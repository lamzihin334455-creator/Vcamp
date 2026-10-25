# T09 交互知识契约

2026-10-15，W9-T09-01。内部沿用 `html` 输出及资料类型，产品显示“交互知识”。它是不可变 JSON 数据，由可信 React 阅读器显示；没有 HTML 文件、脚本解释器、iframe、资源加载、动作或 URL 能力。规则以 `extension/src/contracts/knowledge.ts` 为准。

## JSON v1

必填且只允许以下字段：

```json
{"version":1,"title":"主题","summary":"视频概括","groups":[{"id":"g1","title":"分类","items":[{"id":"i1","title":"知识点","body":"解释正文","basis":"video","question":"预填深入问题"}]}],"concepts":[],"relations":[],"questions":[]}
```

`concepts`／`questions` 与分类条目同结构，`relations` 是 `{from,to,label}`。basis 只能是 `video`（视频依据）、`explanation`（解释）、`inference`（推断）。所有分类及条目 ID 全局唯一、1–60 位字母数字或 `_ -`；边只指向有效条目、概念或问题，重复边拒绝。分类 1–12 组，每组 1–40 条，概念 ≤50、问题 ≤30、边 ≤100，条目总数 ≤120。标题／关系标签 ≤160、正文 ≤2000、预填问题 ≤400、摘要 ≤4000、整体 ≤60000 字符。无任意递归层级或额外字段。允许唯一外层 json 围栏与确定性首尾空白归一化；不猜测修复、不截断或忽略字段。

当前分析源、完整字幕／分段覆盖、模板和模型走原 T05/T12 请求执行器。冻结请求增加 `knowledgeFormat:1`，提示提供结构、示例和内容依据规则。临时流只显示任务状态，通过 schema 且完整覆盖才在原终态事务中新增 artifact 和 revision；Chat 保存完成元数据，普通历史不包含整个成果。失败显示格式错误、保留手动重试／新建请求；停止、删除和迟到完成沿用 first-terminal-wins，无半成品成果。格式有效不代表事实正确；不提供无依据时间点。

渲染只把字段放到 React 文本节点，不解释 HTML／Markdown／链接／DOM 属性；恶意字符串原样显示为文字。分类、原生 details 展开、关系详情和已生成问答全在本地运行，360px 可换行和键盘操作。每次生成新成果，不编辑、不加入通用 @／Markdown 引用。

## 显式追问

可信 UI 展示条目标题、正文及依据标签，预填可编辑问题。带入来源对话后再显式发送；选中动作不调用模型。草稿的可选 `knowledgeFollowup:{artifactId,revisionId,entryId,question}` 作为覆盖层，原 text／模板／输出／引用／附件完整保留，取消或成功接受后恢复。其余草稿不合并发送，问题 ≤8000 字符。

冻结时 S2 在同事务中核有效成果、同 workspace／sourceChat、revision 和 entry ID，自己读取正文并创建不可变 `knowledgeContext:{artifactId,revisionId,entryId,snapshotId,title,entry}`。客户端不能提供正文。发送走来源 Chat 的普通任务，只附此条目；后续历史只保留这个主动选中的片段。原请求重试用原快照，后来浏览／草稿／成果删除不改变片段。新追问拒绝已删除成果或来源；已删除来源的成果仍可读。

固定 `reader.html?workspaceId=…&knowledgeId=…` 及资料库 `library=1` 阅读器复用同一组件；只允许读取，不提供追问编辑／发送。仅明确“回来源对话继续”按钮打开工作台，工作台核当前视频分 P 后选择原 Chat；不偷偷选择其他空间或从 reader 发请求。

## 持久化、旧版本与备份

单库维持 v8，不新增 store／迁移。`artifacts.type='html'` 指向 `noteRevisions.content` 的规范 JSON v1；revision 固定 1。Markdown 的编辑、引用和可见列表仍只接受 markdown 类型。资料库、收藏及回收站增加 html 身份，恢复沿用原归属。

模板新增可选 `outputProtocol:'knowledge-json-v1'`，仅 `outputType:'html'` 可携带；schema 拒绝未知协议。新版自定义交互知识与内置学习导图 v2 明确保存此身份，随版本、冻结快照和备份保留。缺少身份的 HTML 模板一律保持旧自由 HTML 语义（包括普通自定义模板、未发布旧候选及导入映射副本），不按名称、要求、内置 ID 或时间判断。Chat／Markdown 不受影响。

旧模板可在模板管理查看并编辑；草稿发送被拒且不创建任务。选择旧模板→“转换为交互知识”→检查、修改要求，保留概括／分类／概念关系／问答等受支持内容，任意 HTML/CSS/JavaScript 不再支持→“确认转换并保存新版本”→从 @ 重新选择新版。旧版本、冻结请求和已绑定草稿不自动更新；原草稿文字保留。也可显式重选内置学习导图 v2。

没有 `knowledgeFormat:1` 或仍冻结旧自由 HTML 模板的请求拒绝原请求重试，提示新建请求，绝不偷换原格式；合法新版原重试仅用冻结版本，不读取后来编辑的模板。旧历史允许导入，不执行。

新备份 `formatVersion:3/databaseVersion:8`，兼容 v1/db7、v2/db8；新数据（包括模板协议身份）不能冒充旧 format；v1/v2 旧模板读取后仍缺少身份，不自动升级。format3 严格验证新请求与模板协议一致；无身份的旧候选自定义模板需重新确认，不进行隐式迁移。白名单图包含知识 JSON、追问身份／片段和内置模板依赖。导入严格核 schema、归属、正文与不可变依赖；冲突成组复制 Chat／请求／成果／revision／片段 snapshot 身份，entry ID 与模型正文不改写。导入不执行内容或模型。密钥、原始字幕、浏览器能力及临时缓存仍排除。旧版程序不应回读新 payload；回退前保留 profile 和备份。

验证入口：`t09-knowledge.test.ts` 与原快测；`node tests/installed/t09-knowledge-http.mjs` 使用本机受控 SSE、合成视频／凭据，经生产任务链生成，实际下载／文件选择导入。真实模型质量与遵循度 not-run，新真实 API 调用 0。Standards／Spec 为作者串行自检，独立集成仍由 01 确认。

T09-COMPAT-01 窄回归：`t09-template-compat.test.ts` 使用原 BASE 接口生成的 format2 夹具，覆盖原绑定草稿、明确转换、原请求重试、旧新格式及冲突身份映射。`node tests/installed/t09-template-compat-http.mjs` 只走旧模板提示→编辑确认→重选→本机 HTTP JSON 生成；01 原失败证据不改写。
