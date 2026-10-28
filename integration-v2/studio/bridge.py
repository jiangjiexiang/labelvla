import os
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.routing import Mount
from labelme.lerobot_server.app import create_app

root = Path('/data').resolve()
app = create_app()

# Studio 直接部署在站点根路径，移除 LabelVLA 自带的首页与 /static 路由。
app.router.routes = [
    route
    for route in app.router.routes
    if not (
        (getattr(route, 'path', None) == '/' and not isinstance(route, Mount))
        or (isinstance(route, Mount) and route.path == '/static')
    )
]

def safe_dataset(dataset: str) -> Path:
    p = Path(dataset).resolve()
    if p == root or root not in p.parents or not (p / 'meta/info.json').is_file():
        raise HTTPException(400, '请选择 /data 下的数据集目录')
    return p

@app.get('/api/bridge/index')
def index(dataset: str):
    p = safe_dataset(dataset)
    files = []
    for f in p.rglob('*'):
        if f.is_file() and not f.is_symlink() and p in f.resolve().parents:
            files.append(f.relative_to(p).as_posix())
            if len(files) > 200000:
                raise HTTPException(400, '数据集文件数量超过上限')
    return {'files': files}

@app.get('/api/bridge/file')
def file(dataset: str, path: str):
    base = safe_dataset(dataset)
    p = (base / path).resolve()
    if base not in p.parents or not p.is_file():
        raise HTTPException(404, '文件不存在')
    return FileResponse(p)

from dataclasses import asdict
import hashlib
import json
import tempfile
from threading import Lock
import pyarrow.parquet as pq
from labelme.lerobot.segment import SegmentStore, interpolate_bbox_center
from labelme.lerobot_server.app import _deserialize_segments

annotation_lock = Lock()

def episode_length_v2(p: Path, episode: int):
    with (p / 'meta/episodes.jsonl').open() as f:
        for line in f:
            ep = json.loads(line)
            if ep.get('episode_index') == episode:
                return int(ep['length'])
    return None

def episode_length_v3(p: Path, episode: int):
    shards = sorted(
        (p / 'meta/episodes').glob('chunk-*/file-*.parquet'),
        key=lambda f: (int(f.parent.name.split('-')[1]), int(f.stem.split('-')[1])),
    )
    for shard in shards:
        table = pq.read_table(shard, columns=['episode_index', 'length'])
        for row in table.to_pylist():
            if int(row['episode_index']) == episode:
                return int(row['length'])
    return None

def segment_store(dataset: str, episode: int):
    p = safe_dataset(dataset)
    info = json.loads((p / 'meta/info.json').read_text())
    version = str(info.get('codebase_version', ''))
    if episode < 0:
        raise HTTPException(400, '片段编号无效')
    if version.startswith('v2'):
        length = episode_length_v2(p, episode)
    elif version.startswith('v3'):
        length = episode_length_v3(p, episode)
    else:
        raise HTTPException(400, f'标注不支持该数据集版本: {version or "unknown"}')
    if length is None:
        raise HTTPException(404, '片段不存在')
    return SegmentStore(p, episode), length

def revision(store):
    if not store.file_path.exists():
        return 'missing'
    return hashlib.sha256(store.file_path.read_bytes()).hexdigest()

@app.get('/api/bridge/segments')
def bridge_read_segments(dataset: str, episode: int):
    with annotation_lock:
        store, length = segment_store(dataset, episode)
        return {'episode': episode, 'length': length, 'revision': revision(store), 'segments': [asdict(s) for s in store.load()]}

@app.post('/api/bridge/segments')
def bridge_write_segments(dataset: str, episode: int, payload: dict):
    with annotation_lock:
        store, length = segment_store(dataset, episode)
        if payload.get('revision') != revision(store):
            raise HTTPException(409, '标注已被其他会话修改，请重新加载以避免覆盖')
        store.load()
        try:
            segments = _deserialize_segments(payload.get('segments', []))
            for s in segments:
                if not 0 <= s.start_frame <= s.end_frame < length:
                    raise ValueError('标注帧范围无效')
                for b in s.bboxes:
                    if b.width <= 0 or b.height <= 0 or any(not s.start_frame <= k.frame <= s.end_frame for k in b.keypoints):
                        raise ValueError('目标框或关键点无效')
        except (KeyError, TypeError, ValueError) as e:
            raise HTTPException(400, str(e)) from e
        result = []
        for segment in segments:
            item = asdict(segment)
            for bbox, item_bbox in zip(segment.bboxes, item['bboxes']):
                if bbox.keypoints:
                    item_bbox['interpolated_centers'] = [{'frame': i, 'cx': round(interpolate_bbox_center(bbox, i, segment.start_frame, segment.end_frame)[0], 1), 'cy': round(interpolate_bbox_center(bbox, i, segment.start_frame, segment.end_frame)[1], 1)} for i in range(segment.start_frame, segment.end_frame + 1)]
            result.append(item)
        store.file_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix='.labelvla-', dir=store.file_path.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf8') as f:
                json.dump({'episode_index': episode, 'segments': result}, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, store.file_path)
        finally:
            if os.path.exists(tmp): os.unlink(tmp)
        return {'revision': revision(store), 'segments': [asdict(s) for s in segments]}


# 必须最后挂载：/studio 下的 StaticFiles 会匹配所有未命中 API 的请求。
@app.get('/')
def home():
    return RedirectResponse('/studio/')


app.mount('/studio', StaticFiles(directory='/integration/studio', html=True), name='studio')
