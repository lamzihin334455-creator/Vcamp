# GitHub 准备与发布门禁

GitHub CLI 已成功认证。目标仓库为 [lamzihin334455-creator/Vcamp](https://github.com/lamzihin334455-creator/Vcamp)，origin 已配置；目前保持私有，用于完整 CI 与发布门禁验证。维护者确认授权后浏览器回跳出现 404，但 CLI 成功取得认证，GitHub API 也确认账号有效，因此没有重复申请凭据。以下治理配置仍需逐项启用并核验，不能视为已生效。视频继续暂停。

## 仓库与治理

仅将当前筛选后的公开历史上传目标仓库，不推送原工程私有 bundle 或恢复归档。默认分支使用 main；先让 `checks` 工作流运行成功，必需状态名以 GitHub 实际显示为准（计划为 `windows`）。首次上传前已修正工作流重复的顶层 name 键；线上执行结果以实际 Actions 记录为准。

主分支 ruleset：禁止 force push 和删除；合并前检查必须通过、分支需更新、讨论需解决。单人维护可以保留紧急修复通道，但必须留下变更与回归记录。外部 PR 使用只读 contents 权限，不接收真实 API Key，不采用 pull_request_target 执行外部代码。

启用 Settings → Security → Private vulnerability reporting，核对 Security 页的私密报告入口，再更新 SECURITY.md 的真实链接。启用依赖图、Dependabot alerts，并结合可用能力配置 secret scanning。平台或套餐不支持的能力应明确记录。

## Release 与链接

最终准备完成后从干净提交构建：npm ci、typecheck、unit、production build、license inventory、package、E2E 和 package acceptance。正式 v1.0.0 需要去掉 package prerelease 后缀，同步 manifest version/version_name，重新构建及验收，不直接重命名候选 ZIP。

Release 正文说明支持的浏览器/站点、Key 自备、已验证范围、升级备份步骤、已知限制和安装指引。上传浏览器 ZIP、build-manifest.json、SHA256SUMS.txt，视频素材按用户后续决定处理。GitHub 自动源码归档与浏览器包区别明确。

公开后以未登录浏览器检查 README、LICENSE、Security、Release、安装下载链接；重新下载 ZIP 对照 SHA-256并用隔离 profile 安装。只有真实线上链接与已启用设置才能关闭 P60/P61。

## 热修复与回退

发布缺陷时保留已发布资产供核验，标注受影响版本并给出修复版本。数据问题优先指导备份与停止破坏性操作。回退代码不能代表数据库可降级；使用兼容备份恢复。凭据一旦确认泄漏，先撤销/轮换，再处理仓库历史。
