# Vcamp v1.0 演示制作规格

## Production settings

- 产品：Vcamp v1.0 候选，最终镜头绑定通过验收的包和 commit。
- 平台与观众：GitHub README / Bilibili；需要将视频知识沉淀为资料的学习者。
- 主片：1920×1080，30fps，90.0 秒；短版同规格 24.0 秒；封面 PNG。
- 核心承诺：把视频内容整理成可以回看、保存和导出的学习资料。
- CTA：打开项目 README，按安装说明开始。公开链接未建立前不能写“现已发布”。
- 视觉：米白底、深石墨文字、淡蓝强调；真实侧栏是主角。中文使用本机 Microsoft YaHei，字体不随源码分发。动效强调信息层级，避免无目的旋转与频繁缩放。
- 音频：无旁白、无第三方音乐；完整屏幕文案保证静音可看。需要配音时另行增加，不能假装已有配音。
- 无参考视频，工作流图片仅提供执行顺序。

## Evidence ledger

| Claim | Status | Source | Allowed wording |
| --- | --- | --- | --- |
| 字幕阅读、问答、笔记、HTML、资料库 | verified | extension/src 与现有自动化 | 支持这些工作流；模型输出需核对 |
| Key 自备、资料本地保存 | verified | credential-store / database / PRIVACY | 自带 API Key，本机保存资料 |
| 所有视频均可理解 | todo | 无此证据 | 禁止使用 |
| 真实 AI LRU 样本 | verified | 私有 live report，4 次请求 | 合成教材上的真实模型结果，不展示私有原始日志 |
| 正式包全部验收完成 | todo | docs/release/status.md | 完成前仅标候选 |
| 真实插件操作录屏 | todo | RC 后 isolated profile | 录屏使用合成演示资料，剪辑注明 |

## Shot table

| ID | In-out | Purpose | Visual/source | On-screen copy | Narration | Motion | Transition | Audio cue | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S01 | 0.0–7.0 | Hook | 自制文字与 Vcamp 品牌 | 看过的视频，留下多少？ | 无 | 标题 0.6 秒上移 24px 淡入，随后静止 | 硬切 | 无 | 标题可读至少 5 秒 |
| S02 | 7.0–15.0 | Reveal | 正式侧栏全貌截图 | Vcamp / 视频学习工作台 | 无 | 截图 0.7 秒由 96% 放大至 100%，不裁标题 | 硬切 | 无 | 真实界面、版本可追溯 |
| S03 | 15.0–29.0 | 字幕证据 | captures/subtitles.webm | 沿着字幕，回到原视频 | 无 | 真实点击时间；辅助标注 0.4 秒淡入 | 硬切 | 无 | 点击后视频时间改变，合成教材标注常驻 |
| S04 | 29.0–45.0 | 问答 | captures/chat.webm | 带着问题学习 | 无 | 固定镜头；等待剪辑处注明“等待已剪辑” | 硬切 | 无 | 不把 fixture 响应称真实 AI 结果 |
| S05 | 45.0–59.0 | 笔记与 HTML | captures/documents.webm | 整理为笔记与交互学习页 | 无 | 点击文档、切换阅读器；无虚构界面 | 硬切 | 无 | 文字与 HTML 控件可见 |
| S06 | 59.0–73.0 | 保存与导出 | captures/library.webm | 留在资料库，随时导出 | 无 | 实际选择、下载；关注点保持在操作区 | 硬切 | 无 | 下载成功且不含账号或 Key |
| S07 | 73.0–82.0 | 边界与控制 | 真实设置截图 + 文字 | 自带 API Key / 本机保存 / 定期备份 | 无 | 三条顺序淡入，间隔 0.7 秒 | 硬切 | 无 | Key 输入为空，说明生成内容需核对 |
| S08 | 82.0–90.0 | CTA | 品牌与 README 指引 | 从一段视频，建立自己的资料库 | 无 | 0.6 秒淡入，余下保持 | 结束 | 无 | 未公开前无虚假下载 URL |

各镜头连续无重叠，共 90.0 秒。短版使用 S01 4 秒、S02 4 秒、S03 5 秒、S05 5 秒、S08 6 秒，共 24.0 秒。短片说明同样保留合成演示与剪辑标注。

## Asset manifest

| Asset | Owner/source | Status | Used in shots | Notes |
| --- | --- | --- | --- | --- |
| Vcamp 品牌图形 | 项目自有 src/brand | available | S01/S02/S08 | MIT |
| 合成 LRU 教材 | 本项目自制 | available | S03–S06 | 不使用真实站点个人内容 |
| captures/*.webm | 候选包隔离 profile 真实操作 | todo | S03–S06 | 不可用模拟 UI 替代 |
| 截图 | 同一候选包 | todo | S02/S07 | 不含凭据、个人账号 |
| 字体 | OS Microsoft YaHei | available | 全片 | 仅渲染输出，不分发字体文件 |

## Audio and subtitle timeline

无音轨。画面标题承担信息传达；S03–S06 常驻“合成教材 · 真实插件操作 · 流程演示”，如使用受控响应再明确注明。屏幕字幕不声称即时速度。S07 明示“模型内容需核对；卸载前请备份”。

## Open decisions

公开仓库身份和 URL 尚未可用，CTA 先引用 README。正式录屏需等 RC 通过。若核心流程仍失败，视频只能作为候选演示，不能成为正式发布证明。
