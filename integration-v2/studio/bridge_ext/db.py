"""平台数据库:SQLite 单文件,幂等建表,供 bridge_ext 各模块共用。"""
import hashlib
import secrets
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path('/data/.platform/platform.db')

ROLE_LEVEL = {'admin': 100, 'reviewer': 50, 'annotator': 10}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'annotator',
    disabled INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    login_at TEXT NOT NULL,
    logout_at TEXT,
    ip TEXT,
    device TEXT
);
CREATE TABLE IF NOT EXISTS dataset_status(
    dataset TEXT NOT NULL,
    episode INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'untagged',
    assignee TEXT,
    reviewer TEXT,
    reject_reason TEXT,
    updated_at TEXT,
    updated_by TEXT,
    PRIMARY KEY (dataset, episode)
);
CREATE TABLE IF NOT EXISTS dict_entries(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    UNIQUE (kind, name)
);
CREATE TABLE IF NOT EXISTS qc_reports(
    dataset TEXT NOT NULL,
    episode INTEGER NOT NULL,
    rule TEXT NOT NULL,
    severity TEXT,
    detail TEXT,
    frame INTEGER NOT NULL DEFAULT -1,
    created_at TEXT,
    PRIMARY KEY (dataset, episode, rule, frame)
);
CREATE TABLE IF NOT EXISTS problem_marks(
    dataset TEXT NOT NULL,
    episode INTEGER NOT NULL,
    segment_idx INTEGER NOT NULL,
    reason TEXT,
    marked_by TEXT,
    marked_at TEXT,
    fixed_at TEXT,
    PRIMARY KEY (dataset, episode, segment_idx)
);
"""


def now():
    return datetime.now().isoformat(timespec='seconds')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.sha256((salt + password).encode()).hexdigest()
    return f'{salt}${digest}'


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split('$', 1)
    except ValueError:
        return False
    return secrets.compare_digest(hashlib.sha256((salt + password).encode()).hexdigest(), digest)


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.executescript(_SCHEMA)
        # 内置 admin/admin,首登强制改密
        row = conn.execute(
            "SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL LIMIT 1"
        ).fetchone()
        if row is None:
            conn.execute(
                'INSERT INTO users(username, display_name, password_hash, role,'
                ' must_change_password, created_by, created_at)'
                " VALUES('admin', '管理员', ?, 'admin', 1, 'system', ?)",
                (hash_password('admin'), now()))
