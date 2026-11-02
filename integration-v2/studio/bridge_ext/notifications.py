"""Task publication notifications. Disabled unless explicitly enabled by deployment config."""
import base64
import hashlib
import hmac
import json
import os
import threading
import time
from urllib.parse import urlencode, urlsplit, parse_qsl, urlunsplit
from urllib.request import Request, urlopen
from .common import db_session, now_iso


def init_schema():
    with db_session() as db:
        db.execute('CREATE TABLE IF NOT EXISTS task_notifications(task_id INTEGER, event TEXT, status TEXT, updated_at TEXT, PRIMARY KEY(task_id,event))')


def signed_url(webhook, secret, timestamp):
    parts = urlsplit(webhook)
    if parts.scheme != 'https' or parts.hostname != 'oapi.dingtalk.com' or parts.path != '/robot/send' or parts.username or parts.password:
        raise ValueError('invalid webhook')
    query = dict(parse_qsl(parts.query))
    if not query.get('access_token') or not secret:
        raise ValueError('missing credentials')
    sign = base64.b64encode(hmac.new(secret.encode(), f'{timestamp}\n{secret}'.encode(), hashlib.sha256).digest()).decode()
    query.update(timestamp=str(timestamp), sign=sign)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ''))


def make_payload(task, userid, base_url):
    if not userid:
        raise ValueError('missing recipient')
    # Text notifications avoid interpreting names as Markdown or @all.
    content = (f'LabelVLA 任务已发布\n任务：{task["name"]}\n'
               f'数据集：{task["dataset_name"]}\n负责人：{task.get("assignee_name") or task["assignee"]}\n'
               f'任务 ID：{task["id"]}\n请进入任务管理查看：{base_url.rstrip("/")}/')
    content += chr(10) + '@' + userid
    return {'msgtype': 'text', 'text': {'content': content},
            'at': {'atUserIds': [userid], 'isAtAll': False}}


def _send(url, payload):
    request = Request(url, data=json.dumps(payload, ensure_ascii=False).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    with urlopen(request, timeout=10) as response:
        result = json.loads(response.read())
    if result.get('errcode') != 0:
        raise ValueError('DingTalk rejected notification')


def notify_published(task_id):
    """One attempt per task. No automatic retries after ambiguous network failures."""
    with db_session() as db:
        task = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
        if task is None or not task['assignee']:
            return
        task = dict(task)
        person = db.execute('SELECT * FROM users WHERE username=? AND deleted_at IS NULL', (task['assignee'],)).fetchone()
        enabled = os.environ.get('DINGTALK_ENABLED', 'false').lower() == 'true'
        status = 'sending' if enabled else 'disabled'
        if person is None or person['disabled'] or (person['expires_at'] and person['expires_at'] <= now_iso()) or not person['dingtalk_userid']:
            status = 'recipient_missing'
        if enabled and (not os.environ.get('DINGTALK_WEBHOOK') or not os.environ.get('DINGTALK_SECRET')):
            status = 'configuration_missing'
        cur = db.execute('INSERT OR IGNORE INTO task_notifications VALUES (?,?,?,?)', (task_id, 'published', status, now_iso()))
        if cur.rowcount != 1:
            return
    if status == 'sending':
        try:
            url = signed_url(os.environ['DINGTALK_WEBHOOK'], os.environ['DINGTALK_SECRET'], int(time.time()*1000))
            payload = make_payload(task, person['dingtalk_userid'], os.environ.get('PLATFORM_PUBLIC_URL', 'http://172.16.122.44:8002'))
            _send(url, payload)
            status = 'sent'
        except Exception:
            # Never log webhook, signature, UserID, or exception URLs.
            status = 'failed'
    labels = {'disabled': '通知未启用，未发送', 'recipient_missing': '负责人未绑定有效钉钉账号，未发送',
              'configuration_missing': '钉钉配置不完整，未发送', 'sent': '已通知任务负责人', 'failed': '通知失败，未自动重试'}
    with db_session() as db:
        db.execute('UPDATE task_notifications SET status=?,updated_at=? WHERE task_id=? AND event=?', (status, now_iso(), task_id, 'published'))
        db.execute('INSERT INTO task_events(task_id,at,node,level,message,actor) VALUES (?,?,?,?,?,?)',
                   (task_id, now_iso(), None, 'info' if status in ('sent','disabled') else 'warn', labels[status], 'system'))


def schedule_published(task_id):
    threading.Thread(target=notify_published, args=(task_id,), daemon=True).start()
