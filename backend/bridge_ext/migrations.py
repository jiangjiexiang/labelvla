"""Versioned SQLite upgrades. Upgrade before serving; snapshot and restore on failure."""
import fcntl
import json
import sqlite3
import threading
import uuid
from datetime import datetime
from pathlib import Path

_lock = threading.RLock()
_running = False
_ready = set()
_service_lock = None

def acquire_service_lock():
    global _service_lock
    from .db import DB_PATH
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    _service_lock = (DB_PATH.parent/'platform-service.lock').open('a')
    try: fcntl.flock(_service_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: raise RuntimeError('同一平台数据库已有运行实例，请勿重复启动')

def _baseline():
    from . import db, notifications, tasks, workspaces, exclusions
    db._legacy_init_db()
    notifications._legacy_init_schema()
    tasks._legacy_init_schema()
    workspaces._legacy_init_schema()
    exclusions._legacy_init_schema()
    with db.get_db() as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS qc_scans(dataset TEXT PRIMARY KEY, scanned_at TEXT, episodes INT, failed INT)')

def _reliability():
    from .db import get_db
    with get_db() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS task_jobs(
            task_id INTEGER PRIMARY KEY,status TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 1,
            attempts INTEGER NOT NULL DEFAULT 0,owner TEXT,enqueued_at TEXT,heartbeat_at TEXT)''')
        conn.execute('CREATE INDEX IF NOT EXISTS task_jobs_status ON task_jobs(status,enqueued_at)')
        conn.execute('''CREATE TABLE IF NOT EXISTS dataset_preferences(
            dataset TEXT PRIMARY KEY,hidden INTEGER NOT NULL DEFAULT 0,robot_tag TEXT,
            deleted_at TEXT,deleted_by TEXT,trash_key TEXT UNIQUE)''')

MIGRATIONS = [(1, 'adopt_existing_schema', _baseline), (2, 'persistent_tasks_and_dataset_preferences', _reliability)]

def ensure():
    global _running
    from .db import DB_PATH
    key = str(DB_PATH.resolve())
    with _lock:
        if _running or (key in _ready and DB_PATH.is_file()): return
        _running = True
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        snapshot = None
        try:
            with sqlite3.connect(DB_PATH) as conn:
                has_history = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").fetchone()
                applied = {row[0] for row in conn.execute('SELECT version FROM schema_migrations')} if has_history else set()
                pending = [entry for entry in MIGRATIONS if entry[0] not in applied]
                if not pending:
                    _ready.add(key); return
                if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone():
                    directory = DB_PATH.parent/'migration_backups';directory.mkdir(exist_ok=True)
                    snapshot = directory/f'before_v{pending[0][0]}_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}.db'
                    with sqlite3.connect(snapshot) as target: conn.backup(target)
                    snapshot.chmod(0o600)
                conn.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL,backup_path TEXT)')
            for version, name, apply in pending:
                apply()
                with sqlite3.connect(DB_PATH) as conn:
                    conn.execute('INSERT INTO schema_migrations VALUES (?,?,?,?)', (version, name, datetime.now().isoformat(), str(snapshot) if snapshot else None))
            with sqlite3.connect(DB_PATH) as conn: conn.execute('PRAGMA journal_mode=WAL')
            _ready.add(key)
        except BaseException as error:
            if snapshot:
                with sqlite3.connect(snapshot) as source, sqlite3.connect(DB_PATH) as target: source.backup(target)
            report = DB_PATH.parent/'migration_error.json'
            report.write_text(json.dumps({'at':datetime.now().isoformat(), 'backup':str(snapshot) if snapshot else None,'error':str(error)},ensure_ascii=False,indent=2))
            raise RuntimeError(f'数据库升级失败，已恢复升级前数据库；详情：{report}') from error
        finally: _running = False

def restore(backup):
    from .db import DB_PATH
    acquire_service_lock()  # Refuse to restore while an app owns this database.
    backup = Path(backup).resolve()
    if not backup.is_file(): raise RuntimeError('备份不存在')
    with sqlite3.connect(backup) as source:
        if source.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise RuntimeError('备份文件校验失败')
        directory = DB_PATH.parent/'migration_backups';directory.mkdir(exist_ok=True)
        if DB_PATH.exists():
            with sqlite3.connect(DB_PATH) as current, sqlite3.connect(directory/f'before_restore_{uuid.uuid4().hex}.db') as saved: current.backup(saved)
        with sqlite3.connect(DB_PATH) as target: source.backup(target)
    print('数据库已恢复。请使用匹配该备份的代码版本启动服务。')

if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['restore']);parser.add_argument('backup')
    args=parser.parse_args();restore(args.backup)
