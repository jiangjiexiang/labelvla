"""把演示任务的 3 条 Episode 都标注好（片段 / 结构化描述 / 目标框），供截图与后半段录屏使用。

用法：python3 tutorial/tools/prepare_demo.py [任务ID，默认 10]
"""
import json, sys, urllib.request, urllib.parse, http.cookiejar

API = 'http://127.0.0.1:8002'
TASK = int(sys.argv[1] if len(sys.argv) > 1 else 10)
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method or ('POST' if data else 'GET'),
                                 headers={'Content-Type': 'application/json'} if data else {})
    try: return json.loads(op.open(req, timeout=300).read())
    except urllib.error.HTTPError as e: return {'err': e.code, 'detail': e.read().decode()[:300]}

call('/api/bridge/auth/login', {'username': 'admin', 'password': 'admin123'})
ws = call(f'/api/bridge/tasks/{TASK}/workspace', {}, method='POST')
ds = ws.get('dataset')
print('workspace', ds)
PLAN = {
    0: [(0, 180, '抓取食物'), (181, 400, '放到托盘'), (401, 599, '回到初始位')],
    1: [(0, 150, '抓取食物'), (151, 380, '放到托盘'), (381, 594, '回到初始位')],
    2: [(0, 200, '抓取食物'), (201, 420, '放到托盘'), (421, 599, '回到初始位')],
}
# 目标框：中间相机上贴住被拿的那个碗（像素坐标基于 640x480 鱼眼前视画面）
BOX = {'x': 361, 'y': 318, 'width': 108, 'height': 56, 'label': '食物', 'camera': 'observation.images.cam_fisheye_front'}
for ep, plan in PLAN.items():
    cur = call(f"/api/bridge/segments?dataset={urllib.parse.quote(ds)}&episode={ep}")
    if 'err' in cur:
        print('read fail', ep, cur); continue
    segs = []
    for s, e, label in plan:
        seg = {'start_frame': s, 'end_frame': min(e, cur['length'] - 1), 'text': label, 'bboxes': []}
        if label == '抓取食物':
            seg.update({'skill': '抓取', 'object': '食物', 'target': '托盘', 'bboxes': [BOX]})
        segs.append(seg)
    r = call(f"/api/bridge/segments?dataset={urllib.parse.quote(ds)}&episode={ep}", {'revision': cur['revision'], 'segments': segs})
    print(ep, '->', 'ok' if 'segments' in r else r, [(x['text'], x['start_frame'], x['end_frame'], len(x.get('bboxes') or [])) for x in r.get('segments', [])])
