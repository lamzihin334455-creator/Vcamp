# T20 备份与合并契约

## 当前实现（0.1.80）

默认下载为一份 **`.vcamp` 文件**：`vcamp-backup-stream / formatVersion=1 / databaseVersion=10`，资料正文上限 **512 MiB**，清单另限 1 MiB。内部以小段传输，不再将整个备份塞入单条浏览器消息。旧版 JSON（formatVersion=1…6）仍可导入，其 64 MiB 上限不变；旧调用 `library.backup.export` 保留 JSON 行为，新界面使用 `segmented:true`。入口为资料库 → 存储管理 → 备份与恢复；清理缓存独立放在上方。下方 T20 记录描述早期格式，不代表当前容量和类型范围。

新文件首行为严格 JSON 清单，后续为 `[table, row]` JSON 行的连续 UTF-8 内容。清单包含表白名单、有序分段字节数、各段 SHA-256、偏好和清单校验和。每次传输最多 256 K 个 UTF-16 码元，切分不拆开代理对；记录可跨段，不将关联资料拆成独立导入批次。界面通过 Blob 组合一份文件，读取时按清单的字节范围逐段上传，显示进度。

新协议为 `library.backup.part / import.begin / import.append / import.preview / release`。后台最多保留两个临时传输会话，闲置 10 分钟失效，后续访问或建立会话时回收过期项；正常完成、失败或界面取消读取会释放会话。Worker 重启使传输失效，需要重新选择／导出文件，不部分写入资料。缺段、错序、重复段、尾随字节或损坏校验和均拒绝。接收完整后逐行解析，复用原有 payload schema、PNG 内容校验、来源依赖检查及合并逻辑；仍经用户确认后在原单事务内写入。资料数量与单字段限制保留，超限报错，不截断、不自动删资料。

0.1.79 用 88,070,216 字节的合成文件完成了真实浏览器下载和跨 profile 恢复，330 条中文／表情记录逐条完整。详见 大容量备份验证报告（历史内部记录，未纳入公开源码：`../reports/storage-backup-0.1.79-2026-10-25.md`）。

0.1.80 修复冻结历史片段与原消息的比较：生成 Markdown／HTML 且本次请求未带角色时，历史可省略角色；历史图片可保留原图片列表的有序子集。只有相同空间、Chat、消息和内容版本的原消息能证明这些省略合法，比较时才归一化；不补回请求角色、图片或改写历史。正文、引用、模板、知识快照、角色替换、图片替换或乱序仍按冲突拒绝。文件格式和数据库版本不变，已有文件可直接导入。已用一份 80,000,855 字节、299 分段的实际备份完成隔离恢复、计数核对、重复导入、再导出及浏览器导入，详见 历史片段兼容修复报告（历史内部记录，未纳入公开源码：`../reports/storage-backup-0.1.80-2026-10-25.md`）。

除早期资料外，白名单包含角色及版本、HTML 风格及版本；支持白名单界面与输出偏好，以及文件夹、收藏、观看位置和完整草稿。只导出实际依赖的内置版本，恢复时作为自定义副本映射。偏好在资料事务成功后另行写入，写入失败单独反馈，不能声称 IDB 与浏览器偏好跨存储原子提交。密钥和服务配置不随资料备份迁移。

`htmlStyle` 在草稿中是严格的 `{styleId, revisionId}` 选择，在请求快照中则为完整的冻结版本。两者的 ID 都要映射，只有冻结版本可附加 `backupOriginalId`。0.1.64 修复了将来源字段错误写入草稿选择、导致完整结果图校验失败的问题；保留文件校验、图片校验、依赖检查和事务边界，不放宽 schema。

验证包含内置风格草稿在空库恢复、冻结版本来源保留、重复导入、恢复后再次导出至第三库，以及真实下载后导入另一浏览器 profile。实际用户备份仅通过显式设置 `VCAMP_BACKUP_FILE` 在本机回放，默认跳过，不写入夹具、截图、trace 或发布包。详见 0.1.64 验证报告（历史内部记录，未纳入公开源码：`../reports/storage-backup-0.1.64-2026-10-23.md`）。

## T20 初始实现记录

入口为资料库 → 存储管理 → 备份与导入。`ApplicationClient.library` 兼容增加 `library.backup.export / preview / execute`；固定 reader 与普通网页不能调用管理写操作。业务逻辑在 `IndexedBackupStore`，单库 **vcamp v8** 新增 attachments，保留旧资料。备份 **formatVersion=3** 与数据库版本分开声明；兼容导入 formatVersion=1/databaseVersion=7 无附件包及 formatVersion=2/databaseVersion=8 包；T09/T14不新增数据库迁移。

## 格式与边界

JSON 包含严格校验的 manifest 与 payload。manifest 声明格式、版本、创建时间、全部类型和 payload 的 SHA-256；canonical 按 UTF-16 键排序，数组保留顺序。文件最大 20 MiB，总顶层记录及 Chat 最多 20,000，另有每类/历史/正文上限；超限拒绝，不截断。校验用于发现损坏，不把文件当执行授权。

