"""给演示任务准备两个角色账号（标注员 zhang、审核员 li），幂等。"""
import json, urllib.request, http.cookiejar
API = 'http://127.0.0.1:8002'
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method or ('POST' if data else 'GET'),
                                 headers={'Content-Type': 'application/json'} if data else {})
    try: return json.loads(op.open(req, timeout=60).read())
    except urllib.error.HTTPError as e: return {'err': e.code, 'detail': e.read().decode()[:200]}

call('/api/bridge/auth/login', {'username': 'admin', 'password': 'admin123'})
users = call('/api/bridge/users')
have = {u['username'] for u in users} if isinstance(users, list) else set()
for username, display, role in [('zhang', '张工', 'annotator'), ('lily', '李工', 'reviewer')]:
    if username in have:
        print(username, 'exists'); continue
    print(username, call('/api/bridge/users', {'username': username, 'display_name': display, 'password': 'demo123', 'role': role}))
