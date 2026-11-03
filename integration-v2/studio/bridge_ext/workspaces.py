"""Task working copies and atomic Studio exports. Published releases are never edited."""
import copy
import json
import math
import os
import shutil
import subprocess
import tempfile
import threading
import uuid
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from .common import data_root, db_session, now_iso, require, safe_dataset

router = APIRouter()
_lock = threading.RLock()


def init_schema():
    with db_session() as db:
        migrate(db)


def migrate(db):
    columns = {r['name'] for r in db.execute('PRAGMA table_info(tasks)')}
    for column in ('workspace_path', 'edited_dataset', 'source_dataset'):
        if column not in columns:
            db.execute(f'ALTER TABLE tasks ADD COLUMN {column} TEXT')
    db.execute('''CREATE TABLE IF NOT EXISTS studio_drafts(
        id TEXT PRIMARY KEY, task_id INTEGER NOT NULL, owner TEXT NOT NULL,
        source TEXT NOT NULL, mapping TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL)''')


def _task(db, task_id):
    row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
    if not row:
        raise HTTPException(404, '任务不存在')
    return dict(row)


def _editable(task, user):
    if user['role'] != 'admin' and (user['role'] != 'annotator' or user['username'] != task['assignee']):
        raise HTTPException(403, '只有标注负责人或管理员可保存修改')
    if task['status'] != 'waiting_human' or task['current_node'] != 'annotate':
        raise HTTPException(409, '任务已进入审核或发布阶段，不能修改数据')


def _copy_status(db, source, target, mapping):
    manifest_path = Path(source).parent/'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}
    for table in ('dataset_status', 'episode_exclusions'):
        columns = [r['name'] for r in db.execute(f'PRAGMA table_info({table})')]
        if not columns:
            continue
        for item in mapping:
            row = db.execute(f'SELECT * FROM {table} WHERE dataset=? AND episode=?', (str(source), item['source'])).fetchone()
            if row:
                values = dict(row)
            else:
                key = 'platform_status' if table == 'dataset_status' else 'skipped_episodes'
                values = next((r for r in manifest.get(key,[]) if r.get('episode') == item['source']), None)
                if not values:
                    continue
                values = {column:values.get(column) for column in columns}
                if table == 'episode_exclusions': values['skipped'] = 1
            if values:
                values.update(dataset=str(target), episode=item['target'])
                db.execute(f'INSERT INTO {table} ({",".join(columns)}) VALUES ({",".join("?" for _ in columns)})', [values[c] for c in columns])


def _copytree(source, target):
    # Do not follow external links or create hardlinks to source data.
    if any(p.is_symlink() for p in source.rglob('*')):
        raise HTTPException(400, '数据集包含符号链接，不能创建独立副本')
    shutil.copytree(source, target)


@router.post('/api/bridge/tasks/{task_id}/workspace')
def workspace(request: Request, task_id: int):
    user = require(request)
    with _lock, db_session() as db:
        task = _task(db, task_id)
        current = task.get('edited_dataset') or task.get('workspace_path')
        if current:
            return {'dataset': str(safe_dataset(current))}
        if task['status'] != 'waiting_human' or task['current_node'] != 'annotate':
            return {'dataset': str(safe_dataset(task['dataset']))}
        if user['role'] != 'admin' and user['username'] not in (task['assignee'], task['reviewer']):
            raise HTTPException(403, '仅任务负责人或管理员可以创建任务副本')
        source = safe_dataset(task.get('source_dataset') or task['dataset'])
        parent = data_root() / '.platform' / 'workspaces' / f'task_{task_id}'
        parent.mkdir(parents=True, exist_ok=True)
        target = parent / f'{source.name}_{uuid.uuid4().hex[:12]}'
        try:
            import bridge
            with bridge.annotation_lock:
                _copytree(source, target)
            info = json.loads((target / 'meta/info.json').read_text())
            _copy_status(db, source, target, [{'source': i, 'target': i} for i in range(int(info['total_episodes']))])
            db.execute('UPDATE tasks SET workspace_path=?,updated_at=? WHERE id=?', (str(target), now_iso(), task_id))
        except Exception:
            shutil.rmtree(target, ignore_errors=True)
            raise
        return {'dataset': str(target)}


