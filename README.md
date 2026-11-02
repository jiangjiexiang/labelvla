# LabelVLA 数据标注平台

面向 VLA（视觉·语言·动作）数据制作的本地 Web 平台。基于 LabelVLA 与 LeRobot Studio 集成，围绕 LeRobot 数据集提供浏览、片段标注、目标框与轮廓标注、审核和质检能力。

- 源码：[jiangjiexiang/labelvla](https://github.com/jiangjiexiang/labelvla)
- 镜像：[GitHub Container Registry](https://github.com/users/jiangjiexiang/packages/container/package/labelvla)
- 部署与迁移：[部署文档](docs/deployment.md)

## 平台功能

| 模块 | 功能 |
| --- | --- |
| 数据管理 | 读取 LeRobot v2.x / v3.0 数据集，查看 episode、视频和数据集台账 |
| 标注工作台 | 视频播放、逐帧查看、动作片段划分、文本描述、目标框与运动关键点 |
| 智能分割 | 对接外部 SAM 服务，支持点选分割与传播跟踪 |
| 标注规范 | 技能、对象、目标、状语词典，以及问题标注 |
| 账号与审核 | 管理员、标注员、审核员角色；提交审核、通过和打回 |
| 自动质检 | 检查片段无框、缺框帧、框出界、面积突变和轮廓缺失 |
| 任务流水线 | 数据预检查、人工标注、质检、打包及产物版本记录 |
| 平台概览 | 数据集和标注进度统计 |

典型流程：导入数据集 → 浏览 episode → 标注片段与目标 → 提交审核 → 质检 → 打包产物。

以上是当前代码提供的能力范围，各功能仍应结合实际数据验收；SAM 需要单独部署推理服务。平台本身不负责训练 VLA 模型。

## 数据与部署方式

保留 LeRobot 原生数据结构；标注使用数据集内的 `segments/episode_*.json`，平台管理信息另存。运行时 `/data` 挂载宿主机数据目录，平台数据库位于 `/data/.platform/platform.db`。

当前发布镜像 `ghcr.io/jiangjiexiang/labelvla:0.2.1` 是 Linux amd64 基础程序与依赖环境。新版平台的前端构建结果和 Python 桥接服务通过 `integration-v2/studio/` 挂载进容器。**只拉取镜像不能得到当前完整平台，必须同时准备源码、前端构建结果及数据目录。**

## 项目结构

```text
labelvla-docker/
├── integration-v2/
│   ├── studio-src/       # 前端源码及构建配置
│   └── studio/           # 前端构建结果与平台后端
│       ├── bridge.py
│       └── bridge_ext/   # 登录、台账、审核、词典、质检、任务等
├── labelVLA-main/        # LabelVLA 基础代码
├── data/                 # 数据集与运行数据（Git 忽略）
└── docs/                 # 部署、设计及接口文档
```

`studio/assets/` 属于构建产物，不纳入 Git。首次部署需要构建前端；开发与更新步骤见[部署文档](docs/deployment.md)。数据集、账号数据库、导出产物和密钥不应提交到源码仓库。

## 相关文档

- [部署、更新与迁移](docs/deployment.md)
- [平台设计](docs/platform-design.md)
- [开发任务拆分](docs/platform-plan.md)
- [SAM 接口约定](docs/sam3-api-requirements.md)

本项目集成多个上游组件，使用及分发时请保留各组件的许可证与版权声明。
