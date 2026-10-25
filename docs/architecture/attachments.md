# T15 主动截图与视觉附件

@「截取当前帧」或 composer 添加按钮打开本次授权说明；取消不读取像素。确认后复用可选 B 站权限，捕获原绑定视频当前帧，不 pause/seek。T02 隔离 guard 与 MAIN 媒体证据在捕获前后检查 document/BV/cid/video/currentSrc；透明帧最多等 2 秒，合法黑帧接受，污染画布明确拒绝。

S4 增加 attachment.capture/read；只接收目标、绑定、revision 和本次同意标记，不接收网页上传像素。普通网页无入口，reader 只能读固定空间的历史图片。S2 v8 attachments 表保存不可变 PNG data URL（实际编码字节）、hash、尺寸、时间与 workspace/chat/媒体来源。写原草稿事务检查目标有效、来源与 revision；冲突拒绝，不覆盖新输入。移除只改草稿关联，发送原子冻结 ID 到消息/请求并清草稿。历史及重试从实体读取，删除恢复继承父 Chat/空间；T21 清理白名单不含附件。

每次含历史的完整请求最多 6 张、单图 1 MiB、合计 4 MiB；尺寸最大边 1280、总像素 921600。接收/导入/发送校验 PNG CRC、尺寸、受限解压与 hash；发送按实际重复次数计预算，超限拒绝。长字幕归纳调用只传文字，最后调用保留全部图片。ProviderMessage 兼容 string 或 text/image_url 数组，使用现有 ProviderPort、SSE、取消/失败/重试。视觉能力必须 declared；unknown/unsupported 显示阻塞，不猜模型名或静默降级。UI 不读 Key。图片用 data URL 展示，组件离开清引用，无临时对象 URL。

[DeepSeek 官方视觉协议](https://api-docs.deepseek.com/guides/vision/)（2026-10-15 读取）说明多图 content parts 与 Base64 data URL。当前模型目录仍只信服务返回的 input_modalities；若服务不声明则 unknown，本批不新增付费探测或伪造生产能力。受控安装夹具的视觉目录仅用于本机 HTTP 请求验收。

当前备份 formatVersion=3/databaseVersion=8 包含图片实体及字节，兼容 v1/db7 无附件包和 v2/db8；Chat 冲突组映射所有草稿/消息/冻结历史/请求 ID。20 MiB 编码总包上限沿用，损坏/缺图/跨归属拒绝，导入不调用模型。详见 backup.md。T09交互知识与追问依赖已接通备份；T16自主视觉已集成：自动图片归attempt，最终阶段冻结后随重试复用，未完成阶段不继承旧授权；grant／lease仅session，不进备份。一次可见初始化／后台取帧见[自主视觉契约](autonomous-vision.md)。联网与真实视觉质量仍未实现或未验收。
