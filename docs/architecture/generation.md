# T05 文本 Chat 与任务执行

W14已集成[用途策略与安全诊断](generation-purpose-policy.md)：六用途有限预算、合并SSE块解析、终结视觉retired；DB8／format3及既有权限不变。T22保持修复已集成、待真实复验／人工验收，旧A/E/F/H真实失败不隐藏。

公共词汇唯一来源是 `extension/src/contracts/generation.ts`；请求继续区分 chat/subtitle，historyProjection 保存发送前的不可变内容版本。本轮 `ApplicationClient.generation` 是兼容可选方法，经原 v1 信封提交 send/query/stop/retry。reader 只能查 URL 固定目标；内容页不能调用。T12/T13 已复用 S2 接入字幕工作台与翻译／增强处理器，见 [AI 字幕与分析源契约](ai-subtitles.md)。

`IndexedGenerationStore.freezeChat(target, expectedRevision, basis)` 在 workspaces/jobs 同一 readwrite 事务中验证目标、草稿 revision 和任务槽，冻结实际模型/输入/选项/历史，添加唯一用户消息并清空已发送草稿。生成期间可以继续写新草稿。T06/T07 已扩展为 Chat／Markdown 及当前 Chat 有效笔记引用；T08 模板按选择时的不可变版本冻结要求／产物／实际模型，T15支持主动截图附件，T09支持严格JSON交互知识，T14以独立取证阶段接通联网（见[联网证据契约](web-evidence.md)）；旧无协议身份HTML模板拒发，显式转换新版本并重选才采用新协议。选中条目追问在同事务核归属并从存储冻结最小正文，保留原完整草稿，详见[交互知识契约](interactive-knowledge.md)。引用实体在同事务校验并冻结最新保存内容，见 [Markdown契约](markdown.md)。历史包含发送时可见的先前回答，包括其他请求已停止的可见文本。

T16默认关闭，开启后每请求显式确认一次静音副本显示；规划和最终回答沿原执行器，自动图片原子写入attempt而不改草稿，详细权限／焦点／清理见[自主视觉契约](autonomous-vision.md)。

`retry(jobId)` 只新增 attempt，复用原 snapshot；T16完成冻结阶段复用原图片，未完成阶段不继承旧grant；不新增用户输入，不重新投影历史，不混入旧 attempt 输出或后来消息。请求含原字幕 locator、语言、SHA-256 指纹及绑定，不含原字幕正文。重试主动重读原视频并核对定位与指纹，不可复现则返回 source-changed；用户需回原视频重读或创建新请求。进行中的执行不依赖当前视频，换视频不会重新绑定已有请求。

`attach/claim/checkpoint/finish` 是 S2 语义操作。claim 只成功一次；重载任务页不能再发 POST。每个检查点同时提交可见文本、覆盖范围、state/seq 和消息版本，事务成功后才发 invalidate。finish 同事务保存终态、完成凭证、回答状态；字幕成功则保存 SubtitleVersion，无 Chat／伪造消息。按 job/attempt 去重，停止与完成竞争第一个终态；已删除目标返回 not-found，迟到结果不会复活目标。字幕任务通过 freezeSubtitle 占独立目标，允许排队；已用受控结果验证完成、停止及无 Chat 空间，T12/T13 的逐段处理不使用 Chat 摘要，见 AI 字幕契约。

面板先注册订阅，服务端确认后读取原子 GenerationView。每次 invalidate 都重查完整快照，而非叠加未经确认的 delta；JobView.seq 单调，客户端拒绝旧 running 覆盖新终态。因此重复、缺失事件、确认／快照窗口完成均可收敛，无长期事件日志。

