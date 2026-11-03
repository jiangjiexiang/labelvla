"""episode 级状态机:未标→标注中→待审核→已通过/已打回。

权限(设计文档 2.0):
- 标注员:untagged→labeling、labeling→review、rejected→review
- 审核员/管理员:在标注员基础上,review→approved、review→rejected、approved→rejected
- 打回(rejected)必须填原因;通过后标注员不可再改,审核员可打回解锁
"""
from fastapi import APIRouter, HTTPException, Request

from .common import db_session, now_iso, require, safe_dataset

from .exclusions import fields, excluded, set_exclusion, init_schema

router = APIRouter()

STATUSES = ('untagged', 'labeling', 'review', 'approved', 'rejected')
ANNOTATOR_FLOW = {('untagged', 'labeling'), ('labeling', 'review'), ('rejected', 'review')}
REVIEWER_FLOW = ANNOTATOR_FLOW | {
    ('review', 'approved'), ('review', 'rejected'), ('approved', 'rejected'),
}


def _row(db, dataset: str, episode: int):
    return db.execute(
        'SELECT * FROM dataset_status WHERE dataset=? AND episode=?',
        (dataset, episode)).fetchone()


def _public(r) -> dict:
    return {**fields(r['dataset'], r['episode']), **{k: r[k] for k in
            ('dataset', 'episode', 'status', 'assignee', 'reviewer',
             'reject_reason', 'updated_at', 'updated_by')}}


@router.get('/api/bridge/status')
def status_get(request: Request, dataset: str, episode: int):
    require(request, 'admin', 'reviewer', 'annotator')
    p = safe_dataset(dataset)
    with db_session() as db:
        r = _row(db, str(p), episode)
    if not r:
        return {**fields(str(p), episode), 'dataset': str(p), 'episode': episode, 'status': 'untagged',
                'assignee': None, 'reviewer': None, 'reject_reason': None,
                'updated_at': None, 'updated_by': None}
    return _public(r)


@router.get('/api/bridge/status/board')
def status_board(request: Request, dataset: str):
    require(request, 'admin', 'reviewer', 'annotator')
    p = safe_dataset(dataset)
    with db_session() as db:
        rows = db.execute(
            'SELECT * FROM dataset_status WHERE dataset=? ORDER BY episode',
            (str(p),)).fetchall()
    return {'dataset': str(p), 'episodes': [_public(r) for r in rows]}


@router.post('/api/bridge/status')
def status_set(request: Request, payload: dict):
    user = require(request, 'admin', 'reviewer', 'annotator')
    target = str(payload.get('status') or '')
    if target not in STATUSES:
        raise HTTPException(400, f'状态无效: {target}')
    reason = str(payload.get('reason') or '').strip()
    if target == 'rejected' and not reason:
        raise HTTPException(400, '打回必须填写原因')
    p = safe_dataset(str(payload.get('dataset') or ''))
    episode = int(payload.get('episode', -1))
    if episode < 0:
        raise HTTPException(400, 'episode 无效')

    import bridge   # 复用 episode 存在性校验(v2/v3)
    try:
        bridge.segment_store(str(p), episode)
    except HTTPException:
        raise HTTPException(404, '片段不存在')

    if episode in excluded(str(p)):
        raise HTTPException(409, '该数据已跳过，请先恢复标注')
    flow = REVIEWER_FLOW if user['role'] in ('admin', 'reviewer') else ANNOTATOR_FLOW
    with db_session() as db:
        cur = _row(db, str(p), episode)
        current = cur['status'] if cur else 'untagged'
        if target != current and (current, target) not in flow:
            raise HTTPException(403, f'当前角色不允许 {current} → {target}')
        now = now_iso()
        reviewer = user['username'] if target in ('approved', 'rejected') else (cur['reviewer'] if cur else None)
        reject_reason = reason if target == 'rejected' else (None if target != current else (cur['reject_reason'] if cur else None))
        assignee = payload.get('assignee')
        if assignee is not None and user['role'] not in ('admin', 'reviewer'):
            raise HTTPException(403, '只有审核员/管理员可以指派')
        if assignee is None:
            assignee = cur['assignee'] if cur else None
        db.execute(
            'INSERT INTO dataset_status(dataset, episode, status, assignee, reviewer,'
            ' reject_reason, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?)'
            ' ON CONFLICT(dataset, episode) DO UPDATE SET'
            ' status=excluded.status, assignee=excluded.assignee,'
            ' reviewer=excluded.reviewer, reject_reason=excluded.reject_reason,'
            ' updated_at=excluded.updated_at, updated_by=excluded.updated_by',
            (str(p), episode, target, assignee, reviewer, reject_reason, now, user['username']))
        r = _row(db, str(p), episode)
    return _public(r)


@router.post('/api/bridge/status/skip')
def skip_episode(request: Request, payload: dict):
    user = require(request, 'admin', 'reviewer', 'annotator')
    p = safe_dataset(str(payload.get('dataset') or ''))
    try:
        episode = int(payload.get('episode', -1))
    except (TypeError, ValueError):
        raise HTTPException(400, 'Episode 无效')
    import bridge
    bridge.segment_store(str(p), episode)
    with db_session() as db:
        row = _row(db, str(p), episode)
    if row and row['status'] == 'approved' and user['role'] == 'annotator':
        raise HTTPException(403, '已通过的数据需要审核员处理')
    from .workspaces import assert_writable
    assert_writable(request, str(p))
    set_exclusion(str(p), episode, payload.get('skipped'), payload.get('reason'), user['username'])
    return status_get(request, str(p), episode)


def register(app):
    init_schema()
    app.include_router(router)
