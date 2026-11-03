# 统一部署与开发

项目由一个根目录 Dockerfile 构建：Studio 前端位于 `frontend/`，LabelVLA 数据引擎和平台 API 均位于 `backend/`。运行镜像包含前后端完整代码，不依赖旧镜像里的隐含源码或宿主机构建产物。

## 启动

准备 Docker Engine 和 Docker Compose。首次启动需要联网下载 Node/Python 基础镜像、npm 依赖及 Python 依赖，不要求宿主机安装 Node。

```bash
cd /path/to/labelvla-docker
mkdir -p data/.platform output
bash scripts/start.sh
bash scripts/check.sh
```

默认地址 `http://服务器IP:8002/`，容器名 `labelvla-studio-integrated`。更改端口或运行用户：

```bash
LABELVLA_PORT=8002 LABELVLA_UID=$(id -u) LABELVLA_GID=$(id -g) docker compose up -d --build
```

确保运行用户能读 data，并能写 `data/.platform` 和 output。SAM 推理独立部署，可通过 `SAM_BASE=http://服务器:8310` 配置，默认沿用既有地址。初次初始化账号见后端 `bridge_ext/db.py`，已有数据库沿用原账号；重启后需重新登录。

## 修改与更新

- 前端：`frontend/src/`。
- 平台后端：`backend/bridge.py`、`backend/bridge_ext/`。
- LabelVLA 引擎：`backend/labelme/lerobot/`、`backend/labelme/lerobot_server/`。
- Web Python 依赖：根目录 `requirements.lock`。不安装上游桌面版依赖。

修改任何一部分后，在根目录执行 `bash scripts/start.sh`，重新构建并更新服务。默认不挂载源码，单独 `docker restart` 不会加载宿主机的新代码。

前端独立开发可进入 frontend，运行 `npm ci`、`BASE_PATH=/ npm run build`。构建产物只位于 `frontend/dist/`；镜像内复制到 `/app/static`，后端不会写入这个目录。

## 检查与测试

```bash
bash scripts/check.sh
bash scripts/test.sh
docker compose logs --tail 100 app
```

测试镜像使用临时数据和数据库，不挂载生产 data/output，不发送真实通知。包含任务流程、保存副本、真实视频裁剪、Parquet/标注映射及版本隔离测试。健康检查只能证明服务可访问；浏览器登录、播放与保存仍需单独验证。

## 数据与备份

- `data/<名称>`：原始数据，容器内只读。
- `data/.platform`：平台数据库和旧任务数据，单独读写挂载。
- `output/<名称>/<名称>vN`：新任务完整版本，读写挂载。

完整备份包括代码、data 和 output；在无活动任务时停止服务再复制，可获得一致快照。镜像不包含数据集、平台数据库或账号密码。数据流程见 [数据集保存与版本](dataset-versions.md)。

## 目录迁移对照

| 原路径 | 当前路径 |
| --- | --- |
| integration-v2/studio-src | frontend |
| integration-v2/studio/bridge.py | backend/bridge.py |
| integration-v2/studio/bridge_ext | backend/bridge_ext |
| labelVLA-main/labelme | backend/labelme |
| integration-v2/tests | tests/backend |
| integration-v2/studio/assets | frontend/dist/assets（构建产物） |

上游许可证保存在 frontend/LICENSE 和 backend/LICENSE，分发时一并保留。历史部署说明已从项目删除，备份保存在项目外。


## 构建依赖下载与缓存

Python 依赖默认从阿里云 PyPI 镜像安装，可用构建参数 PIP_INDEX_URL 覆盖。robam 的本地 .env 通过 LABELVLA_DEPENDENCY_IMAGE 复用本机当前 labelvla-unified:local 镜像中已有的依赖；pip 仍会按 requirements.lock 校验版本，缺失或变更的依赖使用阿里云源。构建会清除缓存镜像内的旧前后端代码，再复制当前项目源码与构建结果。其他机器未配置该变量时默认从 python:3.11-slim 干净构建。
