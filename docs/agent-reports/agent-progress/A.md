# Agent A · 后端基座 — 已完成 ✅

> 完成时间:2026-10-29。验收方式:容器 `labelvla-studio-integrated` 重启后 curl 实测 28 项全过;测试数据已清库,DB 重置为初始状态(仅内置 admin/admin)。

## 产出文件

| 文件 | 内容 |
|---|---|
| `integration-v2/studio/bridge_ext/__init__.py` | 空包标记 |
| `integration-v2/studio/bridge_ext/db.py` | SQLite `/data/.platform/platform.db`,幂等建表,`get_db()` / `now()` / `hash_password()` / `verify_password()` / `ROLE_LEVEL` / `init_db()` |
| `integration-v2/studio/bridge_ext/auth.py` | 登录/登出/me/改密,HttpOnly cookie 会话,`require_role(*roles)` 装饰器,`register(app)` |
| `integration-v2/studio/bridge_ext/users.py` | 账号管理 5 个接口,`register(app)` |
| `integration-v2/studio/bridge.py` | 仅末尾「必须最后挂载」前加了注册槽(见下) |

## 已实现的接口(均为契约冻结口径,可直接依赖)

```
POST /api/bridge/auth/login     {username, password} → {id, username, display_name, role, must_change_password} + Set-Cookie
POST /api/bridge/auth/logout    → {ok} + 清 cookie
GET  /api/bridge/auth/me        → 同 login 响应;未登录 401
POST /api/bridge/auth/password  {old_password, new_password} → {ok} (新密码 ≥6 位,清除 must_change_password)

GET    /api/bridge/users              任意登录角色 → [{id, username, display_name, role, disabled, expires_at, created_by, created_at}]
POST   /api/bridge/users              admin/reviewer;{username, password, role, display_name?, expires_at?} → {id, username, role}
PATCH  /api/bridge/users/{id}         admin/reviewer;可改 display_name/role/password/expires_at/disabled
POST   /api/bridge/users/{id}/disable 禁用(不可对自己)
DELETE /api/bridge/users/{id}         软删:置 deleted_at + 改名 `xxx#deleted#<id>` 释放用户名
GET    /api/bridge/users/{id}/logins  → [{id, login_at, logout_at, ip, device}] (最近 100 条)
```

## 行为约定(B/C/D 注意)

- **会话**:cookie 名 `labelvla_session`,HttpOnly + SameSite=Lax + path=/,7 天;内存态,**容器重启会话全失效**(前端按 401 跳登录即可)。
- **首登强制改密**:login/me 返回 `must_change_password: true` 时,所有挂了 `require_role` 的接口返回 403「首次登录请先修改密码」;auth 四个接口不受限。前端流程:login → 见 flag 弹改密窗 → `POST auth/password` → 正常用。**新建的账号也带此标记**。
- **角色层级**:admin 100 > reviewer 50 > annotator 10,`ROLE_LEVEL` 在 `db.py`。改他人需严格更高;不可禁用/删除自己(400);用户名 3–30 无空白唯一(重复 409);密码 ≥6。
- **禁用/删除立即生效**:每次请求回查 users 表,被禁用/删除/过期的账号会话立刻 401。
- **错误格式**:FastAPI 标准 `{"detail": "中文错误信息"}`。

## 给 B 的交接

- 表已建好,直接 `from .db import get_db, now, ROLE_LEVEL`;`get_db()` 每次新建连接(sqlite3.Row),`with get_db() as conn:` 自动提交。
- 鉴权:`from .auth import require_role`;被装饰端点**必须声明 `request: Request` 参数**,登录用户在 `request.state.user`(dict:id/username/display_name/role/must_change_password)。
- 注册:在 bridge.py 注册槽追加 `from bridge_ext import ledger, ...` + `ledger.register(app)`,**只动槽位那一块**。
- 与设计文档 2.1 的两处加列(已建,勿重复迁移):`users.must_change_password`、`users.deleted_at`;`qc_reports.frame` 为 `NOT NULL DEFAULT -1`(「片段无框」类无帧规则写 -1,SQLite 主键含 NULL 去重会失效)。

## 给 C 的交接

- 未登录约定:任何 401 → 跳登录页;403「首次登录请先修改密码」→ 弹改密窗(目前仅此一种 403 文案需特判,其余 403 是权限不足)。
- 用户管理页接口如上;`expires_at` 传 ISO 字符串或 null(永久)。

## 验收记录(摘要)

登录→首登改密拦截(403)→改密(弱密码 400)→建号(重名 409/非法名 400)→标注员越权建号/改 admin(403)→层级管理(reviewer 可建 annotator、不可建同级/管 admin)→禁用后会话立即失效→软删后用户名可复用→登出 401;现有 `/api/bridge/segments`、`/api/bridge/index`、`/studio/` 回归 200 不受影响。
