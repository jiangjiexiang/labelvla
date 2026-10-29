# Agent D 交付报告 —— 前端标注面板

> 对应 `docs/platform-plan.md` 的 Agent D 任务(F3 字典+状态+快捷键、F4 审核+问题标注)。
> 状态:**已完成**,`BASE_PATH=/studio/ npm run build`(tsc + vite)通过。

## 产出文件(全部在 `integration-v2/studio-src/src/web/annotation/`)

| 文件 | 内容 |
|---|---|
| `platformApi.ts`(新增) | 平台接口封装:`fetchMe` / `fetchStatus` / `postStatus` / `fetchBoard` / `fetchDict` / `postDictWord`。**关键设计:404/网络错误一律降级为本地模式**(旧 bridge 无平台接口时标注流程零影响);只有 400/401/403/409 才回滚+报错。返回 shape 做防御性解析(数组/`{entries}`/`{episodes}`/map 都认)。 |
| `AnnotationContext.tsx`(改) | `Segment` 扩展 `skill/object/target/adverb/problem`(契约 0.3);`user`/`platformReady`/`status`/`statusBoard`/`dict` 状态;`setStatus`(乐观更新+失败回滚)/`addDictWord`/`markProblem`/`fixProblem`;`readOnly`(审核员全程只读、标注员"已通过"后只读);快捷键 **Q=片段起点、R=终点、Enter=新建片段**(避开 input/select/button/role=dialog 等焦点占用)。 |
| `StatusBar.tsx`(新增) | 面板顶部状态条:状态点+文案、打回原因双向可见、按角色给流转按钮。标注员:开始标注/提交审核/修改后重新提交;审核员/管理员:通过/打回(必填原因内联表单)。 |
| `ProblemMenu.tsx`(新增) | 片段卡片右键菜单,5 种无效类型(无效采集/基础数据有误/EE 异常/姿态异常/语义有误)。 |
| `EpisodeStatusDot.tsx`(新增) | episode 侧栏状态点(灰蓝黄绿红),无看板数据时不渲染;导出 `STATUS_COLORS`/`STATUS_LABELS` 常量。 |
| `AnnotationPanel.tsx`(改) | 目标框 label 与片段四项均改「下拉+可输入」(datalist),失焦/回车提交,新词自动上报入典;`text` 自动拼句(老数据无四项字段时不动原 text);问题片段红色删除线+「标记已修正」;审核员隐藏全部编辑控件与 SAM。 |
| `AnnotationOverlay.tsx`(改) | 只读模式禁交互、不显示绘制横幅。 |
| `SubtaskBridge.tsx`(改) | 原生轨道↔sidecar 合并时透传四项字段与 problem(轨道拖拽/改名不再丢扩展字段);只读时阻断 native→sidecar 回写。 |

## 越界改动(需集成时注意)

- `react/components/Sidebar/episodes/EpisodeRow.tsx`:**仅两行**(import + 序号 Badge 旁渲染 `<EpisodeStatusDot>`)。不在任何 agent 独占清单内;合并冲突可直接去掉这两行,只损失侧栏状态点。

## 我消费的接口(已对过 A/B 源码,形状匹配)

- `GET auth/me` → `{id, username, display_name, role, must_change_password}` ✅ 实测容器
- `GET/POST status`、`GET status/board`(`{episodes:[{episode,status,...}]}`)、`GET/POST dict`(`{entries:[{name,enabled}]}`,POST body 需带 `kind`+`name`)✅ 对过 `status.py`/`dictionary.py` 源码
- 打回流按 B 的实现收紧:标注员只允许 `untagged→labeling→review`、`rejected→review`,**没有** rejected→labeling 按钮

## 给其他 agent 的接口说明

- **C**:登录守卫不用管标注面板内部;`useAnnotation()` 里 `platformReady=false` 表示后端无平台接口(自动降级);`user=null` 表示未登录或旧后端。`STATUS_COLORS`/`STATUS_LABELS` 可从 `web/annotation/EpisodeStatusDot.tsx` 复用(Dashboard/QcReport 如需状态色)。
- **B**:`problem_marks` 表我这期没直接写 —— 问题标记存在 segments JSON 的 `segment.problem = {reason, by, at, fixed_at}` 扩展字段(契约 0.3);如质检/概览要统计问题片段,从 segments 扩展字段读即可。

## 已知缺口(不归 D,集成前必须补)

- **`bridge.py` 第 111/141 行 extras 透传只合并 box 级** `camera/frame_boxes/mask_key`,segment 级 `skill/object/target/adverb/problem` 落盘会丢。按契约 0.3 需在读写两处各补一轮 segment 级 extras 合并(红线文件,D 未动)。
- 容器内 status/dict 路由目前 404(B 未注册/未重启),D 的降级路径覆盖该中间态,B 挂载后前端零改动生效。