同一个 readonly 事务读取白名单：workspaces、jobs、artifacts、noteRevisions、subtitleVersions、scribbles、templates、templateRevisions、folders、favorites、attachments。空间包含全部 Chat/完整 Draft、消息、最近选择、观看位置、分析源、删除时间及管理 revision；请求保存冻结历史内容版本、引用及模板依赖。所有不可变版本与回收站对象保留。T16增加请求autoVision和attempt.visual的计划／阶段／图片ID／显式选择／冻结标记，沿用format3/db8；自动帧PNG与依赖随Chat冲突组映射。仅保存资料，不保存session grant、媒体lease、焦点返回权；导入仍不执行任务。实际使用的内置模板版本也作为依赖导出，导入转成普通自定义副本，避免新版预设改变旧请求。

不读取或打包 chrome.storage.local，不导出凭证/Key、原始字幕正文、executor/claimed/completionToken、浏览器 tabId/documentId/epoch 或 cacheEntries/cachePlans/清理回执。原生来源定位、指纹保留为历史数据。附件包含归属、来源、时间、尺寸、SHA-256 与实际 PNG 字节（data URL 编码），导入核对 CRC、受限解压、尺寸、内容 hash 与全部引用归属。内部 html 实体为严格 JSON v1 交互知识，正文保存在 noteRevisions；包含 knowledgeFollowup、knowledgeContext 最小片段快照及模板 outputProtocol。校验归属、正文和不可变依赖；未知版本／字段拒绝，新实体及协议身份不可伪装 format1/2，旧模板不隐式升级。文件只当数据，不执行代码、抓取 URL 或修改服务配置。

## 合并与来源

空间稳定身份为 `[platform, videoId, partId]`，标题不用于匹配。按模板及版本、空间字幕及其任务、各 Chat（消息、jobs/attempts、请求历史、Markdown及交互知识/版本/引用与追问快照/图片实体及全部 ID 引用）、随笔、文件夹/收藏组成关系组。只有映射后的内容、删除状态及关系等价才跳过；组中任一冲突保留原记录并复制整组。SHA-256 派生稳定 UUID；已存在副本只有内容仍相同才复用，否则寻找另一个副本。不能仅凭包校验值跳过后来变化或缺少的实体。

本机空间元数据、最近 Chat、分析源、观看位置和删除状态优先；新增资料仍并入同一空间。`workspace.backupImports` 保存原单值选择、原父/子删除标记与来源 ID 映射；复制 Chat/模板/模板版本/文件夹兼容保存 `backupOriginalId`，显示副本标记，不改原正文。交互知识 entryId／条目正文不重写，artifactId／revisionId／snapshotId随冲突组映射。原父已删而本机父存活时，导入子项进入回收站，独立子删除时间仍保留；本机父已删时不复活。收藏目标跟随导入关系映射；重名文件夹身份独立。

导入非终态 attempt 变为 `interrupted / executor-lost`，`importedState` 保留原状态，对应 assistant 消息同步；导入绑定用无效历史标记 `tabId=-1/documentId=backup-history/epoch=-1`，无执行能力。已有本机 jobs 不改、不抢槽、不调用 pump；之后显式重试由现有服务重新校验模型与有效字幕来源，不能凭旧浏览器绑定重放。

## 一致性与错误

preview 验证格式、完整性、唯一身份、归属、全部版本及引用依赖、字幕依赖环，再验证与本机合并后的完整图。只在 Worker 内保存最多 4 个不可变计划，10 分钟有效；Worker 丢失计划需重算，没有持久导入计划表。计划绑定文件 checksum 及所有白名单表的原始快照，仅排除 workspace.lastOpenedAt 与 watchPosition 两个观察字段；其他空间的资料变化也会保守地使计划过期。

execute 在一个涵盖全部白名单表的 readwrite 事务内重读并核对上述快照，只将待写 workspace 的两个观察字段替换为事务内本机最新值，再校验实际结果图并写入。正常页面观察（包括暂停视频时 observedAt 更新）不再使确认持续失效；不会重算已确认的冲突组、计数或映射。草稿、消息、笔记版本、删除状态、分析源、当前 Chat、来源元数据及新增对象等仍精确比较，变化需重算预览。quota、abort、异步 request 错误均整体回滚，成功只在 oncomplete 返回并广播刷新。变更/超时/文件校验值不符为 plan-expired；损坏、版本、未知字段、缺依赖为 invalid-message；不支持实体为 unsupported-capability；超限 resource-limit；提交失败 storage-failed。没有跨 IDB 与外部 Blob 一致性声明。

验证：`npm run typecheck`、`npm test`、`npm run build`、`npm run build:test`、`node tests/installed/t20-backup.mjs`。安装组合为原样生产包加测试专用语义夹具页，权限不变；真实下载 → 全新 profile 选文件 → 确认 → 浏览器重启 → 指定阅读器/恢复 → 重复导入 → 已有 profile 冲突合并。T15 另用 t15-capture.spec.ts 验证截图附件往返；真实模型 API 0。T09另用 t09-knowledge-http.mjs 验证知识生成／追问／真实下载及空profile与冲突导入，模板协议转换依赖见 t09-template-compat.test.ts；完整 T22/G4/G5 仍待综合验收。

T14沿用format3/db8：Draft可选webEnabled（缺字段为关）、请求可选冻结web策略/videoTitle，attempt／assistant／成果可选严格webEvidence。证据只含有界来源、字面引用关联、检索时间/状态与数值usage；不含材料正文、raw响应、网页、Key或默认服务设置。导入核对原请求联网身份及消息/成果与attempt证据相等，sourceId只在本次证据内有意义、不当作本库实体ID重写；非终态searching随中断改failed。旧format1/2仍可导入，不允许用旧格式伪装新联网字段。详见[联网证据契约](web-evidence.md)。
