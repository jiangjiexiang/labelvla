# Spec：LeRobot Studio 原生 Subtask 分段 + LabelVLA 标注（方案②）

## 1. 目标

将标注页的“分片段”入口完全交给 LeRobot Studio 原生 Subtask 轨道（播放条上的彩色分段 + 拖拽边界 + 双击改名 + 删除），LabelVLA 面板只负责：

1. 在**当前选中的原生 Subtask 片段**内绘制/跟踪目标框（稀疏关键点 + 运行时线性插值）。
2. 手工保存（`Ctrl/⌘+S`）到数据集 `segments/episode_XXXXXX.json` sidecar，绝不改动 parquet / 视频 / meta。
3. 打开 `/studio/` 时自动连接 `/data` 下的服务器数据集，不再要求用户选择。
4. UI 完全沿用 LeRobot Studio 的 shadcn 设计系统。

## 2. 已确认的现状（源码 `integration-v2/studio-src`）

- `src/core/subtask/types.ts:65` `canMutateSubtasks` 仅允许 `adapterVersion === 'v3.0'`，导致 v2.1 数据集原生 Subtask 编辑被禁用。
- `src/react/contexts/useSubtaskAnnotation.ts` 提供 overlay、`replaceEpisodeSegments`、`updateSegment`、`removeSegment` 等；`replaceEpisodeSegments` 会对重叠区间抛错。
- 原生编辑入口：`EpisodeSidebar` 的 `onToggleEditMode` → `setEpisodeEditMode`；`PlaybackBar.annotationEnabled = canAnnotate && episodeEditMode && !trimming`；`PlaybackProgressSlider` 内部渲染 `SubtaskRangeTrack`。
- 标注 sidecar 已由 `src/web/annotation/AnnotationContext.tsx` 负责读写：`GET/POST /api/bridge/segments?dataset=&episode=`，带 revision 并发校验，自动选中包含播放头的片段。
- 目标框画布 `AnnotationOverlay` 已挂在 `VideoPanel` 上；`AnnotationPanel` 仍是旧的“片段 CRUD”面板，包含“从头开始 / 从当前帧”两个按钮（需删除）。
- `bridge.py` 的 segments 接口只接受 v2 数据集；存在 `/api/datasets?path=/data&depth=3` 与 `/api/bridge/index?dataset=` 可用于自动连接。
- `PlaybackProgressSlider.tsx:1,316` 仍挂载旧的 `AnnotationTimeline`（与原生 Subtask 轨道重复）。

## 3. 关键决策

- **唯一分段入口**：原生 `SubtaskRangeTrack`。标注面板不提供“添加/编辑/删除片段”和任何预设帧按钮。
- **双向桥接**：sidecar 片段 ↔ 原生 overlay。
  - 加载 episode 后：sidecar → 原生 `replaceEpisodeSegments`。
  - 用户在原生轨道上改分段后：原生 → sidecar `update()`，并按帧范围/序号保留已有 bbox 和 keypoints。
  - 用签名比较 + 抑制标记避免互相回写死循环。
- **v2.1 放开**：`canMutateSubtasks` 仅要求 `status === 'supported'`。
- **自动连接**：页面挂载即连接默认数据集；URL 显式指定数据源时让 URL 优先。
- **保存仍为手动**：面板显示 dirty 徽标，`Ctrl/⌘+S` 保存；切换数据集前有 dirty 拦截（已有逻辑）。

## 4. 变更清单（逐文件）

### 4.1 `src/core/subtask/types.ts`

- 修改 `canMutateSubtasks`：

```ts
export function canMutateSubtasks(capability: LeRobotVersionCapability | null): boolean {
  return capability?.status === 'supported';
}
```

- 仅此一处；`v3.0` 与 `v2.1` 均可编辑，未来 read-only 版本仍被拒绝。

### 4.2 新增 `src/web/annotation/SubtaskBridge.tsx`

无 UI，挂载于 `AppShell` 内（已在 `AnnotationProvider` 之下）。职责：

```ts
type NativeSegment = { startFrame: number; endFrame: number; label: string };
const labelFor = (text: string) => (text.trim() === '' ? '_' : text.trim());
const signature = (segs: readonly NativeSegment[]) =>
  segs.map(s => `${s.startFrame}:${s.endFrame}:${s.label}`).join('|');
```

- 依赖：`useLeRobotData()`（`versionCapability`）、`useLeRobotSelection()`（`selectedEpisodeIndex`）、`useLeRobotSubtask()`（`canAnnotate`、`currentSegments`、`replaceEpisodeSegments`）、`useAnnotation()`（`dataset`、`episode`、`segments`、`update`、`saving`）。
- `active = episode !== null && episode === selectedEpisodeIndex`。
- **push 副作用**（sidecar → 原生）：
  - 条件：`active && dataset && !saving && canAnnotate`；
  - 计算 sidecar 映射 `mapped = segments.map(s => ({startFrame: s.start_frame, endFrame: s.end_frame, label: labelFor(s.text)}))`；
  - 若 `signature(mapped) === signature(currentSegments)` 或 `signature(currentSegments) === suppressPushRef.current`，跳过；
  - 否则 `try { replaceEpisodeSegments(mapped) } catch (e) { console.warn('同步分段到原生轨道失败', e) }`，并更新 `lastPushedRef`。
  - 监听依赖：`active, dataset, saving, canAnnotate, segments, currentSegments, replaceEpisodeSegments`。
