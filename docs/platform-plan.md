# LabelVLA 平台化 —— 多 Agent 并行开发计划

> 前置阅读:`docs/platform-design.md`(功能与数据模型)。
> 本文档是给开发 agent 的施工图:任务拆解、文件归属、接口契约、验收标准。
> **核心原则:先定契约(Wave 0),再并行开发(Wave 1+),每个任务只碰自己的文件。**

## 0. 契约层(必须先完成,阻塞后续所有任务)

### 0.1 后端结构改造(单文件 → 包)

`integration-v2/studio/bridge.py` 现在 430 行单文件,多 agent 并行必冲突。先拆包:

```
integration-v2/studio/
  bridge.py                 # 只保留:app 创建、现有路由、include 各模块
  bridge_ext/
    __init__.py
    db.py                   # SQLite 连接、建表、迁移
    auth.py                 # 登录/登出/me、cookie 会话、角色校验装饰器
    ledger.py               # 数据集台账扫描与缓存
    status.py               # 状态机
    dictionary.py           # 数据字典
    qc.py                   # 质检扫描
    dashboard.py            # 概览统计聚合
```

bridge.py 末尾:`from bridge_ext import auth, ledger, ...; auth.register(app)` 各模块暴露 `register(app)`。
**注意:bridge_ext/ 在容器里是 bind-mount 的一部分,无需改镜像。**

### 0.2 接口契约(冻结,前端后端都按此写)

沿用 `docs/platform-design.md` 第 3 节,补充概览接口:

```
GET /api/bridge/dashboard
→ { totals: {datasets, episodes, hours, annotations, annotation_hours},
    status_dist: {untagged, labeling, review, approved, rejected},
    quality: {valid, invalid, error, pass_rate, fix_rate},
    qc: {pass, fail, not_scanned},
    trends: {                      -- 最近 30 天,按日
      data_growth: [{day, count}], annotation_growth: [{day, count}],
      qc_trend: [{day, pass, fail}], quality_trend: [{day, valid, error, invalid}] } }

GET /api/bridge/admin/datasets
→ [{path, name, episodes, size_gb, cameras, hours,
    counts: {untagged, labeling, review, approved, rejected},
    qc: {pass, fail}, updated_at}]
```

### 0.3 前端类型契约

`studio-src/src/web/annotation/AnnotationContext.tsx` 的 Segment/Box 扩展:
```ts
type SegmentExtras = { skill?: string; object?: string; target?: string; adverb?: string;
                       problem?: { reason: string; by: string; at: string } };
type EpisodeStatus = 'untagged'|'labeling'|'review'|'approved'|'rejected';
```
bridge 读写 segments 时 `skill/object/target/adverb` 走现有 extras 透传合并(同 camera/frame_boxes);
`problem` 标记也存 segment 扩展字段,红色删除线由前端渲染。

## 1. 并行任务拆分(Wave 1,契约合并后同时开工)

### 总览:A / B / C / D 四个 agent 的分工

| Agent | 一句话 | 产出文件 |
|---|---|---|
| **A · 后端基座** | 数据库、登录、账号管理 API | `bridge_ext/db.py` `auth.py` `users.py` |
| **B · 后端业务** | 台账、状态机、字典、质检、概览 API | `bridge_ext/ledger.py` `status.py` `dictionary.py` `qc.py` `dashboard.py` |
| **C · 前端平台页** | 登录页、数据集台账页、用户管理页、概览页、质检报告页 | `web/app/Login.tsx` `DatasetList.tsx` `Users.tsx` `Dashboard.tsx` `QcReport.tsx` |
| **D · 前端标注面板** | 字典下拉、状态流转、审核打回、问题标注、快捷键 | `web/annotation/*` |

**依赖与节奏**:**A 先行**(B 要它的表结构、C 要它的登录接口);A 完成后 **B / C / D 三路并行**(C/D 可按冻结的接口契约先 Mock 开发,不等 B 真数据)。

---

### Agent A · 后端基座(先开工)

**独占文件**:`integration-v2/studio/bridge_ext/db.py`、`auth.py`、`users.py`

