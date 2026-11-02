"""数据台账:扫描 /data 下的 LeRobot 数据集(v2/v3),聚合成台账行。

- 数据集识别:任意深度目录下存在 meta/info.json(跳过隐藏目录,含 .trash/.platform)
- 容量:os.scandir 累加,后台线程扫描,缓存 5 分钟,请求不阻塞
- 台账行缓存 60 秒;POST /admin/rescan 清空缓存并后台重扫容量
- 软删:目录移入 /data/.trash/(原名拍平 + @时间戳),标注随目录保留,可恢复
- 状态计数:有标注文件但无 dataset_status 记录的 episode 计入 labeling(标注进度可直接用)
"""
import json
import os
import re
import threading
import time
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from .common import data_root, day_of, db_session, now_iso, require, safe_dataset

router = APIRouter()

SIZE_TTL = 300
LEDGER_TTL = 60
_lock = threading.Lock()
_ledger_cache = {'at': 0.0, 'rows': None}
_size_cache = {}          # str(path) -> {'bytes': int, 'at': float}
_size_scanning = False


def find_datasets(root: Path) -> list:
    """递归找含 meta/info.json 的目录(找到即不再下钻),跳过隐藏目录。"""
    out = []

    def walk(d: Path, depth: int):
        if depth > 4:
            return
        if (d / 'meta' / 'info.json').is_file():
            out.append(d)
            return
        try:
            entries = sorted(os.scandir(d), key=lambda e: e.name)
        except OSError:
            return
        for e in entries:
            if e.is_dir(follow_symlinks=False) and not e.name.startswith('.'):
                walk(Path(e.path), depth + 1)

    walk(root, 0)
    return out


def _dir_size(p: Path) -> int:
    total = 0
    stack = [p]
    while stack:
        try:
            with os.scandir(stack.pop()) as it:
                for e in it:
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(Path(e.path))
                        elif e.is_file(follow_symlinks=False):
                            total += e.stat().st_size
                    except OSError:
                        pass
        except OSError:
            pass
    return total


def _refresh_sizes(paths):
    global _size_scanning
    try:
        for p in paths:
            size = _dir_size(p)
            with _lock:
                _size_cache[str(p)] = {'bytes': size, 'at': time.time()}
    finally:
        with _lock:
            _size_scanning = False


def _ensure_sizes(paths):
    """过期或缺失的容量交给后台线程重扫;本次返回已有缓存(可为 None)。"""
    global _size_scanning
    now = time.time()
    with _lock:
        stale = []
        for p in paths:
            hit = _size_cache.get(str(p))
            if not hit or now - hit['at'] > SIZE_TTL:
                stale.append(p)
        if stale and not _size_scanning:
            _size_scanning = True
            threading.Thread(target=_refresh_sizes, args=(stale,), daemon=True).start()
        return {str(p): (_size_cache.get(str(p)) or {}).get('bytes') for p in paths}


def _v2_episode_days(p: Path, info: dict, camera: str) -> dict:
    days = {}
    chunks = int(info.get('chunks_size') or 1000)
    for ep in range(int(info.get('total_episodes') or 0)):
        f = p / f'videos/chunk-{ep // chunks:03d}/{camera}/episode_{ep:06d}.mp4'
        try:
            day = day_of(f.stat().st_mtime)
        except OSError:
            continue
        days[day] = days.get(day, 0) + 1
    return days


def _v3_episode_days(p: Path) -> dict:
    """v3 按 shard 文件 mtime 归日,条数取 parquet 行数。"""
    days = {}
    try:
        import pyarrow.parquet as pq
    except ImportError:
        return days
    for shard in (p / 'meta' / 'episodes').glob('chunk-*/file-*.parquet'):
        try:
            n = pq.read_metadata(shard).num_rows
            day = day_of(shard.stat().st_mtime)
        except Exception:
            continue
        days[day] = days.get(day, 0) + n
    return days


