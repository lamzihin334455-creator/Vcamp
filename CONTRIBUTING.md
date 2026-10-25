# 贡献指南

使用 .node-version 指定的 Node.js 和 npm 11，在 extension 目录执行 npm ci --ignore-scripts。修改后执行 typecheck、npm test、build 和相关浏览器回归；完整浏览器回归为 npm run test:e2e，先安装 Playwright Chromium。CI 目标 Windows，默认测试使用合成资料与受控响应，不需要真实 Key。

先描述可观察的问题、预期行为及最小复现，再实施修复。避免夹带 UI 重设计。涉及权限、数据和兼容性的修复应增加能捕获原缺陷的回归测试；不要删除测试或放宽关键断言掩盖失败。角色、模板和任务历史按版本冻结。

不得提交 .env、API Key、profile、个人备份、真实完整字幕或未经脱敏的请求响应。提交前检查 git diff --cached 和忽略规则。安全漏洞不要发公开 Issue，见 [安全说明](SECURITY.md)。

自有贡献采用 MIT 许可证；第三方代码、字体、图片和视频保留来源与许可。运行时依赖变化后重新生成第三方许可清单。视频工具链与扩展分别管理。

PR 描述问题、行为变化、验证和限制。维护者合并前等待 checks / windows 等必需检查完成。
