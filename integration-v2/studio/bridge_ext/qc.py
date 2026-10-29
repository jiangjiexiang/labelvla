"""质检扫描:后台线程跑 5 条规则,结果落 qc_reports 表。

规则(设计文档第 5 节):
  no_box            片段存在但 bboxes 为空
  missing_frame_box 片段范围内某帧没有任何框覆盖(frame_boxes/interpolated_centers/keypoints)
  out_of_bounds     框超出相机画面(info.json features[cam].shape = [h, w, c])
  area_jump         相邻帧框面积变化 > 3 倍
  mask_missing      bbox 有 mask_key 且有框覆盖的帧,磁盘 mask 文件缺失
每次全量重扫一个数据集:先清旧报告再写入,并更新 qc_scans(dataset 级扫描台账)。
"""
import json
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from .common import db_session, now_iso, require, safe_dataset

router = APIRouter()

_active = set()
_active_lock = threading.Lock()


def _covered_frames(b: dict) -> set:
    frames = {int(e['frame']) for e in b.get('frame_boxes') or [] if 'frame' in e}
    frames |= {int(e['frame']) for e in b.get('interpolated_centers') or [] if 'frame' in e}
    if not frames:
        frames = {int(k['frame']) for k in b.get('keypoints') or [] if 'frame' in k}
    return frames


def check_episode(p: Path, data: dict, episode: int, shapes: dict) -> list:
    """返回 [(rule, severity, detail, frame)]。"""
    out = []
    default_cam = next(iter(shapes), None)
    for si, s in enumerate(data.get('segments') or []):
        start, end = int(s.get('start_frame') or 0), int(s.get('end_frame') or 0)
        text = str(s.get('text') or '')[:30]
        bboxes = s.get('bboxes') or []
        if not bboxes:
            out.append(('no_box', 'error', f'片段{si}({text}) 没有任何目标框', start))
            continue
        covered = set()
        for b in bboxes:
            frames = _covered_frames(b)
            covered |= frames
            cam = b.get('camera') or default_cam
            wh = shapes.get(cam)
            fbx = sorted(b.get('frame_boxes') or [], key=lambda e: e.get('frame', 0))
            boxes = [(float(e['x']), float(e['y']), float(e['w']), float(e['h']), int(e['frame']))
                     for e in fbx if all(k in e for k in ('x', 'y', 'w', 'h', 'frame'))]
            if not boxes and all(k in b for k in ('x', 'y', 'width', 'height')):
                boxes = [(float(b['x']), float(b['y']), float(b['width']), float(b['height']), start)]
            if wh:
                w, h = wh
                hit = next((fr for x, y, bw, bh, fr in boxes
                            if x < 0 or y < 0 or x + bw > w or y + bh > h), None)
                if hit is not None:
                    out.append(('out_of_bounds', 'error', f'片段{si} 框超出 {cam} 画面 {w}x{h}', hit))
            prev = None
            for x, y, bw, bh, fr in boxes:
                if prev and fr - prev[4] == 1:
                    a0, a1 = prev[2] * prev[3], bw * bh
                    if a0 > 0 and (a1 > 3 * a0 or a1 < a0 / 3):
                        out.append(('area_jump', 'warning',
                                    f'片段{si} 相邻帧面积 {a0:.0f}→{a1:.0f}', fr))
                        break
                prev = (x, y, bw, bh, fr)
            mask_key = b.get('mask_key')
            if mask_key and frames:
                mdir = p / 'segments' / 'masks' / f'episode_{episode:06d}' / str(mask_key)
                missing = next((fr for fr in sorted(frames)
                                if not (mdir / f'{fr:05d}.png').is_file()), None)
                if missing is not None:
                    out.append(('mask_missing', 'warning',
                                f'片段{si} mask {mask_key} 缺帧(首缺 {missing})', missing))
        missing_frames = [fr for fr in range(start, end + 1) if fr not in covered]
        if missing_frames:
            out.append(('missing_frame_box', 'error',
                        f'片段{si}({text}) 缺框 {len(missing_frames)}/{end - start + 1} 帧',
                        missing_frames[0]))
    return out


