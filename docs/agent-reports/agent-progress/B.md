# Agent B · 后端业务 — 已完成 ✅

> 对应 `docs/platform-plan.md` 的 Agent B 任务(台账/状态机/字典/质检/概览)。
> 验收方式:容器内 stub 集成测试 45 项全过 + 容器 `labelvla-studio-integrated` 重启后真实登录态 curl 全链路全过;测试数据已清库,DB 重置为初始状态(仅 admin/admin,首登强制改密)。

## 产出文件(均在 `integration-v2/studio/bridge_ext/`)

| 文件 | 内容 |
|---|---|
| `common.py` | 共享收口:`db_session()`(每请求新连接,退出提交关闭)、`require(request, *roles)`(未登录 401 / 首登未改密 403 / 越权 403)、`data_root()` / `safe_dataset()` / `now_iso()` / `day_of()`。对 `bridge.py` 一律惰性 import,无循环依赖。 |
| `ledger.py` | 台账 `GET /admin/datasets`、回收站 `?trash=1`、`POST /admin/rescan`、软删/恢复。v2/v3 都认;容量后台扫+5 分钟缓存;台账行 60 秒缓存。 |
| `status.py` | episode 状态机 `GET/POST /api/bridge/status`、`GET status/board`。 |
| `dictionary.py` | 四类词表 `GET/POST /dict`,admin `PATCH/DELETE /dict/{id}`。 |
| `qc.py` | `POST /qc/scan`(后台线程,5 规则)、`GET /qc`;新增 `qc_scans` 表(扫描覆盖台账,幂等建表)。 |
| `dashboard.py` | `GET /dashboard`,严格按契约 0.2。 |

`bridge.py` 改动:仅在 A 的注册槽内追加 5 个 `register(app)`,其他未动。

## 接口形状(可直接依赖)

```
GET  /api/bridge/admin/datasets           admin → {datasets: [{path, name, episodes, size_gb, cameras, hours,
                                      counts: {untagged, labeling, review, approved, rejected},
                                      qc: {pass, fail}, updated_at}]}
GET  /api/bridge/admin/datasets?trash=1   admin → {trash: [{name, path, size_gb, deleted_at}]}
POST /api/bridge/admin/rescan             admin → {ok}(清缓存+后台重扫容量)
POST /api/bridge/admin/datasets/delete    admin {path} → {ok, trash};目录移入 /data/.trash/,标注随目录保留
POST /api/bridge/admin/datasets/restore   admin {name} → {ok, path};name 为回收站条目名

GET  /api/bridge/status?dataset&episode   任意角色 → {dataset, episode, status, assignee, reviewer,
                                      reject_reason, updated_at, updated_by}(无记录返回 untagged 默认行)
POST /api/bridge/status                   任意角色 {dataset, episode, status, reason?, assignee?}
GET  /api/bridge/status/board?dataset=    任意角色 → {dataset, episodes: [同上完整行]}

GET    /api/bridge/dict?kind=skill|object|target|adverb   任意角色 → {kind, entries: [{id, kind, name, enabled}]}
                                      (默认只返回 enabled=1;admin 加 &all=1 看待确认)
POST   /api/bridge/dict                   任意角色 {kind, name} → entry;标注员 enabled=0,admin enabled=1,重名去重
PATCH  /api/bridge/dict/{id}              admin {enabled: 0|1}(确认入典/停用)
DELETE /api/bridge/dict/{id}              admin → {ok}

POST /api/bridge/qc/scan                  admin/reviewer {dataset} → {ok, scanning}(后台线程,同数据集防重入)
GET  /api/bridge/qc?dataset=&episode=     任意角色 → {dataset, scanning, scanned_at,
                                      issues: [{episode, rule, severity, detail, frame, created_at}]}

GET  /api/bridge/dashboard                任意角色 → 契约 0.2 完整结构
```

## 关键口径(验收数字以这为准)

- **counts.untagged**:有标注文件但无 `dataset_status` 记录的 episode **自动计入 `labeling`**(否则已标未走状态机的数据集会被显示成全未标);dashboard 的 `status_dist` 与台账 counts 同源求和,两处数字必然一致。
- **容量**:`size_gb` 为 GiB;首次请求可能为 `null`(后台扫描中),5 分钟内补齐;`qc.pass` 在数据集从未扫过质检时为 `null`。
- **质检规则**:`no_box`(error,片段无框)/ `missing_frame_box`(error,片段内有帧无框覆盖,覆盖源 frame_boxes→interpolated_centers→keypoints)/ `out_of_bounds`(error,对照 info.json 相机 shape)/ `area_jump`(warning,相邻帧面积>3 倍)/ `mask_missing`(warning,有框覆盖的帧缺 mask 文件)。每片段每规则只报首帧,避免刷屏。
- **dashboard quality**:`valid/invalid` 单位是**片段**(invalid=未修正 problem 标记,读 segments 扩展字段,与 D 的落地一致,`problem_marks` 表未使用);`error` 单位是 qc_reports 的 error 行数;`fix_rate`=已修正/总问题,无数据时为 `null`。
- **trends**:`data_growth` v2 按 episode 视频 mtime、v3 按 shard mtime×行数;`annotation_growth` 按 segments 文件 mtime 当日的片段数;`qc_trend` 按扫描日聚合;均为近似口径,近 30 天按日分桶补零。

## 事故与修复(全员须知)

1. **rsync 部署曾清掉整个 bridge_ext/**:旧部署命令 `rsync -a --delete --exclude bridge.py --exclude __pycache__` 会删掉不在 dist 里的后端源码(10-29 15:42 实际发生,A 和 B 的文件全没,由 wire 日志抢救回 commit 48947b1)。**部署命令必须带 `--exclude bridge_ext`**,README.txt 与 plan 文档 §3 均已改。
2. **A 的 `db.py` `verify_password` 有必现 bug 已由 B 修复**:`hashlib.sha256(password, salt)` 两位置参数必抛 TypeError(主机/容器均验证),已改为 `compare_digest(sha256((salt+password).encode()).hexdigest(), digest)`。工作区当前是修复版,与 commit 48947b1 里的恢复版不同,提交时留意别被覆盖回去。
3. `users.py` 用的是 **A 的原版**(git 恢复,非 B 重写版):GET users 任意登录角色可读、返回**裸数组**,与 C 的对接以 A 版为准。

## 给其他 agent

- **C**:台账/回收站/字典/状态/质检/概览接口形状见上,全部已在真实容器跑通,可直接联调;字典 `all=1` 仅 admin 生效,其他角色加了也只看到 enabled 的。
- **D**:你提到的「容器内 status/dict 404」已解决(B 已挂载并重启);打回流按 `status.py` 收紧(标注员无 rejected→labeling),与你的前端一致。
- **集成者**:D 报告的「bridge.py 第 111/141 行 segment 级 extras(skill/object/target/adverb/problem)透传缺失」仍未修,那是 Wave 0/bridge.py 红线文件,B 未动;不修则 D 的四项字段和问题标记落盘会丢。
