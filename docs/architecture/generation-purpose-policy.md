# 0.1.75 百炼 Qwen 补充

`qwen3.8-flash` 在官方百炼兼容地址下按明确的模型能力设置最终输出 131072，覆盖旧目录 / 已录入资料中的 8192；此例优先级高于目录能力。适用回答、Markdown、HTML 和原请求手动重试，不修改已冻结请求内容。模型 ID 精确匹配，端点限制为官方 DashScope 或文档所列地域的业务空间 maas 地址及 compatible-mode/v1 路径；代理端点不套用。

通过文档支持的 enable_thinking=false 关闭思考，不增加 reasoning_effort / thinking_budget。该路径使用 stream_options.include_usage；所有兼容请求的诊断补充服务商身份与预设 / 自定义地址类型，仍不持久化地址、Key、任意错误原文或思考正文。内部规划上限维持原策略，真实 length 依旧失败且不保存半页。

来源与验证：[0.1.75 修复记录](../reports/qwen-output-0.1.75.md)。下述 0.1.73 策略除本节明确例外外继续有效。

# 0.1.73 最终输出策略

Chat、Markdown、HTML 的旧表格额度已被本节替代；下文保留演变记录。三种最终用途的 DeepSeek 输出上限为 393216 token，字符链路统一 4000000。传输总响应允许 256 MiB、单事件 8 Mi 字符，兼容逐 token 事件开销；这些是浏览器工程保护，不用于要求模型写满。内部规划、核验、字幕与旧知识协议维持原用途额度。

`generation/output-policy.ts` 根据当前连接和完整模型 ID 决定最终请求参数：优先有效目录能力，官方 DeepSeek / 百炼已知 V4 使用官方上限，未知兼容模型不发送 max_tokens，采用服务默认值。目录只接受有界正整数 max_output_tokens，未知或畸形能力值不使整个目录失败。诊断 maxTokens 缺失表示由服务决定，不虚构一个客户端数值。已录入模型可从最新已保存 catalog 取得能力，无额外探测调用。

最终提示移除具体预算，新增 output-scope，要求完整满足任务后结束，不因容量增加额外推理、重复或无关内容。官方 DeepSeek 继续关闭 thinking；文档支持的百炼 / 硅基流动已知 V4 模型关闭 enable_thinking，未知兼容模型不增设私有字段。普通任务移除 10 分钟累计截止；最终模型请求有 180 秒无服务数据超时，每次读取刷新，取消信号始终有效。

生成检查点、message/job schemas、Markdown 编辑、HTML validator/sandbox、note/reference schemas 和备份 noteRevisions/attempts 共用输出边界。未增加重试或续写，服务截断仍失败，完整 HTML 校验仍生效。验收见 [0.1.73 记录](../reports/generation-headroom-0.1.73.md)。

## 历史策略

# T22 有限生成与检索材料契约

0.1.56 输入更新（2026-10-23）：问答请求的总文字上限提高至1000000字符，字幕最多100000条／128个完整分段。超过旧6万字符规模时用有列定义的紧凑时间标记，仍发送全部原始正文、原始秒数和规划 cueId；没有摘要替换或自动续写。执行器、检查点、联网准备和自主识别预算同步支持。见[长字幕问答修复](../reports/long-video-context-0.1.56-2026-10-23.md)。本页输出用途表不因输入扩容改变。

当前预算更新于 2026-10-23（0.1.54）：针对自主识别后生成笔记／HTML 提高规划、核验和最终输出额度，并同步传输、保存和 HTML 预览界限。见[预算扩容与流程验证](../reports/autovision-budget-0.1.54-2026-10-23.md)。

2026-10-16，W14-T22-FIX-01。此策略已于W14集成，待真实服务复验／人工验收；代码中的上限不构成调用授权。见[集成报告与新预算](../reports/integration/e748520551a8/report.md)。旧A/E/F/H失败原因未确定，新受控通过不代表已恢复真实生成质量。

## 请求与完成

Chat Completions 使用 `/chat/completions`、显式 `thinking: {type: 'disabled'}`、`stream_options.include_usage: true`。每次请求按用途选择策略，不再用摘要 boolean 兼任规划：

| purpose | max_tokens | 正文字符上限 | response_format |
| --- | ---: | ---: | --- |
| answer | 4096 | 16000 | 文本 |
| markdown | 32768 | 100000 | 文本 |
| html-page | 65536 | 100000 | 文本 |
| knowledge | 8192 | 60000 | json_object |
| subtitle | 8192 | 100000 | json_object |
| summary | 1024 | 1800 | 文本 |
| vision-plan | 8192 | 32000 | json_object |
| vision-review（逐目标核验） | 16384 | 60000 | json_object |
| web-query（0.1.28起） | 512 | 1024 | json_object |

普通回答与笔记的详略由本次要求、角色和模板决定，预算不是篇幅目标。内部归纳450字以内，规划理由120字以内。客户端不截断正文。字幕保持每批最多40条／4000序列化字符（含索引与时间），原88条样本为40／40／8，共3 POST；JSON仍逐条严格校验索引、时间与完整覆盖，不补括号、不接受 length、不自动续写或重试。知识保留 T09 JSON v1 严格解析及旧模板兼容，结构不因 json_object 放宽。

