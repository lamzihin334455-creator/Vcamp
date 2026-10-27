# API 连接与模型

在主设置菜单打开 **API 设置**。顶部和主菜单中的模型切换器都只显示已经录入的模型，模型名后标注服务商；同一服务商保存多个 Key 时还会标注连接名称。

图文操作位置见 [连接服务与录入模型](usage.md#连接服务与录入模型)。

## 设置流程

1. **连接服务**：选择服务商，填写 API Key，保存。预设会填好 Base URL，也可以修改；每个 Key 单独保存为一条连接。
2. **管理模型**：点击对应连接，拉取模型，勾选需要的模型并录入。录入后会自动选用默认模型，可以直接返回对话。

拉取列表按完整模型 ID 去重。未录入的模型不会出现在应用模型切换器中。模型很多时，可以在录入列表搜索完整 ID 或名称。

在已录入模型右侧点击垃圾桶可移除模型，不会删除 Key。每张连接卡片上的“删除”会删除整条连接及其本机保存的 Key、模型列表。删除当前连接时会优先切到仍有可用默认模型的连接；删除其它连接不会切换当前模型。

“更多设置”中可修改连接名称，或手动填写完整模型 ID。服务商没有模型列表接口时，也能手动录入；这不表示连接或模型已经通过实际调用验证。

## 服务地址

| 服务商 | 默认 Base URL |
| --- | --- |
| DeepSeek | `https://api.deepseek.com` |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 商汤日日新 | `https://token.sensenova.cn/v1` |
| 自定义 | 自行填写 OpenAI 兼容服务地址 |

新连接只提供 DeepSeek、阿里云百炼、商汤日日新和自定义。以前保存的硅基流动、智谱连接继续可用；新增这些连接时选择自定义，并填写服务商提供的兼容地址。

填写 HTTPS Base URL，保留 `/v1` 等接口前缀，不要追加 `/models`、`/chat/completions`，不要在 URL 中包含 Key 或查询参数。百炼默认北京公共地址；业务空间专属域名及其它地域应使用控制台提供的对应地址和该地域 Key。

商汤预设对应 [SenseNova API 服务平台](https://platform.sensenova.cn/docs#list-models)。如果使用旧版 SenseCore ModelStudio 账号，可自定义为 `https://api.sensenova.cn/compatible-mode/v2`；该地址下模型列表通过同域的 `/v1/llm/models` 获取，对话仍使用兼容模式。参考 [SenseCore 兼容接口](https://www.sensecore.cn/help/docs/model-as-a-service/nova/overview/compatible-mode) 和 [模型列表](https://console.sensecore.cn/micro/help/docs/model-as-a-service/nova/overview/Models/GetModelList/)。不同平台的 Key 不通用；本设置接受 API Key，不负责将 AK/SK 签发成临时 Token。

## 浏览器权限与 Key

预设服务商地址随扩展声明，保存时不再申请浏览器权限。已授权的自定义域名也直接保存；首次使用其它自定义域名时，Chrome 仍可能要求一次地址访问授权。这是浏览器安全权限，不是保存成功通知。拒绝授权时原配置保留。扩展更新时的权限确认由 Chrome 控制。

Key 只保存在本机浏览器的受限扩展存储中，不进入对话、资料备份或导出。请求只发往对应连接地址，不跟随重定向。

## 功能范围

DeepSeek V4.1 是专项优化目标。DeepSeek 官方服务保留现有联网与已声明的视觉能力；联网还需要在同一连接下录入 `deepseek-flash` 检索模型。

其它服务商及自定义地址目前支持 OpenAI 兼容的流式文本对话，暂不开放联网、图片输入和自主画面识别，无需额外配置搜索或视觉 Key。切换到这些连接会关闭当前草稿中的联网、画面识别开关。已有历史图片的对话应改用支持视觉的 DeepSeek 模型，或新建文本对话。

模型列表中可以同时含有文本、图片、音频等模型。仅支持图片或音频输出的模型不能作为文本模型录入；这类条目不会让整份列表拉取失败。

## 拉取失败

- 认证失败：核对 Key、账号平台和地域是否一致。
- 网络或超时：检查地址、服务状态和本机网络后重试。
- 响应格式不支持：确认 Base URL 指向 API，服务应返回包含 `data` 模型数组的 JSON；不要填写控制台网页地址。
- 服务不提供列表：在“更多设置”填写完整模型 ID，然后通过实际对话验证。

排错时请勿公开 API Key。需要反馈列表兼容问题时，只提供去掉敏感字段的响应结构与服务地址。

## 已能拉取模型，但对话失败

模型目录读取成功与具体模型调用是不同请求。客户端会使用所选连接保存的同一 Key、Base URL 和完整模型 ID；生成仍可能收到服务商的拒绝响应。

0.1.71 兼容商汤单选项流式分块省略 index 的格式，仍要求正常结束标记。

0.1.71 起不再把所有 HTTP 403 归为认证失败。已识别的模型权限、业务空间权限、免费额度用完即停、余额或计费状态分别显示原因；未知拒绝至少保留 HTTP 状态。HTTP 401 仍提示核对 Key 与地址匹配。不要仅凭旧版“认证失败”就删除连接或更换 Key。

在失败消息展开“失败详情 / 重试”，下载诊断文件。新版包含服务商标识、模型 ID、HTTP 状态及已识别的错误码，不保存任意服务端错误原文、Key 或自定义地址。旧版任务缺失的数据无法补回，需要更新后重试一次。

参考：[百炼错误码](https://help.aliyun.com/zh/model-studio/error-code)、[SenseNova API](https://github.com/OpenSenseNova/SenseNova6.8/blob/main/API_CN.md)、[SenseNova 限流与额度说明](https://github.com/OpenSenseNova/SenseNova-Skills/blob/main/docs/faq_CN.md)。

## 商汤 HTTP 429 与请求次数（0.1.72）

0.1.72 起，商汤连接在本地整理本次资料，普通文本回答只请求模型一次。保留完整主字幕、必要历史、模板要求和用户明确启用的资料；不再额外请求模型判断是否补充简介、章节或评论。百炼和 DeepSeek 官方的资料规划流程沿用原设置。

HTTP 429 表示服务端限流或额度受限，不能仅凭状态码判断具体额度是否耗尽。扩展不会自动重试或自动换模型；如果服务端返回可识别的 `Retry-After` 秒数，会显示本次建议等待时间，并记录到诊断中。该时间不是持续倒计时，也不保证等待后服务一定可用。

商汤当前官方模型表将 DeepSeek V4.1 Flash（1017）列为 `deepseek-flash`，参考 [模型总览](https://platform.sensenova.cn/docs#models-overview)。0.1.74 起，官方地址 `https://token.sensenova.cn/v1` 拉取到的 `deepseek-v4.1-flash` 自动按该调用 ID 录入并去重；已有连接、默认模型和旧任务重试同步兼容，无需手动录入名称。`deepseek-v4-flash` 是独立的 V4 Flash，保留原 ID，不自动替换成 V4.1。其它服务商和代理地址不改写。目录可读取不等于每个模型均有调用权限；真实账号的 403、429 仍以服务端授权、限流或额度响应为准。

## 长输出与思考（0.1.73）

Chat、Markdown 和 HTML 不再使用旧的 4096 token 回答限制或第三方统一 8192 token 限制。DeepSeek 官方及百炼已知 DeepSeek V4 系列按 393216 token 的可用上限发送；模型目录提供有效 `max_output_tokens` 时使用该模型声明的能力。未知兼容模型不强塞可能被拒绝的大参数，交由服务商默认设置；其默认值仍可能较低，不能视为无限输出。

上限不是篇幅目标。最终提示词不包含具体额度数字，要求按任务、角色和模板决定详略、完成即可结束，不为可用空间增加重复内容、无关章节或推理强度。DeepSeek 官方保持 `thinking.type=disabled`；百炼及硅基流动已知 DeepSeek V4 混合思考模型使用文档支持的 `enable_thinking=false`，不设置更高 `reasoning_effort` 或 `thinking_budget`。其它未知模型沿用已有服务端行为，不注入未经确认的专有参数；模型若只支持推理模式，客户端不能承诺关闭其内部推理。

长输出的接收、检查点、聊天消息、笔记编辑、HTML 预览与备份恢复同步扩容。400 万字符是浏览器数据结构的工程边界，不是模型应生成的长度。普通生成不再按累计 10 分钟结束；连续 3 分钟没有收到服务数据才按连接停滞处理，用户仍可随时停止。

本次调整不添加自动续写、重试或新一轮模型调用。服务商明确截断、断网或返回不完整 HTML 时仍如实提示，不把半成品当成成功页面。服务侧额度、限流和模型上下文上限仍以实际响应为准。

参数依据：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[模型能力字段](https://api-docs.deepseek.com/api/list-models/)、[百炼 DeepSeek 参数](https://help.aliyun.com/zh/model-studio/deepseek-api)、[硅基流动参数](https://docs.siliconflow.cn/docs/api/chat-completions-post)。

## 百炼 Qwen 3.8 Flash 长输出（0.1.75）

百炼官方兼容地址下的 `qwen3.8-flash` 使用其已核实的 131072 token 输出上限，不再让已保存或拉取资料中的 8192 值覆盖该能力。回答、笔记和 HTML 同样适用，升级后不必重新填写 Key 或重新录入模型；原请求的手动重试也会使用新参数。官方业务空间专属地址及自定义连接填写的同类官方地址同样适用，第三方代理地址和其它模型不套用。

该模型请求显式设置 `enable_thinking=false`，不提高 `reasoning_effort`，不分配额外 `thinking_budget`。输出上限不进入提示词，不作为篇幅要求；模型应按任务自然结束。请求服务返回数值用量用于诊断，不保存推理正文。服务确实截断时仍提示未完成，拒绝将半页保存为成功，不自动续写或重试。

依据：[Qwen 3.8 Flash 模型能力](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)、[百炼 Chat Completions 参数](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)。
