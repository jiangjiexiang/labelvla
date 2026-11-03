# LabelVLA 前端

Studio 工作台、数据管理和标注界面源码位于 src/。

从项目根目录执行 `bash scripts/start.sh`，前后端一起构建部署。
前端单独开发：先运行 `npm ci`，然后运行 `npm run dev` 或 `BASE_PATH=/ npm run build`。

scripts/vite 是构建所需插件；tests、examples、etc 保留现有测试和 API 检查所需的文件。
上游版权与许可证见 LICENSE、NOTICE。
