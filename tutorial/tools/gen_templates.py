"""生成模板数据集 data/tutorial_demo_template（3 条 Episode，无标注，H.264 640x480）。

从 data/subtask1_50 取前 3 条 Episode，每条截 20 秒，压成浏览器友好的 H.264。
原数据集不会被修改。
"""
import json, shutil, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'data' / 'subtask1_50'
DST = ROOT / 'data' / 'tutorial_demo_template'
FFMPEG = ROOT / 'data' / '.platform' / 'tools' / 'ffmpeg'
EPISODES = [0, 1, 2]
SECONDS = 20.0
CAMERAS = [
    'observation.images.cam_fisheye_front',
    'observation.images.cam_left_wrist_down',
    'observation.images.cam_right_wrist_down',
]
import pyarrow as pa, pyarrow.parquet as pq  # noqa: E402


def read_jsonl(path):
    return [json.loads(x) for x in path.read_text(encoding='utf8').splitlines() if x.strip()]


def main():
    if DST.exists():
        shutil.rmtree(DST)
    info = json.loads((SRC / 'meta' / 'info.json').read_text(encoding='utf8'))
    fps = int(info['fps'])
    keep = int(round(SECONDS * fps))
    src_eps = {e['episode_index']: e for e in read_jsonl(SRC / 'meta' / 'episodes.jsonl')}
    tasks = read_jsonl(SRC / 'meta' / 'tasks.jsonl')[:1]
    out_ep, out_stats, total = [], [], 0
    for idx in EPISODES:
        length = min(int(src_eps[idx]['length']), keep)
        (DST / 'data' / 'chunk-000').mkdir(parents=True, exist_ok=True)
        table = pq.read_table(SRC / 'data' / 'chunk-000' / f'episode_{idx:06d}.parquet').slice(0, length)
        cols = {n: table.column(n) for n in table.column_names}
        cols['frame_index'] = pa.array(range(length), type=pa.int64())
        cols['episode_index'] = pa.array([idx] * length, type=pa.int64())
        cols['index'] = pa.array(range(total, total + length), type=pa.int64())
        pq.write_table(pa.table(cols), DST / 'data' / 'chunk-000' / f'episode_{idx:06d}.parquet')
        for cam in CAMERAS:
            src = SRC / 'videos' / 'chunk-000' / cam / f'episode_{idx:06d}.mp4'
            dst = DST / 'videos' / 'chunk-000' / cam / f'episode_{idx:06d}.mp4'
            dst.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run([str(FFMPEG), '-y', '-hide_banner', '-loglevel', 'error', '-i', str(src),
                            '-t', f'{length / fps:.3f}', '-vf', f'scale=640:480,fps={fps}', '-an',
                            '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p',
                            '-movflags', '+faststart', str(dst)], check=True)
        out_ep.append({'episode_index': idx, 'tasks': src_eps[idx]['tasks'], 'length': length})
        out_stats.append({'episode_index': idx, 'stats': {
            'frame_index': {'min': [0], 'max': [length - 1], 'mean': [(length - 1) / 2], 'std': [0.0], 'count': [length]},
            'episode_index': {'min': [idx], 'max': [idx], 'mean': [idx], 'std': [0.0], 'count': [length]}}})
        total += length
    feats = {}
    for k, v in info['features'].items():
        if v.get('dtype') == 'video':
            if k in CAMERAS: feats[k] = v
        elif k in ('observation.state', 'action', 'timestamp', 'frame_index', 'episode_index', 'index', 'task_index'):
            v = dict(v)
            if k == 'timestamp': v['shape'] = [1]
            feats[k] = v
    info.update(total_episodes=len(EPISODES), total_frames=total, total_tasks=len(tasks),
                total_videos=len(EPISODES) * len(CAMERAS), total_chunks=1,
                splits={'train': f'0:{len(EPISODES)}'}, features=feats)
    meta = DST / 'meta'; meta.mkdir(parents=True, exist_ok=True)
    (meta / 'info.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    (meta / 'episodes.jsonl').write_text(''.join(json.dumps(e, ensure_ascii=False) + '\n' for e in out_ep), encoding='utf8')
    (meta / 'episodes_stats.jsonl').write_text(''.join(json.dumps(e, ensure_ascii=False) + '\n' for e in out_stats), encoding='utf8')
    (meta / 'tasks.jsonl').write_text(''.join(json.dumps(t, ensure_ascii=False) + '\n' for t in tasks), encoding='utf8')
    print('ok', DST)


if __name__ == '__main__':
    main()
