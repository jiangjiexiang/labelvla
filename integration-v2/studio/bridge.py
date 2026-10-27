import os
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from labelme.lerobot_server.app import create_app

root = Path('/data').resolve()
app = create_app()

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

app.mount('/studio', StaticFiles(directory='/integration/studio', html=True), name='studio')

from dataclasses import asdict
import hashlib
import json
import tempfile
from threading import Lock
from labelme.lerobot.segment import SegmentStore, interpolate_bbox_center
from labelme.lerobot_server.app import _deserialize_segments

annotation_lock = Lock()

def segment_store(dataset: str, episode: int):
    p = safe_dataset(dataset)
    info = json.loads((p / 'meta/info.json').read_text())
    if not str(info.get('codebase_version', '')).startswith('v2'):
        raise HTTPException(400, '标注目前只支持 v2 数据集')
    if episode < 0:
        raise HTTPException(400, '片段编号无效')
    with (p / 'meta/episodes.jsonl').open() as f:
        ep = next((e for line in f if (e := json.loads(line)).get('episode_index') == episode), None)
    if ep is None:
        raise HTTPException(404, '片段不存在')
    return SegmentStore(p, episode), int(ep['length'])

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
