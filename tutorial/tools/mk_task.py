"""创建教程演示任务（标注员 zhang / 审核员 lily），输出任务 ID。"""
import json, sys, urllib.request, http.cookiejar
API='http://127.0.0.1:8002'
cj=http.cookiejar.CookieJar(); op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def call(path, body=None):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(API+path, data=data, headers={'Content-Type':'application/json'})
    try: return json.loads(op.open(req, timeout=120).read())
    except urllib.error.HTTPError as e: print('ERR', e.code, e.read().decode()[:300]); sys.exit(1)
call('/api/bridge/auth/login', {'username':'admin','password':'admin123'})
wf=[{'key':'preprocess','name':'预处理','program':'inspect_dataset'},{'key':'annotate','name':'人工标注','program':None},
    {'key':'qc','name':'人工验收','program':None},{'key':'program_qc','name':'程序质检','program':'annotation_audit'},
    {'key':'compile','name':'版本发布','program':'publish_dataset'}]
t=call('/api/bridge/tasks', {'name':'tutorial_demo_template · 抓取动作标注','dataset':'/data/tutorial_demo_template','task_type':'video_annotation',
  'workflow':wf,'assignee':'zhang','reviewer':'lily','create_mode':'new','base_version_id':None,
  'description':'3 条 Episode，划分「抓取食物 / 放到托盘 / 回到初始位」三个动作片段，只标被抓取的那个碗。'})
print(json.dumps({'id':t['id'],'number':t['task_number'],'version':t.get('output_version'),'status':t['status']}))