def scan_dataset(p: Path) -> dict:
    info = json.loads((p / 'meta' / 'info.json').read_text(encoding='utf8'))
    shapes = {}
    for cam, v in info.get('features', {}).items():
        if v.get('dtype') == 'video' and len(v.get('shape') or []) >= 2:
            shapes[cam] = (int(v['shape'][1]), int(v['shape'][0]))
    total = int(info.get('total_episodes') or 0)
    rows = []
    episodes_with_rows = set()
    scanned_files = 0
    seg_dir = p / 'segments'
    if seg_dir.is_dir():
        for f in sorted(seg_dir.glob('episode_*.json')):
            try:
                episode = int(f.stem.split('_')[1])
                data = json.loads(f.read_text(encoding='utf8'))
            except Exception:
                continue
            scanned_files += 1
            for rule, severity, detail, frame in check_episode(p, data, episode, shapes):
                rows.append((str(p), episode, rule, severity, detail, frame, now_iso()))
                episodes_with_rows.add(episode)
    now = now_iso()
    with db_session() as db:
        db.execute('CREATE TABLE IF NOT EXISTS qc_scans('
                   'dataset TEXT PRIMARY KEY, scanned_at TEXT, episodes INT, failed INT)')
        db.execute('DELETE FROM qc_reports WHERE dataset=?', (str(p),))
        db.executemany(
            'INSERT OR REPLACE INTO qc_reports'
            '(dataset, episode, rule, severity, detail, frame, created_at)'
            ' VALUES (?,?,?,?,?,?,?)', rows)
        db.execute('INSERT OR REPLACE INTO qc_scans(dataset, scanned_at, episodes, failed)'
                   ' VALUES (?,?,?,?)',
                   (str(p), now, total, len(episodes_with_rows)))
    return {'dataset': str(p), 'episodes': total, 'annotated': scanned_files,
            'issues': len(rows), 'failed_episodes': len(episodes_with_rows)}


@router.post('/api/bridge/qc/scan')
def qc_scan(request: Request, payload: dict):
    require(request, 'admin', 'reviewer')
    p = safe_dataset(str(payload.get('dataset') or ''))
    key = str(p)
    with _active_lock:
        if key in _active:
            return {'ok': True, 'scanning': True, 'already': True}
        _active.add(key)

    def run():
        try:
            scan_dataset(p)
        finally:
            with _active_lock:
                _active.discard(key)

    threading.Thread(target=run, daemon=True).start()
    return {'ok': True, 'scanning': True}


@router.get('/api/bridge/qc')
def qc_get(request: Request, dataset: str, episode: int = None):
    require(request, 'admin', 'reviewer', 'annotator')
    p = safe_dataset(dataset)
    with db_session() as db:
        if episode is None:
            rows = db.execute(
                'SELECT * FROM qc_reports WHERE dataset=? ORDER BY episode, frame, rule',
                (str(p),)).fetchall()
        else:
            rows = db.execute(
                'SELECT * FROM qc_reports WHERE dataset=? AND episode=? ORDER BY frame, rule',
                (str(p), episode)).fetchall()
        try:
            scan = db.execute('SELECT * FROM qc_scans WHERE dataset=?', (str(p),)).fetchone()
        except Exception:
            scan = None
    return {
        'dataset': str(p),
        'scanning': str(p) in _active,
        'scanned_at': scan['scanned_at'] if scan else None,
        'issues': [{'episode': r['episode'], 'rule': r['rule'], 'severity': r['severity'],
                    'detail': r['detail'], 'frame': r['frame'], 'created_at': r['created_at']}
                   for r in rows],
    }


def register(app):
    app.include_router(router)
