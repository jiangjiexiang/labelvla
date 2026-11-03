"""Workflow integration tests against an isolated FastAPI app and temporary SQLite/data."""
import json
import os
import sqlite3
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path

sys.path.insert(0,os.environ.get('LABELVLA_BRIDGE_DIR','/integration/studio'))
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from bridge_ext import db, tasks as t, workflow as w, workspaces as ws, notifications as notify, exclusions


class WorkflowTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='labelvla_workflow_')
        self.root=Path(self.temp.name)
        self.previous_bridge=sys.modules.get('bridge')
        bridge=types.ModuleType('bridge'); bridge.root=self.root;bridge.annotation_lock=threading.Lock()
        def safe(path):
            path=Path(path).resolve()
            if not path.is_relative_to(self.root) or not (path/'meta/info.json').is_file():raise HTTPException(400,'dataset invalid')
            return path
        bridge.safe_dataset=safe;sys.modules['bridge']=bridge
        self.previous_db=db.DB_PATH;db.DB_PATH=self.root/'.platform/platform.db'
        self.previous_require=t.require;self.previous_enqueue=t.enqueue;self.previous_notify=notify.schedule_published
        self.user={'username':'admin','role':'admin'}
        def require(request,*roles):
            if roles and self.user['role'] not in roles:raise HTTPException(403,'forbidden')
            return self.user
        t.require=require;t.enqueue=lambda task_id:None;notify.schedule_published=lambda task_id:None
        db.init_db();t.init_schema();exclusions.init_schema()
        app=FastAPI();app.include_router(t.router);self.client=TestClient(app)
        self.source=self.root/'source';(self.source/'meta').mkdir(parents=True);(self.source/'segments').mkdir()
        (self.source/'meta/info.json').write_text(json.dumps({'codebase_version':'v2.1','total_episodes':3,'total_frames':30,'fps':10,'features':{}}))
        (self.source/'meta/episodes.jsonl').write_text(''.join(json.dumps({'episode_index':i,'length':10,'tasks':['original acquisition instruction']})+'\n' for i in range(3)))
        import pyarrow as pa
        import pyarrow.parquet as pq
        for i in range(3):
            path=self.source/f'data/chunk-000/episode_{i:06d}.parquet';path.parent.mkdir(parents=True,exist_ok=True)
            pq.write_table(pa.table({'episode_index':[i]*10,'frame_index':list(range(10)),'timestamp':[i/10 for i in range(10)]}),path)

    def tearDown(self):
        t.require=self.previous_require;t.enqueue=self.previous_enqueue;notify.schedule_published=self.previous_notify
        db.DB_PATH=self.previous_db
        if self.previous_bridge is None:sys.modules.pop('bridge',None)
        else:sys.modules['bridge']=self.previous_bridge
        self.temp.cleanup()

    def label(self,episode,text='pick cup'):
        (self.source/f'segments/episode_{episode:06d}.json').write_text(json.dumps({'episode_index':episode,'segments':[{'start_frame':0,'end_frame':9,'text':text,'bboxes':[]}]}))

    def create(self,workflow=None):
        payload={'dataset':str(self.source),'name':'workflow test','assignee':'admin','reviewer':'admin'}
        if workflow is not None:payload['workflow']=workflow
        response=self.client.post('/api/bridge/tasks',json=payload)
        self.assertEqual(response.status_code,200,response.text)
        return response.json()['id']

    def task(self,task_id):return self.client.get(f'/api/bridge/tasks/{task_id}').json()

    def approve(self,task_id,key):
        response=self.client.post(f'/api/bridge/tasks/{task_id}/nodes/{key}/complete',json={})
        self.assertEqual(response.status_code,200,response.text)
        t._run_task(task_id)

    def test_program_qc_blocks_publication_and_rework_recovers(self):
        self.label(0)
        # Legacy skipped rows without reasons must still be caught by the new audit.
        with t.db_session() as conn:
            conn.execute('INSERT INTO episode_exclusions VALUES (?,?,?,?,?,?)',(str(self.source),1,1,'','admin','now'))
        task_id=self.create();t._run_task(task_id)
        self.assertEqual(self.task(task_id)['current_node'],'annotate')
        self.approve(task_id,'annotate')
        self.assertEqual(self.task(task_id)['current_node'],'qc')
        self.assertFalse((self.root/'.platform/releases').exists())
        self.approve(task_id,'qc')
        task=self.task(task_id)
        self.assertEqual((task['status'],task['current_node']),('failed','program_qc'))
        report=json.loads(next(n for n in task['nodes'] if n['key']=='program_qc')['result_json'])
        self.assertEqual((report['total'],report['annotated'],report['skipped'],report['failed']),(3,1,0,2))
        self.assertEqual([row['status'] for row in report['episodes']],['annotated','missing_reason','missing_annotation'])
        self.assertTrue(Path(report['report_path']).is_file())
        with t.db_session() as conn:self.assertEqual(conn.execute('SELECT COUNT(*) FROM versions').fetchone()[0],0)
        self.assertEqual(next(n for n in task['nodes'] if n['key']=='compile')['status'],'waiting')
        with self.assertRaises(HTTPException):exclusions.set_exclusion(str(self.source),1,True,'  ','admin')
        exclusions.set_exclusion(str(self.source),1,True,'画面异常','admin')
        self.label(2)
        response=self.client.post(f'/api/bridge/tasks/{task_id}/rework')
        self.assertEqual(response.status_code,200,response.text)
        t._run_task(task_id);self.approve(task_id,'annotate');self.approve(task_id,'qc')
        task=self.task(task_id)
        self.assertEqual(task['status'],'done',task.get('error'))
        report=json.loads(next(n for n in task['nodes'] if n['key']=='program_qc')['result_json'])
        self.assertEqual((report['annotated'],report['skipped'],report['failed']),(2,1,0))
        with t.db_session() as conn:
            row=conn.execute('SELECT * FROM versions WHERE task_id=?',(task_id,)).fetchone()
            self.assertIsNotNone(row)
            self.assertTrue(Path(row['bundle_path']).is_file())
        self.assertEqual(self.client.post(f'/api/bridge/tasks/{task_id}/nodes/qc/complete',json={}).status_code,409)
        print('PASS manual pause -> per-Episode rejection -> no version -> chosen reason + rework -> complete full version')

    def test_workflow_edit_persists_order_programs_and_concurrency_guards(self):
        task_id=self.create();t._run_task(task_id);task=self.task(task_id)
        expected=[{k:n.get(k) for k in ('key','name','program','status')} for n in task['nodes']]
        nodes=[{k:n.get(k) for k in ('key','name','program')} for n in task['nodes']]
        extra={'key':'auto_quality','name':'追加框检查','program':'geometry_qc'}
        edited=[*nodes[:3],extra,*nodes[3:]]
        response=self.client.put(f'/api/bridge/tasks/{task_id}/workflow',json={'workflow':edited,'expected_nodes':expected})
        self.assertEqual(response.status_code,200,response.text)
        actual=response.json()['nodes']
        self.assertEqual([n['key'] for n in actual],['preprocess','annotate','qc','auto_quality','program_qc','compile'])
        self.assertEqual(actual[3]['program'],'geometry_qc')
        self.assertEqual(actual[0]['status'],'done');self.assertEqual(actual[1]['status'],'blocked')
        self.assertEqual(self.client.put(f'/api/bridge/tasks/{task_id}/workflow',json={'workflow':edited,'expected_nodes':expected}).status_code,409)
        latest=[{k:n.get(k) for k in ('key','name','program','status')} for n in actual]
        edited[0]['name']='tamper completed node'
        self.assertEqual(self.client.put(f'/api/bridge/tasks/{task_id}/workflow',json={'workflow':edited,'expected_nodes':latest}).status_code,409)
        self.user.update(username='annotator',role='annotator')
        self.assertEqual(self.client.put(f'/api/bridge/tasks/{task_id}/workflow',json={'workflow':edited,'expected_nodes':latest}).status_code,403)
        print('PASS actual ordered workflow persistence, selected program, locked prefix, stale-edit conflict and authorization')

    def test_invalid_workflows_are_rejected(self):
        template=w.catalog()['templates']['video_annotation']
        invalid=[[],template+[dict(template[0])],template[:-2]+[template[-1]],list(reversed(template)),[{**template[0],'program':'shell:anything'}]]
        for nodes in invalid:
            with self.subTest(nodes=nodes):
                with self.assertRaises(HTTPException):w.normalize(nodes,'video_annotation')
        minimal=w.normalize([{'key':'auto_inspect','name':'只运行预检查','program':'inspect_dataset'}],'preprocess')
        self.assertEqual(len(minimal),1)
        selected=self.create(minimal);t._run_task(selected)
        self.assertEqual(self.task(selected)['status'],'done')
        with t.db_session() as conn:self.assertEqual(conn.execute('SELECT COUNT(*) FROM versions').fetchone()[0],0)

    def test_registered_program_is_actually_executed_and_its_failure_stops_flow(self):
        directory=self.root/'.platform/programs';directory.mkdir()
        script=directory/'check.py'
        script.write_text('import sys,json\nfrom pathlib import Path\nctx=json.loads(Path(sys.argv[1]).read_text())\nprint(json.dumps({"passed":False,"message":"action quality failed","received_dataset":ctx["dataset"]}))\n')
        registry=[{'id':'custom_action_qc','name':'动作数据检查','description':'测试自定义程序','command':[sys.executable,str(script)],'timeout_seconds':5}]
        (self.root/'.platform/programs.json').write_text(json.dumps(registry))
        self.assertIn('custom_action_qc',[p['id'] for p in self.client.get('/api/bridge/workflow/catalog').json()['programs']])
        selected=self.create([{'key':'auto_actions','name':'动作检查','program':'custom_action_qc'},{'key':'preprocess','name':'后置检查','program':'inspect_dataset'}]);t._run_task(selected)
        task=self.task(selected)
        self.assertEqual(task['status'],'failed');self.assertEqual(task['nodes'][1]['status'],'waiting')
        report=json.loads(task['nodes'][0]['result_json'])
        self.assertEqual(report['received_dataset'],str(self.source))
        self.assertTrue(Path(report['run_directory'],'context.json').is_file())
        script.write_text('import json\nprint(json.dumps({"passed":True,"message":"action quality passed"}))\n')
        self.assertEqual(self.client.post(f'/api/bridge/tasks/{selected}/retry').status_code,200)
        t._run_task(selected);self.assertEqual(self.task(selected)['status'],'done')
        print('PASS registered external program receives real context; negative result blocks next node; corrected program retries successfully')

    def test_audit_v3_empty_placeholder_and_malformed_labels(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        meta=self.source/'meta';(meta/'episodes.jsonl').unlink()
        info=json.loads((meta/'info.json').read_text());info['codebase_version']='v3.0';(meta/'info.json').write_text(json.dumps(info))
        path=meta/'episodes/chunk-000/file-000.parquet';path.parent.mkdir(parents=True)
        pq.write_table(pa.table({'episode_index':[0,1,2],'length':[10,10,10]}),path)
        self.label(0,'_');(self.source/'segments/episode_000001.json').write_text('{bad json')
        exclusions.set_exclusion(str(self.source),2,True,'数据不完整','admin')
        report=w.annotation_audit({'path':self.source},lambda *args:None)
        self.assertEqual((report['total'],report['annotated'],report['skipped'],report['failed']),(3,0,1,2))
        self.assertEqual([r['status'] for r in report['episodes']],['invalid_annotation','invalid_annotation','skipped'])
        self.assertFalse(report['passed'])

    def test_migrate_only_unexecuted_package(self):
        with t.db_session() as conn:
            for task_id,status,node_status in [(10,'waiting_human','waiting'),(11,'done','done')]:
                conn.execute('INSERT INTO tasks(id,name,dataset,created_at,status) VALUES (?,?,?,?,?)',(task_id,'legacy',str(self.source),'now',status))
                conn.execute('INSERT INTO task_nodes(task_id,seq,key,name,status) VALUES (?,0,?,?,?)',(task_id,'package','生产打包',node_status))
        t.init_schema();t.init_schema()
        with t.db_session() as conn:
            active=conn.execute('SELECT * FROM task_nodes WHERE task_id=10').fetchone()
            archived=conn.execute('SELECT * FROM task_nodes WHERE task_id=11').fetchone()
            self.assertEqual((active['key'],active['program']),('program_qc','annotation_audit'))
            self.assertEqual((archived['key'],archived['name'],archived['status']),('package','生产打包','done'))
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM task_events WHERE task_id=10').fetchone()[0],1)


if __name__=='__main__':unittest.main(verbosity=2)
