"""数据字典:技能/对象/目标/状语四类词表。

- GET 任何登录角色可读(默认只返回已生效词条,admin 可用 all=1 看待确认)
- POST 任何登录角色可提交;标注员提交进待确认(enabled=0),admin 提交直接生效
- PATCH/DELETE 仅 admin(确认入典 / 停用 / 删除)
"""
import re

from fastapi import APIRouter, HTTPException, Request

from .common import db_session, require

router = APIRouter()

KINDS = ('skill', 'object', 'target', 'adverb')
_NAME_RE = re.compile(r'^\S(?:.*\S)?$')


def _entry(r) -> dict:
    return {'id': r['id'], 'kind': r['kind'], 'name': r['name'], 'enabled': r['enabled']}


def _check_kind(kind: str) -> str:
    if kind not in KINDS:
        raise HTTPException(400, f'字典类型无效: {kind}(可选 {"/".join(KINDS)})')
    return kind


@router.get('/api/bridge/dict')
def dict_list(request: Request, kind: str, all: int = 0):
    user = require(request, 'admin', 'reviewer', 'annotator')
    _check_kind(kind)
    with db_session() as db:
        if all and user['role'] == 'admin':
            rows = db.execute(
                'SELECT * FROM dict_entries WHERE kind=? ORDER BY enabled DESC, name',
                (kind,)).fetchall()
        else:
            rows = db.execute(
                'SELECT * FROM dict_entries WHERE kind=? AND enabled=1 ORDER BY name',
                (kind,)).fetchall()
    return {'kind': kind, 'entries': [_entry(r) for r in rows]}


@router.post('/api/bridge/dict')
def dict_add(request: Request, payload: dict):
    user = require(request, 'admin', 'reviewer', 'annotator')
    kind = _check_kind(str(payload.get('kind') or ''))
    name = str(payload.get('name') or '').strip()
    if not name or len(name) > 50 or not _NAME_RE.match(name):
        raise HTTPException(400, '词条需为 1–50 字符,且首尾不能是空白')
    enabled = 1 if user['role'] == 'admin' else 0
    with db_session() as db:
        existing = db.execute(
            'SELECT * FROM dict_entries WHERE kind=? AND name=?', (kind, name)).fetchone()
        if existing:
            if enabled and not existing['enabled']:
                db.execute('UPDATE dict_entries SET enabled=1 WHERE id=?', (existing['id'],))
                existing = db.execute('SELECT * FROM dict_entries WHERE id=?', (existing['id'],)).fetchone()
            return _entry(existing)
        cur = db.execute(
            'INSERT INTO dict_entries(kind, name, enabled) VALUES (?,?,?)',
            (kind, name, enabled))
        entry = db.execute('SELECT * FROM dict_entries WHERE id=?', (cur.lastrowid,)).fetchone()
    return _entry(entry)


@router.patch('/api/bridge/dict/{entry_id}')
def dict_update(request: Request, entry_id: int, payload: dict):
    require(request, 'admin')
    enabled = payload.get('enabled')
    if enabled not in (0, 1, True, False):
        raise HTTPException(400, 'enabled 只能为 0/1')
    with db_session() as db:
        cur = db.execute('UPDATE dict_entries SET enabled=? WHERE id=?', (int(enabled), entry_id))
        if cur.rowcount == 0:
            raise HTTPException(404, '词条不存在')
        entry = db.execute('SELECT * FROM dict_entries WHERE id=?', (entry_id,)).fetchone()
    return _entry(entry)


@router.delete('/api/bridge/dict/{entry_id}')
def dict_delete(request: Request, entry_id: int):
    require(request, 'admin')
    with db_session() as db:
        cur = db.execute('DELETE FROM dict_entries WHERE id=?', (entry_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, '词条不存在')
    return {'ok': True}


def register(app):
    app.include_router(router)
