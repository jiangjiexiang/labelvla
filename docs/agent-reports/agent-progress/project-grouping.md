# 项目聚合交接文档 — `subtask1_50/part_*` 显示为一个项目

> 日期:2026-10-29
> 目标读者:下一位负责前端台账页整合的 agent。
> 当前代码状态:A/B/C/D 的平台化产物已整合并部署到容器 `labelvla-studio-integrated`。

## 1. 当前已完成内容

### 1.1 A/B/C/D 整合

- 后端平台模块已挂载:`bridge_ext/auth.py`、`users.py`、`ledger.py`、`status.py`、`dictionary.py`、`qc.py`、`dashboard.py`。
- 前端平台页已接入:登录、概览、数据集台账、用户管理、质检报告。
- D 的标注面板已接入:字典下拉、episode 状态条、审核只读、问题标注、Q/R/Enter 快捷键、侧栏状态点。
- 部署方式已按 `integration-v2/README.txt` 执行，且没有误删 `bridge_ext/`。

### 1.2 本次集成修复

1. `integration-v2/studio/bridge.py`
   - `GET /api/bridge/segments` 与 `POST /api/bridge/segments` 都补上了 segment 级扩展字段透传:
     `skill` / `object` / `target` / `adverb` / `problem`。
   - 这修复了 D 报告中的已知缺口;否则结构化描述和问题标记会在保存后丢失。

2. `integration-v2/studio-src/src/web/annotation/AnnotationContext.tsx`
   - 不再单独调用一次 `fetchMe()` 保存本地用户快照。
   - 改为共享 C 的全局 `useAuth()` 登录态，登录/登出后角色与只读状态立即生效。

3. `integration-v2/studio-src/src/web/app/platform/api.ts`
   - 修复 `GET /api/bridge/admin/datasets` 返回 `{datasets: [...]}` 与前端预期裸数组不一致的问题。
   - 修复回收站删除/恢复路径:
     - 删除:`POST /api/bridge/admin/datasets/delete`
     - 恢复:`POST /api/bridge/admin/datasets/restore`,body 使用 `{name}`。
   - 修复质检返回 shape:后端返回 `{issues, scanning, scanned_at}`,不是 `{items}`。

4. `integration-v2/studio-src/src/web/app/QcReport.tsx`
   - 修复质检规则名映射:`no_box`、`missing_frame_box` 等。
   - `frame = -1` 表示「无具体帧」,页面不再显示或跳转到 `-1` 帧。
   - 质检扫描轮询在 `scanning=false` 后立即停止。

5. `integration-v2/studio-src/src/web/app/DatasetList.tsx`
   - 回收站恢复改传后端要求的 trash entry `name`。

### 1.3 已验证

- `BASE_PATH=/studio/ npm run build`:通过(tsc + vite)。
- `python -m py_compile integration-v2/studio/bridge.py integration-v2/studio/bridge_ext/*.py`:通过。
- 已执行部署并重启容器:
  ```bash
  rsync -a --delete --exclude bridge.py --exclude bridge_ext --exclude __pycache__ dist/ ../studio/
  docker restart labelvla-studio-integrated
  ```
- 用临时 admin 账号 + 临时数据集在真实容器走通:
  登录、数据集列表、状态流转、字典写入、segment 扩展字段保存与读取、质检扫描、概览、软删除、回收站恢复。
- 用户之前遇到的 `h.reduce is not a function` 已修复;原因是后端返回 `{datasets: [...]}`，前端把外层对象当数组处理。

### 1.4 未完成验证

- 真实浏览器自动化检查曾尝试运行，但本机 Playwright Chromium 可执行文件缺失:
  `~/.cache/ms-playwright/chromium_headless_shell-1243/...`。
- 如需 UI 自动化，下一位 agent 可先执行 `npx playwright install chromium`;不安装也可以先手工验证页面。

## 2. 新需求:`part_*` 聚合成一个项目

用户当前看到台账中 `/data/subtask1_50/part_0`、`part_1`、... 都是独立行，希望它们显示为一个项目。

推荐做法:**只在前端台账页做项目聚合，不改磁盘目录、不改 LeRobot 数据、不改后端 ledger 扫描结果**。

原因:

- 每个 `part_*` 仍然是合法 LeRobot dataset;进入标注、状态机、质检都以单个 dataset 为单位。
- 后端台账已经递归扫描所有 dataset,保留逐 part 数据对统计和质检是有价值的。
- 前端把同父目录下的 `part_*` 聚合成项目行，风险最低，不破坏现有 API 和标注流程。

## 3. 建议的交互

以 `/data/subtask1_50/part_*` 为例:

- 台账默认显示一个项目行:`subtask1_50`。
- 项目行显示聚合后的:
  - part 数量
  - episode 总数
  - 总时长
  - 总容量
  - 相机数
  - 汇总状态分布
  - 汇总质检结果
