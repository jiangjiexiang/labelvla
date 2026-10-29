# LabelVLA 平台化完善设计

> 对标 Embodiflow 的标注/审核链路,落到我们现有架构(studio + bridge + SAM)上。
> 原则:**不动 LeRobot 原生格式**,平台数据全部放 sidecar(数据集内 `_platform/` 目录 + 桥接服务自带 SQLite),单机单服务,不做多节点。

## 1. 功能清单与范围

| 模块 | 内容 | 不做 |
|---|---|---|
| 登录 | 账号密码登录、3 种角色(管理员/标注员/审核员)、会话 cookie | 注册、SSO、细粒度权限键 |
| 数据管理台账 | 数据集列表:episode 数、总大小、相机数、标注进度、审核进度、最近活动 | 存储桶管理 |
| 数据字典 | 对象词表 + 动作词表,管理员维护,标注时 label 下拉选择 | 多级树、导入导出 |
| 任务状态机 | episode 级:未标→标注中→待审核→已通过 / 已打回(带原因) | 任务分派多人抢单(第一期按人指派即可) |
| 审核视图 | 审核员逐 episode 过,播放检查(框+轮廓都在),通过/打回写原因 | 抽检规则配置 |
| 质检扫描 | 后台扫:片段内缺框帧、框出界、框面积突变、片段无框、mask 缺失 | ROS 级深度质检(帧率/topic) |
| 概览 | 总数据量、总容量、标注/审核进度条、按人统计 | 日历图、关系图 |

## 2. 数据模型

### 2.0 从 Embodiflow 标注员指南对齐的口径

- **状态机 6 态**(他们任务级,我们落到 episode 级):
  `未标 untagged → 标注中 labeling → 待审核 review →(审核员)已通过 approved / 已打回 rejected`
  权限约束:**标注员不能设"已通过/已打回"**,只能 未标→标注中→待审核、打回后→待审核;
  已通过之后标注员不可再改(审核员可打回解锁)。打回必须带原因,标注员界面显示原因。
- **字典四类**:技能 skill / 对象 object / 目标 target / 状语 adverb(标注表单四项,无匹配可自定义,管理员确认入字典)。
- **问题标注**:标注节点可标记无效,类型:无效采集数据/基础数据有误/EE 结果异常/姿态异常数据/语义描述有误;
  标红删除线显示,记录"修正时间",未修正进问题清单。
- **批量标注**(放后期):快速标注(全部数据集同一描述)/按比例复制/批量替换。
- **快捷键对齐**:Q=片段起点 R=终点 Enter=新建片段 Ctrl+S=保存 空格=播放 ←/→=逐帧。

### 2.1 平台数据库(桥接服务内 SQLite,单文件)

```sql
users(id, username UNIQUE, display_name, password_hash, role,  -- role: admin/reviewer/annotator
      disabled, expires_at, created_by, created_at)            -- 禁用=expires_at 设为当前;删除=软删除标记
login_logs(id, user_id, login_at, logout_at, ip, device)
dataset_status(dataset, episode,                             -- 主键 (dataset, episode)
               status,          -- untagged/labeling/review/approved/rejected
               assignee, reviewer, reject_reason, updated_at, updated_by)
dict_entries(id, kind, name, enabled)                        -- kind: skill/object/target/adverb
qc_reports(dataset, episode, rule, severity, detail, frame, created_at)  -- 主键 (dataset, episode, rule, frame)
problem_marks(dataset, episode, segment_idx, reason, marked_by, marked_at, fixed_at)
```

角色层级(对齐 Embodiflow):admin 100 > reviewer 50 > annotator 10。
**管理他人账号需角色层级严格更高**;当前登录账号不可禁用/删除自己。
账号约束:用户名 3–30 字符无空白唯一;密码 ≥6 位;过期时间可空(永久)。
CSV 批量导入第一期不做(团队小,手动建号够)。

### 2.2 台账统计(实时扫,结果缓存 5 分钟)

- episode 数/时长:读 `meta/info.json` + episodes 元数据(v2 jsonl / v3 parquet,复用 bridge 已有代码)
- 容量:`du` 太慢,用 `os.scandir` 累加文件大小,后台线程跑,缓存
- 是否标注:看 `segments/episode_*.json` 是否有内容
- 是否审核:查 dataset_status 表

### 2.3 数据字典落库后,标注面板的 label 输入框变成「下拉 + 可输入新词」;
新词提交时提示"是否加入字典"(管理员确认后进词表)。

