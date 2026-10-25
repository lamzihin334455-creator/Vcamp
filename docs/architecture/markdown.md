# T06/T07 Markdown 成果、版本和当前 Chat 引用

2026-10-14；W4-T06T07-01。复用 T05 的 freeze/attach/claim/checkpoint/finish/retry、可信执行页及 ProviderPort，不新增生成宿主或权限。支持 `chat`、`markdown` 及当前 Chat 的 Markdown 引用；当前模板、主动截图附件及JSON交互知识分别由T08/T15/T09接通；Markdown编辑与通用引用仍限定markdown，联网仍关闭。真实模型未调用，下面描述的是实现与受控 HTTP 验证。

唯一数据库 `vcamp` 在 `data/database.ts` 升到 v4，一次新增 `artifacts` 与 `noteRevisions`；不改 v3 workspaces/jobs/subtitleVersions。`StoredArtifact` 固定 workspaceId/sourceChatId/jobId/attemptId，指向不可变 `NoteRevision`。成功 finish 在同事务提交完成凭证、新成果、首版、来源关联与消息 artifactId；停止／失败只更新任务及消息，重复终态幂等。事务失败全部回滚，不影响旧成果。Markdown 回答带 outputType 标记，不进入后续 historyProjection；只有用户主动引用的正文进入模型。

`IndexedArtifactStore.list(workspaceId, sourceChatId?)` 返回最新已保存正文与版本；指定 sourceChatId 时仅返回仍存活来源的本 Chat Markdown。不指定来源可浏览空间内笔记，包括来源已删除的成果。`save(workspaceId, artifactId, expectedRevision, content)` 检查归属与 revision，同事务创建新不可变版本、更新最新指针。取消编辑不调用 save，冲突保留编辑文字。`revisions` 为公开历史版本查询。`remove` 和 `IndexedWorkspaceStore.removeChat` 是仅数据层的删除失效验证入口，没有删除消息/UI、恢复或回收站；删除 Chat 保留成果、停止其活动 Chat 任务，不影响字幕任务。T19 仍需补管理编排及真实宿主释放联验。

`ApplicationClient.artifacts` 是可选兼容接口，v1 信封新增 `artifact.query` 与 `artifact.save`。View 新增可选 artifacts；既有客户端继续可用。后台、运行 schema、Chrome client 为消费者。`main.tsx` 注册 MarkdownWorkbench；`MarkdownArtifactViewer` 遵守 ArtifactViewerProps，可在工作台编辑或以 readonly 渲染。编辑页面与只读页面共用 MarkdownContent；只读分支没有 textarea、编辑、发送、引用或凭证能力。reader URL 固定 `workspaceId` 与 `artifactId`，路由拒绝其他 artifactId 和所有写命令。T17 资料库导航尚未实现，本批实际以该 reader URL 联验。

查看与编辑不改变当前输入 Chat；只有「打开来源对话」主动选择来源。生成成功不自动切模块。编辑离开提供保存／放弃／取消；网页外部换视频时保留原笔记编辑，保存固定回原空间，取消后可通过提示转到当前视频。刷新／关闭窗口的未保存修改使用浏览器 beforeunload 提示。

草稿继续使用 T03 的 referenceIds/references；描述只用于显示。`freezeChat` 在包含 workspaces/artifacts/noteRevisions/jobs 的同一 readwrite 事务中重新检查有效实体、同空间／同来源 Chat、Markdown 类型及最新 revision。冻结 `referenceSnapshots[]`（snapshotId/artifactId/revisionId/revision/title/content），referenceSnapshotIds 指向这些冻结 ID。用户消息与历史投影携带对应不可变内容，ProviderPort 的最终用户输入和允许历史显式附上资料 JSON。重试只沿用原 snapshot，不重新读取成果；编辑／删除不更改已接受请求的依据，来源目标本身删除仍禁止重试。

现有上限仍适用：输入 8,000 字符、历史 12,000、服务请求 60,000；新增本次引用标题与正文合计 12,000，历史中的引用正文计入历史上限。超限明确拒绝，保留草稿，不静默截断。多份引用不改变已选 outputType。

渲染使用固定 `react-markdown@10.1.0`，按[官方说明](https://github.com/remarkjs/react-markdown)使用 React 元素及 `skipHtml`，不加载原始 HTML 插件或执行脚本。仅允许 http/https/mailto/片内锚点，链接新窗口带 noopener/noreferrer；图片显示说明文字，不加载模型指定远程资源。保留 CommonMark 标题、列表、引用和代码块；GFM 表格／数学扩展本批未加。

验证入口：`npm run typecheck`、`npm test`、`npm run build`、`npm run build:test`，然后 `node tests/installed/t06-t07-http.mjs`。端口 43105、独立 profile、合成视频／Key、本地真实 HTTP SSE；执行器和 Worker 无调试附着。安装闭环含普通 Chat 冒烟、笔记生成／主动打开／保存取消／脏编辑、两份引用／标签移除／刷新恢复、编辑后原请求重试请求体相同、新发送读取最新版、浏览 B 返回仍 A、固定只读拒写及危险内容、360px 长文截图。真实模型、旧站点全矩阵、T17/T19 管理流程 not-run。
