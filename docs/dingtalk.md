# 钉钉任务发布通知

新建任务成功并分配负责人后，系统安排一次发布通知。任务重试、刷新和重启不会自动重复通知历史任务。

当前默认关闭，不发送消息。用户管理中由管理员为负责人绑定钉钉 UserID；该人员必须在机器人所在群中。平台用户名不等于钉钉 UserID。

容器启用时需要注入以下环境变量（真实凭据只放部署环境，不提交 Git）：

```dotenv
DINGTALK_ENABLED=false
DINGTALK_WEBHOOK=https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN
DINGTALK_SECRET=YOUR_SIGNING_SECRET
PLATFORM_PUBLIC_URL=http://YOUR_HOST:8002
```

后续确认发送授权后再将 DINGTALK_ENABLED 改为 true，并重新创建容器使环境变量生效。当前并未替现有容器启用发送。

消息通过 HMAC-SHA256 加签，包含任务名、数据集、负责人和平台入口，只 @所分配的人员，不 @全体。通知状态保存在 task_notifications，结果写入执行事件。未绑定、未启用或配置缺失会记录未发送；发送异常记录失败，不影响任务创建。

为避免网络超时导致重复消息，每个任务只尝试一次，不自动补发。服务在发送过程中退出可能留下 sending 状态，需人工核查；当前没有自动重试或批量补发功能。

参考：https://open.dingtalk.com/document/robots/custom-robot-access