def scan_dataset(p: Path) -> dict:
    """单数据集 fs 侧统计(台账 + 概览趋势共用,字段比台账契约多)。"""
    info = json.loads((p / 'meta' / 'info.json').read_text(encoding='utf8'))
    fps = float(info.get('fps') or 30)
    cameras = [k for k, v in info.get('features', {}).items() if v.get('dtype') == 'video']
    episodes = int(info.get('total_episodes') or 0)
    total_frames = float(info.get('total_frames') or 0)
    version = str(info.get('codebase_version') or '')

    labeled = annotations = problems = problems_fixed = 0
    labeled_eps = []
    span_frames = 0
    seg_days = {}
    problem_days = {}
    seg_dir = p / 'segments'
    if seg_dir.is_dir():
        for f in sorted(seg_dir.glob('episode_*.json')):
            try:
                segs = json.loads(f.read_text(encoding='utf8')).get('segments') or []
                day = day_of(f.stat().st_mtime)
            except Exception:
                continue
            if not segs:
                continue
            labeled += 1
            try:
                labeled_eps.append(int(f.stem.split('_')[1]))
            except (ValueError, IndexError):
                pass
            annotations += len(segs)
            seg_days[day] = seg_days.get(day, 0) + len(segs)
            for s in segs:
                span_frames += max(0, int(s.get('end_frame') or 0) - int(s.get('start_frame') or 0) + 1)
                prob = s.get('problem')
                if prob:
                    problems += 1
                    pday = str(prob.get('at') or '')[:10]
                    if prob.get('fixed_at'):
                        problems_fixed += 1
                    elif pday:
                        problem_days[pday] = problem_days.get(pday, 0) + 1

    if version.startswith('v2') and cameras:
        video_days = _v2_episode_days(p, info, cameras[0])
    elif version.startswith('v3'):
        video_days = _v3_episode_days(p)
    else:
        video_days = {}

    return {
        'path': str(p),
        'episodes': episodes,
        'hours': round(total_frames / fps / 3600, 2),
        'cameras': len(cameras),
        'labeled': labeled,
        'labeled_eps': labeled_eps,
        'annotations': annotations,
        'annotation_hours': round(span_frames / fps / 3600, 2),
        'problems': problems,
        'problems_fixed': problems_fixed,
        'seg_days': seg_days,
        'problem_days': problem_days,
        'video_days': video_days,
        'fs_updated_at': day_of((p / 'meta' / 'info.json').stat().st_mtime),
    }


def _db_side(root: Path):
    """dataset_status / qc 库侧聚合;库或表尚未就绪时降级为空。"""
    status_map, qc_fail, qc_scanned, updated = {}, {}, {}, {}
    try:
        with db_session() as db:
            for r in db.execute('SELECT dataset, episode, status FROM dataset_status'):
                status_map.setdefault(r['dataset'], {})[r['episode']] = r['status']
            for r in db.execute(
                    "SELECT dataset, COUNT(DISTINCT episode) c FROM qc_reports GROUP BY dataset"):
                qc_fail[r['dataset']] = r['c']
            for r in db.execute(
                    "SELECT dataset, MAX(updated_at) u FROM dataset_status GROUP BY dataset"):
                updated[r['dataset']] = r['u']
            try:
                for r in db.execute("SELECT dataset, episodes, failed FROM qc_scans"):
                    qc_scanned[r['dataset']] = (r['episodes'], r['failed'])
            except Exception:
                pass
    except Exception:
        pass
    return status_map, qc_fail, qc_scanned, updated


def get_ledger(force: bool = False) -> list:
    """完整台账(含内部字段),带 60 秒缓存。dashboard 复用同一份。"""
    now = time.time()
    with _lock:
        if not force and _ledger_cache['rows'] is not None and now - _ledger_cache['at'] < LEDGER_TTL:
            return _ledger_cache['rows']
    root = data_root()
    rows = []
    for p in find_datasets(root):
        try:
            row = scan_dataset(p)
        except Exception:
            continue
        row['name'] = p.relative_to(root).as_posix()
        rows.append(row)
    status_map, qc_fail, qc_scanned, updated = _db_side(root)
    sizes = _ensure_sizes([Path(r['path']) for r in rows])
    for r in rows:
        smap = status_map.get(r['path'], {})
        # 有标注但无状态记录的 episode 视为标注中,台账的标注进度才不虚报
        auto = set(r['labeled_eps']) - set(smap)
        counts = {'untagged': 0, 'labeling': 0, 'review': 0, 'approved': 0, 'rejected': 0}
        for st in smap.values():
            if st in ('labeling', 'review', 'approved', 'rejected'):
                counts[st] += 1
        counts['labeling'] += len(auto)
        counts['untagged'] = max(0, r['episodes'] - (len(smap) - sum(
            1 for st in smap.values() if st == 'untagged')) - len(auto))
        r['counts'] = counts
        fail = qc_fail.get(r['path'], 0)
        scanned = qc_scanned.get(r['path'])
        r['qc'] = {'pass': (max(0, scanned[0] - fail) if scanned else None), 'fail': fail}
        size = sizes.get(r['path'])
        r['size_gb'] = round(size / 1024 ** 3, 2) if size is not None else None
        r['updated_at'] = updated.get(r['path']) or r['fs_updated_at']
    with _lock:
        _ledger_cache['rows'] = rows
        _ledger_cache['at'] = now
    return rows