SSE 必须 stop、DONE 且正文非空；reasoning_content 永不进入正文或持久化。Markdown、HTML、视觉规划与核验的总响应最多8 MiB，单行／未完成行／单事件累计最多512 Ki字符；其他用途仍为1 MiB和65536字符。传输预算容纳逐 token 事件开销，正文仍受各用途字符界限约束。先解析网络块内完成的事件，避免把多个合法小事件合并后的网络块误判成一个超限事件。Key回显屏蔽、取消及原请求冻结保持有效。

## HTML 一次完整交付（0.1.45 历史记录）

0.1.44 实际失败记录的请求上限与完成用量同为8192 token，正文19239字符，未触及60000字符或8 MiB响应界限。视频时长不能预测页面代码量；带模板和不带模板使用同一 HTML 策略，模板也不会额外发起一个页面请求。增加到16384 token，同时通过 P1 `html-output-budget` 告知模型真实预算；24000字符是精简目标，可因任务需要超过，客户端不据此截取或删改源码。仍保留完整字幕、当前模板与输出内容的自由度，要求复用样式和函数、留足完整闭合空间。提示版本v23；内置模板v4及用户保存的模板不改写。

视觉规划的 `finalOutputReserved` 和发送前校验复用同一用途策略，包含新上限，不从媒体处理或图像预算中隐性借用。其他用途上限不变。仍只有一个最终 HTML POST，没有自动重试、续写或补全标签。`length` 无论收到多少正文都失败；`stop` 后也必须通过完整文档校验才能入库。唯一 HTML 围栏缺少闭合而内部已有有效文档开头时，诊断改为 `missing-end`，但仍拒绝保存。单次可用输出增加，实际成本取决于服务返回的 usage；设置上限本身不是费用金额。

依据：[DeepSeek Chat Completions 官方接口](https://api-docs.deepseek.com/api/create-chat-completion/) 明确提供 thinking、max_tokens、JSON模式、流式usage；[思考模式说明](https://api-docs.deepseek.com/guides/thinking_mode/) 说明默认开启思考及独立 reasoning_content。此处选择关闭思考，是针对简短完整结构任务的有限策略判断，不证明旧失败由思考消耗导致，也不保证真实学习质量。0.1.28起，网页检索先用web-query生成关键词，再由应用发一次[独立Search请求](https://api-docs.deepseek.com/api/search/)；旧Anthropic内置搜索工具循环已替换，具体权限、预算和兼容见[当前联网契约](web-evidence.md)。

## 安全诊断与兼容

`Attempt.diagnostics?`／`generation.query` 返回的 `view.generation.jobs[].diagnostics?` 最多18项，旧数据缺失合法。每项仅允许 purpose、cause、maxTokens、outputChars、responseBytes 和 usage 数值。cause 为 stop／service-length／local-characters／response-bytes／event-buffer／protocol／cancelled／transport；用户仍使用既有固定错误词汇（例如 output-limit）。outputChars 为已接收到的正文字符，包括与 length 同块但未提交的内容；responseBytes 是已读取网络块字节数。它们不是已展示字符或精确计费量。

usage 只提取 prompt_tokens→inputTokens、completion_tokens→outputTokens、total_tokens→totalTokens、completion_tokens_details.reasoning_tokens→reasoningTokens、prompt_cache_hit_tokens→cacheReadTokens，均限制为0至10亿整数；缺少字段是 unknown，不补0。不保存raw响应、推理正文、字幕、认证信息或任意错误原文。stop 表示传输完成，之后知识／字幕JSON业务校验仍可能失败。

诊断在执行器结束该请求时写入当前已认领且未终结的 attempt，更新 seq；终结后的迟到诊断不写入，故用户主动停止可能只有 stopped 状态而没有 cancelled 诊断。写入通知不等待任务取消队列，避免取消等待清理、清理再等待通知的环。普通失败先写诊断再终结，报告可通过既有 generation.query 获取。诊断仅本地任务可查询，既有备份导出投影不纳入该字段；DB8／format3不变、无迁移。

## 当前视频内容与清理

联网前，在可信执行器内验证冻结分析源后调用一次既有完整准备流程。单段发送完整字幕（最多12000字符）；多段完成所有分段归纳后发送全部归纳（最多16×1800字符加分隔符），携带 full-subtitles／complete-summaries 和相等的 totalSegments／coveredSegments。与问题、视频标题及选中知识的最小上下文一起送入检索，不只使用片头或标题。相同 prepared 对象供检索、规划及最终回答复用，不为检索另加归纳调用。原字幕／归纳／检索正文仍仅在执行内存中，snapshot和备份不增加这些材料。

以上完整短字幕／全部归纳描述为W14历史实现；当前准备流程复用完整可用字幕，沿用60000字符请求上限，不静默截取片头。检索要求按视频内容识别主题，仍须区分视频、网页来源与模型解释／推断；发送真实主题材料并不保证搜索相关性或事实正确。T14来源和URI规则见当前联网契约。

未冻结的视觉阶段在 failed／stopped／interrupted 时标记 retired，侧栏显示“画面任务已结束”。媒体副本／grant释放沿既有 finally 路径，受控安装已验证规划服务length、本地字符上限、取消及用户接管；自有标签关闭、接管标签保留、原播放器保持不变。一次静音可见初始化路线不变。
