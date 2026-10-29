"""登录/登出/会话、角色校验。会话为内存态(重启失效),cookie HttpOnly。"""
import functools
import secrets
import time
from threading import Lock

from fastapi import HTTPException, Request, Response

from .db import ROLE_LEVEL, get_db, hash_password, init_db, now, verify_password

SESSION_COOKIE = 'labelvla_session'
SESSION_TTL = 7 * 24 * 3600

_sessions = {}
_lock = Lock()


def _row_to_user(row):
    return {'id': row['id'], 'username': row['username'],
            'display_name': row['display_name'], 'role': row['role'],
            'must_change_password': bool(row['must_change_password'])}


def _load_user(username):
    with get_db() as conn:
        row = conn.execute(
            'SELECT * FROM users WHERE username = ? AND deleted_at IS NULL',
            (username,)).fetchone()
    if row is None or row['disabled']:
        return None
    if row['expires_at'] and row['expires_at'] <= now():
        return None
    return row


def current_user(request: Request):
    """从 cookie 解析当前登录用户;无效/过期返回 None。每次请求回查库,禁用立即生效。"""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    with _lock:
        sess = _sessions.get(token)
    if not sess or sess['expires'] < time.time():
        with _lock:
            _sessions.pop(token, None)
        return None
    row = _load_user(sess['username'])
    if row is None:
        with _lock:
            _sessions.pop(token, None)
        return None
    return _row_to_user(row)


def require_role(*roles):
    """FastAPI 装饰器:未登录 401,角色不符 403,首登未改密 403。
    被装饰的端点须声明 `request: Request` 参数,登录用户信息在 request.state.user。"""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(request: Request, *args, **kwargs):
            user = current_user(request)
            if user is None:
                raise HTTPException(401, '未登录或会话已过期')
            if user['must_change_password']:
                raise HTTPException(403, '首次登录请先修改密码')
            if roles and user['role'] not in roles:
                raise HTTPException(403, '权限不足')
            request.state.user = user
            return fn(request=request, *args, **kwargs)
        return wrapper
    return deco


def register(app):
    init_db()

    @app.post('/api/bridge/auth/login')
    def login(payload: dict, request: Request, response: Response):
        username = str(payload.get('username') or '').strip()
        password = str(payload.get('password') or '')
        row = _load_user(username)
        if row is None or not verify_password(password, row['password_hash']):
            raise HTTPException(401, '用户名或密码错误')
        token = secrets.token_hex(32)
        device = request.headers.get('user-agent', '')[:200]
        ip = request.client.host if request.client else ''
        with get_db() as conn:
            cur = conn.execute(
                'INSERT INTO login_logs(user_id, login_at, ip, device) VALUES(?,?,?,?)',
                (row['id'], now(), ip, device))
            log_id = cur.lastrowid
        with _lock:
            _sessions[token] = {'username': row['username'], 'log_id': log_id,
                                'expires': time.time() + SESSION_TTL}
        response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_TTL,
                            httponly=True, samesite='lax', path='/')
        return _row_to_user(row)

    @app.post('/api/bridge/auth/logout')
    def logout(request: Request, response: Response):
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            with _lock:
                sess = _sessions.pop(token, None)
            if sess:
                with get_db() as conn:
                    conn.execute('UPDATE login_logs SET logout_at = ? WHERE id = ?',
                                 (now(), sess['log_id']))
        response.delete_cookie(SESSION_COOKIE, path='/')
        return {'ok': True}

    @app.get('/api/bridge/auth/me')
    def me(request: Request):
        user = current_user(request)
        if user is None:
            raise HTTPException(401, '未登录或会话已过期')
        return user

    @app.post('/api/bridge/auth/password')
    def change_password(payload: dict, request: Request):
        user = current_user(request)
        if user is None:
            raise HTTPException(401, '未登录或会话已过期')
        old = str(payload.get('old_password') or '')
        new = str(payload.get('new_password') or '')
        if len(new) < 6:
            raise HTTPException(400, '密码至少 6 位')
        with get_db() as conn:
            row = conn.execute('SELECT password_hash FROM users WHERE id = ?',
                               (user['id'],)).fetchone()
            if not verify_password(old, row['password_hash']):
                raise HTTPException(400, '原密码错误')
            conn.execute(
                'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
                (hash_password(new), user['id']))
        return {'ok': True}
