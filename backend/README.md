# LabelVLA 后端

- bridge.py：统一 Web 服务入口。
- bridge_ext/：用户、任务、保存、版本、质检等平台接口。
- labelme/：LabelVLA 数据集与标注引擎。

Web 依赖由项目根目录 requirements.lock 管理，从根目录 Dockerfile 构建。
上游许可证与引用信息保留在 LICENSE 和 CITATION.cff。