- **write-back 副作用**（原生 → sidecar）：
  - 条件：`active && canAnnotate && !saving`；
  - 若 `signature(currentSegments) === signature(mapped)` 则跳过；
  - 合并：按原生片段顺序，优先取 sidecar 中 `start_frame/end_frame` 完全相同的片段；否则按同索引且区间有交集取 bbox；都没有则 `bboxes: []`。`text = label === '_' ? '' : label`；
  - 写入前 `suppressPushRef.current = signature(currentSegments)`（防止 push 副作用把旧值推回去），调用 `a.update(merged)`；
  - 监听依赖同上，声明在 push 副作用**之前**。
- episode 切换时重置 `suppressPushRef`/`lastPushedRef`。

### 4.3 重写 `src/web/annotation/AnnotationPanel.tsx`

- 删除全部片段 CRUD 状态与“从头开始 / 从当前帧 / 添加片段 / 编辑 / 删除片段”UI。
- 使用 shadcn/Tailwind 类名（`bg-background`、`border-border`、`text-foreground`、`text-muted-foreground`、`Button`、`Badge`、`Separator`），宽度 `w-[260px] shrink-0`，仅桌面端显示（窄屏由 `unified.css` 变为横向卡片）。
- 结构：
  1. 标题 `LabelVLA 标注` + `Episode {episode ?? '—'}` + `保存` 按钮（`disabled={!dirty || saving}`）+ dirty 徽标（`已修改`）。
  2. 当前原生片段只读信息：`#index · start–end 帧` + `text || '未命名片段'`；若当前帧不在任何片段内，显示提示“当前帧不在任何片段内，请在下方 Subtask 轨道选择或创建片段”。
  3. 提示行：`在播放条 Subtask 轨道编辑/拖动分段；需先在左侧 Episode 侧栏开启编辑模式`。
  4. 目标框：`boxLabel` 输入、框列表（显示 `label · w×h · N 个关键点`）、删除按钮、`标记轨迹 / 结束轨迹`、`清除轨迹`。
  5. 错误/状态文本放在 `role="status"` 区域，颜色用 `text-amber-600`（主题兼容）。
- 仍从 `useAnnotation()` 取 `segments[selected]`；`a.select(i)` 等 API 保持不变。

### 4.4 `src/web/annotation/AnnotationOverlay.tsx`

在保留现有绘制/拖拽/关键点逻辑的基础上补齐反馈：

- 顶部状态条（`<g>` 内 `rect` + `text`）：`标记轨迹中 · 第 {frame} 帧`，未跟踪时显示 `拖动创建目标框`；
- 关键点圆点旁显示帧号（`p.frame`），当前帧高亮；
- 已有关键点的虚线轨迹保留（`strokeDasharray="5 4"`）；
- 颜色改用主题：普通框 `className="text-cyan-400"` + `stroke="currentColor"`，选中框 `className="text-primary"` + `stroke="currentColor"`，文字用 `fill="currentColor"`；轨迹用 `className="text-rose-400"`。
- 不引入新的外部依赖。

### 4.5 `src/react/components/Playback/PlaybackProgressSlider.tsx`

- 删除 `import { AnnotationTimeline } ...` 与 `<AnnotationTimeline />`（原生 `SubtaskRangeTrack` 取代）。

### 4.6 删除 `src/web/annotation/AnnotationTimeline.tsx`

- 无其他引用后删除文件。

### 4.7 新增 `src/web/app/serverDataset.ts`

```ts
export class ServerSource implements DataSource { /* 现有 ServerBridge 中的实现搬移 */ }
export async function fetchServerDatasets(path = '/data'): Promise<Array<{name: string; path: string}>>
export async function connectServerDataset(dataset: string): Promise<{ name: string }>
export function useAutoConnectServerDataset(): void
```

- `fetchServerDatasets`：`GET /api/datasets?path=/data&depth=3`，返回 `datasets`。
- `connectServerDataset(dataset)`：
  - `GET /api/bridge/index?dataset=` 取 `files` → `new ServerSource(dataset, new Set(files))`；
  - 读 `meta/info.json` 的 `codebase_version`；
  - `initialize(source)`；
  - 若以 `v2` 开头，`annotation.setDataset(dataset)`（与现 `ServerBridge.openDataset` 行为一致）；
  - 返回 `{ name: basename }`。
- `useAutoConnectServerDataset()`：
  - 仅在 `info === null && !isLoading` 时执行，`useRef` 保证一次；
  - 若 URL 含 `?url=` / `?dataset=` / `?data=`（`getUrlParamFromLocation()` 非空）则直接跳过，交给 `useUrlDrivenSourceController`；
  - 优先数据集 `/data/panda_droid-pick_color-20261013`（存在时），否则取 `fetchServerDatasets()` 第一个；
  - 连接失败时 `console.warn`，页面保留原有 WelcomeScreen（不阻塞 UI）。