- 项目行有「展开/收起」按钮。
- 展开后显示每个 part 的子行,子行保留原有「进入标注 / 删除」。
- 第一版不要做项目级「进入标注」或项目级「删除」:
  - Studio 当前一次只能打开一个 LeRobot dataset。
  - 项目级删除会一次移动几十个目录,风险较高。
- 回收站 tab 保持现状,不做项目聚合。

## 4. 聚合规则

只对满足以下条件的 dataset 做聚合:

- `path` 的最后一级目录名匹配 `part_<数字>`,例如 `part_0`、`part_31`。
- 这些 dataset 具有相同父目录,例如共同父目录 `/data/subtask1_50`。
- 父目录本身不出现在台账结果里;如果父目录也是一个合法 dataset,为避免隐藏父 dataset,不做聚合。

示例:

```text
/data/subtask1_50/part_0
/data/subtask1_50/part_1
...
/data/subtask1_50/part_31
```

聚合为:

```text
项目 key: /data/subtask1_50
项目名: subtask1_50
子项: part_0 ... part_31
```

子项排序使用数字排序,不能用字符串排序:

```text
part_0, part_1, part_2, ..., part_9, part_10
```

不要出现字典序的 `part_0, part_1, part_10, part_11, part_2`。

## 5. 聚合字段口径

后端每行 shape 目前为:

```ts
{
  path: string;
  name: string;
  episodes: number;
  size_gb: number | null;   // 容量后台扫描期间可能是 null
  cameras: number;
  hours: number;
  counts: Record<EpisodeStatus, number>;
  qc: { pass: number | null; fail: number };
  updated_at?: string;
}
```

项目聚合建议:

- `episodes`:子项求和。
- `hours`:子项求和。
- `size_gb`:
  - 任一子项为 `null` 时,项目容量显示「扫描中…」或 `—`,不要把 null 当 0 后显示假数字。
  - 全部有值时求和。
- `cameras`:取最大值(同一项目的 part 通常 schema 一致)。
- `counts`:五个状态分别求和。
- `qc.pass`:
  - 所有子项都为 `null`:项目也显示「未质检」。
  - 有扫描结果的子项求和;`fail` 求和。
- `updated_at`:取最新的 ISO 时间。
- `part_count`:子项数量。

建议先修正 `DatasetRow` 类型,让 `size_gb` 和 `qc.pass` 与后端一致地允许 `null`,再处理页面展示。

## 6. 建议修改文件

主要修改:

- `integration-v2/studio-src/src/web/app/DatasetList.tsx`
- `integration-v2/studio-src/src/web/app/platform/api.ts`(只需要修正类型,不要改后端接口)

如果逻辑变复杂,可新增:

- `integration-v2/studio-src/src/web/app/platform/datasetGroups.ts`

建议把纯聚合逻辑放到 `datasetGroups.ts`,例如:

```ts
type DatasetGroup = {
  key: string;
  name: string;
  path: string;
  rows: DatasetRow[];
  episodes: number;
  size_gb: number | null;
  cameras: number;
  hours: number;
  counts: Record<EpisodeStatus, number>;
  qc: { pass: number | null; fail: number };
  updated_at?: string;
};
```

`DatasetList.tsx` 只负责展开状态和渲染,避免把聚合逻辑塞进 JSX。

## 7. 实现注意点

- 搜索过滤建议先作用于原始 part 行,再聚合;搜索 `subtask1_50` 时应能匹配整个项目。
- 底部统计要区分项目和数据集,例如:
  `共 1 个项目 / 32 个数据集`,容量、episode、审核统计仍按子项汇总。
- 当前 `api.datasets(true)` 会把回收站条目补默认字段;项目聚合只处理非回收站模式。
- 不要给项目行直接调用 `openDataset(project.path)`,因为父目录 `/data/subtask1_50` 通常不是合法 dataset。
- 项目行删除按钮不要直接批量调用删除接口;第一版隐藏。
- 保持现有 Tailwind 风格和中文界面,不要引入新依赖。
- 不要改 `bridge_ext/ledger.py` 的扫描规则;后端继续返回逐 part 行。

## 8. 验收清单

1. `BASE_PATH=/studio/ npm run build` 通过。
2. 台账页 `/data/subtask1_50/part_0` 到 `part_31` 默认只显示一个 `subtask1_50` 项目行。
3. 项目行数字等于所有 part 子项求和;容量扫描中时不显示错误的 `0.00 GB`。
4. 展开项目后,part 顺序是 `part_0, part_1, ..., part_31` 数字顺序。
5. 子行「进入标注」仍能打开对应 part,标注页、状态条、字典、SAM 不受影响。
6. 子行删除/回收站恢复仍走原来的单数据集流程。
7. 其他不在 `part_N` 规则下的数据集仍按原方式逐行显示。
8. 部署命令必须保留:
   `--exclude bridge.py --exclude bridge_ext --exclude __pycache__`。
9. 重启 `labelvla-studio-integrated` 后手工确认页面无 `h.reduce is not a function` 或其他页面异常。
