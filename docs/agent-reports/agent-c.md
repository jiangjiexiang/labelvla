# Agent C 完成报告 —— 前端平台页

> 状态:✅ 已完成、已部署、已提交(commit `3ae99e8`)。
> 本文档供 A/B/D 及集成者读取。最后更新:2026-10-29。

## 我拥有的文件(别人别改)

```
integration-v2/studio-src/src/web/app/
  Login.tsx              # 登录页 + 首登强制改密
  DatasetList.tsx        # 数据集台账(表格/筛选写 URL/软删/回收站/进入标注)
  Users.tsx              # 用户管理(CRUD/禁用/登录记录/层级置灰)
  Dashboard.tsx          # 概览(4 指标卡 + 3 SVG 环形图 + 4 条趋势线)
  QcReport.tsx           # 质检报告(按 episode 分组,点击跳帧)
  platform/
    api.ts               # ★ 全部平台接口的 typed 客户端(契约的唯一前端实现)
    authStore.ts         # 登录态 store(401 自动登出;auth 404 时 bypass 放行)
    usePage.ts           # ?page= URL 路由(dashboard|datasets|users|qc)
    PlatformNav.tsx      # 平台页顶栏(概览/数据集/质检/用户 + 返回标注 + 退出)
    PlatformPages.tsx    # 页面容器;page=null 时渲染右下角「数据平台 →」入口
AppShell.tsx             # 只动了 4 行:import + useAuth 守卫 + ROUTE_SLOT
```

## 给 B 的接口期望(我在 platform/api.ts 里怎么调你)

字段名以 `platform/api.ts` 为准,与 plan 0.2 一致。要点:

| 接口 | 我期望的响应 |
|---|---|
| `GET /api/bridge/admin/datasets` | `[{path, name, episodes, size_gb, cameras, hours, counts:{untagged,labeling,review,approved,rejected}, qc:{pass,fail}, updated_at}]`;`?trash=1` 返回回收站 |
| `POST /api/bridge/admin/rescan` | 触发重扫,`{ok:true}` |
| `POST /api/bridge/datasets/delete` / `restore` | `{path}` → `{ok:true}` |
| `GET /api/bridge/dashboard` | plan 0.2 的完整结构(totals/status_dist/quality/qc/trends 四组 30 天按日) |
| `GET /api/bridge/qc?dataset=` | `{items:[{episode, rule, severity, detail, frame, created_at}]}`;frame 无帧用 `-1`,我前端已按 `null|-1` 兼容 |
| `POST /api/bridge/qc/scan` | `{dataset}` → 后台扫描,我前端每 3s 轮询 `GET qc` 共 20 次 |

未就绪时你的接口 404 即可,我的页面会显示空态/错误提示,不会崩。

## 给 D 的共用物

- 登录态:`import { useAuth } from '../app/platform/authStore'` → `{user:{id,username,display_name,role,must_change_password}, ready, bypass}`。角色判断:`user.role === 'reviewer'` 进审核只读模式。
- 状态流转:面板里请调 `POST /api/bridge/status`(B 的接口),不要把状态存本地 state 就完事。
- 字典:`GET /api/bridge/dict?kind=object|skill|target|adverb`。
- 注意 `api.ts` 的 401 处理会把 user 置 null 触发重新登录——你的请求记得带 cookie(fetch 默认带)。

## 已验证 / 未验证

- ✅ tsc + vite build 通过;已部署到容器并重启验证(auth 401、admin 登录正常)
- ✅ 与 A 的契约已对齐(登录响应是平铺 `{id,username,...,must_change_password}`,不是嵌套 user)
- ⏳ 未接真数据:B 的接口还没注册(404),页面目前显示空态。B 注册后我做集成验收

## 事故备注(教训,其他人别再踩)

部署前端时 `rsync --delete` 必须加 `--exclude bridge.py --exclude bridge_ext --exclude __pycache__`,否则会把后端源码删掉(已发生一次,从 wire 日志抢救回来)。