def assert_writable(request, dataset):
    user = require(request)
    path = safe_dataset(dataset)
    if (data_root()/'.platform/releases').resolve() in path.parents:
        raise HTTPException(409, '已发布版本为只读，请新建任务进行修改')
    with db_session() as db:
        row = db.execute('SELECT * FROM tasks WHERE workspace_path=? OR edited_dataset=?', (str(path), str(path))).fetchone()
        if row:
            _editable(dict(row), user)
            if db.execute("SELECT 1 FROM studio_drafts WHERE task_id=? AND status='uploading'", (row['id'],)).fetchone():
                raise HTTPException(409, '正在保存数据，请等待保存结束后再编辑')


def _draft(request, draft_id, editable=True):
    user = require(request)
    with db_session() as db:
        row = db.execute('SELECT * FROM studio_drafts WHERE id=?', (draft_id,)).fetchone()
        if not row:
            raise HTTPException(404, '保存记录不存在')
        draft = dict(row)
        if draft['owner'] != user['username']:
            raise HTTPException(403, '不能访问其他人的保存记录')
        if editable:
            _editable(_task(db, draft['task_id']), user)
            if draft['status'] != 'uploading':
                raise HTTPException(409, '此保存记录已经结束')
    draft['path'] = data_root() / '.platform' / 'drafts' / draft['id'] / 'dataset'
    return draft


@router.post('/api/bridge/tasks/{task_id}/drafts')
def create_draft(request: Request, task_id: int, payload: dict):
    user = require(request)
    with _lock, db_session() as db:
        db.execute('BEGIN IMMEDIATE')
        task = _task(db, task_id)
        _editable(task, user)
        source = safe_dataset(task.get('edited_dataset') or task.get('workspace_path') or task.get('source_dataset') or task['dataset'])
        if payload.get('source') != str(source):
            raise HTTPException(409, '任务数据已更新，请重新进入工作区后保存')
        mapping = payload.get('episodes')
        total = int(json.loads((source / 'meta/info.json').read_text())['total_episodes'])
        if not isinstance(mapping, list) or not mapping or len(mapping) > total:
            raise HTTPException(400, '至少保留一个片段')
        seen = set()
        for target, item in enumerate(mapping):
            if not isinstance(item, dict) or any(type(item.get(k)) is not int for k in ('source', 'start', 'end')):
                raise HTTPException(400, '片段编号和裁剪帧必须是整数')
            if item['source'] in seen or not 0 <= item['source'] < total or not 0 <= item['start'] <= item['end']:
                raise HTTPException(400, '片段映射或裁剪范围无效')
            item['target'] = target
            seen.add(item['source'])
        if db.execute("SELECT 1 FROM studio_drafts WHERE task_id=? AND status='uploading'", (task_id,)).fetchone():
            raise HTTPException(409, '此任务正在保存，请先完成或取消上次保存')
        draft_id = uuid.uuid4().hex
        path = data_root() / '.platform' / 'drafts' / draft_id / 'dataset'
        path.mkdir(parents=True)
        db.execute('INSERT INTO studio_drafts VALUES (?,?,?,?,?,?,?)', (draft_id, task_id, user['username'], str(source), json.dumps(mapping), 'uploading', now_iso()))
        return {'id': draft_id}


def _file(draft, path):
    relative = PurePosixPath(path)
    if not path or relative.is_absolute() or any(p in ('..', '.') for p in relative.parts) or '\\' in path or relative.parts[0] not in ('meta', 'data', 'videos'):
        raise HTTPException(400, '文件路径无效')
    target = draft['path'] / relative
    if not target.resolve().is_relative_to(draft['path'].resolve()):
        raise HTTPException(400, '文件路径无效')
    return target


