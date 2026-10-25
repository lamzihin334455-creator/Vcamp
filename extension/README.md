# Vcamp 扩展工程

产品与构建见 [根目录 README](../README.md)，安装升级见 [安装教程](../docs/install.md)，服务设置见 [API 配置](../docs/api-settings.md)。

在本目录执行 npm ci --ignore-scripts、npm run typecheck、npm test、npm run build。生产目录为 dist，执行 npm run licenses 和 npm run package 后在根目录 out 获得 ZIP 和校验文件。

浏览器测试先执行 npx playwright install chromium，再运行 npm run test:e2e。测试自动构建独立生产候选、dist-test 与 dist-capture，不覆盖正在使用的 dist。测试构建含本地 HTTP 权限和 seed/probe 页面，不得分发。

付费联调由 scripts/qualify-live.mjs 单独运行。ENV 和结果应位于公开仓库外，请求预算先记录再调用，失败也计数。不要使用个人资料作为公共测试夹具。
