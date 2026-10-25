# Vcamp

Chrome 侧栏中的视频学习工作台：字幕、问答、笔记、交互学习页与本地资料管理。

AI 功能使用你自己的 API Key，费用由服务商收取；资料保存在本机，没有项目自建账号或云同步。

**v1.0 发布工程进行中，尚未公开发布。** 验证状态见 [发布记录](docs/release/status.md) 与 [候选验收](docs/release/validation.md)。GitHub 自动生成的源码 ZIP 不是浏览器安装包。

## 开始使用

1. 按 [安装教程](docs/install.md) 构建或加载生产扩展。
2. 打开 Bilibili 视频，点击扩展图标打开侧栏。
3. 在设置 → API 设置保存连接，拉取模型并勾选录入，然后回到视频提问。
4. 在资料库保存和导出学习资料，定期下载备份。

支持 DeepSeek、阿里云百炼、商汤日日新及自定义 OpenAI 兼容 HTTPS 服务。第三方连接目前仅开放文本；视觉和联网仅在满足条件的 DeepSeek 官方连接下提供。模型与额度以服务商实际返回为准，详见 [API 配置](docs/api-settings.md)。无字幕或画面证据不足时不能保证理解完整视频，生成内容应结合原视频核对。

## 开发与构建

使用 [.node-version](.node-version) 指定的 Node.js 和 npm 11：

```sh
cd extension
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run licenses
npm run package
```

生产 ZIP、SHA-256 与构建清单输出至根目录 `out/`。执行 `npx playwright install chromium` 后运行 `npm run test:e2e` 进行浏览器回归。默认测试使用合成数据和受控响应，不需要真实 API Key。

## 文档与许可

- [安装、升级与备份](docs/install.md) · [API 配置与故障排查](docs/api-settings.md)
- [架构与信任边界](docs/architecture.md) · [发布范围](docs/release-scope.md)
- [隐私说明](PRIVACY.md) · [安全报告](SECURITY.md) · [贡献指南](CONTRIBUTING.md)
- [变更记录](CHANGELOG.md) · [Standards 审查](docs/release/standards-review.md) · [Spec 审查](docs/release/spec-review.md)

自有代码以 [MIT](LICENSE) 发布，依赖保留各自许可证，见 [第三方声明](THIRD_PARTY_NOTICES.md)。`promo-video/` 为独立的演示制作工程，其 Remotion 使用条件与扩展运行时分别管理。