1. `db.py`:SQLite 单文件 `/data/.platform/platform.db`;幂等建表(users / login_logs / dataset_status / dict_entries / qc_reports / problem_marks,表结构见设计文档 2.1);提供 `get_db()`
2. `auth.py`:`POST /api/bridge/auth/login`(sha256+salt,HttpOnly cookie 会话)、`POST logout`、`GET auth/me`、`POST auth/password`(改密);`require_role(*roles)` 装饰器,未登录 401;内置 admin/admin,首登强制改密
3. `users.py`:`GET/POST /api/bridge/users`、`PATCH users/{id}`、`POST users/{id}/disable`、`DELETE users/{id}`(软删)、`GET users/{id}/logins`;规则:角色层级 admin 100 > reviewer 50 > annotator 10,改他人需严格更高,不可禁用/删除自己;用户名 3–30 无空白唯一,密码 ≥6 位

**验收**:curl 走通 登录→建标注员→标注员登录→越权被拒→改密→登出;现有接口不受影响。

---

### Agent B · 后端业务(A 的 db.py 就绪后开工)

**独占文件**:`bridge_ext/ledger.py`、`status.py`、`dictionary.py`、`qc.py`、`dashboard.py`

1. `ledger.py`:`GET /api/bridge/admin/datasets`(v2/v3 都认:条数/时长/容量/相机数/各状态条数;容量后台扫 + 5 分钟缓存)、`POST admin/rescan`、数据集软删/恢复(目录移入 `/data/.trash/`,标注保留)
2. `status.py`:episode 状态机 `GET/POST /api/bridge/status`、`GET status/board?dataset=`;权限:标注员只能 untagged→labeling→review、rejected→review;approved/rejected 仅审核员,打回必填原因
3. `dictionary.py`:`GET/POST /api/bridge/dict?kind=skill|object|target|adverb`;标注员自定义词进待确认(enabled=0),admin 确认生效
4. `qc.py`:`POST /api/bridge/qc/scan`(后台线程,5 条规则:片段无框/缺框帧/框出界/面积突变>3 倍/mask 缺帧)、`GET qc?dataset=&episode=`
5. `dashboard.py`:`GET /api/bridge/dashboard` 按契约 0.2 输出(四指标 + 三分布 + 四条 30 天趋势)

**验收**:每个接口 curl 自测;数字与人工抽查一致;未登录 401、越权 403。

---

### Agent C · 前端平台页(契约冻结即可开工,前期 Mock)

**独占文件**:`studio-src/src/web/app/Login.tsx`、`DatasetList.tsx`、`Users.tsx`、`Dashboard.tsx`、`QcReport.tsx`;`AppShell.tsx` 只加守卫 + 路由插槽

1. `Login.tsx`:登录卡片、失败提示、首登改密弹窗
2. `DatasetList.tsx`:台账表格(名称/条数/时长/GB/相机/标注进度/审核进度),筛选写 URL query,底部容量合计+标注统计,行操作(进入标注/软删),回收站 tab
3. `Users.tsx`:账号表 + 建号对话框 + 禁用 + 登录记录弹窗;按层级置灰
4. `Dashboard.tsx`:四指标卡 + 三个手写 SVG 环形图 + 四条 uplot 趋势线;手动刷新;深色兼容
5. `QcReport.tsx`:按 episode 分组列问题,点击跳转到对应 episode+frame 的标注页

**验收**:`BASE_PATH=/ npm run build` 过 tsc;页面中文、风格沿用现有 Tailwind 体系。

---

### Agent D · 前端标注面板(契约冻结即可开工)

**独占文件**:`studio-src/src/web/annotation/` 全部(改 AnnotationContext/Panel/Overlay,新增 `StatusBar.tsx`、`ProblemMenu.tsx`)

1. 字典下拉:label 改「下拉+可输入」(object 词表);片段拆四项(技能/对象/目标/状语)下拉,保存时 `text` 自动拼句 + 四扩展字段透传
2. `StatusBar.tsx`:面板顶部当前 episode 状态 + 可执行按钮(标注员:开始标注/提交审核;审核员:通过/打回填原因);episode 侧栏状态点(灰蓝黄绿红)
3. 审核模式:审核员只读,禁编辑,只留通过/打回
4. `ProblemMenu.tsx`:片段右键标无效(5 类型),红删除线,修正记录 fixed_at
5. 快捷键:Q=片段起点、R=终点、Enter=新建片段(沿用 Ctrl+S/空格/方向键)

