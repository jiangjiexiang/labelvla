# Tasks：原生 Subtask 分段 + LabelVLA 标注

- [x] 1. `src/core/subtask/types.ts`：`canMutateSubtasks` 改为仅要求 `status === 'supported'`（放开 v2.1）。
- [x] 2. 新增 `src/web/annotation/SubtaskBridge.tsx`：sidecar → 原生 push、原生 → sidecar write-back，签名比较 + `suppressPushRef` 防死循环，bbox 按帧范围/索引合并。
- [x] 3. 重写 `src/web/annotation/AnnotationPanel.tsx`：去掉片段 CRUD 与“从头开始/从当前帧”，展示当前原生片段只读信息，保留目标框/轨迹/保存，shadcn 主题样式。
- [x] 4. `src/web/annotation/AnnotationOverlay.tsx`：主题色、顶部“标记轨迹中 · 第 N 帧”状态条、关键点帧号、虚线轨迹。
- [x] 5. `src/react/components/Playback/PlaybackProgressSlider.tsx`：移除 `AnnotationTimeline` 引用与渲染。
- [x] 6. 删除 `src/web/annotation/AnnotationTimeline.tsx`。
- [x] 7. 新增 `src/web/app/serverDataset.ts`：`ServerSource`、`fetchServerDatasets`、`connectServerDataset`、`useAutoConnectServerDataset`（URL 参数优先跳过）。
- [x] 8. `src/web/app/ServerBridge.tsx`：复用 `serverDataset` 连接逻辑，去掉重复实现。
- [x] 9. `src/web/app/AppShell.tsx`：调用自动连接 hook，挂载 `<SubtaskBridge />`。
- [x] 10. `src/react/components/Navbar.tsx`：“打开”菜单仅保留“服务器数据集”。
- [x] 11. `src/web/app/unified.css`：移除写死配色，保留窄屏规则。
- [x] 12. `npm install && npm run build`，复制 `dist/index.html` 与 `dist/assets` 到 `integration-v2/studio`。
- [x] 13. 浏览器硬刷新验证：自动连接、原生 Subtask 编辑、面板只读片段、目标框/轨迹、保存 sidecar、原始数据未变。
