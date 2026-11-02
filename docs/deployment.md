# LabelVLA 部署、更新与迁移

本文对应当前“基础镜像 + 平台目录挂载”的部署方式。镜像：`ghcr.io/jiangjiexiang/labelvla:0.2.1`，架构：`linux/amd64`。ARM 主机需要另外验证依赖或构建适配镜像。

## 1. 准备环境和源码

准备 Docker Engine、Git、Node.js 和 npm。前端声明的包管理器版本见 `integration-v2/studio-src/package.json`；建议使用与开发环境一致的版本。

```bash
git clone https://github.com/jiangjiexiang/labelvla.git labelvla-docker
cd labelvla-docker
mkdir -p data
```

检出包含所需平台代码的分支或提交。尚未提交、推送的服务器改动不会出现在新克隆中。

GHCR 包为私有时需要先登录。使用具有包读取权限的 GitHub Token，按交互提示输入；不要填写 GitHub 账号密码。

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
docker pull ghcr.io/jiangjiexiang/labelvla:0.2.1
```

## 2. 构建前端

```bash
cd integration-v2/studio-src
npm ci
BASE_PATH=/ npm run build
rsync -a --delete \
  --exclude bridge.py \
  --exclude bridge_ext \
  --exclude __pycache__ \
  dist/ ../studio/
cd ../..
```

构建部署在网站根路径，因此必须设置 `BASE_PATH=/`。同步时必须保留 `bridge.py`、`bridge_ext/`；它们是平台后端源码，不在 `dist/` 中。执行前确认当前位于正确目录，`rsync --delete` 会删除目标中的非排除旧文件。

## 3. 放置数据并启动

将 LeRobot 数据集放在 `data/` 下，每个数据集保持完整目录结构，例如：

```text
data/
└── example_dataset/
    ├── meta/info.json
    ├── data/
    └── videos/
```

不同版本的数据文件组织可能不同，迁移时复制完整数据集，不手工重排。

在仓库根目录执行（Linux）：

```bash
docker run -d \
  --name labelvla-studio-integrated \
  --restart unless-stopped \
  --user "$(id -u):$(id -g)" \
  -p 8002:8000 \
  -e PYTHONPATH=/integration/studio \
  -v "$PWD/data:/data" \
  -v "$PWD/integration-v2/studio:/integration/studio:ro" \
  --entrypoint python \
  ghcr.io/jiangjiexiang/labelvla:0.2.1 \
  -m uvicorn bridge:app --host 0.0.0.0 --port 8000
```

确保运行用户对宿主机 `data/` 有读写权限。浏览器访问 `http://服务器IP:8002/`。已有同名容器时先检查其配置，更新代码通常只需重启，不要重复创建。

当前首次初始化的管理员账号为 admin，初始密码为 admin；已有数据库沿用原账号。初始化逻辑请以 `bridge_ext/db.py` 为准，首次登录后按界面要求修改密码。服务重启会使内存中的登录会话失效，需要重新登录。

## 4. 可选：SAM 分割服务

SAM 推理服务独立于本镜像运行，镜像不包含完整 SAM 推理部署。使用此功能前，按 [SAM 接口约定](sam3-api-requirements.md) 准备服务，创建平台容器时添加：

```bash
-e SAM_BASE=http://YOUR_SAM_HOST:8310
```

地址必须能从平台容器内部访问。应显式配置目标地址；未配置时，当前代码可能使用开发环境默认地址。普通浏览和人工标注不依赖 SAM 推理服务。

## 5. 检查部署结果

```bash
docker ps --filter name=labelvla-studio-integrated
docker logs --tail 100 labelvla-studio-integrated
curl -I http://127.0.0.1:8002/
```

首页返回成功只说明服务可访问。还应实际登录，选择数据集，播放视频，保存并重新加载标注，再检查审核和质检；启用 SAM 后单独验证分割与传播。

任务队列和登录会话目前使用内存状态。容器重启后不会自动续跑未完成任务，应检查任务状态并通过界面的重试入口恢复。

## 6. 更新代码

更新前先查看 `git status`，保留本地修改并备份运行数据，再获取所需分支或提交。

- 后端 `studio/bridge.py` 或 `studio/bridge_ext/` 更新后：重启容器。
- 前端 `studio-src/` 更新后：按第 2 节重新构建、同步，再重启容器。
- 修改 Python 或系统依赖时：需要构建包含新依赖的镜像，并按原挂载配置重新创建容器；仅重启不会安装依赖。

```bash
docker restart labelvla-studio-integrated
```

当前没有在本文配置自动部署。`git pull` 不会自动构建前端或重启服务。

## 7. 备份与迁移

迁移需要准备三部分：镜像、完整项目代码和 `data/`。数据库、标注、导出文件均应随运行数据一起备份。为获得一致备份，在无活动任务时停止容器后复制数据；恢复前核对目录所有者和权限。

新机器可以直接拉取 GHCR 镜像；无网络环境可使用：

```bash
# 源机器
docker save -o labelvla-0.2.1.tar ghcr.io/jiangjiexiang/labelvla:0.2.1
# 目标机器
docker load -i labelvla-0.2.1.tar
```

镜像归档不包含挂载代码与数据。复制项目和数据后，按第 2、3 节构建并创建容器，执行第 5 节验收。不要把数据集、账号数据库或 Token 上传到 Git 仓库。

## 8. 镜像仓库关联

构建发布镜像时保留来源标签：

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/jiangjiexiang/labelvla"
```

仓库提交与镜像标签是独立的：提交代码不会自动更新 GHCR 镜像。当前 `0.2.1` 镜像仍需要挂载平台代码；后续发布应记录对应源码提交，以便复现。