**验收**:tsc 过;老数据打开正常;打回原因双向可见;SAM 标注流程回归不破。

---

### 子任务编号备查(与 A/B/C/D 的映射)

| 归属 | 子任务 | 文件 |
|---|---|---|
| A | B1 auth+db | `db.py` `auth.py` |
| A | B1b 用户管理 | `users.py` |
| B | B2 台账 | `ledger.py` |
| B | B3 状态机+字典 | `status.py` `dictionary.py` |
| B | B4 质检 | `qc.py` |
| B | B5 概览 | `dashboard.py` |
| C | F1 登录+守卫 | `Login.tsx` |
| C | F1b 用户管理页 | `Users.tsx` |
| C | F2 台账页 | `DatasetList.tsx` |
| C | F5 概览页 | `Dashboard.tsx` |
| C | F6 质检报告页 | `QcReport.tsx` |
| D | F3 字典+状态+快捷键 | `annotation/*` |
| D | F4 审核+问题标注 | `StatusBar.tsx` `ProblemMenu.tsx` |

**冲突红线**:`bridge.py` 只允许 Wave 0 动;`AppShell.tsx` 只允许 F1 加守卫、F2/F5/F6 各加一条路由登记(用约定好的插槽注释,如 `{/* ROUTE_SLOT */}`,最后由我合并);共享类型只许在 0.3 冻结后追加、不许改已有字段。

## 2. 集成与验收(全部并行任务完成后,我做)

1. `npm run build`(必须 `BASE_PATH=/`)+ `py_compile` + 重启容器
2. 端到端验收清单:
   - 未登录访问 → 跳登录;admin 登录 → 建标注员/审核员账号
   - 数据集列表数字与 `du`/人工抽查一致
   - 标注员标完提交 → 状态待审核;审核员打回带原因 → 标注员看到原因 → 重提
   - 字典新增对象 → 标注下拉立即可选;自定义词管理员确认入典
   - 质检扫出问题帧,点击跳转到对应 episode+frame
   - 概览数字与台账一致,趋势图有 30 天分桶
3. 回归:SAM 标注全流程(点选→传播→保存)不受影响

## 2.5 明确不做(已对标文档后排除)

- **采集任务模块**(设备/遥操作/TRRO):我们不接采集设备;「任务分派」用 dataset_status.assignee 一个字段覆盖
- **多格式导出**、MCAP 三维渲染、ROS 深度质检、许可证名额
- 用户 CSV 批量导入(第一期)、项目多层级(我们一级:数据集即项目)

## 3. 给 agent 的通用背景(每个 prompt 都要带)

- 项目:`/home/robam/labelvla-docker`,部署见 `integration-v2/README.txt`
- 前端源码 `integration-v2/studio-src`,构建 `BASE_PATH=/ npm run build`,
  部署 `rsync -a --delete --exclude bridge.py --exclude bridge_ext --exclude __pycache__ dist/ ../studio/`(bridge_ext 必须排除,里面是平台后端源码)
- 后端 `integration-v2/studio/bridge.py`(bind-mount 进容器 `labelvla-studio-integrated`,改后 `docker restart`)
- 容器 Python 无 requests/httpx,用 urllib;数据根 `/data`(宿主机 `./data`)
- 数据集分 v2(`videos/chunk-000/<cam>/episode_NNNNNN.mp4`)和 v3(`videos/<cam>/chunk-*/file-*.mp4` + parquet 时间戳),v3 帧偏移逻辑已在 bridge.py `_episode_video`
- segments JSON 扩展字段透传模式见 bridge.py 现有 camera/frame_boxes/mask_key 合并逻辑,新字段照此办理
- 代码风格:前端紧凑单行(见 AnnotationOverlay.tsx),后端 4 空格snake_case