## 3. 接口(全部加在 bridge.py,路径前缀 /api/bridge/)

```
POST /api/bridge/auth/login            {username, password} → set cookie
POST /api/bridge/auth/logout
GET  /api/bridge/auth/me               → {username, role}

GET  /api/bridge/admin/datasets        → [{path, name, episodes, size_gb, cameras,
                                          labeled, in_review, approved, rejected, updated_at}]
POST /api/bridge/admin/rescan          → 触发台账重扫(后台)

GET/POST /api/bridge/dict?kind=object  词表读写(写仅管理员)

GET  /api/bridge/status?dataset&episode        单条状态
POST /api/bridge/status  {dataset, episode, status, reason?}   状态流转(带角色校验)
GET  /api/bridge/status/board?dataset          整个数据集的状态看板

POST /api/bridge/qc/scan  {dataset}            触发质检(后台任务)
GET  /api/bridge/qc?dataset&episode            查报告
```

前端调这些接口时带 cookie;未登录 → 401 → 跳登录页。

## 4. 页面设计(studio 前端,复用现有 dockview 布局)

1. **登录页** `/studio/` 入口拦截:未登录显示登录卡片,登录后回原页面。
2. **数据集列表页**(替换/增强现在的数据集选择):表格带「条数 / 时长 / 大小 / 相机 / 标注 42/50 / 审核 30/42 / 状态筛选」。
   对齐 Embodiflow 数据管理页:**筛选条件写入 URL 查询参数**(可分享带筛选的链接);底部显示当前筛选结果的容量合计与标注统计(标注总数/合格率/平均每条标注量/无效数);
   数据集软删除→回收站(目录改名 `.trash/`,可恢复,保留标注)。
3. **标注面板改动**:
   - label 输入框 → 下拉(字典对象词表)+ 自定义
   - 片段文本拆成结构化四项(技能/对象/目标/状语,字典下拉),落盘时同时保留原 `text` 字段(自动拼句)+ 四个扩展字段(走 camera 同款透传合并,老读取方不受影响)
   - 片段区加「提交审核」按钮;审核员看到「通过 / 打回(填原因)」
   - 片段右键可标「问题标注」(无效采集/基础数据有误/EE 异常/姿态异常/语义有误),红色删除线显示
   - 快捷键对齐 Embodiflow:Q/R 设片段起止、Enter 新建、Ctrl+S 保存
   - episode 侧栏每条加状态点(灰=未标 蓝=标中 黄=待审 绿=已过 红=打回)
4. **审核视图**:就是标注页的只读模式 + 通过/打回按钮,播放检查即可,不用单独做页面。
5. **概览页**:几个数字卡片 + 每数据集进度条,放在登录后的首页。
6. **字典管理**:管理员一个小页面,对象/动作两个 tab,增删启停。
7. **质检报告**:数据集行内「质检」按钮 → 按 episode 列出问题帧,点击跳转。

## 5. 质检规则(第一版)

| 规则 | 判定 |
|---|---|
| 片段无框 | segment 存在但 bboxes 为空 |
| 缺框帧 | segment 范围内某帧没有任何框覆盖(frame_boxes/keypoints 查) |
| 框出界 | 框超出视频宽高 |
| 面积突变 | 相邻帧面积变化 > 3 倍(跟踪漂移信号) |
| 轮廓缺失 | bbox 有 mask_key 但磁盘 mask 文件缺帧 |

## 6. 实施顺序(每期可独立交付使用)

1. **登录 + 数据台账**(登录页、users 表、数据集列表页)——平台骨架
2. **状态机 + 看板**(episode 状态点、提交审核、按状态筛选、打回原因展示)——标注过程可管理
3. **审核视图 + 打回**(角色=审核员,通过/打回写原因;打回后标注员可见原因并可重提)——质量闭环
4. **数据字典**(四类词表 + label 下拉 + 自定义入典)——标注口径统一
4.5 **问题标注**(片段标无效 + 类型 + 修正时间)——异常数据有出口
5. **质检扫描 + 报告页**——自动查错
6. **批量标注 + 概览统计页**——效率与总览

## 7. 对现有系统的影响

- 标注数据格式(segments JSON)**零改动**,已标数据全部兼容
- bridge.py 加约 600 行(认证 + 台账 + 状态 + 字典 + 质检)
- studio 前端加登录页 + 数据集列表页改造 + 面板状态按钮,其余不动
- 登录可以先做"单实例一把梭":默认账号 admin/admin 首次登录强制改密
