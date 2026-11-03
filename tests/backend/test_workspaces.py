"""Isolated real-media test: no production DB, task worker or notifications."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path

sys.path.insert(0, os.environ.get('LABELVLA_BRIDGE_DIR', str(Path(__file__).resolve().parents[2] / 'backend')))
import cv2
if not os.environ.get("LABELVLA_FFMPEG"):
    import imageio_ffmpeg
    os.environ["LABELVLA_FFMPEG"] = imageio_ffmpeg.get_ffmpeg_exe()
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from bridge_ext import db
from bridge_ext import workspaces as ws, tasks, exclusions


class WorkspaceTest(unittest.TestCase):
    def test_full_export_lifecycle(self):
        with tempfile.TemporaryDirectory(prefix='labelvla_versions_') as directory:
            root = Path(directory)
            os.environ['OUTPUT_ROOT'] = str(root/'output')
            fake = types.ModuleType('bridge')
            fake.root = root
            fake.annotation_lock = threading.Lock()
            def safe(path):
                path = Path(path).resolve()
                if not path.is_relative_to(root) or not (path/'meta/info.json').is_file():
                    raise HTTPException(400, 'invalid dataset')
                return path
            fake.safe_dataset = safe
            fake._episode_video = lambda p,ep,cam,info: (p/f'videos/chunk-000/{cam}/episode_{ep:06d}.mp4',0,10)
            previous_bridge = sys.modules.get('bridge')
            sys.modules['bridge'] = fake
            old_db = db.DB_PATH
            db.DB_PATH = root/'.platform/platform.db'
            try:
                db.init_db(); tasks.init_schema(); ws.init_schema(); exclusions.init_schema()
                app = FastAPI(); app.include_router(ws.router)
                user = {'username':'admin', 'role':'admin'}
                original_require = ws.require
                ws.require = lambda *args: user
                client = TestClient(app)
                source = root/'demo'
                (source/'meta').mkdir(parents=True)
                (source/'data/chunk-000').mkdir(parents=True)
                video_dir = source/'videos/chunk-000/observation.images.front'
                video_dir.mkdir(parents=True)
                info = {'codebase_version':'v2.1','total_episodes':3,'total_frames':30,'fps':10,'features':{'observation.images.front':{'dtype':'video','shape':[32,32,3]}}}
                (source/'meta/info.json').write_text(json.dumps(info))
                (source/'meta/episodes.jsonl').write_text(''.join(json.dumps({'episode_index':i,'length':10,'tasks':['pick']})+'\n' for i in range(3)))
                ffmpeg = os.environ.get('LABELVLA_FFMPEG','/data/.platform/tools/ffmpeg')
                for ep in range(3):
                    rows = {'episode_index':[ep]*10,'frame_index':list(range(10)), 'timestamp':[i/10 for i in range(10)],'action':[ep*100+i for i in range(10)]}
                    pq.write_table(pa.table(rows), source/f'data/chunk-000/episode_{ep:06d}.parquet')
                    subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i',f'color=c=red:s=32x32:r=10:d=1','-c:v','libaom-av1' if ep == 2 else 'libx264','-pix_fmt','yuv420p',str(video_dir/f'episode_{ep:06d}.mp4')], check=True)
                def digest(path):
                    return {p.relative_to(path).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in path.rglob('*') if p.is_file()}
                raw_digest = digest(source)
                with ws.db_session() as conn:
                    conn.execute("INSERT INTO tasks (id,name,dataset,dataset_name,status,current_node,created_at,assignee,reviewer,created_by) VALUES (1,'test',?,'demo','waiting_human','annotate',?,'worker','reviewer','admin')",(str(source),ws.now_iso()))
                    conn.execute("INSERT INTO dataset_status(dataset,episode,status) VALUES (?,2,'labeling')",(str(source),))
                response = client.post('/api/bridge/tasks/1/workspace')
                self.assertEqual(response.status_code,200,response.text)
                work = Path(response.json()['dataset'])
                self.assertEqual(digest(work),raw_digest)
                # Add LabelVLA ranges and actual per-frame PNG masks to the task copy only.
                (work/'segments').mkdir()
                box = {'x':0,'y':0,'width':10,'height':10,'label':'cup','keypoints':[{'frame':0,'cx':0,'cy':0},{'frame':9,'cx':9,'cy':9}], 'frame_boxes':[{'frame':i,'x':i,'y':i,'w':10,'h':10} for i in range(10)],'mask_key':'mask1'}
                label = {'episode_index':2,'segments':[{'start_frame':1,'end_frame':7,'text':'pick cup','skill':'pick','bboxes':[box]}, {'start_frame':8,'end_frame':9,'text':'outside','bboxes':[]}]}
                (work/'segments/episode_000002.json').write_text(json.dumps(label))
                masks=work/'segments/masks/episode_000002/mask1'; masks.mkdir(parents=True)
                for i in range(10): cv2.imwrite(str(masks/f'{i:05d}.png'), np.full((32,32),i,np.uint8))
                work_digest=digest(work)
                mapping=[{'source':2,'start':2,'end':5},{'source':0,'start':0,'end':9}]
                user.update(username='reviewer',role='reviewer')
                self.assertEqual(client.post('/api/bridge/tasks/1/drafts',json={'source':str(work),'episodes':mapping}).status_code,403)
                user.update(username='admin',role='admin')
                draft=client.post('/api/bridge/tasks/1/drafts',json={'source':str(work),'episodes':mapping}).json()['id']
                self.assertEqual(client.post('/api/bridge/tasks/1/drafts',json={'source':str(work),'episodes':mapping}).status_code,409)
                self.assertEqual(client.put(f'/api/bridge/drafts/{draft}/file?path=../bad',content=b'x').status_code,400)
                user.update(username='other')
                self.assertEqual(client.get(f'/api/bridge/drafts/{draft}/file?path=meta/info.json').status_code,403)
                user.update(username='admin')
                stats=client.get(f'/api/bridge/drafts/{draft}/visual-stats?episode=2&start=2&end=5')
                self.assertEqual(stats.status_code,200,stats.text)
                self.assertEqual(stats.json()['observation.images.front']['count'],[4])
                self.assertGreater(stats.json()['observation.images.front']['mean'][0][0][0],.9)
                self.assertEqual(client.post(f'/api/bridge/drafts/{draft}/finish').status_code,400)
                with ws.db_session() as conn:
                    self.assertIsNone(conn.execute('SELECT edited_dataset FROM tasks WHERE id=1').fetchone()[0])
                def put(path,data):
                    result=client.put(f'/api/bridge/drafts/{draft}/file',params={'path':path},content=data)
                    self.assertEqual(result.status_code,200,result.text)
                new_info={**info,'total_episodes':2,'total_frames':14}
                put('meta/info.json', json.dumps(new_info).encode())
                put('meta/episodes.jsonl', b'{"episode_index":0,"length":4,"tasks":["pick"]}\n{"episode_index":1,"length":10,"tasks":["pick"]}\n')
                for new, m in enumerate(mapping):
                    table=pq.read_table(work/f'data/chunk-000/episode_{m["source"]:06d}.parquet').slice(m['start'],m['end']-m['start']+1)
                    n=table.num_rows
                    table=table.set_column(0,'episode_index',pa.array([new]*n)).set_column(1,'frame_index',pa.array(list(range(n)))).set_column(2,'timestamp',pa.array([i/10 for i in range(n)]))
                    sink=pa.BufferOutputStream();pq.write_table(table,sink)
                    put(f'data/chunk-000/episode_{new:06d}.parquet',sink.getvalue().to_pybytes())
                    video=(video_dir/f'episode_{m["source"]:06d}.mp4').read_bytes()
                    if m['start'] or m['end'] != 9:
                        response=client.post(f'/api/bridge/drafts/{draft}/video?start={m["start"]/10}&end={(m["end"]+1)/10}',content=video)
                        self.assertEqual(response.status_code,200,response.text[:300])
                        video=response.content
                    put(f'videos/chunk-000/observation.images.front/episode_{new:06d}.mp4',video)
                response=client.post(f'/api/bridge/drafts/{draft}/finish')
                self.assertEqual(response.status_code,200,response.text)
                saved=Path(response.json()['dataset'])
                actual=json.loads((saved/'segments/episode_000000.json').read_text())
                self.assertEqual(actual['episode_index'],0)
                self.assertEqual(len(actual['segments']),1)
                seg=actual['segments'][0]
                self.assertEqual((seg['start_frame'],seg['end_frame']),(0,3))
                self.assertEqual([p['frame'] for p in seg['bboxes'][0]['keypoints']],[0,3])
                self.assertEqual(seg['bboxes'][0]['keypoints'][0]['cx'],2)
                self.assertEqual([p['frame'] for p in seg['bboxes'][0]['frame_boxes']],[0,1,2,3])
                self.assertEqual(len(list((saved/'segments/masks/episode_000000/mask1').glob('*.png'))),4)
                self.assertEqual(int(cv2.imread(str(saved/'segments/masks/episode_000000/mask1/00000.png'),0)[0,0]),2)
                self.assertEqual(client.post(f'/api/bridge/drafts/{draft}/finish').status_code,409)
                self.assertEqual(digest(source),raw_digest)
                self.assertEqual(digest(work),work_digest)
                ctx=tasks._load_task_ctx(1)
                self.assertEqual(ctx['path'],saved)
                tasks._node_package(ctx,lambda *args:None)
                first=tasks._node_compile(ctx,lambda *args:None)
                release1=Path(first['bundle']).parent
                first_digest=digest(release1)
                # The next publication uses the same source lineage and a new independent directory.
                tasks._node_package(ctx,lambda *args:None)
                second=tasks._node_compile(ctx,lambda *args:None)
                self.assertEqual((first['version'],second['version']),('V1.0','V2.0'))
                self.assertEqual(digest(release1),first_digest)
                # Start a new task from a published version, keeping the original lineage.
                from bridge_ext import notifications
                old_require, old_enqueue, old_notify = tasks.require, tasks.enqueue, notifications.schedule_published
                tasks.require = lambda *args: user
                tasks.enqueue = lambda *args: None
                notifications.schedule_published = lambda *args: None
                try:
                    with ws.db_session() as conn:
                        version_id = conn.execute("SELECT id FROM versions WHERE version='V1.0'").fetchone()[0]
                    created = tasks.create_task(None, {'dataset':str(source),'name':'next edit','assignee':'admin','reviewer':'admin','base_version_id':version_id})
                    self.assertEqual(created['source_dataset'],str(release1/'snapshot/demo_V1.0'))
                    with ws.db_session() as conn:
                        conn.execute("UPDATE tasks SET status='waiting_human',current_node='annotate' WHERE id=?",(created['id'],))
                    fork=client.post(f'/api/bridge/tasks/{created["id"]}/workspace')
                    self.assertEqual(fork.status_code,200,fork.text)
                    fork_path=Path(fork.json()['dataset'])
                    self.assertEqual(digest(fork_path),digest(release1/'snapshot/demo_V1.0'))
                    with ws.db_session() as conn:
                        self.assertEqual(conn.execute('SELECT status FROM dataset_status WHERE dataset=? AND episode=0',(str(fork_path),)).fetchone()[0],'labeling')
                    self.assertEqual(digest(release1),first_digest)
                finally:
                    tasks.require, tasks.enqueue, notifications.schedule_published = old_require, old_enqueue, old_notify

                self.assertTrue((release1/'snapshot/demo_V1.0/meta/info.json').is_file())
                with ws.db_session() as conn:
                    conn.execute("UPDATE tasks SET current_node='qc' WHERE id=1")
                    self.assertEqual(conn.execute('SELECT status FROM dataset_status WHERE dataset=? AND episode=0',(str(saved),)).fetchone()[0],'labeling')
                with self.assertRaises(HTTPException):ws.assert_writable(None,str(saved))
                self.assertEqual(digest(source),raw_digest)
                print('PASS real MP4 crop + Parquet rows + range/track/mask remap + source hashes + V1/V2 immutability + access controls')
            finally:
                ws.require=original_require
                db.DB_PATH=old_db
                if previous_bridge is None:sys.modules.pop('bridge',None)
                else:sys.modules['bridge']=previous_bridge


    def test_annotation_only_save_copies_dataset(self):
        with tempfile.TemporaryDirectory(prefix='labelvla_copy_') as directory:
            root = Path(directory)
            os.environ['OUTPUT_ROOT'] = str(root/'output')
            fake = types.ModuleType('bridge')
            fake.root = root
            fake.annotation_lock = threading.Lock()
            def safe(path):
                path = Path(path).resolve()
                if not path.is_relative_to(root) or not (path/'meta/info.json').is_file():
                    raise HTTPException(400, 'invalid dataset')
                return path
            fake.safe_dataset = safe
            previous_bridge = sys.modules.get('bridge')
            sys.modules['bridge'] = fake
            old_db = db.DB_PATH
            db.DB_PATH = root/'.platform/platform.db'
            original_require = ws.require
            try:
                db.init_db(); tasks.init_schema(); ws.init_schema(); exclusions.init_schema()
                app = FastAPI(); app.include_router(ws.router)
                user = {'username':'admin', 'role':'admin'}
                ws.require = lambda *args: user
                client = TestClient(app)
                source = root/'demo'
                (source/'meta').mkdir(parents=True)
                (source/'data/chunk-000').mkdir(parents=True)
                (source/'videos/chunk-000/observation.images.front').mkdir(parents=True)
                info = {'codebase_version':'v2.1','total_episodes':2,'total_frames':20,'fps':10,
                        'features':{'observation.images.front':{'dtype':'video','shape':[32,32,3]}}}
                (source/'meta/info.json').write_text(json.dumps(info))
                (source/'meta/episodes.jsonl').write_text(''.join(
                    json.dumps({'episode_index':i,'length':10,'tasks':['pick']})+'\n' for i in range(2)))
                (source/'segments').mkdir()
                label = json.dumps({'episode_index':0,'segments':[{'start_frame':0,'end_frame':4,'text':'pick','bboxes':[]}]})
                (source/'segments/episode_000000.json').write_text(label)
                with ws.db_session() as conn:
                    conn.execute("INSERT INTO tasks (id,name,dataset,dataset_name,status,current_node,created_at,assignee,reviewer,created_by) VALUES (1,'test',?,'demo','waiting_human','annotate',?,'worker','reviewer','admin')",(str(source),ws.now_iso()))
                identity = [{'source':0,'start':0,'end':9},{'source':1,'start':0,'end':9}]
                response = client.post('/api/bridge/tasks/1/drafts', json={'source':str(source),'episodes':identity})
                self.assertEqual(response.status_code,200,response.text)
                body = response.json()
                self.assertTrue(body.get('copied'), body)
                saved = Path(body['dataset'])
                self.assertEqual((saved/'segments/episode_000000.json').read_text(), label)
                self.assertTrue((saved/'labelvla_revision.json').is_file())
                self.assertFalse((source/'labelvla_revision.json').exists())
                with ws.db_session() as conn:
                    self.assertEqual(conn.execute('SELECT edited_dataset FROM tasks WHERE id=1').fetchone()[0],str(saved))
                    self.assertEqual(conn.execute('SELECT status FROM studio_drafts').fetchone()[0],'saved')
                # Any trim or dropped episode still needs the client-side export.
                trimmed = [{'source':0,'start':2,'end':9},{'source':1,'start':0,'end':9}]
                response = client.post('/api/bridge/tasks/1/drafts', json={'source':str(saved),'episodes':trimmed})
                self.assertEqual(response.status_code,200,response.text)
                self.assertNotIn('dataset',response.json())
                print('PASS annotation-only save copies the dataset server-side')
            finally:
                ws.require = original_require
                db.DB_PATH = old_db
                if previous_bridge is None: sys.modules.pop('bridge',None)
                else: sys.modules['bridge'] = previous_bridge


if __name__=='__main__':unittest.main()
