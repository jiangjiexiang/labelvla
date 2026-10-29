"""账号管理:层级 admin 100 > reviewer 50 > annotator 10,改他人需严格更高。"""
import re

from fastapi import HTTPException, Request

from .auth import require_role
from .db import ROLE_LEVEL, get_db, hash_password, now

_USERNAME_RE = re.compile(r'\S{3,30}')


def _user_dict(row):
    return {'id': row['id'], 'username': row['username'],
            'display_name': row['display_name'], 'role': row['role'],
            'disabled': bool(row['disabled']), 'expires_at': row['expires_at'],
            'created_by': row['created_by'], 'created_at': row['created_at']}


def _get_user(uid: int):
    with get_db() as conn:
        row = conn.execute(
            'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', (uid,)).fetchone()
    if row is None:
        raise HTTPException(404, '用户不存在')
    return row


def _check_manage(actor: dict, target):
    """actor 的角色层级必须严格高于 target;返回 None 或抛 403。"""
    if ROLE_LEVEL[actor['role']] <= ROLE_LEVEL[target['role']]:
        raise HTTPException(403, '无权管理同级或更高角色的账号')


def _check_role_grant(actor: dict, role: str):
    if ROLE_LEVEL[actor['role']] <= ROLE_LEVEL[role]:
        raise HTTPException(403, '不能创建或授予不低于自己角色的账号')


def _check_username(username: str):
    if not _USERNAME_RE.fullmatch(username):
        raise HTTPException(400, '用户名须为 3-30 个字符且不含空白')


def register(app):
    @app.get('/api/bridge/users')
    @require_role()
    def list_users(request: Request):
        with get_db() as conn:
            rows = conn.execute(
                'SELECT * FROM users WHERE deleted_at IS NULL ORDER BY id').fetchall()
        return [_user_dict(r) for r in rows]

    @app.post('/api/bridge/users')
    @require_role('admin', 'reviewer')
    def create_user(payload: dict, request: Request):
        actor = request.state.user
        username = str(payload.get('username') or '').strip()
        password = str(payload.get('password') or '')
        role = str(payload.get('role') or 'annotator')
        display_name = str(payload.get('display_name') or '').strip()
        expires_at = payload.get('expires_at') or None
        _check_username(username)
        if role not in ROLE_LEVEL:
            raise HTTPException(400, '角色无效')
        if len(password) < 6:
            raise HTTPException(400, '密码至少 6 位')
        _check_role_grant(actor, role)
        try:
            with get_db() as conn:
                cur = conn.execute(
                    'INSERT INTO users(username, display_name, password_hash, role,'
                    ' expires_at, must_change_password, created_by, created_at)'
                    ' VALUES(?,?,?,?,?,1,?,?)',
                    (username, display_name, hash_password(password), role,
                     expires_at, actor['username'], now()))
                uid = cur.lastrowid
        except Exception as e:
            if 'UNIQUE' in str(e):
                raise HTTPException(409, '用户名已存在') from e
            raise
        return {'id': uid, 'username': username, 'role': role}

    @app.patch('/api/bridge/users/{uid}')
    @require_role('admin', 'reviewer')
    def update_user(uid: int, payload: dict, request: Request):
        actor = request.state.user
        target = _get_user(uid)
        _check_manage(actor, target)
        sets, args = [], []
        if 'display_name' in payload:
            sets.append('display_name = ?')
            args.append(str(payload['display_name'] or '').strip())
        if 'role' in payload:
            role = str(payload['role'])
            if role not in ROLE_LEVEL:
                raise HTTPException(400, '角色无效')
            _check_role_grant(actor, role)
            sets.append('role = ?')
            args.append(role)
        if 'password' in payload:
            password = str(payload['password'] or '')
            if len(password) < 6:
                raise HTTPException(400, '密码至少 6 位')
            sets.append('password_hash = ?')
            args.append(hash_password(password))
        if 'expires_at' in payload:
            sets.append('expires_at = ?')
            args.append(payload['expires_at'] or None)
        if 'disabled' in payload:
            sets.append('disabled = ?')
            args.append(1 if payload['disabled'] else 0)
        if not sets:
            raise HTTPException(400, '没有要修改的字段')
        args.append(uid)
        with get_db() as conn:
            conn.execute(f'UPDATE users SET {", ".join(sets)} WHERE id = ?', args)
        return {'ok': True}

    @app.post('/api/bridge/users/{uid}/disable')
    @require_role('admin', 'reviewer')
    def disable_user(uid: int, request: Request):
        actor = request.state.user
        target = _get_user(uid)
        if target['id'] == actor['id']:
            raise HTTPException(400, '不能禁用自己')
        _check_manage(actor, target)
        with get_db() as conn:
            conn.execute('UPDATE users SET disabled = 1 WHERE id = ?', (uid,))
        return {'ok': True}

    @app.delete('/api/bridge/users/{uid}')
    @require_role('admin', 'reviewer')
    def delete_user(uid: int, request: Request):
        actor = request.state.user
        target = _get_user(uid)
        if target['id'] == actor['id']:
            raise HTTPException(400, '不能删除自己')
        _check_manage(actor, target)
        with get_db() as conn:
            conn.execute(
                'UPDATE users SET deleted_at = ?, disabled = 1,'
                " username = username || '#deleted#' || id WHERE id = ?",
                (now(), uid))
        return {'ok': True}

    @app.get('/api/bridge/users/{uid}/logins')
    @require_role('admin', 'reviewer')
    def user_logins(uid: int, request: Request):
        actor = request.state.user
        target = _get_user(uid)
        if target['id'] != actor['id']:
            _check_manage(actor, target)
        with get_db() as conn:
            rows = conn.execute(
                'SELECT id, login_at, logout_at, ip, device FROM login_logs'
                ' WHERE user_id = ? ORDER BY id DESC LIMIT 100', (uid,)).fetchall()
        return [dict(r) for r in rows]
