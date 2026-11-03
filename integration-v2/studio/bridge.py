import os
import re
from pathlib import Path
from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
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
        segments = [asdict(s) for s in store.load()]
        # store.load 走 dataclass 会丢掉 camera/frame_boxes 等扩展字段,从原始 JSON 合并回来
        if store.file_path.exists():
            raw = json.loads(store.file_path.read_text(encoding='utf8'))
            for s_item, s_raw in zip(segments, raw.get('segments', [])):
                for extra in ('skill', 'object', 'target', 'adverb', 'problem'):
                    if s_raw.get(extra):
                        s_item[extra] = s_raw[extra]
                for b_item, b_raw in zip(s_item.get('bboxes', []),
                                         s_raw.get('bboxes', [])):
                    for extra in ('camera', 'frame_boxes', 'mask_key'):
                        if b_raw.get(extra):
                            b_item[extra] = b_raw[extra]
        return {'episode': episode, 'length': length, 'revision': revision(store), 'segments': segments}

@app.post('/api/bridge/segments')
def bridge_write_segments(dataset: str, episode: int, payload: dict):
    from bridge_ext.exclusions import excluded
    if episode in excluded(str(safe_dataset(dataset))):
        raise HTTPException(409, '该数据已跳过，请先恢复标注')
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
        raw_segments = payload.get('segments', [])
        for si, segment in enumerate(segments):
            item = asdict(segment)
            if si < len(raw_segments):
                for extra in ('skill', 'object', 'target', 'adverb', 'problem'):
                    if raw_segments[si].get(extra):
                        item[extra] = raw_segments[si][extra]
            raw_bboxes = raw_segments[si].get('bboxes', []) if si < len(raw_segments) else []
            for bi, (bbox, item_bbox) in enumerate(zip(segment.bboxes, item['bboxes'])):
                # dataclass 序列化会丢扩展字段,从原始提交里带回来
                if bi < len(raw_bboxes):
                    for extra in ('camera', 'frame_boxes', 'mask_key'):
                        if raw_bboxes[bi].get(extra):
                            item_bbox[extra] = raw_bboxes[bi][extra]
                if bbox.keypoints:
                    fbx = {}
                    if bi < len(raw_bboxes) and raw_bboxes[bi].get('frame_boxes'):
                        fbx = {int(e['frame']): e for e in raw_bboxes[bi]['frame_boxes']}
                    centers = []
                    for i in range(segment.start_frame, segment.end_frame + 1):
                        cx, cy = interpolate_bbox_center(bbox, i, segment.start_frame, segment.end_frame)
                        entry = {'frame': i, 'cx': round(cx, 1), 'cy': round(cy, 1)}
                        fb = fbx.get(i)
                        if fb:
                            entry.update({'x': fb['x'], 'y': fb['y'], 'w': fb['w'], 'h': fb['h']})
                        else:
                            entry.update({'x': round(cx - bbox.width / 2, 1),
                                          'y': round(cy - bbox.height / 2, 1),
                                          'w': bbox.width, 'h': bbox.height})
                        centers.append(entry)
                    item_bbox['interpolated_centers'] = centers
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
        return {'revision': revision(store), 'segments': result}


# ── SAM 3.1 代理:标注面板 → SAM 推理服务 ─────────────────────────────
# 会话按 (dataset, episode, camera) 缓存;建立新会话时关闭旧会话释放显存。
# v2 数据集直接上传 episode mp4;v3 数据集上传包含该片段的整个视频文件,
# 用帧偏移量(offset)在片段帧号和文件帧号之间换算。
import urllib.error
import urllib.parse
import urllib.request
import uuid as _uuid

SAM_BASE = os.environ.get('SAM_BASE', 'http://8.147.114.158:8310').rstrip('/')
SAM_SESSIONS = {}
SAM_LOCK = Lock()


def _sam_http(method, path, payload=None, timeout=300):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {'Content-Type': 'application/json'} if data else {}
    req = urllib.request.Request(SAM_BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            if 'json' in r.headers.get('Content-Type', ''):
                return json.loads(body)
            return body
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors='replace')[:300]
        try:
            raw = json.loads(raw).get('detail', raw)
        except Exception:
            pass
        raise HTTPException(e.code, f'SAM 服务: {raw}') from e
    except urllib.error.URLError as e:
        raise HTTPException(502, f'SAM 服务不可达: {e.reason}') from e


