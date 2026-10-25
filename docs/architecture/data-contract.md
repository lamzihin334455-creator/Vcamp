# WorkspaceStore 与 Chat 草稿契约（T03，T05兼容扩展）

T19/T21：当前单库 v7 新增显式临时缓存及清理计划表；Workspace / Chat / 实体软删除与恢复保持原身份，任务取消及提交检查共享事务边界，详见 [管理契约](management.md)。历史迁移说明仍保留。

T17/T18 兼容扩展：唯一入口升级到 v6，新增文件夹及唯一收藏关系；原空间兼容增加最近查看时间与实际观看位置。UI 只用应用接口，固定只读不写最近 Chat／草稿／分析源。详见 [资料库契约](library.md)。下文 v2—v5 是各批历史说明。

T03 从已审 T02 候选 `8878107933b66850ed8c51b40a18db2f014fccc1` 开发。统一类型与运行校验仍在 `extension/src/contracts/application.ts`，唯一数据库仍为 `vcamp`。本文补充运行手册的 T01 单 Chat 契约；生成已由 T05、实体引用解析已由 T06/T07 接入，附件捕获和资料库未实现。

T05保持下列草稿／选择语义，数据库升为v3，新增请求冻结、任务／消息与完成凭证事务；见 [T05生成契约](generation.md)。本文的v2迁移是T03历史说明，唯一升级入口现在为 `src/data/database.ts`，v2全部Chats与草稿原样保留。

## 公开语义与消费者

`WorkspaceStore` 位于 `src/data/indexed-store.ts`，生产使用 IndexedDB 适配器。基线没有内存适配器，本轮未新增平行存储实现。应用层、消息路由、`createChromeClient` 和 `useWorkspace`/App 为当前消费者；其他工作台模块继续只用 ApplicationClient，不读取数据库。

| 操作 | 语义 |
| --- | --- |
| `open(source)` | 按 platform/videoId/partId 的稳定键打开唯一空间；首次原子创建空 Chat，否则返回最近选择的 Chat。标题不参与身份。 |
| `read(workspaceId, chatId?)` | 只读投影指定 Chat，未指定时读取最近 Chat；返回原有 id/source/chatId/draft，加 chats 摘要。不修改最近选择。 |
| `save(workspaceId, expectedRevision, draft, chatId?)` | 同事务检查 Chat 归属与该 Chat 的 revision，提交新 revision；不改变最近选择。原签名兼容，应用会话及生产消息显式指定 Chat。 |
| `createChat(workspaceId)` | 在该空间原子新建空 Chat 并设置最近选择，标题为对话序号，ID 为 UUID。 |
| `selectChat(workspaceId, chatId)` | 归属检查后原子设置最近选择；不改变任何草稿 revision。 |

应用命令新增 `chat.create {workspaceId}` 和 `chat.select {workspaceId,chatId}`，只允许当前空间，reader 在 client、路由和应用层都拒绝写入。`draft.save.target` 固定目标，保留 T02 允许迟到草稿保存回原空间的行为；不因当前网页／Chat 切换而重定向。

`WorkspaceView.chats` 是可选兼容字段，返回各 Chat 的 id/title，现有 draft 是当前 Chat 投影。`workspace.query` 可带可选 `target {workspaceId,chatId}`：仅在目标空间等于当前 source/localSource 确认空间时投影指定 Chat，跨空间目标不会切走当前空间；同空间伪造 Chat 返回 forbidden。reader 忽略调用方 target，使用 URL 固定的 workspaceId/可选 chatId。

每个页面 client 记忆当前选择，query 显式携带，Worker 重启后仍能恢复页面选择；只有最新查询／选择响应更新 client 选择。路由的 documentId 临时选择用于兼容不携带 target 的查询，不作为持久数据。窗口间各自选择独立；新打开页面与重新进入空间默认读持久 recentChatId。查看模块／固定 reader 不更新 recentChatId。`chat.create/select` 与草稿成功提交后才发布 invalidate，重连仍先订阅确认再快照。

## 草稿格式与归属

继续使用 `schemaVersion:1`，保留 text、outputType、template(templateId/revisionId)、referenceIds、attachmentIds、modelId 和 revision。本轮兼容新增可选字段：

- `references[]`：artifactId/workspaceId/sourceChatId/title/type（仅 markdown）。
- `attachments[]`：attachmentId/workspaceId/chatId/name/mimeType/可选 time。

