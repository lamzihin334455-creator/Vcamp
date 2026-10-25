# T19/T21：可恢复删除与可重建缓存

公开入口沿用 `ApplicationClient.library` / LibraryPort；工作台与资料库的 DeleteButton 先 `library.trash.preview`，展示影响及活动任务数，再以稳定 target 和 expectedRevision 确认 `library.trash.move`。`library.trash.query` 返回独立删除项、原 target、删除时间、管理 revision 与 parentDeleted；`library.trash.restore` 只按原身份解除删除标记。reader 所有管理命令在路由及 client 拒绝。

Workspace / 内嵌 Chat / Markdown / Scribble / SubtitleVersion 兼容增加 `deleted`、`deletedAt`、`managementRevision`。不新增 trash 副本或硬删行。空间删除仅标记父级，所有标准查询和写入检查父级；先前独立删除的子项标记不变。恢复子项要求父级存活，返回 parent-deleted 提示；恢复不新建 Chat、来源、收藏或文件夹。删 Chat 留原 sourceChatId，Markdown 仍可浏览并显示来源对话已删除，编辑和其他 Chat 的引用拒绝。删除选定 AI 版本保留原 analysisSource ID，失效不回退；恢复后同一保存版重新有效。

IndexedManagementStore.move 在包含 workspaces/jobs/artifacts/scribbles/subtitleVersions 的单个 readwrite 事务中提交删除标记、管理 revision、所属非终态 attempt 的 stopped / seq 及对应可见回答状态。草稿正文保留，删除 Chat／空间递增所属草稿 revision，旧延迟保存不能覆盖恢复后的输入。空间删除保留所有请求快照、消息和版本行。删除与 finish 共享事务作用域：第一个任务终态胜出，已停止 attempt 的 checkpoint/finish/claim 不得写入；恢复不改变 attempt，也不调用执行／重试。正常 open 拒绝已删空间，面板显示显式恢复入口；空空间不凭空造 Chat。观看位置回写拒绝已删空间及删除之前的旧观测。固定 reader 刷新删除状态并移除不可用对象。

事务完成后才交 TaskService.releaseDeleted 释放内存字幕、关闭精确匹配的 executor，并推进其他已接受队列；仍使用既有状态机。关闭失败不会放开提交限制，后续通知／Worker 恢复会再核对终态执行标签。删除 Chat 不触及同空间字幕任务；删空间停止两类任务及排队项。无永久删除、清空、自动清理。

唯一数据库从 v6 一次升级至 **v7**，仅新增 `cacheEntries {id,…}`、`cachePlans {planId,…}`，保留所有 v6 表／行／关系。软删除字段本身不需要迁移。CacheEntry 只允许 `video-metadata` / `derived-preview` 两种明确可重建类别，独立于长期资料表，载荷为 Uint8Array，计量为实际载荷 byteLength（不宣称测得浏览器磁盘分配释放量）。**当前没有生产缓存写入方**，生产查询／预览真实为 0 项／0 字节；put / touch 只由测试调用，生产不植入演示缓存，不缓存原字幕。

存储管理默认超过 30 天，可选时间与类型。preview 持久保存具体候选 ID、revision／类别／载荷大小／最近访问及关联空间管理与访问依据，10 分钟有效。任何真实收藏关系（含不可用关系）保护其稳定 platform/videoId 的全部 P；已删除空间也受保护。execute 在 cacheEntries/cachePlans/workspaces/favorites 同一事务中重验类型、版本、访问、父级及收藏，任一候选变化则整体 plan-expired 并要求重算。新行不会被旧计划选中。清理只删除计划里的 CacheEntry；失败整体回滚、实际清理 0，保留计划可重试；成功持久保存计量凭证，重复执行返回原凭证，不重复删除／累计。当前均为 IndexedDB 载荷，不存在外部文件的部分提交路径。

T20 备份须保留原 Workspace / Chat / 实体 ID、sourceChatId、删除标记／时间／管理 revision、完整草稿与 revision、消息、不可变成果／字幕／模板版本、请求历史与 attempt 终态、收藏关系、观看位置。父子独立删除状态必须往返；保留 deletedAt 也用于迟到观看位置的隔离。cacheEntries / cachePlans 是临时载荷／计划与回执，排除备份；不能因备份恢复删除前 attempt 而自动调用模型。本批未实现 T20。

证据入口：`tests/unit/t19-trash.test.ts`（删除竞争、父子恢复、分析源、事务 abort）、`t21-cache.test.ts`（分类、具体收藏保护全视频、预览失效、清理回滚／准确计量、v6 行保留）；`tests/installed/t19-t21-http.mjs` 使用本机受控 HTTP、合成 Key 和独立 profile，测试专用 management-seed 仅进 test-extension 构建，不进生产。沿用播放器／内容显示证据，不重新跑实站或真实模型矩阵。
