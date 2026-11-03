"""Exercise the unified app, real auth and dataset API with disposable data only."""
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, os.environ.get('LABELVLA_BRIDGE_DIR', str(Path(__file__).resolve().parents[2]/'backend')))
from fastapi.testclient import TestClient
from bridge_ext import db, tasks, notifications


class AppIntegrationTest(unittest.TestCase):
    def test_authenticated_task_save_publish_and_original_protection(self):
        with tempfile.TemporaryDirectory(prefix='labelvla_app_') as directory:
            root=Path(directory); data=root/'data'; output=root/'output'
            old_env={key:os.environ.get(key) for key in ('DATA_ROOT','OUTPUT_ROOT','LABELVLA_DATA_ROOTS')}
            os.environ.update(DATA_ROOT=str(data),OUTPUT_ROOT=str(output),LABELVLA_DATA_ROOTS=f'{data}:{output}')
            old_db=db.DB_PATH;db.DB_PATH=data/'.platform/platform.db'
            previous=sys.modules.pop('bridge',None)
            old_enqueue,old_notify=tasks.enqueue,notifications.schedule_published
            tasks.enqueue=lambda *args:None;notifications.schedule_published=lambda *args:None
            try:
                app_module=importlib.import_module('bridge')
                client=TestClient(app_module.app)
                with db.get_db() as conn: conn.execute("UPDATE users SET must_change_password=0 WHERE username='admin'")
                self.assertEqual(client.get('/api/health').status_code,200)
                self.assertEqual(client.get('/').status_code,200)
                self.assertEqual(client.get('/api/bridge/versions').status_code,401)
                self.assertEqual(client.post('/api/bridge/auth/login',json={'username':'admin','password':'admin'}).status_code,200)
                source=data/'demo';(source/'meta').mkdir(parents=True);(source/'data/chunk-000').mkdir(parents=True)
                info={'codebase_version':'v2.1','total_episodes':1,'total_frames':10,'fps':10,'features':{}}
                (source/'meta/info.json').write_text(json.dumps(info))
                (source/'meta/episodes.jsonl').write_text(json.dumps({'episode_index':0,'length':10,'tasks':['pick']})+'\n')
                import pyarrow as pa
                import pyarrow.parquet as pq
                pq.write_table(pa.table({'episode_index':[0]*10,'frame_index':list(range(10)),'timestamp':[i/10 for i in range(10)]}), source/'data/chunk-000/episode_000000.parquet')
                def digest():return {str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
                original=digest()
                response=client.post('/api/bridge/tasks',json={'dataset':str(source),'name':'isolated app test','assignee':'admin','reviewer':'admin'})
                self.assertEqual(response.status_code,200,response.text)
                task=response.json();task_id=task['id'];target=output/'demo/demov1'
                self.assertEqual(task['workspace_path'],str(target));tasks._run_task(task_id)
                params={'dataset':str(target),'episode':0}
                initial=client.get('/api/bridge/segments',params=params)
                self.assertEqual(initial.status_code,200,initial.text)
                annotation={'revision':initial.json()['revision'],'segments':[{'start_frame':0,'end_frame':9,'text':'pick cup','bboxes':[]}]}
                self.assertEqual(client.post('/api/bridge/segments',params={'dataset':str(source),'episode':0},json=annotation).status_code,409)
                saved=client.post('/api/bridge/segments',params=params,json=annotation)
                self.assertEqual(saved.status_code,200,saved.text)
                draft=client.post(f'/api/bridge/tasks/{task_id}/drafts',json={'source':str(target),'episodes':[{'source':0,'start':0,'end':9}]})
                self.assertEqual(draft.status_code,200,draft.text);self.assertEqual(draft.json()['dataset'],str(target))
                index=client.get('/api/bridge/index',params={'dataset':str(target)})
                self.assertIn('segments/episode_000000.json',index.json()['files'])
                self.assertEqual(client.get('/api/bridge/segments',params=params).json()['segments'][0]['text'],'pick cup')
                for node in ('annotate','qc'):
                    result=client.post(f'/api/bridge/tasks/{task_id}/nodes/{node}/complete',json={})
                    self.assertEqual(result.status_code,200,result.text);tasks._run_task(task_id)
                version=client.get('/api/bridge/versions').json()['versions'][0]
                self.assertEqual((version['status'],version['dataset_path']),('已发布',str(target)))
                archive=client.get(version['download_url']);self.assertEqual(archive.status_code,200)
                import io
                with tarfile.open(fileobj=io.BytesIO(archive.content)) as tar:self.assertIn('demov1/segments/episode_000000.json',tar.getnames())
                self.assertEqual(client.post('/api/bridge/segments',params=params,json=annotation).status_code,409)
                self.assertEqual(digest(),original)
                print('PASS unified app: auth -> create output version -> save/read -> review/publish -> archive -> original and release protection')
            finally:
                tasks.enqueue,notifications.schedule_published=old_enqueue,old_notify
                db.DB_PATH=old_db
                sys.modules.pop('bridge',None)
                if previous is not None:sys.modules['bridge']=previous
                for key,value in old_env.items():
                    if value is None:os.environ.pop(key,None)
                    else:os.environ[key]=value

if __name__=='__main__':unittest.main()
