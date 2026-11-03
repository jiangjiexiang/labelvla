"""数据生产任务:任务 / 节点 / 事件 / 版本表,以及后台流水线执行器。

节点都是真实动作,不是占位:

  preprocess  读取 meta/info.json、清点视频与 parquet,产出可标注性报告
  annotate    人工节点:标记 blocked 并把任务挂起,等人从 Studio 完作后继续
  qc          逐 episode 跑质检规则(复用 qc.check_episode),结果落 qc_reports
  package     把 segments 导出到 /data/.platform/exports/task_<id>/ 并打 tar.gz
  compile     对产物求 sha256,写一条版本记录到 versions 表

任务状态:pending → running →(waiting_human →)done / failed / canceled
"""
import hashlib
import json
import os
import queue
import tarfile
import threading
import traceback
import tempfile
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from .common import data_root, db_session, now_iso, require, safe_dataset

router = APIRouter()

TASK_TYPES = {
    'video_annotation': [('preprocess', '预处理'), ('annotate', '人工标注'),
                         ('qc', '人工验收'), ('program_qc', '程序质检'), ('compile', '版本发布')],
    'preprocess': [('preprocess', '预处理')],
    'qc': [('qc', '人工验收'), ('program_qc', '程序质检')],
}
TASK_TYPE_LABEL = {'video_annotation': '视频标注任务',
                   'preprocess': '数据预处理任务', 'qc': '数据质检任务'}
