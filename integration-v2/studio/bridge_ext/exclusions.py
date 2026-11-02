from fastapi import HTTPException
from .common import db_session, now_iso


def init_schema():
    with db_session() as db:
        db.execute('CREATE TABLE IF NOT EXISTS episode_exclusions(dataset TEXT,episode INTEGER,skipped INTEGER NOT NULL,reason TEXT,updated_by TEXT,updated_at TEXT,PRIMARY KEY(dataset,episode))')


def excluded(dataset):
    with db_session() as db:
        return {r['episode']:dict(r) for r in db.execute('SELECT * FROM episode_exclusions WHERE dataset=? AND skipped=1',(str(dataset),))}


def fields(dataset,episode):
    row=excluded(dataset).get(episode)
    return {'skipped':bool(row),'skip_reason':row['reason'] if row else None,'skip_by':row['updated_by'] if row else None,'skip_at':row['updated_at'] if row else None}


def set_exclusion(dataset,episode,skipped,reason,user):
    if not isinstance(skipped,bool):raise HTTPException(400,'跳过状态必须是布尔值')
    reason=str(reason or '').strip()
    if len(reason)>500:raise HTTPException(400,'原因最多500字符')
    with db_session() as db:
        db.execute('INSERT INTO episode_exclusions VALUES (?,?,?,?,?,?) ON CONFLICT(dataset,episode) DO UPDATE SET skipped=excluded.skipped,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at',(str(dataset),episode,int(skipped),reason,user,now_iso()))
