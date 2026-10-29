"""B 组共享助手:对 A 组(db/auth)和 bridge.py 的依赖统一收口在这一层。

A 组契约(docs/platform-plan.md 0.1 / 设计文档 2.1):
  bridge_ext.db.get_db() -> sqlite3.Connection(平台库 /data/.platform/platform.db)
  bridge_ext.auth.current_user(request) -> dict | None(含 id/username/role/must_change_password)

bridge.py 由 Wave 0 负责改造,本包模块一律惰性 import bridge,避免循环依赖。
"""
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException, Request

from .db import get_db
from .auth import current_user

ROLES = ('admin', 'reviewer', 'annotator')
ROLE_LEVEL = {'admin': 100, 'reviewer': 50, 'annotator': 10}


def data_root() -> Path:
    try:
        import bridge
        return Path(bridge.root)
    except Exception:
        return Path(os.environ.get('DATA_ROOT', '/data')).resolve()


def safe_dataset(dataset: str) -> Path:
    import bridge
    return bridge.safe_dataset(dataset)


def connect() -> sqlite3.Connection:
    db = get_db()
    db.row_factory = sqlite3.Row
    return db


@contextmanager
def db_session():
    """每次调用新建连接(线程安全),退出时提交并关闭。"""
    db = connect()
    try:
        yield db
        db.commit()
    finally:
        db.close()


def now_iso() -> str:
    return datetime.now().isoformat(timespec='seconds')


def day_of(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime('%Y-%m-%d')


def require(request: Request, *roles: str) -> dict:
    """登录 + 角色校验。roles 为空则只要求登录。未登录 401、越权 403。"""
    user = current_user(request)
    if not user:
        raise HTTPException(401, '未登录')
    if user.get('disabled'):
        raise HTTPException(403, '账号已禁用')
    if user.get('must_change_password'):
        raise HTTPException(403, '首次登录请先修改密码')
    if roles and user.get('role') not in roles:
        raise HTTPException(403, '权限不足')
    return user
