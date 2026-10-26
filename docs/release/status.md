# v1.0 验证与发布记录

正式安装包、校验值、构建来源和最终验收结果统一保存在 [v1.0.0 Release](https://github.com/lamzihin334455-creator/Vcamp/releases/tag/v1.0.0)。完整线上检查见 [checks](https://github.com/lamzihin334455-creator/Vcamp/actions/workflows/ci.yml)。本文保留发布前已取得的证据，线上状态与最终资产以 Release 为准。

公开源码从筛选后的基线 `fe026729becdd20d34ea8ac2f9b6d5dc4b2907d9` 建立；原工程、完整历史恢复材料、ENV 和用户完整备份保存在公开仓库之外。Standards 与 Spec 两条基线审查分别见 [Standards](standards-review.md) 和 [Spec](spec-review.md)。审查覆盖重点边界，不等同于全仓逐行证明。

基线审查的 5 项必要 P2 已修复并补回归；最终 CI 排查另发现关闭联网后立即重试的 P1 竞态，以及字幕选择、操作提示、权限变化和草稿快照的四项 P2，修复及回归见 [修复清单](fixes.md)。最终是否通过发布门禁以 Release 验收附件为准。自有代码 MIT；110 个生产依赖为 MIT/ISC，扩展运行时已移除 Remotion。模型使用与独立复审的服务限制见 [实际执行记录](model-execution.md)。

当前默认目录严格采用维护者确认的 4 个角色和 5 个模板，原文、顺序及来源见 [内置目录](default-presets.md)。RC.2 本地验证为 678 项单测通过、3 条件跳过，23 项相关浏览器回归通过；原候选完整运行与失败修正不能拼接成一次全绿，详见 [RC.1 记录](validation.md) 与 [RC.2 记录](rc.2-validation.md)。正式版本由独立完整 CI 再验证。

正式门禁期间的单测并发与重载准备时序修正见 [CI 稳定性记录](ci-reliability.md)。这些调整仅涉及测试及其调度，最终完整结果仍由 Release 附件记录。

维护者于 2026-10-26 在 zihin 浏览器手动完成 RC.2 安装，打开真实有字幕视频，确认字幕可读、角色及模板顺序正确；提供的截图显示 848 条中文 ai-zh 字幕。此项为维护者人工确认，未伪记为工具自动验收。截图包含真实站点内容，只保存在私有验收目录。最终版保留该候选的默认内容及顺序，另修正上述交互竞态并收敛版本、文档和发布配置；最终 ZIP 仍须另行通过完整 CI、安装及升级检查。

真实 DeepSeek 样本累计使用 4 / 300 次请求，材料为自制合成教材，问答、Markdown 和 HTML 的实际响应及 HTML 离线交互已验证。本轮默认配置调整和发布自动化不消耗真实模型 API。该证据不代表所有站点、服务商或生成内容质量都已覆盖。

GitHub 认证成功，目标仓库为 [lamzihin334455-creator/Vcamp](https://github.com/lamzihin334455-creator/Vcamp)。发布流程先在私有仓库完成完整 CI，再公开源码、配置主分支保护及私密漏洞报告入口、发布正式资产，最后用未登录访问与重新下载完成复验。治理操作与最终结果写入 Release 验收报告。

产品演示视频由维护者暂缓，后续另议制作方法；不进入本次技术发布的完成范围。Chrome Web Store 上架、新站点、ASR Lab 与 Studio Lab 均不在此次发布范围。