执行宿主采用已选 R1-EXECUTOR：Worker 仅调度，打包 executor.html 在独立、不激活扩展标签中持有字幕、凭证和 HTTP 流；URL只有 job/attempt ID，DOM只有固定任务说明。启动消息只向记录 tabId／精确 URL／本扩展顶层上下文交付内存字幕，不发送 Key；凭证在可信执行页通过 T04 TRUSTED_CONTEXTS 存储适配器读取。新增 tabs 权限用于核对、清理任务标签，不注入不可信 HTML，不使用 Offscreen 或保活心跳。任务成功、取消、失败关闭标签，手动关闭显示 interrupted；Worker 重启只核对原执行者，浏览器退出／重载不自动重新计费。队列内尚未交付的字幕在 Worker 丢失后显示 interrupted。释放只关闭仍匹配原任务 URL 的 tabId，避免重启复用 ID 时关闭其他网页。

资源限制：全局最多 2 个执行标签、10 个未结束任务（其余最多8个排队），每个 Chat 单活动任务；字幕目标不占 Chat 槽，同空间字幕一次一个执行槽。单任务总时限10分钟，无自动网络重试；SSE 与正文限额按[用途策略](generation-purpose-policy.md)选择，0.1.54 的 Markdown／HTML／视觉规划／核验传输最多8MiB，其余1MiB；笔记和 HTML 正文最多100,000字符。要求 finish_reason=stop 和 [DONE]，断流、输出长度上限、认证、限流明确失败并保留 Chat 已见部分。Key及错误响应正文不写入DOM／数据／日志。

输入限制以字符控制，不假定模型名称代表上下文容量。0.1.56 单次服务请求最多1,000,000文字字符；主字幕最多100,000 cues，每段12,000字符、最多128段。长字幕使用有表头的紧凑秒数标记，全部原始正文及时间都送入最终请求，不再走历史归纳路线。覆盖范围完整且连续才可 completed，最终请求失败不标记完整覆盖；单条 cue、总段数或总请求仍超限时明确拒绝，不截断。历史投影继续按既有完整轮次窗口限制，较早记录仍保存。具体实现与服务容量边界见长字幕输入报告（历史内部记录，未纳入公开源码：`../reports/long-video-context-0.1.56-2026-10-23.md`）。

数据库 v3 在唯一 versionchange 入口新增 jobs/subtitleVersions，T06/T07 的 v4 同入口新增 artifacts/noteRevisions 并保留 v3 数据；v2 workspaces 数据原样保留（所有 Chats、草稿、revision）；v1仍沿原转换路径升级。升级失败整体回滚，不清库；旧程序不能打开v3，应保留 profile并前向修复。未来备份必须通过数据接口选取，不复制整个扩展 local 存储；原字幕／中间归纳仅在内存，AI 字幕版本与允许的消息属于长期资料。

验证：`npm run typecheck`、`npm test`、`npm run build`、`npm run build:test`；`node tests/installed/t05-http.mjs` 使用独立 profile、合成视频／Key与本地可控 HTTP SSE。生产固定 https://api.deepseek.com/chat/completions，只有显式 test-extension 构建替换端点并增加本机 HTTP 权限；生产不包含夹具。测试控制浏览器根目标，执行器／Worker无 DevTools 附着，记录真实原生面板关闭、跨空间双任务、Worker被终止后终态恢复、停止／原请求重试、断流及手动关标签。

协议核对来源：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)（2026-10-14）；原T05只实现文本 SSE；T14独立检索路线依据已批准WEB-04实测，见联网证据契约。本轮0真实模型 API，未读取旧 Key/.env；生产真实模型E2E、任意长任务／休眠、完整旧浏览器产品矩阵 not-run，R1固定路线证据不等于完整产品发布放行。

T08/T10：模板版本保留在用户消息与历史投影，原请求重试不重新读取模板。模板要求作为标明边界的用户数据 JSON，不能改变固定输出、权限或隔离。T10 `scribble-operation` 消息在 freezeChat 投影前排除；随笔正文没有引用／生成接口，overlay 存在时拒绝发起 AI 请求。详情见 [模板与随笔契约](templates-scribbles.md)。
