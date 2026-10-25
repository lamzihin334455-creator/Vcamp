# T17/T18 资料库、固定只读和收藏

T19/T21 已兼容扩展可恢复删除及手动缓存清理；当前数据库为 v7，行为和备份影响见 [管理契约](management.md)。下文 v6 是 T17/T18 的迁移记录。

唯一数据库仍为 `vcamp`。`ApplicationClient.library` / v1 信封新增标题查询、固定空间目录、受控打开、文件夹与收藏命令；UI 不读取整库或凭证。查询按 platform/videoId 聚合、workspaceId/partId 区分；仅检索视频主标题。新 VideoKey 兼容增加 videoTitle/partTitle/pageNumber/partCount，旧记录按既有解析器的 ` · Pn ` 装饰标题分离；旧媒体没有 pageNumber 时，VideoPort 通过既有授权的 view 元数据按 CID 找正确 P，不猜第一 P。交互式 open 更新 lastOpenedAt；只读查询不改变最近顺序、recentChatId、草稿或 analysisSource。

`reader.html?library=1&workspaceId=…` 固定一个空间，可附 chatId/artifactId/knowledgeId/scribbleId/subtitleVersionId 指定初始对象。模块与 Chat 选择只存在页面内。后台按 URL 限制 library.read、workspace.query、同空间存活 Chat 的 generation.query、同空间成果只读查询；拒绝跨空间／伪造具体对象、所有写入、库查询和打开媒体命令。无存活 Chat 的空间仍可读其资料。Markdown、随笔、字幕和 Chat 消息复用既有组件；来源 Chat 只在本资料页导航。字幕菜单仅列保存的 AI 版本，页面不查询原生字幕、不连接 PlaybackPort、不提供引用／编辑／生成；交互知识复用可信文本阅读器，可离线展开与浏览关系，reader不发送新AI请求；明确“回来源对话继续”打开工作台后核对来源视频分P与Chat，删除来源禁新追问，见[交互知识契约](interactive-knowledge.md)。

`library.open` 只在受控应用入口接受稳定 LibraryTarget，先重新检查实体存在与归属，再打开固定 reader 或调用 VideoPort.open。视频普通打开使用持久观看位置，引用打开显式 time。创建空标签、登记受控标签、导航正确媒体，在真实解码／可定位媒体就绪后经既有单次 isolated guard 校验、暂停和 native seek；身份变化、未授权、加载／定位超时明确失败。新页的短期暂停保护在打开过程中阻止站点自动播放，完成后允许用户手动继续观看。只读页没有 VideoPort 权限。成功的视频 UI 动作回到问答并恢复该空间最近 Chat。

观看位置是 `workspace.watchPosition {time, observedAt}`。只接受 VideoPort 实际观测值，按原绑定媒体的稳定键回写；观察队列、生命周期／解码身份校验与时间戳顺序防止旧事件串空间或覆盖较新的值。受控打开中尚未恢复的位置不写回；只读浏览不会改进度。lastOpenedAt 与观看位置均是原 workspace 的兼容字段。

唯一升级入口从 v5 一次迁至 **v6**，新增 `folders {id,name,revision}` 和 `favorites {id,folderId,target,title,videoTitle}`，保留所有旧表与行。target 固定 `{workspaceId,entityType,id}`，类型仅 workspace/chat/markdown/scribble/subtitle；subtitle 仅有效保存的 AI 版，不包含原生字幕和 Chat 附件。favorite.id 是 `[folderId,workspaceId,entityType,id]` 的稳定 JSON；同元组唯一索引保证去重，folderId 索引用于事务删除关系。标题仅为失效对象的显示元数据，不复制正文或改变归属。文件夹单层；重命名与删除检查 expectedRevision。移除收藏只删关系，删除文件夹在同一事务删文件夹及其关系，不访问资料删除接口。

`library.query {folderId:'all'}` 的全部已整理只从真实收藏关系投影。具体文件夹按 folderId 过滤；失效对象保留 available:false 和原目标，不替换为其他资料。每次打开再次检查目标。稳定关系格式预留后续备份，但本批没有备份、回收站或清理实现。生产 manifest 权限不变；安装测试包将既有 B 站可选权限预授予，添加独立语义数据创建页，生产构建不包含样例或该测试入口。