def ledger_public(row: dict) -> dict:
    """台账契约字段(docs/platform-plan.md 0.2)。"""
    result = {k: row[k] for k in
            ('path', 'name', 'episodes', 'size_gb', 'cameras', 'hours', 'counts', 'qc', 'updated_at')}
    try:
        result['robot_tag'] = json.loads((Path(row['path']) / '_platform' / 'robot.json').read_text()).get('robot_tag', '')
    except (OSError, ValueError):
        result['robot_tag'] = ''
    return result


# ── 回收站 ────────────────────────────────────────────────

def _trash_dir() -> Path:
    d = data_root() / '.trash'
    d.mkdir(exist_ok=True)
    return d


def list_trash() -> list:
    out = []
    d = _trash_dir()
    try:
        entries = sorted(os.scandir(d), key=lambda e: e.name)
    except OSError:
        return out
    for e in entries:
        if not e.is_dir(follow_symlinks=False):
            continue
        m = re.match(r'^(.*)@(\d{14})$', e.name)
        if not m:
            continue
        size = _ensure_sizes([Path(e.path)])[e.path]
        out.append({
            'name': e.name,
            'path': m.group(1).replace('__', '/'),
            'size_gb': round(size / 1024 ** 3, 2) if size is not None else None,
            'deleted_at': datetime.strptime(m.group(2), '%Y%m%d%H%M%S').isoformat(),
        })
    return out


# ── 路由 ─────────────────────────────────────────────────

@router.get('/api/bridge/admin/datasets')
def admin_datasets(request: Request, trash: int = 0):
    require(request, 'admin')
    if trash:
        return {'trash': list_trash()}
    return {'datasets': [ledger_public(r) for r in get_ledger()]}


@router.post('/api/bridge/admin/rescan')
def admin_rescan(request: Request):
    require(request, 'admin')
    with _lock:
        _ledger_cache['rows'] = None
        _ledger_cache['at'] = 0.0
        _size_cache.clear()
    get_ledger(force=True)   # 触发 fs 重扫并启动后台容量扫描
    return {'ok': True}


@router.post('/api/bridge/admin/datasets/delete')
def admin_delete_dataset(request: Request, payload: dict):
    require(request, 'admin')
    p = safe_dataset(str(payload.get('path') or ''))
    rel = p.relative_to(data_root())
    name = '__'.join(rel.parts) + '@' + datetime.now().strftime('%Y%m%d%H%M%S')
    os.rename(p, _trash_dir() / name)
    with _lock:
        _ledger_cache['rows'] = None
        _size_cache.pop(str(p), None)
    return {'ok': True, 'trash': name}


@router.post('/api/bridge/admin/datasets/restore')
def admin_restore_dataset(request: Request, payload: dict):
    require(request, 'admin')
    name = str(payload.get('name') or '')
    m = re.fullmatch(r'([\w\-.]+(?:__[\w\-.]+)*)@(\d{14})', name)
    if not m:
        raise HTTPException(400, '回收站条目名不合法')
    src = _trash_dir() / name
    if not src.is_dir():
        raise HTTPException(404, '回收站里没有该条目')
    dst = data_root().joinpath(*m.group(1).split('__'))
    if dst.exists():
        raise HTTPException(409, f'原位置已存在: {dst}')
    dst.parent.mkdir(parents=True, exist_ok=True)
    os.rename(src, dst)
    with _lock:
        _ledger_cache['rows'] = None
        _size_cache.pop(str(src), None)
    return {'ok': True, 'path': str(dst)}


@router.post('/api/bridge/admin/datasets/robot-tag')
def set_robot_tag(request: Request, payload: dict):
    require(request, 'admin', 'reviewer')
    dataset = safe_dataset(str(payload.get('dataset') or ''))
    tag = payload.get('robot_tag', '')
    if not isinstance(tag, str) or len(tag.strip()) > 80:
        raise HTTPException(400, '机器人标签最多 80 个字符')
    tag = tag.strip()
    folder = dataset / '_platform'
    if folder.is_symlink():
        raise HTTPException(400, '平台目录不能是符号链接')
    folder.mkdir(exist_ok=True)
    temp = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=folder, delete=False, encoding='utf-8') as f:
            temp = f.name
            json.dump({'robot_tag': tag}, f, ensure_ascii=False)
        os.replace(temp, folder / 'robot.json')
    finally:
        if temp and os.path.exists(temp):
            os.unlink(temp)
    return {'ok': True, 'robot_tag': tag}


def register(app):
    app.include_router(router)