有描述时必须属于保存目标，描述 ID 必须在对应原 ID 数组中；不接受额外字段。旧只有 ID 的草稿仍可读取和保存。这些是合法描述，不宣称对应实体已存在；T07/T15 必须在请求准备时验证真实成果／附件及存活、类型和归属，不能信任描述。模板选择绑定明确版本，编辑文字或产物不会丢弃未上线能力字段。未添加附件 UI、Blob、生成、原字幕或凭证持久化。

## 并发与 UI 恢复

IndexedDB readwrite 事务串行读取并修改一个 workspace 记录；不同 Chat 各自 revision，避免用最后一次整库写入覆盖他人。成功仅在 transaction.oncomplete 返回；失败 abort 回滚。版本冲突返回 revision-conflict，不会重试覆盖新数据。

页面草稿缓存按 workspaceId+chatId，写入串行且目标固定。主动切 Chat 前等待当前保存队列；失败保持当前 Chat 和完整输入。创建／切换过程中禁用输入；输入法组合期间暂缓查询更新和切换，compositionend 提交最终文字。网页外部换视频不受面板控制，页面先等待原目标保存，失败草稿仍留在缓存并显示可恢复提示，返回原视频可重试；也可下载所有未保存草稿的 JSON（固定 target、expectedRevision 和完整 Draft）。

冲突界面提供下载／复制、重新载入及确认；取消不丢输入，确认后才换成服务器已保存草稿。恢复文件是临时输入保护，不是 T20 完整备份／导入。浏览器关闭前未获保存确认的输入仍需先下载，不能称其已持久保存。

## v1 → v2 迁移

W2-T03-01 唯一预约数据库版本 2。仍用同一 workspaces object store（keyPath=id），不清库、不改稳定 ID。v1 `{id,source,chatId,draft}` 迁移为 `{id,source,recentChatId:chatId,chats:[{id:chatId,title:'对话 01',draft}]}`。公开返回是投影，数据库不重复保存顶层草稿。升级在单个 versionchange 事务中处理全部记录，保留所有旧字段与 revision；异常／配额导致整体回滚并报告 storage-failed，重试升级可继续，不做降级清库。旧程序不能打开 v2 数据库；需要回退时保留 profile，使用前向兼容修复。

直接证据：`tests/fixtures/t03-v1-workspaces.json` 是按旧生产 v1 格式填充的双分 P 夹具，包含模板版本、引用、附件与非零 revision；`tests/unit/t03-chats.test.ts` 通过公开应用查询验证完整迁移与中途 abort 后重试。原字幕 VideoView 仅由路由拼入返回值，存储操作只接收 source/Draft，不持久原字幕。

## 验证入口

在 extension 运行 `npm run typecheck`、`npm test`、`npm run build`、`npm run build:test`，定向安装验证 `npx playwright test t03-chats.spec.ts workbench.spec.ts failure-recovery.spec.ts t02-fixes.spec.ts`。安装闭环实际关闭 BrowserContext 并同 profile 重启；固定绑定适配器／合成站点与真实站点证据区分，native IME 和完整实站字幕矩阵留批次验收。

## T06/T07 兼容扩展

唯一入口升级至 v4，保留 v3 数据并新增成果／不可变版本。草稿描述仍非权限凭据；请求接受事务读取当前 Chat 有效 Markdown 最新保存版并冻结正文，历史与重试不随编辑变化。ApplicationClient 新增可选 artifacts 方法，固定 reader 只查询指定成果且拒绝写入。详情见 [Markdown 数据与查看器契约](markdown.md)。

## T08/T10 兼容扩展

唯一升级入口一次迁至 v5：templates/templateRevisions/scribbles，保留 v4 所有表与记录。Draft v1 新增可选 scribble overlay；ApplicationClient 新增可选 templates/scribbles，信封及只读路由同步验证。无 Chat 的已存在空间投影 draft/chatId 为 null，不自动创建 Chat。详情见 [模板与随笔契约](templates-scribbles.md)。

## T12/T13 兼容扩展

仍为 v5，无 schema 迁移。复用 subtitleVersions，空间可选 analysisSource/analysisSourceRevision/subtitleVersionIds；ApplicationClient.subtitles 与固定保存版 Reader 拒写同步接入。分析源的存在、类型、归属在选源／发送／重试分别校验，失效不自动换依据。见 [AI 字幕与分析源契约](ai-subtitles.md)。