@router.put('/api/bridge/drafts/{draft_id}/file')
async def upload(request: Request, draft_id: str, path: str):
    draft = _draft(request, draft_id)
    target = _file(draft, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.upload')
    try:
        with temporary.open('xb') as f:
            async for chunk in request.stream():
                f.write(chunk)
        with _lock:
            _draft(request, draft_id)
            os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return {'ok': True}


@router.get('/api/bridge/drafts/{draft_id}/file')
def read_file(request: Request, draft_id: str, path: str):
    target = _file(_draft(request, draft_id), path)
    if not target.is_file():
        raise HTTPException(404, '文件不存在')
    return FileResponse(target)


@router.delete('/api/bridge/drafts/{draft_id}')
def cancel(request: Request, draft_id: str):
    # An owner can cancel even when the task has moved to another stage.
    draft = _draft(request, draft_id, editable=False)
    with _lock, db_session() as db:
        if draft['status'] == 'uploading':
            db.execute("UPDATE studio_drafts SET status='canceled' WHERE id=?", (draft_id,))
    # Keep partial files for diagnosis; never remove an active/published dataset.
    return {'ok': True}


def _point_at(points, frame):
    ordered = sorted(points, key=lambda p: p['frame'])
    if not ordered:
        return None
    if frame <= ordered[0]['frame']:
        return {**ordered[0], 'frame': frame}
    for a, b in zip(ordered, ordered[1:]):
        if a['frame'] <= frame <= b['frame']:
            t = (frame-a['frame']) / max(1, b['frame']-a['frame'])
            return {'frame': frame, 'cx': a['cx']+(b['cx']-a['cx'])*t, 'cy': a['cy']+(b['cy']-a['cy'])*t}
    return {**ordered[-1], 'frame': frame}


def copy_annotations(source, target, mapping):
    """Crop inclusive annotation ranges, tracks and SAM masks into renumbered episodes."""
    segments_dir = target / 'segments'
    segments_dir.mkdir(exist_ok=True)
    for item in mapping:
        old, new, start, end = (item[k] for k in ('source', 'target', 'start', 'end'))
        origin = source / 'segments' / f'episode_{old:06d}.json'
        if not origin.is_file():
            continue
        doc = json.loads(origin.read_text())
        output = []
        for original in doc.get('segments', []):
            a, b = max(start, original['start_frame']), min(end, original['end_frame'])
            if a > b:
                continue
            segment = copy.deepcopy(original)
            segment.update(start_frame=a-start, end_frame=b-start)
            for box in segment.get('bboxes', []):
                points = box.get('keypoints') or []
                if points:
                    clipped = [p for p in points if a <= p['frame'] <= b]
                    clipped += [_point_at(points, a), _point_at(points, b)]
                    box['keypoints'] = [{**p, 'frame': frame-start} for frame, p in sorted({p['frame']:p for p in clipped}.items())]
                if 'frame_boxes' in box:
                    box['frame_boxes'] = [{**p, 'frame': p['frame']-start} for p in box['frame_boxes'] if a <= p['frame'] <= b]
                key = box.get('mask_key')
                if key:
                    if not isinstance(key, str) or Path(key).name != key or key in ('.', '..'):
                        raise ValueError('轮廓文件标识无效')
                    old_masks = source / 'segments/masks' / f'episode_{old:06d}' / key
                    for mask in old_masks.glob('*.png'):
                        frame = int(mask.stem)
                        if a <= frame <= b:
                            dest = segments_dir / 'masks' / f'episode_{new:06d}' / key / f'{frame-start:05d}.png'
                            dest.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(mask, dest)
            output.append(segment)
        doc.update(episode_index=new, segments=output)
        (segments_dir / f'episode_{new:06d}.json').write_text(json.dumps(doc, ensure_ascii=False, indent=2))


def validate_export(path, mapping):
    import pyarrow.parquet as pq
    info = json.loads((path / 'meta/info.json').read_text())
    if int(info['total_episodes']) != len(mapping):
        raise ValueError('导出的片段数量不一致')
    expected = {m['target']: m['end']-m['start']+1 for m in mapping}
    counts = {i:0 for i in expected}
    fps = float(info['fps'])
    for file in sorted((path / 'data').rglob('*.parquet')):
        table = pq.read_table(file, columns=['episode_index','frame_index','timestamp'])
        for row in table.to_pylist():
            ep, frame, timestamp = row['episode_index'], row['frame_index'], row['timestamp']
            if ep not in counts or frame != counts[ep] or not math.isfinite(timestamp) or abs(timestamp-frame/fps)>1e-4:
                raise ValueError('导出的帧编号或时间戳不一致')
            counts[ep] += 1
    if counts != expected or int(info['total_frames']) != sum(expected.values()):
        raise ValueError('导出的 Parquet 行数与裁剪范围不一致')
    # Decode each MP4 to catch broken/incomplete video before switching the task.
    import cv2
    cameras = [k for k,v in info['features'].items() if v.get('dtype')=='video']
    for camera in cameras:
        files = sorted((path/'videos').glob(f'**/{camera}/*.mp4'))
        # v3 layout is videos/<camera>/chunk-xxx/file-xxx.mp4.
        if not files:
            files = sorted((path/'videos'/camera).rglob('*.mp4'))
        if not files:
            raise ValueError(f'缺少视频：{camera}')
        count = 0
        for file in files:
            cap = cv2.VideoCapture(str(file))
            if not cap.isOpened():
                raise ValueError(f'无法读取视频：{file.name}')
            file_count = 0
            while True:
                ok, _ = cap.read()
                if not ok:
                    break
                file_count += 1
            cap.release()
            if file_count == 0:
                process = subprocess.run([_ffmpeg(),'-v','error','-i',str(file),'-map','0:v:0','-fps_mode','passthrough','-progress','pipe:1','-f','null','-'],capture_output=True,timeout=1800)
                if process.returncode:
                    raise ValueError(f'视频解码失败：{file.name}')
                import re
                frames = re.findall(r'^frame=(\d+)',process.stdout.decode(),re.M)
                file_count = int(frames[-1]) if frames else 0
            count += file_count
        if count != sum(expected.values()):
            raise ValueError(f'视频帧数不匹配：{camera}，视频 {count} / 数据 {sum(expected.values())}')
    return info


@router.post('/api/bridge/drafts/{draft_id}/finish')
def finish(request: Request, draft_id: str):
    with _lock:
        draft = _draft(request, draft_id)
        mapping = json.loads(draft['mapping'])
        try:
            info = validate_export(draft['path'], mapping)
            source = safe_dataset(draft['source'])
            import bridge
            with bridge.annotation_lock:
                copy_annotations(source, draft['path'], mapping)
            canonical_meta = {'info.json','episodes.jsonl','episodes_stats.jsonl','stats.json','tasks.jsonl','episodes','tasks.parquet','subtasks.parquet'}
            for item in (source/'meta').iterdir():
                target = draft['path']/'meta'/item.name
                if item.name in canonical_meta or target.exists():
                    continue
                if item.is_dir(): _copytree(item, target)
                else: shutil.copy2(item, target)
            # Preserve custom top-level assets / nested source backups as full copies.
            # Core LeRobot directories are replaced by the exporter above.
            for item in source.iterdir():
                if item.name in ('meta', 'data', 'videos', 'segments', 'labelvla_revision.json'):
                    continue
                target = draft['path'] / item.name
                if item.is_symlink():
                    raise ValueError('数据集包含符号链接')
                if item.is_dir():
                    _copytree(item, target)
                else:
                    shutil.copy2(item, target)
            revision = {'task_id':draft['task_id'], 'source':str(source), 'episodes':mapping, 'saved_by':draft['owner'], 'saved_at':now_iso()}
            (draft['path']/'labelvla_revision.json').write_text(json.dumps(revision, ensure_ascii=False, indent=2))
            with db_session() as db:
                db.execute('BEGIN IMMEDIATE')
                task = _task(db, draft['task_id'])
                _editable(task, require(request))
                if (task.get('edited_dataset') or task.get('workspace_path') or task.get('source_dataset') or task['dataset']) != draft['source']:
                    raise HTTPException(409, '任务数据已变更，请重新保存')
                _copy_status(db, source, draft['path'], mapping)
                db.execute('UPDATE tasks SET edited_dataset=?,episodes_total=?,updated_at=? WHERE id=?', (str(draft['path']), len(mapping), now_iso(), task['id']))
                db.execute("UPDATE studio_drafts SET status='saved' WHERE id=? AND status='uploading'", (draft_id,))
                from .tasks import _event
                _event(db, task['id'], 'annotate', f'保存数据修改：{len(mapping)} 个片段 / {info["total_frames"]} 帧', actor=draft['owner'])
            return {'dataset':str(draft['path']), 'episodes':len(mapping)}
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(400, f'保存校验失败：{error}') from error


@router.get('/api/bridge/drafts/{draft_id}/visual-stats')
def visual_stats(request: Request, draft_id: str, episode: int, start: int, end: int):
    """Match Studio's retained-frame RGB histogram statistics without WebCodecs/HTTPS."""
    import cv2
    import numpy as np
    import bridge
    draft = _draft(request, draft_id)
    source = safe_dataset(draft['source'])
    mapping = next((m for m in json.loads(draft['mapping']) if m['source']==episode), None)
    if mapping is None or start != mapping['start'] or end != mapping['end']:
        raise HTTPException(400, '统计范围与保存的裁剪范围不一致')
    info = json.loads((source/'meta/info.json').read_text())
    result = {}
    for camera, feature in info['features'].items():
        if feature['dtype'] not in ('video','image','depth'):
            continue
        if feature['dtype'] != 'video' or feature.get('info',{}).get('is_depth_map'):
            raise HTTPException(400, f'服务器保存暂不支持此图像特征：{camera}')
        video, offset, length = bridge._episode_video(source, episode, camera, info)
        if not 0 <= start <= end < length:
            raise HTTPException(400, '裁剪范围超过片段长度')
        count = min(100,end-start+1)
        frames = [start+int(math.floor(i*(end-start)/max(1,count-1)+0.5)) for i in range(count)]
        names = [str(n).lower() for n in feature.get('names',[]) if not isinstance(n,list)]
        shape = feature.get('shape',[])
        axis = next((i for i,n in enumerate(names) if n in ('channel','channels')), -1)
        channels = shape[axis] if axis >= 0 else shape[0] if shape and shape[0] in (1,3) else shape[-1] if shape else 3
        if channels not in (1,3):
            raise HTTPException(400, f'不支持的通道布局：{camera}')
        cap = cv2.VideoCapture(str(video))
        width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()
        if width <= 0 or height <= 0:
            raise HTTPException(400, f'无法读取视频尺寸：{camera}')
        relative = [frame-start for frame in frames]
        select = '+'.join(f'eq(n\\,{frame})' for frame in relative)
        args = [_ffmpeg(),'-v','error','-ss',str((offset+start)/float(info['fps'])),'-i',str(video),
                '-vf',f'select={select}','-frames:v',str(count),'-fps_mode','passthrough',
                '-pix_fmt','rgb24','-f','rawvideo','pipe:1']
        process = subprocess.run(args,capture_output=True,timeout=1800)
        if process.returncode or len(process.stdout) != count*width*height*3:
            raise HTTPException(400, f'无法读取 {camera} 的裁剪帧：'+process.stderr.decode(errors='replace')[-300:])
        rgb = np.frombuffer(process.stdout,dtype=np.uint8).reshape(count,height,width,3)
        pixels = count*width*height
        histograms = np.stack([np.bincount(rgb[:,:,:,channel].ravel(),minlength=256) for channel in range(channels)]).astype(np.float64)
        stats = {'count':[count]}
        for histogram in histograms:
            values = np.arange(256,dtype=np.float64)
            mean = float((histogram*values).sum()/pixels)
            active = np.flatnonzero(histogram)
            channel_stats = {'min':float(active[0])/255,'max':float(active[-1])/255,'mean':mean/255,
                             'std':math.sqrt(max(0,float((histogram*values*values).sum()/pixels)-mean*mean))/255}
            cumulative = np.cumsum(histogram)
            for name,q in [('q01',.01),('q10',.1),('q50',.5),('q90',.9),('q99',.99)]:
                channel_stats[name]=int(np.searchsorted(cumulative,q*pixels))/255
            for name,value in channel_stats.items():
                stats.setdefault(name,[]).append([[value]])
        result[camera]=stats
    return result


def _ffmpeg():
    binary = Path(os.environ.get('LABELVLA_FFMPEG') or data_root()/'.platform/tools/ffmpeg')
    if binary.is_file():
        return str(binary)
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as error:
        raise HTTPException(503, '服务器未安装 FFmpeg，请按部署文档安装视频裁剪依赖') from error


@router.post('/api/bridge/drafts/{draft_id}/video')
async def convert_video(request: Request, draft_id: str, start: float = 0, end: float = 0):
    _draft(request, draft_id)
    if not math.isfinite(start) or not math.isfinite(end) or start < 0 or (end and end <= start):
        raise HTTPException(400, '视频裁剪范围无效')
    directory = Path(tempfile.mkdtemp(prefix='video_', dir=data_root()/'.platform/drafts'))
    source, target = directory/'input.mp4', directory/'output.mp4'
    try:
        with source.open('wb') as f:
            async for chunk in request.stream():
                f.write(chunk)
        import cv2
        cap = cv2.VideoCapture(str(source))
        fps = cap.get(cv2.CAP_PROP_FPS)
        cap.release()
        if not math.isfinite(fps) or fps <= 0:
            raise HTTPException(400, '无法读取源视频帧率')
        args = [_ffmpeg(), '-hide_banner', '-loglevel', 'error', '-i', str(source)]
        if end > start:
            args += ['-vf', f'trim=start={start}:end={end},setpts=PTS-STARTPTS']
        args += ['-r', str(fps), '-fps_mode', 'cfr', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target)]
        # Sync work runs off the ASGI loop so normal API requests stay responsive.
        import asyncio
        result = await asyncio.to_thread(subprocess.run, args, capture_output=True, timeout=1800)
        if result.returncode:
            raise HTTPException(400, '视频裁剪失败：'+result.stderr.decode(errors='replace')[-1000:])
        return FileResponse(target, media_type='video/mp4', background=BackgroundTask(shutil.rmtree, directory, ignore_errors=True))
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise


def register(app):
    init_schema()
    # Interrupted uploads never become the next published dataset.
    with db_session() as db:
        db.execute("UPDATE studio_drafts SET status='interrupted' WHERE status='uploading'")
    app.include_router(router)
