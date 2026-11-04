# LabelVLA 使用指南

文档站已经接进平台：登录后在顶部导航点 **帮助中心**，或直接访问 `/help/`。

也可以离线看：双击 [site/index.html](site/index.html)，或把整个 `site/` 目录打包发给别人（`demo.html` 里的录屏是内嵌的，离线能播放）。

接入方式：

- 前端 `frontend/src/web/app/platform/PlatformNav.tsx` 的「帮助中心」改为链接 `<a href="/help/">`（原来是无动作的按钮）。
- Dockerfile 把 `tutorial/site/` 复制到镜像的 `/app/static/help/`，由后端既有的静态文件服务提供 `/help/`。
- 页面里的站内链接、样式、图片在运行时按访问前缀改写：平台内走 `/help/…`，本地双击打开则用相对路径；顶部「返回数据平台」在平台内回到 `/`，本地打开时回退到 `LABELVLA_URL`。

## 页面

导航分三组：开始（概览、流程演示）· 操作指南（第 1–6 章）· 参考（常见问题、快捷键、角色与权限）。

| 页 | 内容 |
| --- | --- |
| 概览 | 平台的五个节点、阅读顺序 |
| 流程演示 | 33 秒连续录屏 + 示例数据说明 |
| 1. 登录与数据管理 | 登录、数据集、Episode 状态 |
| 2. 新建标注任务 | 选数据集、分配标注人和审核人、任务详情 |
| 3. 标注工作台 | 界面分区、划片段、描述与目标框 |
| 4. SAM 辅助分割 | 点选、传播跟踪、注意事项 |
| 5. 保存与提交 | 两层保存、提交审核、文件位置 |
| 6. 审核与版本发布 | 视频质检、程序质检、版本记录 |
| 常见问题 / 快捷键 / 角色与权限 | 参考 |

## 目录

```text
tutorial/
├── site/                 # 文档站（index.html 为入口）
│   ├── nav.json          # 左侧导航配置
│   ├── pages.py          # 各页正文
│   ├── assets/style.css  # 共用样式
│   └── *.html            # 由 pages.py 生成，不要手改
├── build_site.py         # 生成 site/*.html（同时把 images/ 复制到 site/images/）
├── images/               # 截图（1600×960 JPEG）与录屏封面
├── videos/tutorial.mp4   # 录屏成品（1280×768，约 33 秒）
└── tools/                # 截图与录制脚本
```

改内容：编辑 `site/pages.py` 或 `site/nav.json`，然后 `python3 tutorial/build_site.py`。

## 录屏是怎么做的

无头 Chrome 操作真实页面，逐步截 JPEG 作为视频帧，再用 ffmpeg 按 25fps 合成；页面上方的黑条是脚本注入的步骤说明，点击位置用圆圈标出，不使用系统光标。

刻意避开闪烁的做法：

- 不插整屏卡片、不做黑场淡入淡出，只在同一页面里连续操作；
- 静止画面按 20fps 录制，避免大片纯色区域在压缩时忽然变暗；
- 分段按 crf 18 单独压制，再缩放到 1280×768 拼接。

## 重新生成

前置：平台运行在 `http://127.0.0.1:8002`，管理员 `admin / admin123`，演示账号 `zhang / demo123`（标注员）、`lily / demo123`（审核员）。

```bash
# 出页（改了 site/pages.py 或 nav.json 之后）
python3 tutorial/build_site.py
# 让平台帮助中心生效：重新构建并启动
bash scripts/start.sh

# ---- 需要重新录素材时才用下面的步骤 ----
# 演示数据（3 条 Episode，约 9 MB）
/home/robam/miniconda3/envs/lerobot/bin/python tutorial/tools/gen_templates.py

# 账号与任务
python3 tutorial/tools/setup_demo_users.py   # 建 zhang / lily
python3 tutorial/tools/fix_users.py          # 重置演示账号密码
python3 tutorial/tools/mk_task.py            # 新建演示任务，记下任务 ID

# 截图（输出到 images/）
cd tutorial/tools && npm install
TASK_ID=<任务ID> node shots.mjs
TASK_ID=<任务ID> node sam_stills.mjs

# 录屏：三段依次录，每段录完把 .work/frames 压成 mp4
TASK_ID=<任务ID> node rec_doc_1.mjs   # 登录 → 建任务 → 进工作区
TASK_ID=<任务ID> node rec_doc_2.mjs   # 划片段 → 描述 → 目标框 → 提交
TASK_ID=<任务ID> node rec_doc_3.mjs   # 审核 → 程序质检 → 发布 → 版本记录
# 合成：ffmpeg -framerate 25 -i .work/frames/%05d.jpg -c:v libx264 -crf 18 ...
# 拼接后写入 videos/tutorial.mp4

# 出页
python3 tutorial/build_site.py
```

`rec_doc_3.mjs` 需要任务处于「人工验收」节点：先 `save_demo.mjs` 完成保存，再在任务详情页点「完成人工标注」。

## 注意

- 教程第 3 节写明：界面底部提示的 `Q / R / Enter` 片段快捷键在当前版本没有生效，只能用鼠标点轨道和拖拽边界。
- 截图里主账号显示为 `admin · 管理员`，这是演示环境的实际情况；管理员账号是 `admin` / `admin123`（未改过密码的新部署初始为 `admin`）。
- 演示数据在 `data/tutorial_demo_template/`，演示任务可在「任务管理」里查看；`reset_demo.py` 能把任务复位，不需要时直接删除即可。
