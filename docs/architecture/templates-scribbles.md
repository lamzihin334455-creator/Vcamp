# T08/T10 模板版本、统一 @ 与空间随笔

S5 通过原 ApplicationClient／v1 信封访问兼容可选 templates、scribbles 方法；UI 不直接访问数据库。background 组合对应 Store，成功写入后 invalidate。唯一 database 入口升级到 **v5**，一次增加 templates（当前版本）、templateRevisions（不可变版本）、scribbles（空间资料），v4 workspaces/jobs/subtitleVersions/artifacts/noteRevisions 原样保留，不清库；旧版本程序不能打开 v5，应保留 profile 前向修复。

模板有 name/description/requirements/outputType/defaultModelId 五字段，另有仅html可携带的可选 outputProtocol 身份；自定义创建及 expectedRevision 编辑均产生新 revisionId，旧版保留。预置文案从已审 prototype 的快速总结、知识笔记、学习导图及 PRD 模板流程收敛：分别为 Chat 概括、Markdown 章节与关键时间点、交互知识JSON导图v2（保留旧自由HTML v1）；未沿用演示模型名、截图／工具脚本流程。内置版只读，可新建自定义模板；默认模型 null 使用选择时的真实配置默认模型，明确指定却不可用则保留该 ID、提示手动选择，不静默替换。

统一 @ 提供模板单选替换、手写随笔和 T07 当前 Chat 的 Markdown 多选。Draft.template 只保存 templateId/revisionId；选择时锁定输出并选默认模型，模型可手动改。退出只清模板，保留文字、输出和模型。模板编辑后提示有新版，重新选择才应用新版。freezeChat 同事务读取原模板版本与各引用的最新有效已保存版本，验证产物锁定、实际目标／归属与输入限制；冻结要求／版本／类型／实际模型到 snapshot 和用户消息。发送清模板，历史／retry 使用原快照。模板要求以用户数据 JSON 组装进 Provider 请求，没有脚本／工具／权限入口。旧HTML模板缺 outputProtocol 时拒发；用户检查要求并显式转换保存新版本、从@重选后才生成交互知识。新版本使用 knowledge-json-v1，随历史、重试与备份保留，未知或错配协议拒绝，详见[交互知识契约](interactive-knowledge.md)。

Draft v1 的可选 scribble `{text,time}` 是临时覆盖输入：原 text/template/references/outputType/modelId 仍原样保存。创建时捕获已有 VideoView.playback.time，可移除时间点；随笔无字幕／无模型也可记录。Enter 保存、Shift+Enter 换行，composition/isComposing/229 拒绝误提交。创建以固定 workspaceId/chatId/expectedRevision 验证 overlay；同一事务新增空间随笔、清 overlay、增加原 Chat 操作消息，随后恢复完整草稿。取消只清 overlay。失败／冲突保留输入，迟到提交不根据当前视频重新定目标。

随笔只有 id/workspaceId/text/time/revision，不绑定 Chat。操作记录为 `kind:scribble-operation`，正文不写入 Chat；freezeChat 在历史投影前排除整条操作记录，随笔不进入 Markdown 引用候选，overlay 存在时禁止 AI 请求。没有 Chat 时可独立创建空间随笔，查询不凭空造 Chat。模块列表、乐观修订编辑／取消、离开保存／放弃／取消均固定原目标，外部视频切换时允许保留原编辑；正文按文本显示。时间点调用现有 video.seek 的 preserve 策略，不更换模块或播放器实现。

固定 `reader.html?workspaceId=…&scribbleId=…` 无编辑器、不依赖 Chat，只允许查询该空间该随笔，请求层拒写和跨实体读。资料库已复用 ScribbleWorkbench 及独立数据接口；资料库、交互知识、附件、回收站和备份见各自当前契约，联网仍未接入。

直接验证：t08-templates/t10-scribbles 单测覆盖旧版冻结／原重试、锁定／HTML拒绝、空间归属／无 Chat／只读／v4 全表保留；t08-t10-http 安装脚本通过本地真实 HTTP 检查模板及多引用请求、随笔上下文排除、完整草稿恢复、组合输入、原空间迟到编辑、时间调用、无字幕记录、浏览器重启和 360px。时间调用使用测试构建 VideoPort，真实播放器的 preserve 实现沿用既有 T02 证据；没有新增实站或真实模型验收。