HUMAN_NODES = {'annotate', 'qc'}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    dataset TEXT NOT NULL,
    dataset_name TEXT NOT NULL DEFAULT '',
    task_type TEXT NOT NULL DEFAULT 'video_annotation',
    create_mode TEXT NOT NULL DEFAULT 'new',
    base_task_id INTEGER,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    current_node TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    episodes_total INTEGER NOT NULL DEFAULT 0,
    episodes_done INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS task_nodes(
    task_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    started_at TEXT,
    finished_at TEXT,
    PRIMARY KEY (task_id, key)
);
CREATE TABLE IF NOT EXISTS task_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    at TEXT NOT NULL,
    node TEXT,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT
);
CREATE TABLE IF NOT EXISTS versions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset TEXT NOT NULL,
    dataset_name TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL,
    note TEXT,
    episodes INTEGER NOT NULL DEFAULT 0,
    size_gb REAL,
    status TEXT NOT NULL DEFAULT '已发布',
    task_id INTEGER,
    manifest TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (dataset, version)
);
"""


def init_schema():
    from .notifications import init_schema as init_notifications
    init_notifications()
    with db_session() as db:
        db.executescript(_SCHEMA)
        event_columns = {r['name'] for r in db.execute('PRAGMA table_info(task_events)')}
        if 'actor' not in event_columns:
            db.execute('ALTER TABLE task_events ADD COLUMN actor TEXT')
        version_columns = {r['name'] for r in db.execute('PRAGMA table_info(versions)')}
        for column in ('bundle_path', 'source_bundle'):
            if column not in version_columns:
                db.execute(f'ALTER TABLE versions ADD COLUMN {column} TEXT')
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS versions_source_bundle ON versions(source_bundle) WHERE source_bundle IS NOT NULL')
        columns = {r['name'] for r in db.execute('PRAGMA table_info(tasks)')}
        if 'export_dir' not in columns:
            db.execute('ALTER TABLE tasks ADD COLUMN export_dir TEXT')
        if 'reviewer' not in columns:
            db.execute('ALTER TABLE tasks ADD COLUMN reviewer TEXT')
        if 'reviewer_name' not in columns:
            db.execute('ALTER TABLE tasks ADD COLUMN reviewer_name TEXT')
        if 'assignee' not in columns:
            db.execute('ALTER TABLE tasks ADD COLUMN assignee TEXT')
        if 'assignee_name' not in columns:
            db.execute('ALTER TABLE tasks ADD COLUMN assignee_name TEXT')
        from .workspaces import migrate as migrate_workspaces
        migrate_workspaces(db)
        node_columns = {r['name'] for r in db.execute('PRAGMA table_info(task_nodes)')}
        for column in ('program','result_json'):
            if column not in node_columns:
                db.execute(f'ALTER TABLE task_nodes ADD COLUMN {column} TEXT')
        # Migrate only unexecuted package nodes, preserving completed history.
        candidates = db.execute("SELECT n.task_id FROM task_nodes n JOIN tasks t ON t.id=n.task_id WHERE n.key='package' AND n.status='waiting' AND t.status IN ('pending','waiting_human','failed') AND NOT EXISTS (SELECT 1 FROM task_nodes other WHERE other.task_id=n.task_id AND other.key='program_qc')").fetchall()
        for row in candidates:
            db.execute("UPDATE task_nodes SET key='program_qc',name='程序质检',program='annotation_audit' WHERE task_id=? AND key='package'",(row['task_id'],))
            _event(db,row['task_id'],'program_qc','未执行的生产打包已调整为程序质检；完整数据打包由版本发布节点执行')
        from .workflow import LEGACY_PROGRAMS
        for key,program in LEGACY_PROGRAMS.items():
            db.execute('UPDATE task_nodes SET program=? WHERE key=? AND program IS NULL',(program,key))



# ── 工具 ──────────────────────────────────────────────────

def _dict(row):
    return dict(row) if row is not None else None


def _event(db, task_id, node, message, level='info', actor='system'):
    db.execute('INSERT INTO task_events(task_id, at, node, level, message, actor) VALUES (?,?,?,?,?,?)',
               (task_id, now_iso(), node, level, message, actor))


def _task_or_404(task_id: int):
    with db_session() as db:
        row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
    if row is None:
        raise HTTPException(404, '任务不存在')
    return dict(row)


def _exports_dir(task_id: int) -> Path:
    d = data_root() / '.platform' / 'exports' / f'task_{task_id}'
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── 节点实现 ──────────────────────────────────────────────

def _node_preprocess(ctx, progress):
    p = ctx['path']
    info = json.loads((p / 'meta' / 'info.json').read_text(encoding='utf8'))
    version = str(info.get('codebase_version') or '')
    cams = [k for k, v in info.get('features', {}).items() if v.get('dtype') == 'video']
    total = int(info.get('total_episodes') or 0)
    fps = float(info.get('fps') or 30)
    progress(10, f'{version} · {total} episodes · {len(cams)} 相机')

    if version.startswith('v3'):
        expect = 0
        for cam in cams:
            expect += len(list((p / 'videos' / cam).glob('chunk-*/*.mp4')))
        found = expect
        missing = max(0, total * max(1, len(cams)) - found)
    else:
        expect = total * max(1, len(cams))
        found = 0
        for cam in cams:
            found += len(list((p / 'videos' / 'chunk-000' / cam).glob('episode_*.mp4')))
        missing = max(0, expect - found)
    progress(45, f'视频 {found}/{expect}')

    parquet = len(list((p / 'data').glob('**/*.parquet')))
    seg_dir = p / 'segments'
    annotated = len([f for f in seg_dir.glob('episode_*.json')]) if seg_dir.is_dir() else 0
    progress(80, f'parquet {parquet} · 已有标注 {annotated}')

    hours = round(float(info.get('total_frames') or 0) / fps / 3600, 2)
    msg = (f'{version} · {total} episodes · {hours}h · {len(cams)} 相机 · '
           f'视频 {found}/{expect}{" · 缺 %d" % missing if missing else ""} · '
           f'parquet {parquet} · 已标注 {annotated}')
    progress(100, msg)
    return {'episodes_total': total, 'cameras': len(cams), 'fps': fps,
            'hours': hours, 'videos': found, 'videos_expected': expect,
            'missing_videos': missing, 'parquet': parquet, 'annotated': annotated}


def _node_qc(ctx, progress):
    from .qc import check_episode

    p = ctx['path']
    info = json.loads((p / 'meta' / 'info.json').read_text(encoding='utf8'))
    shapes = {}
    for cam, v in info.get('features', {}).items():
        if v.get('dtype') == 'video' and len(v.get('shape') or []) >= 2:
            shapes[cam] = (int(v['shape'][1]), int(v['shape'][0]))

    seg_dir = p / 'segments'
    from .exclusions import excluded
    skip_rows = excluded(str(p))
    files = [f for f in sorted(seg_dir.glob('episode_*.json')) if int(f.stem.split('_')[1]) not in skip_rows] if seg_dir.is_dir() else []
    rows, failed = [], set()
    now = now_iso()
    for i, f in enumerate(files):
        try:
            episode = int(f.stem.split('_')[1])
            data = json.loads(f.read_text(encoding='utf8'))
        except Exception:
            continue
        for rule, severity, detail, frame in check_episode(p, data, episode, shapes):
            rows.append((str(p), episode, rule, severity, detail, frame, now))
            failed.add(episode)
        if i % 5 == 0 or i == len(files) - 1:
            progress(int(90 * (i + 1) / max(1, len(files))),
                     f'已检查 {i + 1}/{len(files)} 个 episode,问题 {len(rows)} 条')

    with db_session() as db:
        db.execute('CREATE TABLE IF NOT EXISTS qc_scans('
                   'dataset TEXT PRIMARY KEY, scanned_at TEXT, episodes INT, failed INT)')
        db.execute('DELETE FROM qc_reports WHERE dataset=?', (str(p),))
        db.executemany(
            'INSERT OR REPLACE INTO qc_reports'
            '(dataset, episode, rule, severity, detail, frame, created_at) VALUES (?,?,?,?,?,?,?)',
            rows)
        db.execute('INSERT OR REPLACE INTO qc_scans(dataset, scanned_at, episodes, failed)'
                   ' VALUES (?,?,?,?)',
                   (str(p), now, int(info.get('total_episodes') or 0), len(failed)))
    progress(100, f'{len(files)} 个已标注 episode,{len(failed)} 个有问题,共 {len(rows)} 条')
    return {'issues': len(rows), 'failed_episodes': len(failed), 'scanned': len(files)}


def _file_sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def _node_package(ctx, progress):
    p = ctx['path'].resolve()
    exports = data_root() / '.platform' / 'exports'
    exports.mkdir(parents=True, exist_ok=True)
    if p == exports.resolve() or p in exports.resolve().parents:
        raise RuntimeError('导出目录不能位于源数据集内部')
    out = Path(tempfile.mkdtemp(prefix=f'task_{ctx["task_id"]}_', dir=exports))
    target = out / 'dataset'
    target.mkdir()
    from .exclusions import excluded
    skip_rows = excluded(str(p))
    source_files = {}
    for item in p.rglob('*'):
        if item.is_symlink():
            raise RuntimeError(f'完整快照暂不接受符号链接：{item.relative_to(p)}')
        if item.is_file():
            stat = item.stat()
            source_files[item.relative_to(p).as_posix()] = (stat.st_size, stat.st_mtime_ns)
        elif item.is_dir():
            (target / item.relative_to(p)).mkdir(parents=True, exist_ok=True)
    inventory = []
    for i, (relative, before) in enumerate(sorted(source_files.items())):
        source_file = p / relative
        dest = target / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_file, dest)
        digest = _file_sha256(source_file)
        if _file_sha256(dest) != digest:
            raise RuntimeError(f'文件复制校验失败：{relative}')
        after = source_file.stat()
        if (after.st_size, after.st_mtime_ns) != before:
            raise RuntimeError(f'复制过程中源数据发生变化：{relative}，请停止编辑后重新打包')
        inventory.append({'path': relative, 'bytes': before[0], 'sha256': digest})
        if i % 20 == 0 or i == len(source_files)-1:
            progress(int(75 * (i+1) / max(1,len(source_files))), f'完整复制 {i+1}/{len(source_files)} 个文件')
    after_files = {f.relative_to(p).as_posix(): (f.stat().st_size, f.stat().st_mtime_ns) for f in p.rglob('*') if f.is_file()}
    if after_files != source_files:
        raise RuntimeError('复制期间数据集发生变化，请重新打包')
    info = json.loads((target / 'meta/info.json').read_text(encoding='utf8'))
    annotations = 0
    for f in (target / 'segments').glob('episode_*.json'):
        if int(f.stem.split('_')[1]) in skip_rows:
            continue
        annotations += len(json.loads(f.read_text(encoding='utf8')).get('segments') or [])
    with db_session() as db:
        has_status = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='dataset_status'").fetchone()
        statuses = [dict(r) for r in db.execute('SELECT * FROM dataset_status WHERE dataset=?', (str(p),))] if has_status else []
    manifest = {'task_id': ctx['task_id'], 'task_name': ctx['name'], 'dataset': str(p),
                'export_kind': 'full_dataset', 'episodes': int(info.get('total_episodes') or 0),
                'annotations': annotations, 'skipped_episodes': list(skip_rows.values()),
                'platform_status': statuses, 'files': inventory,
                'generated_at': now_iso(), 'source': 'labelvla-studio'}
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf8')
    progress(80, '打包完整数据集：视频、Parquet、元数据和标注')
    tgz = Path(str(out) + '.tar.gz')
    with tarfile.open(tgz, 'x:gz') as tar:
        tar.add(out / 'manifest.json', arcname='manifest.json')
        tar.add(target, arcname='dataset')
    with db_session() as db:
        db.execute('UPDATE tasks SET export_dir=? WHERE id=?', (str(out), ctx['task_id']))
    progress(100, f'完整数据集 {manifest["episodes"]} 个 episode / {len(inventory)} 个文件')
    return {'episodes': manifest['episodes'], 'annotations': annotations, 'bundle': str(tgz), 'bytes': tgz.stat().st_size}


def _node_compile(ctx, progress):
    p = Path(ctx['dataset'])  # Version numbers belong to the original dataset lineage.
    with db_session() as db:
        task = db.execute('SELECT export_dir FROM tasks WHERE id=?', (ctx['task_id'],)).fetchone()
    out = Path(task['export_dir']) if task and task['export_dir'] else _exports_dir(ctx['task_id'])
    source = Path(str(out) + '.tar.gz')
    if not source.is_file() or not (out / 'manifest.json').is_file():
        raise RuntimeError('找不到完整导出产物，请重新执行打包节点')
    digest = _file_sha256(source)
    manifest = json.loads((out / 'manifest.json').read_text(encoding='utf8'))
    progress(30, '校验独立导出快照')
    with db_session() as db:
        db.execute('BEGIN IMMEDIATE')
        existing = db.execute('SELECT version, manifest, bundle_path FROM versions WHERE source_bundle=?', (str(source),)).fetchone()
        if existing:
            bundle = Path(existing['bundle_path'])
            if not bundle.is_file() or _file_sha256(bundle) != existing['manifest']:
                raise RuntimeError('已发布版本文件缺失或校验失败，禁止覆盖')
            version = existing['version']
            digest = existing['manifest']
        else:
            rows = db.execute('SELECT version FROM versions WHERE dataset=?', (str(p),)).fetchall()
            numbers = []
            for row in rows:
                try:
                    numbers.append(int(row['version'].lstrip('Vv').split('.')[0]))
                except (ValueError, AttributeError):
                    pass
            number = max(numbers, default=0) + 1
            parent = data_root() / '.platform' / 'releases' / hashlib.sha256(str(p).encode()).hexdigest()[:16]
            parent.mkdir(parents=True, exist_ok=True)
            while True:
                version = f'V{number}.0'
                release = parent / version
                try:
                    release.mkdir()
                    break
                except FileExistsError:
                    number += 1
            # Only new paths are written. A failed attempt leaves its directory reserved.
            shutil.copytree(out, release / 'snapshot')
            dataset_dir = f'{p.name}_{version}'
            (release / 'snapshot' / 'dataset').rename(release / 'snapshot' / dataset_dir)
            release_manifest = json.loads((release / 'snapshot/manifest.json').read_text())
            release_manifest.update(version=version, dataset_dir=dataset_dir, original_dataset=str(p))
            (release / 'snapshot/manifest.json').write_text(json.dumps(release_manifest, ensure_ascii=False, indent=2))
            bundle = release / 'dataset.tar.gz'
            with tarfile.open(bundle, 'x:gz') as archive:
                archive.add(release / 'snapshot/manifest.json', arcname='manifest.json')
                archive.add(release / 'snapshot' / dataset_dir, arcname=dataset_dir)
            digest = _file_sha256(bundle)
            db.execute(
                'INSERT INTO versions(dataset,dataset_name,version,note,episodes,size_gb,status,task_id,manifest,created_by,created_at,bundle_path,source_bundle) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (str(p), p.name, version, f'任务 {ctx["task_id"]} · {ctx["name"]}', int(manifest['episodes']), round(bundle.stat().st_size / 1024**3, 6),
                 '已发布', ctx['task_id'], digest, ctx.get('user'), now_iso(), str(bundle), str(source)))
            _event(db, ctx['task_id'], 'compile', f'发布独立版本 {version} sha256={digest[:16]}…')
    progress(100, f'已发布 {version} · sha256 {digest[:16]}…')
    return {'version': version, 'sha256': digest, 'bundle': str(bundle)}


NODE_RUNNERS = {'preprocess': _node_preprocess, 'qc': _node_qc,
                'package': _node_package, 'compile': _node_compile}


# ── 执行器 ────────────────────────────────────────────────

_queue = queue.Queue()
_worker_lock = threading.Lock()
_worker = {'thread': None}
_running = {'task_id': None}


def _ensure_worker():
    with _worker_lock:
        t = _worker['thread']
        if t is None or not t.is_alive():
            t = threading.Thread(target=_worker_loop, name='task-worker', daemon=True)
            t.start()
            _worker['thread'] = t


def _worker_loop():
    while True:
        task_id = _queue.get()
        try:
            _run_task(task_id)
        except Exception:
            traceback.print_exc()
        finally:
            _queue.task_done()


def enqueue(task_id: int):
    _ensure_worker()
    _queue.put(task_id)


def _run_task(task_id: int):
    with db_session() as db:
        row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
        if row is None or row['status'] == 'canceled':
            return
        nodes = db.execute('SELECT * FROM task_nodes WHERE task_id=? ORDER BY seq',
                           (task_id,)).fetchall()
        db.execute("UPDATE tasks SET status='running', started_at=COALESCE(started_at, ?),"
                   ' updated_at=? WHERE id=?', (now_iso(), now_iso(), task_id))
        _event(db, task_id, None, '任务开始执行')

    _running['task_id'] = task_id
    total = max(1, len(nodes))
    done_before = 0
    try:
        for n in nodes:
            if n['status'] == 'done':
                done_before += 1
                continue
            with db_session() as db:
                cur = db.execute('SELECT status FROM tasks WHERE id=?', (task_id,)).fetchone()
            if cur is None or cur['status'] == 'canceled':
                return
            if n['key'] in HUMAN_NODES:
                with db_session() as db:
                    db.execute("UPDATE task_nodes SET status='blocked', message=?,"
                               ' started_at=COALESCE(started_at, ?) WHERE task_id=? AND key=?',
                               ('等待审核负责人查看视频并确认质检' if n['key'] == 'qc' else '等待人工标注完成', now_iso(), task_id, n['key']))
                    db.execute("UPDATE tasks SET status='waiting_human', current_node=?,"
                               ' updated_at=? WHERE id=?', (n['key'], now_iso(), task_id))
                    _event(db, task_id, n['key'], '人工节点已就绪,等待人工完成', 'warn')
                return

            ctx = dict(n)
            ctx.update(_load_task_ctx(task_id))
            with db_session() as db:
                db.execute("UPDATE task_nodes SET status='running',"
                           ' started_at=COALESCE(started_at, ?) WHERE task_id=? AND key=?',
                           (now_iso(), task_id, n['key']))
                db.execute('UPDATE tasks SET current_node=?, updated_at=? WHERE id=?',
                           (n['key'], now_iso(), task_id))
                _event(db, task_id, n['key'], f'节点「{n["name"]}」开始')

            last = {'msg': ''}

            def progress(pct, msg=None, _key=n['key'], _i=done_before):
                if msg:
                    last['msg'] = msg
                with db_session() as db:
                    db.execute('UPDATE task_nodes SET progress=?, message=? WHERE task_id=? AND key=?',
                               (int(pct), msg, task_id, _key))
                    db.execute('UPDATE tasks SET progress=?, updated_at=? WHERE id=?',
                               (int((_i + pct / 100) / total * 100), now_iso(), task_id))

            try:
                if n['program']:
                    from .workflow import run as run_program
                    result = run_program(ctx, progress)
                else:
                    result = NODE_RUNNERS[n['key']](ctx, progress)
                result = result or {}
                report_dir = data_root()/'.platform/task_reports'/str(task_id)
                report_dir.mkdir(parents=True,exist_ok=True)
                import uuid
                report_file = report_dir/f'{n["key"]}_{uuid.uuid4().hex}.json'
                report_file.write_text(json.dumps(result,ensure_ascii=False,indent=2,default=str))
                result['report_path'] = str(report_file)
                with db_session() as db:
                    db.execute('UPDATE task_nodes SET result_json=? WHERE task_id=? AND key=?',(json.dumps(result,ensure_ascii=False,default=str),task_id,n['key']))
                if result.get('passed') is False:
                    raise RuntimeError(str(result.get('message') or '程序质检未通过'))
            except Exception as exc:
                with db_session() as db:
                    db.execute("UPDATE task_nodes SET status='failed', message=? WHERE task_id=? AND key=?",
                               (str(exc), task_id, n['key']))
                    db.execute("UPDATE tasks SET status='failed', error=?, updated_at=? WHERE id=?",
                               (str(exc), now_iso(), task_id))
                    _event(db, task_id, n['key'], f'节点失败:{exc}', 'error')
                traceback.print_exc()
                return

            done_before += 1
            with db_session() as db:
                db.execute("UPDATE task_nodes SET status='done', progress=100, message=?,"
                           ' finished_at=? WHERE task_id=? AND key=?',
                           (str((result or {}).get('message') or last['msg'] or '完成'),
                            now_iso(), task_id, n['key']))
                extra = ''
                if n['key'] == 'compile' and result:
                    extra = f' 发布 {result.get("version")}'
                _event(db, task_id, n['key'], f'节点「{n["name"]}」完成{extra}')
                db.execute('UPDATE tasks SET progress=?, updated_at=? WHERE id=?',
                           (int(done_before / total * 100), now_iso(), task_id))

        with db_session() as db:
            db.execute("UPDATE tasks SET status='done', progress=100, current_node=NULL,"
                       ' finished_at=?, updated_at=? WHERE id=?', (now_iso(), now_iso(), task_id))
            _event(db, task_id, None, '任务全部完成')
    finally:
        _running['task_id'] = None


def _load_task_ctx(task_id: int) -> dict:
    with db_session() as db:
        row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
    if row is None:
        raise RuntimeError('任务不存在')
    return {'task_id': row['id'], 'name': row['name'], 'dataset': row['dataset'],
            'path': Path(row['edited_dataset'] or row['workspace_path'] or row['source_dataset'] or row['dataset']), 'user': row['created_by']}


# ── 接口 ──────────────────────────────────────────────────

@router.get('/api/bridge/tasks')
def list_tasks(request: Request, status: str = '', q: str = '', dataset: str = '',
               limit: int = 200):
    require(request)
    sql = 'SELECT * FROM tasks WHERE 1=1'
    args = []
    if status:
        sql += ' AND status=?'
        args.append(status)
    if dataset:
        sql += ' AND dataset=?'
        args.append(str(safe_dataset(dataset)))
    if q:
        sql += ' AND (name LIKE ? OR dataset_name LIKE ? OR CAST(id AS TEXT)=?)'
        args += [f'%{q}%', f'%{q}%', q]
    sql += ' ORDER BY id DESC LIMIT ?'
    args.append(max(1, min(limit, 1000)))
    with db_session() as db:
        rows = db.execute(sql, args).fetchall()
        nodes = db.execute('SELECT * FROM task_nodes ORDER BY task_id, seq').fetchall()
    by_task = {}
    for n in nodes:
        by_task.setdefault(n['task_id'], []).append(dict(n))
    out = []
    for r in rows:
        d = dict(r)
        d['task_type_label'] = TASK_TYPE_LABEL.get(d['task_type'], d['task_type'])
        d['nodes'] = by_task.get(d['id'], [])
        out.append(d)
    return {'tasks': out, 'stats': _stats()}


def _stats():
    with db_session() as db:
        rows = db.execute('SELECT status, COUNT(*) c FROM tasks GROUP BY status').fetchall()
        total = db.execute('SELECT COUNT(*) c FROM tasks').fetchone()['c']
    dist = {r['status']: r['c'] for r in rows}
    return {'total': total,
            'running': dist.get('running', 0) + dist.get('waiting_human', 0),
            'pending': dist.get('pending', 0),
            'done': dist.get('done', 0),
            'failed': dist.get('failed', 0),
            'dist': dist}


@router.get('/api/bridge/tasks/stats')
def task_stats(request: Request):
    require(request)
    return _stats()


@router.get('/api/bridge/workflow/catalog')
def workflow_catalog(request: Request):
    require(request)
    from .workflow import catalog
    return catalog()


@router.put('/api/bridge/tasks/{task_id}/workflow')
def edit_workflow(request: Request, task_id: int, payload: dict):
    user=require(request,'admin','reviewer')
    from .workflow import normalize
    with db_session() as db:
        db.execute('BEGIN IMMEDIATE')
        task=db.execute('SELECT * FROM tasks WHERE id=?',(task_id,)).fetchone()
        if not task:raise HTTPException(404,'任务不存在')
        if task['status'] not in ('waiting_human','failed') or _running['task_id']==task_id:
            raise HTTPException(409,'只有暂停等待人工或已失败的任务可以编辑后续流程')
        old=[dict(row) for row in db.execute('SELECT * FROM task_nodes WHERE task_id=? ORDER BY seq',(task_id,))]
        expected=payload.get('expected_nodes')
        current=[{k:row[k] for k in ('key','name','program','status')} for row in old]
        if expected!=current:
            raise HTTPException(409,'流程状态已变化，请刷新后重新编辑')
        nodes=normalize(payload.get('workflow'),task['task_type'],legacy_keys=[row['key'] for row in old if row['status']=='done' and row['key']=='package'])
        if any(n['key']=='annotate' for n in nodes) and not task['assignee']:
            raise HTTPException(400,'此任务没有标注负责人，不能添加人工标注节点')
        prefix=0
        for row in old:
            if row['status']!='done':break
            prefix+=1
        locked=prefix+(1 if len(old)>prefix and old[prefix]['status']=='blocked' else 0)
        for i in range(locked):
            if i>=len(nodes) or any(nodes[i][key]!=old[i][key] for key in ('key','name','program')):
                raise HTTPException(409,'已完成节点和当前人工节点不能改动，只能编辑后续流程')
        if len(nodes)<=prefix:
            raise HTTPException(400,'至少保留一个后续节点')
        if db.execute("SELECT 1 FROM studio_drafts WHERE task_id=? AND status='uploading'",(task_id,)).fetchone():
            raise HTTPException(409,'Studio 正在保存，请稍后再编辑流程')
        db.execute('DELETE FROM task_nodes WHERE task_id=? AND seq>=?',(task_id,locked))
        db.executemany('INSERT INTO task_nodes(task_id,seq,key,name,status,program) VALUES (?,?,?,?,?,?)',
                       [(task_id,i,node['key'],node['name'],'waiting',node['program']) for i,node in enumerate(nodes) if i>=locked])
        db.execute('UPDATE tasks SET export_dir=NULL,updated_at=?,progress=? WHERE id=?',(now_iso(),int(100*prefix/len(nodes)),task_id))
        _event(db,task_id,None,'编辑后续流程：'+' → '.join(node['name'] for node in nodes),actor=user['username'])
    return get_task(request,task_id)


@router.post('/api/bridge/tasks/{task_id}/rework')
def rework_task(request: Request, task_id: int):
    user=require(request)
    with db_session() as db:
        db.execute('BEGIN IMMEDIATE')
        task=db.execute('SELECT * FROM tasks WHERE id=?',(task_id,)).fetchone()
        if not task:raise HTTPException(404,'任务不存在')
        if user['role'] not in ('admin','reviewer') and user['username']!=task['assignee']:
            raise HTTPException(403,'只有任务负责人或管理员可以返回标注修正')
        if task['status']!='failed' or _running['task_id']==task_id:
            raise HTTPException(409,'只有已失败的任务可以返回标注修正')
        node=db.execute("SELECT seq FROM task_nodes WHERE task_id=? AND key='annotate'",(task_id,)).fetchone()
        if not node:raise HTTPException(400,'此流程没有人工标注节点，请新建标注任务修正数据')
        db.execute("UPDATE task_nodes SET status='waiting',progress=0,message=NULL,started_at=NULL,finished_at=NULL,result_json=NULL WHERE task_id=? AND seq>=?",(task_id,node['seq']))
        total=db.execute('SELECT COUNT(*) FROM task_nodes WHERE task_id=?',(task_id,)).fetchone()[0]
        db.execute("UPDATE tasks SET status='pending',current_node=NULL,error=NULL,export_dir=NULL,progress=?,updated_at=? WHERE id=?",(int(100*node['seq']/total),now_iso(),task_id))
        _event(db,task_id,'annotate','程序检查未通过，返回标注修正',actor=user['username'])
    enqueue(task_id)
    return get_task(request,task_id)


@router.get('/api/bridge/tasks/{task_id}')
def get_task(request: Request, task_id: int):
    require(request)
    with db_session() as db:
        row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
        if row is None:
            raise HTTPException(404, '任务不存在')
        nodes = db.execute('SELECT * FROM task_nodes WHERE task_id=? ORDER BY seq',
                           (task_id,)).fetchall()
        events = db.execute('SELECT * FROM task_events WHERE task_id=? ORDER BY id DESC LIMIT 50',
                            (task_id,)).fetchall()
    d = dict(row)
    d['task_type_label'] = TASK_TYPE_LABEL.get(d['task_type'], d['task_type'])
    from .workflow import catalog
    names={item['id']:item['name'] for item in catalog()['programs']}
    names.update(publish_dataset='完整数据集版本发布',export_dataset='完整数据导出')
    d['nodes'] = [{**dict(n),'program_name':names.get(n['program'],'')} for n in nodes]
    d['events'] = [dict(e) for e in events]
    return d


@router.post('/api/bridge/tasks')
def create_task(request: Request, payload: dict):
    user = require(request, 'admin', 'reviewer')
    try:
        p = safe_dataset(str(payload.get('dataset') or ''))
    except HTTPException:
        raise HTTPException(400, '请选择 /data 下的数据集')
    name = str(payload.get('name') or '').strip() or f'{p.name} · 数据生产'
    task_type = str(payload.get('task_type') or 'video_annotation')
    if task_type not in TASK_TYPES:
        raise HTTPException(400, '未知任务类型')
    assignee = str(payload.get('assignee') or '').strip()
    assignee_name = None
    if task_type == 'video_annotation' and not assignee:
        raise HTTPException(400, '请选择标注负责人')
    if assignee:
        with db_session() as db:
            person = db.execute('SELECT * FROM users WHERE username=? AND deleted_at IS NULL', (assignee,)).fetchone()
        if person is None or person['disabled'] or (person['expires_at'] and person['expires_at'] <= now_iso()):
            raise HTTPException(400, '分配账号不存在、已禁用或已过期')
        assignee_name = person['display_name'] or person['username']
    reviewer = str(payload.get('reviewer') or '').strip()
    reviewer_name = None
    if not reviewer:
        raise HTTPException(400, '请选择审核负责人')
    if reviewer:
        with db_session() as db:
            person = db.execute('SELECT * FROM users WHERE username=? AND deleted_at IS NULL', (reviewer,)).fetchone()
        if person is None or person['disabled'] or person['role'] not in ('admin', 'reviewer') or (person['expires_at'] and person['expires_at'] <= now_iso()):
            raise HTTPException(400, '审核负责人必须是有效的管理员或审核员')
        reviewer_name = person['display_name'] or person['username']
    source = p
    base_version_id = payload.get('base_version_id')
    if base_version_id is not None:
        with db_session() as db:
            version_row = db.execute('SELECT * FROM versions WHERE id=? AND dataset=?', (base_version_id, str(p))).fetchone()
        if version_row is None:
            raise HTTPException(400, '起始版本不属于此数据集')
        source = _version_dataset(dict(version_row))
        if source is None:
            raise HTTPException(409, '此历史版本没有完整数据快照，无法继续编辑')
    from .workflow import normalize
    nodes = normalize(payload.get('workflow'),task_type)
    if any(node['key']=='annotate' for node in nodes) and not assignee:
        raise HTTPException(400,'请选择标注负责人')
    try:
        info = json.loads((source / 'meta' / 'info.json').read_text(encoding='utf8'))
        episodes = int(info.get('total_episodes') or 0)
    except Exception:
        episodes = 0
    now = now_iso()
    with db_session() as db:
        cur = db.execute(
            'INSERT INTO tasks(name, dataset, dataset_name, task_type, create_mode,'
            ' base_task_id, description, status, progress, episodes_total, created_by,'
            ' created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?)',
            (name, str(p), p.name, task_type, str(payload.get('create_mode') or 'new'),
             payload.get('base_task_id'), str(payload.get('description') or ''),
             'pending', episodes, user['username'], now, now))
        task_id = cur.lastrowid
        db.execute('UPDATE tasks SET source_dataset=? WHERE id=?', (str(source), task_id))
        db.execute('UPDATE tasks SET assignee=?, assignee_name=? WHERE id=?', (assignee or None, assignee_name, task_id))
        db.execute('UPDATE tasks SET reviewer=?, reviewer_name=? WHERE id=?', (reviewer or None, reviewer_name, task_id))
        db.executemany(
            'INSERT INTO task_nodes(task_id, seq, key, name, status, program) VALUES (?,?,?,?,?,?)',
            [(task_id, i, node['key'], node['name'], 'waiting', node['program']) for i,node in enumerate(nodes)])
        _event(db, task_id, None, f'任务创建 · {TASK_TYPE_LABEL[task_type]} · {p.name}', actor=user['username'])
    enqueue(task_id)
    from .notifications import schedule_published
    schedule_published(task_id)
    return get_task(request, task_id)


@router.post('/api/bridge/tasks/{task_id}/cancel')
def cancel_task(request: Request, task_id: int, payload: dict = None):
    user = require(request, 'admin', 'reviewer')
    _task_or_404(task_id)
    with db_session() as db:
        db.execute("UPDATE tasks SET status='canceled', updated_at=? WHERE id=?",
                   (now_iso(), task_id))
        db.execute("UPDATE task_nodes SET status='skipped' WHERE task_id=? AND status IN ('waiting','blocked')",
                   (task_id,))
        _event(db, task_id, None, '任务已取消', 'warn', actor=user['username'])
    return get_task(request, task_id)


@router.post('/api/bridge/tasks/{task_id}/retry')
def retry_task(request: Request, task_id: int, payload: dict = None):
    user = require(request, 'admin', 'reviewer')
    _task_or_404(task_id)
    with db_session() as db:
        db.execute("UPDATE task_nodes SET status='waiting', progress=0, message=NULL"
                   " WHERE task_id=? AND status IN ('failed','skipped')", (task_id,))
        db.execute("UPDATE tasks SET status='pending', error=NULL, updated_at=? WHERE id=?",
                   (now_iso(), task_id))
        _event(db, task_id, None, '任务重试', actor=user['username'])
    enqueue(task_id)
    return get_task(request, task_id)


@router.post('/api/bridge/tasks/{task_id}/nodes/{key}/complete')
def complete_node(request: Request, task_id: int, key: str, payload: dict = None):
    user = require(request)
    payload = payload or {}
    decision = payload.get('decision', 'approved')
    if decision not in ('approved', 'rejected') or (key != 'qc' and decision != 'approved'):
        raise HTTPException(400, '质检决定无效')
    reason = str(payload.get('reason') or '').strip()
    if decision == 'rejected' and (not reason or len(reason) > 500):
        raise HTTPException(400, '请填写质检打回原因，最多500字符')
    with db_session() as db:
        db.execute('BEGIN IMMEDIATE')
        task = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
        if task is None:
            raise HTTPException(404, '任务不存在')
        node = db.execute('SELECT * FROM task_nodes WHERE task_id=? AND key=?', (task_id, key)).fetchone()
        if node is None or key not in HUMAN_NODES:
            raise HTTPException(400, '只有人工节点需要手动完成')
        if task['status'] != 'waiting_human' or task['current_node'] != key or node['status'] != 'blocked':
            raise HTTPException(409, '任务当前不在这个人工节点，不能重复确认或跳过流程')
        pending = db.execute("SELECT COUNT(*) FROM task_nodes WHERE task_id=? AND seq<? AND status!='done'", (task_id, node['seq'])).fetchone()[0]
        if pending:
            raise HTTPException(409, '前置节点尚未完成')
        owner = task['reviewer'] if key == 'qc' else task['assignee']
        if user['role'] != 'admin':
            if user['username'] != owner or (key == 'qc' and user['role'] != 'reviewer'):
                raise HTTPException(403, '只有任务指定负责人或管理员可确认该节点')
        if decision == 'approved' and key == 'annotate':
            if db.execute("SELECT 1 FROM studio_drafts WHERE task_id=? AND status='uploading'", (task_id,)).fetchone():
                raise HTTPException(409, 'Studio 正在保存数据，请完成保存后再提交审核')
            if task['workspace_path'] and not task['edited_dataset']:
                raise HTTPException(409, '请先在 Studio 点击保存修改，再提交审核')
        if decision == 'rejected':
            annotate = db.execute("SELECT seq FROM task_nodes WHERE task_id=? AND key='annotate'", (task_id,)).fetchone()
            seq = annotate['seq'] if annotate else node['seq']
            db.execute("UPDATE task_nodes SET status='waiting',progress=0,message=NULL,started_at=NULL,finished_at=NULL,result_json=NULL WHERE task_id=? AND seq>=?", (task_id, seq))
            db.execute("UPDATE tasks SET status='pending',current_node=NULL,export_dir=NULL,error=NULL,progress=?,updated_at=? WHERE id=?", (int(100*seq/max(1,db.execute('SELECT COUNT(*) FROM task_nodes WHERE task_id=?',(task_id,)).fetchone()[0])), now_iso(), task_id))
            _event(db, task_id, key, f'质检打回：{reason}', 'warn', actor=user['username'])
        else:
            message = ('视频质检通过' if key == 'qc' else '人工标注完成') + f' · {user["username"]}'
            db.execute("UPDATE task_nodes SET status='done',progress=100,message=?,finished_at=? WHERE task_id=? AND key=?", (message, now_iso(), task_id, key))
            db.execute("UPDATE tasks SET status='pending',updated_at=? WHERE id=?", (now_iso(), task_id))
            _event(db, task_id, key, message, actor=user['username'])
    enqueue(task_id)
    return get_task(request, task_id)


# ── Episode / 视频 / 版本 ─────────────────────────────────

def _read_jsonl(p: Path) -> list:
    if not p.is_file():
        return []
    out = []
    with p.open(encoding='utf8') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except Exception:
                    pass
    return out


@router.get('/api/bridge/episodes')
def list_episodes(request: Request, dataset: str, q: str = '', limit: int = 500):
    require(request)
    p = safe_dataset(dataset)
    info = json.loads((p / 'meta' / 'info.json').read_text(encoding='utf8'))
    fps = float(info.get('fps') or 30)
    total = int(info.get('total_episodes') or 0)
    cams = [k for k, v in info.get('features', {}).items() if v.get('dtype') == 'video']
    avg_len = round(float(info.get('total_frames') or 0) / max(1, total))

    meta = _read_jsonl(p / 'meta' / 'episodes.jsonl')
    lengths, texts = {}, {}
    for e in meta:
        idx = e.get('episode_index')
        if idx is None:
            continue
        lengths[int(idx)] = e.get('length')
        tasks = e.get('tasks')
        texts[int(idx)] = tasks[0] if tasks else e.get('task')

    seg_dir = p / 'segments'
    seg_count = {}
    if seg_dir.is_dir():
        for f in seg_dir.glob('episode_*.json'):
            try:
                seg_count[int(f.stem.split('_')[1])] = len(
                    json.loads(f.read_text(encoding='utf8')).get('segments') or [])
            except Exception:
                seg_count[int(f.stem.split('_')[1])] = 0

    status_map = {}
    with db_session() as db:
        try:
            for r in db.execute('SELECT episode, status FROM dataset_status WHERE dataset=?',
                                (str(p),)):
                status_map[r['episode']] = r['status']
        except Exception:
            pass

    from .exclusions import excluded
    skipped = excluded(str(p))
    rows = []
    for i in range(min(total, max(1, min(limit, 2000)))):
        length = lengths.get(i) or avg_len
        rows.append({
            'skipped': i in skipped, 'skip_reason': skipped.get(i, {}).get('reason'),
            'index': i,
            'length': length,
            'duration': f'{int(length / fps) // 60:02d}:{int(length / fps) % 60:02d}',
            'task': texts.get(i) or '',
            'cameras': len(cams),
            'annotated': i not in skipped and seg_count.get(i, 0) > 0,
            'segments': seg_count.get(i, 0),
            'status': status_map.get(i, 'labeling' if seg_count.get(i, 0) > 0 else 'untagged'),
        })
    if q:
        ql = q.lower()
        rows = [r for r in rows
                if ql in str(r['index']).lower() or ql in (r['task'] or '').lower()]
    return {'dataset': str(p), 'name': p.name, 'total': total, 'fps': fps,
            'cameras': cams, 'version': str(info.get('codebase_version') or ''),
            'episodes': rows}


@router.get('/api/bridge/videos')
def list_videos(request: Request, dataset: str, limit: int = 200):
    require(request)
    p = safe_dataset(dataset)
    info = json.loads((p / 'meta' / 'info.json').read_text(encoding='utf8'))
    fps = float(info.get('fps') or 30)
    vroot = p / 'videos'
    cams = [k for k, v in info.get('features', {}).items() if v.get('dtype') == 'video']
    out = []
    if vroot.is_dir():
        for f in vroot.rglob('*.mp4'):
            rel = f.relative_to(vroot).parts
            cam = next((part for part in rel[:-1] if part in cams), rel[0] if rel else '')
            ep = None
            stem = f.stem
            for token in stem.replace('_', '-').split('-'):
                if token.isdigit():
                    ep = int(token)
                    break
            try:
                size = f.stat().st_size / 1024 ** 2
            except OSError:
                continue
            out.append({'path': f.relative_to(p).as_posix(), 'camera': cam,
                        'episode': ep, 'size_mb': round(size, 1), 'name': stem})
    out.sort(key=lambda r: (r['camera'], r['episode'] if r['episode'] is not None else 0, r['name']))
    return {'dataset': str(p), 'name': p.name, 'fps': fps,
            'videos': out[:max(1, min(limit, 1000))]}


@router.get('/api/bridge/versions')
def list_versions(request: Request, dataset: str = ''):
    require(request)
    with db_session() as db:
        if dataset:
            p = safe_dataset(dataset)
            rows = db.execute('SELECT * FROM versions WHERE dataset=? ORDER BY id DESC',
                              (str(p),)).fetchall()
        else:
            rows = db.execute('SELECT * FROM versions ORDER BY id DESC LIMIT 200').fetchall()
    output = []
    for row in rows:
        item = dict(row)
        path = _version_dataset(item)
        item['dataset_path'] = str(path) if path else None
        item['download_url'] = f'/api/bridge/versions/{item["id"]}/download' if item.get('bundle_path') and Path(item['bundle_path']).is_file() else None
        output.append(item)
    return {'versions': output}


def _version_dataset(row):
    bundle_path = row.get('bundle_path')
    if not bundle_path:
        return None
    snapshot = Path(bundle_path).parent / 'snapshot'
    if not snapshot.resolve().is_relative_to(data_root().resolve()):
        return None
    manifest = snapshot / 'manifest.json'
    if manifest.is_file():
        doc = json.loads(manifest.read_text())
        name = doc.get('dataset_dir', 'dataset')
        if not isinstance(name, str) or Path(name).name != name or name in ('.', '..'):
            return None
        path = snapshot/name
        if (path/'meta/info.json').is_file():
            return path
    return None


@router.get('/api/bridge/versions/{version_id}/download')
def download_version(request: Request, version_id: int):
    require(request)
    with db_session() as db:
        row = db.execute('SELECT * FROM versions WHERE id=?', (version_id,)).fetchone()
    if not row or not row['bundle_path']:
        raise HTTPException(404, '版本文件不存在')
    path = Path(row['bundle_path'])
    if not path.resolve().is_relative_to(data_root().resolve()) or not path.is_file():
        raise HTTPException(404, '版本文件不存在')
    from fastapi.responses import FileResponse
    return FileResponse(path, media_type='application/gzip', filename=f'{row["dataset_name"]}_{row["version"]}.tar.gz')


def _recover_interrupted():
    """进程重启后,内存队列里的任务已经丢了:把中断的任务标为失败,提示重试。"""
    with db_session() as db:
        rows = db.execute(
            "SELECT id FROM tasks WHERE status IN ('pending', 'running')").fetchall()
        for r in rows:
            db.execute("UPDATE tasks SET status='failed', error=?, updated_at=? WHERE id=?",
                       ('服务重启导致任务中断,请点重试', now_iso(), r['id']))
            db.execute("UPDATE task_nodes SET status='failed', message=?"
                       " WHERE task_id=? AND status='running'",
                       ('服务重启中断', r['id']))
            _event(db, r['id'], None, '服务重启,任务中断', 'error')


def register(app):
    init_schema()
    _recover_interrupted()
    app.include_router(router)