- 常量 `DEFAULT_SERVER_DATASET = '/data/panda_droid-pick_color-20261013'`.

### 4.8 `src/web/app/ServerBridge.tsx`

- 删除内部 `ServerSource` 类与 `openDataset` 的重复实现，改为：
  - `import { ServerSource, connectServerDataset } from './serverDataset'`;
  - `openDataset` → 先做 dirty 拦截，再 `const { name } = await connectServerDataset(path); onOpened(name); onClose();`，错误写入本地 message。
- 保留目录浏览 UI 与 `/api/fs` 逻辑。

### 4.9 `src/web/app/AppShell.tsx`

- `import { SubtaskBridge } from '../annotation/SubtaskBridge';`
- `import { useAutoConnectServerDataset } from './serverDataset';`
- 在组件顶部调用 `useAutoConnectServerDataset();`
- 在 `<ServerBridge ... />` 之后渲染 `<SubtaskBridge />`。
- 其余布局不变。

### 4.10 `src/react/components/Navbar.tsx`

- “打开”下拉菜单仅保留“服务器数据集”一项（`onOpenServerDirectory`）；移除本地目录、压缩包、远程 URL、示例数据集、历史等条目，避免入口分散。
- 保留 Go Home、导出、健康检查、侧栏/播放条开关、主题/语言按钮。
- 无用的 props 保留签名以兼容，但不再渲染对应菜单项。

### 4.11 `src/web/app/unified.css`

- 仅保留窄屏适配规则；`.unified-annotation` 在窄屏改为 `width:100%; max-height:340px; border-top`，去掉写死的深色背景/边框颜色（由 shadcn 类名接管）。

## 5. 数据流与防死循环

1. episode 加载完成 → `AnnotationContext` 读 sidecar → `SubtaskBridge` push 到原生。
2. 用户在原生轨道拖动/改名/删除 → 原生 `currentSegments` 变化 → write-back 合并 bbox → `a.update()` → dirty。
3. dirty 状态下 bbox 编辑不改变分段签名，不会触发 push。
4. push / write-back 都用 `signature()` 比较；write-back 写前设置 `suppressPushRef`，push 看到该签名即跳过，避免同一轮把旧分段推回。
5. 保存成功 `revision` 更新、`segments` 回写；签名不变，不触发同步。

## 6. 验收标准

1. 打开 `http://172.16.122.44:8002/studio/` 无需任何选择，自动显示 100 个 episode（默认数据集），Navbar 标题为数据集名。
2. “打开”菜单只有“服务器数据集”，弹窗可切换 `/data` 下其他 v2 数据集。
3. 左侧 Episode 侧栏开启编辑模式后，播放条出现彩色 Subtask 轨道；可拖拽边界、双击改名、删除、点击空白补全片段；这些操作在 v2.1 数据集上可用。
4. 标注面板显示当前片段只读信息；切换片段后目标框跟着切换；不再出现“从头开始/从当前帧/添加片段”。
5. 在视频上拖动创建框、`标记轨迹` 后逐帧点击中心，框按线性插值移动；关键点显示帧号与虚线轨迹，顶部显示“标记轨迹中 · 第 N 帧”。
6. 修改后出现 dirty 徽标；`Ctrl/⌘+S` 或点击保存后写入 `<dataset>/segments/episode_XXXXXX.json`，其中每个 bbox 只存稀疏 `keypoints`，响应包含 `interpolated_centers`。
7. 原始 parquet / 视频 / meta 文件 mtime 与内容不变（`segments/` 目录除外）。
8. 刷新浏览器后标注与原生 Subtask 分段都能恢复（sidecar → 原生 push 生效）。
9. `npm run build` 通过（tsc 无错误），产物已复制到 `integration-v2/studio`。

## 7. 验证与部署步骤

```bash
cd /home/robam/labelvla-docker/integration-v2/studio-src
npm install
npm run build
cp -r dist/index.html dist/assets /home/robam/labelvla-docker/integration-v2/studio/
```

浏览器硬刷新（Ctrl+Shift+R）验证第 6 节。检查 sidecar：

```bash
ls -l /data/panda_droid-pick_color-20261013/segments/
```

（在容器/宿主机对应挂载路径执行。）

## 8. 约束与风险

- 只写 `segments/` sidecar；不触碰任何 LeRobot 原始文件。
- 原生分段重叠会抛错：push/write-back 必须 `try/catch` 并 `console.warn`，不得崩溃。
- 保存仍为手动；`dirty` 时切换数据集需被 `ServerBridge` 拦截（保留）。
- `replaceEpisodeSegments` 只在 `canAnnotate` 为真时可用；capability 未就绪时不同步，就绪后自动补推。
- 若原生轨道改名后 label 为空，映射为 `'_'`；sidecar 中 `'_'` 回写为空字符串。
