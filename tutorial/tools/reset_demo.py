"""把教程演示任务重置到「人工标注」节点，并清空演示数据，便于重新录屏。

录制脚本可重复运行：先 reset_demo.py，再 mk_task.py 建任务，按需 docker restart 让调度器重跑。

会做三件事（只影响演示数据集的任务）：
1. API 取消任务并删除 output 下的教程版本目录；
2. 直接改 platform.db，把任务的标注及后续节点复位为等待；
3. 删除模板数据集里残留的标注。

用法：python3 tutorial/tools/reset_demo.py [数据集名，默认 tutorial_demo_template]
"""
import json, sqlite3, sys, urllib.request, http.cookiejar, shutil, pathlib
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parents[2]
API = 'http://127.0.0.1:8002'
KEY = sys.argv[1] if len(sys.argv) > 1 else 'tutorial_demo_template'

cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, headers={'Content-Type': 'application/json'})
    try:
        return json.loads(op.open(req, timeout=120).read())
    except urllib.error.HTTPError as e:
        return {'err': e.code, 'detail': e.read().decode()[:200]}

call('/api/bridge/auth/login', {'username': 'admin', 'password': 'admin123'})

db = sqlite3.connect(ROOT / 'data/.platform/platform.db')
db.row_factory = sqlite3.Row
tasks = db.execute("SELECT * FROM tasks WHERE name LIKE ? AND dataset = ?", (f'%{KEY}%', f'/data/{KEY}')).fetchall()
demo_ids = [t['id'] for t in tasks]
if not demo_ids:
    sys.exit(f'没有匹配的任务：{KEY}')
for t in tasks:
    if t['status'] not in ('done', 'failed', 'cancelled'):
        print('cancel', t['id'], call(f"/api/bridge/tasks/{t['id']}/cancel", {}))
now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
for t in tasks:
    node = db.execute("SELECT seq FROM task_nodes WHERE task_id=? AND key='annotate'", (t['id'],)).fetchone()
    if not node:
        print('skip (no annotate node)', t['id']); continue
    total = db.execute('SELECT COUNT(*) FROM task_nodes WHERE task_id=?', (t['id'],)).fetchone()[0]
    db.execute("UPDATE task_nodes SET status='waiting',progress=0,message=NULL,started_at=NULL,finished_at=NULL,result_json=NULL WHERE task_id=? AND key='annotate'", (t['id'],))
    db.execute("UPDATE task_nodes SET status='pending',progress=0,message=NULL,started_at=NULL,finished_at=NULL,result_json=NULL WHERE task_id=? AND seq>?", (t['id'], node['seq']))
    db.execute("UPDATE tasks SET workspace_path=NULL,edited_dataset=NULL,status='pending',current_node=NULL,error=NULL,export_dir=NULL,progress=?,finished_at=NULL,updated_at=? WHERE id=?",
               (int(100 * node['seq'] / total), now, t['id']))
    t = db.execute('SELECT * FROM tasks WHERE id=?', (t['id'],)).fetchone()
    # 任务若已取消，直接把它的队列行发回执行器，让它自然重跑（无需重启容器）
    if t['status'] == 'canceled':
        db.execute("INSERT INTO task_jobs(task_id,status,generation,enqueued_at,attempts) VALUES(?,'ready',1,?,0) "
                   "ON CONFLICT(task_id) DO UPDATE SET status='ready',generation=generation+1,owner=NULL,enqueued_at=excluded.enqueued_at",
                   (t['id'], now))
    print('reset task', t['id'], t['status'])

# 删除本任务在 output 下的版本目录（先取 output_path/versions，再清空字段，避免保存时 promote 失败）
for t in tasks:
    paths = {t['output_path'], t['workspace_path']}
    for row in db.execute('SELECT dataset_path FROM versions WHERE task_id=?', (t['id'],)):
        paths.add(row['dataset_path'])
    for raw in paths:
        if not raw or not str(raw).startswith('/output/'):
            continue
        target = ROOT / str(raw).replace('/output/', 'output/')
        if target.is_dir():
            shutil.rmtree(target)
            print('removed', target)
    db.execute("UPDATE versions SET status='已取消' WHERE task_id=?", (t['id'],))
db.execute("UPDATE tasks SET output_path=NULL,output_version=NULL WHERE name LIKE ?", (f'%{KEY}%',))
# 之前录制中断留下的失效路径也要清掉，否则工作室保存时无法 promote
for row in db.execute('SELECT id, output_path FROM tasks WHERE name LIKE ?', (f'%{KEY}%',)).fetchall():
    if row['output_path']:
        db.execute('UPDATE tasks SET output_path=NULL WHERE id=?', (row['id'],))
for row in db.execute('SELECT id, task_id, dataset_path FROM versions WHERE task_id IN (SELECT id FROM tasks WHERE name LIKE ?)', (f'%{KEY}%',)).fetchall():
    if row['dataset_path']:
        target = ROOT / str(row['dataset_path']).replace('/output/', 'output/')
        if target.is_dir():
            shutil.rmtree(target)
            print('removed', target)
db.commit()
db.close()

seg = ROOT / 'data' / KEY / 'segments'
if seg.is_dir():
    shutil.rmtree(seg)
    print('removed', seg)
print('done')
