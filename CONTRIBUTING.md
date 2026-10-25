# 贡献

使用 Node.js 24，在 extension 目录 npm ci --ignore-scripts，修改后执行 typecheck、npm test 和 npm run test:e2e；E2E 先安装 Playwright Chromium，默认不调用真实模型。当前 CI 目标 Windows。

前端交互方案已确定。先复现可观察的问题并写明预期/实际，避免附带重设计。历史资料、角色和模板按版本冻结。测试验证行为与隔离边界，不通过放宽断言掩盖失败。

测试素材使用自制合成内容并记录来源，勿提交真实视频字幕、Key、账号或抓取响应。检查文件列表，排除 .env、profile、.tmp、node_modules、测试结果和用户备份。项目自身许可证待确定，公开接受贡献前补齐许可及安全报告入口。
