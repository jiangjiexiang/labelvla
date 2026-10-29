# SAM 3.1 视频分割服务 —— 接口需求文档

> 给 SAM 服务端的开发同学。我们是标注工具侧(调用方),本文档定义我们需要你提供的 HTTP 接口。
> 服务部署在 Docker 内、独占 GPU,只有我们后端会调用(服务器对服务器,不需要 CORS)。

## 0. 总体约定

| 项 | 约定 |
|---|---|
| 交互方式 | HTTP + JSON;mask 图像用 PNG |
| 坐标系 | **所有坐标一律使用原始视频分辨率的像素坐标**。服务端内部做任何缩放(如压到 1280),对外透明 |
| 会话制 | 一个视频一个会话(sid),会话内可跟踪多个对象(object_id) |
| 长任务 | 传播(propagate)耗时可能几十秒到几分钟,必须异步化:提交后返回 task_id,调用方轮询进度 |
| 并发 | 可以假设单用户串行使用;服务端内部串行化推理即可 |
| 模型就绪 | 模型加载是慢操作,提供 health 接口供我们等待/探活 |

## 1. 接口列表

### 1.1 健康检查

```
GET /api/sam/health
```

响应:

```json
{ "ready": true, "model": "sam3.1", "gpu": true, "error": null }
```

模型未加载完时 `ready: false`;加载失败时 `error` 给出原因。

### 1.2 创建会话(上传视频)

```
POST /api/sam/session
Content-Type: multipart/form-data
字段: video = <mp4 文件>
```

服务端抽帧(可缓存:按内容 MD5,重复上传同一视频直接复用)。响应:

```json
{
  "sid": "a1b2c3",
  "num_frames": 340,
  "width": 1920,
  "height": 1080,
  "fps": 30
}
```

`width/height` 是**原始视频**分辨率,后续所有坐标都以它为基准。

### 1.3 点提示分割

```
POST /api/sam/{sid}/click
```

请求:

```json
{
  "frame": 120,
  "points": [{ "x": 540, "y": 320, "positive": true }],
  "object_id": null
}
```

- `object_id` 为 null → 新建对象,服务端分配 id;传入已有 id → 给该对象追加修正点
- 支持一次多个正/负点
- 同一对象再次点击(换帧或加负点)即修正该对象

响应:

```json
{
  "object_id": 1,
  "frame": 120,
  "bbox": { "x": 400, "y": 210, "w": 280, "h": 220 },
  "mask_url": "/api/sam/a1b2c3/mask/120/1.png",
  "score": 0.91
}
```

`bbox` 为该帧 mask 的外接矩形(原始分辨率)。首次点不出目标时服务端可自行重试。

### 1.4 文本提示分割

```
POST /api/sam/{sid}/text
```

请求: `{ "frame": 0, "text": "red cube" }`

响应:

```json
{
  "objects": [
    { "object_id": 2, "bbox": {"x":0,"y":0,"w":0,"h":0}, "score": 0.88,
      "mask_url": "/api/sam/a1b2c3/mask/0/2.png" }
  ]
}
```

文本作为该对象的 label 记住(见 1.10)。

> ⚠️ 已验证的模型行为(SAM 3.1 multiplex):**文本提示和点提示不要在同一会话混用**。
> 文本走 VG(视觉定位)传播、点走 tracker 传播,混合会话里 propagate 只输出其中一路,
> 且文本对象存在时点提示的当次响应可能不含新对象。建议:文本流和点选流各自开独立会话。

### 1.5 传播(跟踪到整个视频)—— 异步

```
POST /api/sam/{sid}/propagate
```

请求: `{ "object_id": 1 }`(null 或省略 = 会话内所有对象)

> 实现说明:SAM 的传播本身是整段视频、全对象一起算的,`object_id` 仅作语义标记;
> 即使只传一个对象,其余已提示对象也会一并传播完成。

以各对象的提示帧为起点,向前+向后双向传播到整个视频。响应:

```json
{ "task_id": "t-xxx" }
```

### 1.6 任务进度查询

```
GET /api/sam/task/{task_id}
```

响应:

```json
{
  "status": "running",          // pending | running | done | failed
  "done_frames": 180,
  "total_frames": 340,
  "fps": 12.5,                  // 处理速度,便于前端显示预计剩余时间
  "error": null
}
```

### 1.7 批量取外接框(传播完成后调用)

```
GET /api/sam/{sid}/bboxes/{object_id}
```

响应:

```json
{
  "object_id": 1,
  "boxes": [
    { "frame": 0, "x": 410, "y": 205, "w": 275, "h": 218 },
    { "frame": 1, "x": 412, "y": 206, "w": 276, "h": 219 }
  ]
}
```

- 只包含有 mask 的帧;某帧目标消失则该帧缺席
- **必须批量一次返回**,不接受逐帧请求(300+ 帧逐帧拉不可行)

### 1.8 取单帧 mask(前端叠加显示用)

```
GET /api/sam/{sid}/mask/{frame}/{object_id}.png
```

- RGBA PNG,**尺寸 = 原始视频分辨率**,目标外 alpha=0(前端用 source-in 上色)
- 传播完成后任意帧可取
- 建议带 HTTP 缓存头

### 1.9 删除对象 / 关闭会话

```
DELETE /api/sam/{sid}/object/{object_id}   // 删除该对象全部帧的 mask
DELETE /api/sam/{sid}                       // 关闭会话,释放显存
```

### 1.10 会话状态(可选但建议)

```
GET /api/sam/{sid}
```

返回会话内对象列表:`{ "objects": [{"object_id":1, "label":"red cube", "prompt_frame":120, "propagated":true}] }`,便于断线重连后恢复现场。

## 2. 错误格式

统一:

```json
{ "detail": "human readable message" }
```

- 404: sid / object_id / frame 不存在
- 409: 会话已关闭、传播中与点击冲突等状态错误
- 500: 推理失败,`detail` 带具体异常信息

## 3. 非功能需求

1. **显存管理**:会话长期不用要能手动 DELETE 释放(见 1.9),服务端可加闲置超时回收,但建议 ≥ 30 分钟
2. **响应时延参考**(1080p 视频,单卡):
   - click: ≤ 2s
   - propagate:不限制,但进度接口要实时
   - mask / bboxes 拉取: ≤ 200ms
3. **稳定性**:连续处理多个视频不泄漏显存(我们会逐个开/关会话)
4. **时间戳/缓存**:抽帧按内容 MD5 缓存,同一视频重复建会话应秒回

## 4. 调用方时序(供你理解使用方式)

```
POST /api/sam/session          (上传 episode mp4, 拿 sid)
POST /api/sam/{sid}/click      (用户在第 120 帧点一下目标)
GET  mask PNG                  (前端叠加显示分割效果)
POST /api/sam/{sid}/propagate  → task_id
GET  /api/sam/task/{task_id}   (轮询直到 done)
GET  /api/sam/{sid}/bboxes/1   (一次拿回全部帧的框,写入标注数据)
GET  /api/sam/{sid}/mask/...   (可选:把 mask 逐帧存盘)
DELETE /api/sam/{sid}          (用户切换 episode 时)
```