def _sam_upload_session(video_path: Path):
    boundary = _uuid.uuid4().hex
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="video"; '
        f'filename="{video_path.name}"\r\nContent-Type: video/mp4\r\n\r\n'
    ).encode() + video_path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(
        SAM_BASE + '/api/sam/session', data=body, method='POST',
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    try:
        with urllib.request.urlopen(req, timeout=1800) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise HTTPException(e.code, f'SAM 会话建立失败: {e.read().decode(errors="replace")[:300]}') from e
    except urllib.error.URLError as e:
        raise HTTPException(502, f'SAM 服务不可达: {e.reason}') from e


def _first_camera(info):
    for k, v in info.get('features', {}).items():
        if v.get('dtype') == 'video':
            return k
    raise HTTPException(400, '数据集没有视频相机')


def _episode_video(p: Path, episode: int, camera: str, info: dict):
    """返回 (视频路径, 帧偏移, 片段帧数)。帧偏移仅 v3 非零。"""
    version = str(info.get('codebase_version', ''))
    if version.startswith('v2'):
        chunk = episode // int(info.get('chunks_size', 1000))
        f = p / f'videos/chunk-{chunk:03d}/{camera}/episode_{episode:06d}.mp4'
        if not f.is_file():
            raise HTTPException(404, f'视频不存在: {f.name}')
        _, length = segment_store(str(p), episode)
        return f, 0, length
    if version.startswith('v3'):
        fps = float(info.get('fps', 30))
        for shard in sorted((p / 'meta/episodes').glob('chunk-*/file-*.parquet')):
            table = pq.read_table(shard, columns=[
                'episode_index', 'length',
                f'videos/{camera}/chunk_index', f'videos/{camera}/file_index',
                f'videos/{camera}/from_timestamp'])
            for row in table.to_pylist():
                if int(row['episode_index']) == episode:
                    ci = int(row[f'videos/{camera}/chunk_index'])
                    fi = int(row[f'videos/{camera}/file_index'])
                    f = p / f'videos/{camera}/chunk-{ci:03d}/file-{fi:03d}.mp4'
                    if not f.is_file():
                        raise HTTPException(404, f'视频不存在: {f.name}')
                    offset = int(round(float(row[f'videos/{camera}/from_timestamp']) * fps))
                    return f, offset, int(row['length'])
        raise HTTPException(404, '片段不存在')
    raise HTTPException(400, f'不支持的数据集版本: {version or "unknown"}')


def _sam_ensure(dataset: str, episode: int, camera: str | None = None):
    p = safe_dataset(dataset)
    info = json.loads((p / 'meta/info.json').read_text())
    cam = camera or _first_camera(info)
    feats = info.get('features', {})
    if not cam or feats.get(cam, {}).get('dtype') != 'video':
        raise HTTPException(400, f'不是视频相机: {cam}')
    key = (str(p), episode, cam)
    with SAM_LOCK:
        hit = SAM_SESSIONS.get(key)
        if hit:
            return hit
        for old_key, old in list(SAM_SESSIONS.items()):
            try:
                _sam_http('DELETE', f"/api/sam/{old['sid']}", timeout=15)
            except HTTPException:
                pass
            SAM_SESSIONS.pop(old_key, None)
        video, offset, length = _episode_video(p, episode, cam, info)
        resp = _sam_upload_session(video)
        hit = {'sid': resp['sid'], 'offset': offset, 'length': length,
               'camera': cam, 'width': resp['width'], 'height': resp['height'],
               'fps': resp.get('fps'), 'key': key}
        SAM_SESSIONS[key] = hit
        return hit


def _sam_call(dataset, episode, camera, method, path_fn, payload_fn=None, timeout=300):
    """转发请求到 SAM 服务;若会话已失效(SAM 服务重启过),重建会话并重试一次。

    path_fn / payload_fn 都接收会话对象,保证重试时用新 sid 和 offset。
    """
    sess = _sam_ensure(dataset, episode, camera)
    try:
        payload = payload_fn(sess) if payload_fn else None
        return sess, _sam_http(method, path_fn(sess), payload, timeout)
    except HTTPException as e:
        if e.status_code == 404 and '会话不存在' in str(e.detail):
            with SAM_LOCK:
                SAM_SESSIONS.pop(sess.get('key'), None)
            sess = _sam_ensure(dataset, episode, camera)
            payload = payload_fn(sess) if payload_fn else None
            return sess, _sam_http(method, path_fn(sess), payload, timeout)
        raise


def _sam_args(payload):
    dataset = str(payload.get('dataset') or '')
    episode = int(payload.get('episode', -1))
    camera = payload.get('camera') or None
    return dataset, episode, _sam_ensure(dataset, episode, camera)


@app.post('/api/bridge/sam/session')
def bridge_sam_session(payload: dict):
    _, _, sess = _sam_args(payload)
    return {'camera': sess['camera'], 'width': sess['width'],
            'height': sess['height'], 'fps': sess['fps'], 'length': sess['length']}


@app.post('/api/bridge/sam/click')
def bridge_sam_click(payload: dict):
    dataset = str(payload.get('dataset') or '')
    episode = int(payload.get('episode', -1))
    camera = payload.get('camera') or None
    frame = int(payload.get('frame', 0))
    sess, resp = _sam_call(
        dataset, episode, camera, 'POST',
        lambda s: f"/api/sam/{s['sid']}/click",
        lambda s: {'frame': frame + s['offset'],
                   'points': payload.get('points') or [],
                   'object_id': payload.get('object_id')})
    resp['frame'] = frame
    if resp.get('mask_url'):
        q = urllib.parse.urlencode({'dataset': dataset, 'episode': episode,
                                    'camera': sess['camera']})
        resp['mask_url'] = f"/api/bridge/sam/mask/{frame}/{resp['object_id']}.png?{q}"
    return resp


@app.post('/api/bridge/sam/propagate')
def bridge_sam_propagate(payload: dict):
    dataset = str(payload.get('dataset') or '')
    episode = int(payload.get('episode', -1))
    camera = payload.get('camera') or None
    _, resp = _sam_call(dataset, episode, camera, 'POST',
                        lambda s: f"/api/sam/{s['sid']}/propagate",
                        lambda s: {'object_id': None})
    return resp


@app.get('/api/bridge/sam/task/{task_id}')
def bridge_sam_task(task_id: str):
    return _sam_http('GET', f'/api/sam/task/{task_id}', timeout=30)


@app.get('/api/bridge/sam/bboxes/{oid}')
def bridge_sam_bboxes(oid: int, dataset: str, episode: int, camera: str | None = None):
    sess, resp = _sam_call(dataset, episode, camera, 'GET',
                           lambda s: f"/api/sam/{s['sid']}/bboxes/{oid}", timeout=60)
    offset, length = sess['offset'], sess['length']
    boxes = [{**b, 'frame': b['frame'] - offset} for b in resp.get('boxes', [])]
    resp['boxes'] = [b for b in boxes if 0 <= b['frame'] < length]
    return resp


@app.get('/api/bridge/sam/mask/{frame}/{oid}.png')
def bridge_sam_mask(frame: int, oid: int, dataset: str, episode: int, camera: str | None = None):
    sess, body = _sam_call(dataset, episode, camera, 'GET',
                           lambda s: f"/api/sam/{s['sid']}/mask/{frame + s['offset']}/{oid}.png",
                           timeout=60)
    return Response(content=body, media_type='image/png',
                    headers={'Cache-Control': 'no-store'})


@app.delete('/api/bridge/sam/object/{oid}')
def bridge_sam_remove(oid: int, dataset: str, episode: int, camera: str | None = None):
    _, resp = _sam_call(dataset, episode, camera, 'DELETE',
                        lambda s: f"/api/sam/{s['sid']}/object/{oid}", timeout=60)
    return resp


@app.get('/api/bridge/sam/health')
def bridge_sam_health():
    return _sam_http('GET', '/api/sam/health', timeout=15)


@app.post('/api/bridge/sam/finalize')
def bridge_sam_finalize(payload: dict):
    """把某个对象的全部 mask 落盘到 segments/masks/episode_XXXXXX/<mask_key>/,
    之后预览不再依赖 SAM 会话。"""
    dataset = str(payload.get('dataset') or '')
    episode = int(payload.get('episode', -1))
    camera = payload.get('camera') or None
    oid = int(payload.get('object_id'))
    mask_key = str(payload.get('mask_key') or '')
    if not re.fullmatch(r'[\w\-]{4,64}', mask_key):
        raise HTTPException(400, 'mask_key 不合法')
    sess = _sam_ensure(dataset, episode, camera)
    out_dir = (safe_dataset(dataset) / 'segments' / 'masks'
               / f'episode_{episode:06d}' / mask_key)
    out_dir.mkdir(parents=True, exist_ok=True)
    saved = 0
    for f in range(sess['length']):
        try:
            body = _sam_http(
                'GET',
                f"/api/sam/{sess['sid']}/mask/{f + sess['offset']}/{oid}.png",
                timeout=60)
        except HTTPException as e:
            if e.status_code == 404:
                continue  # 该帧没有此对象的 mask
            raise
        (out_dir / f'{f:05d}.png').write_bytes(body)
        saved += 1
    return {'saved': saved, 'mask_key': mask_key}


@app.get('/api/bridge/mask_file')
def bridge_mask_file(dataset: str, episode: int, key: str, frame: int):
    base = safe_dataset(dataset)
    if not re.fullmatch(r'[\w\-]{4,64}', key):
        raise HTTPException(400, 'mask_key 不合法')
    p = (base / 'segments' / 'masks' / f'episode_{episode:06d}'
         / key / f'{frame:05d}.png')
    if not p.is_file():
        raise HTTPException(404, 'mask 不存在')
    return FileResponse(p, headers={'Cache-Control': 'private, max-age=3600'})


# ── 鉴权闸门:数据面(/file /index /segments /mask_file /sam)以及上游引擎自带的
#    (/api/fs /api/datasets /api/episode/*)历史上都没有登录校验,任何能访问端口的人
#    都能读走甚至覆盖标注。这里在中间件里统一补上,不逐个改路由签名。
#    静态资源挂在 '/' 不走 /api/ 前缀;登录与探活接口按白名单放行。
PUBLIC_PATHS = frozenset({
    '/api/health',              # 容器/探活
    '/api/bridge/auth/login',   # 登录本身
    '/api/bridge/auth/logout',  # 会话已过期时点退出不应再报 401
    '/api/bridge/sam/health',   # 外部 SAM 服务状态
})


@app.middleware('http')
async def require_login(request: Request, call_next):
    path = request.url.path
    if path.startswith('/api/') and path not in PUBLIC_PATHS:
        from bridge_ext.auth import current_user
        if current_user(request) is None:
            return JSONResponse({'detail': '未登录或会话已过期'}, status_code=401)
    return await call_next(request)


# ── 平台化扩展注册槽(Wave 0):各 bridge_ext 模块在此 register(app) ──
from bridge_ext import auth as _ext_auth, users as _ext_users
from bridge_ext import ledger as _ext_ledger, status as _ext_status, \
    dictionary as _ext_dict, qc as _ext_qc, dashboard as _ext_dash, tasks as _ext_tasks
_ext_auth.register(app)
_ext_users.register(app)
for _m in (_ext_ledger, _ext_status, _ext_dict, _ext_qc, _ext_dash, _ext_tasks):
    _m.register(app)


# 必须最后挂载：根路径 StaticFiles 会匹配所有未命中 API 的请求。
@app.get('/studio')
@app.get('/studio/')
@app.get('/studio/{legacy_path:path}')
def legacy_studio(request: Request, legacy_path: str = ''):
    query = f'?{request.url.query}' if request.url.query else ''
    return RedirectResponse(f'/{query}', status_code=307)


app.mount('/', StaticFiles(directory='/integration/studio', html=True), name='studio')
