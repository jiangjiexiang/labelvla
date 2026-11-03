# 2026-11-03 目录与部署统一

当前运行目录：`/home/robam/labelvla-docker`。

- 前端源码：frontend。
- 统一后端：backend/bridge.py、backend/bridge_ext、backend/labelme。
- 默认部署：根目录 Dockerfile 和 compose.yaml，镜像 labelvla-unified:local，端口 8002。
- 数据保持原路径 data、output；未搬迁原始数据和已有版本。
- 修改代码后执行 `bash scripts/start.sh`，重新构建并启动。单独重启容器不会加载宿主机代码修改。

迁移前源码、原有未提交修改、Docker 配置和数据库备份位于：
`/home/robam/labelvla-docker-backups/unified-layout-20261103`。
旧 integration-v2 已移动到该备份目录，旧容器保留为 labelvla-studio-integrated-before-unified-20261103。

如需回退部署，先停止并重命名当前容器，恢复备份目录中的 integration-v2 到项目原路径，再将旧容器恢复原名并启动。旧容器需要该宿主机挂载目录。数据库备份仅供必要时恢复；不要覆盖迁移后产生的标注数据。

迁移过程中已完成完整镜像构建并观察到服务启动完成。用户要求自行进行后续测试，因此切换后未执行功能测试或操作网页。
