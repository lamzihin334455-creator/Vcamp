# 安装、更新与恢复

从 [v1.0.0 Release](https://github.com/lamzihin334455-creator/Vcamp/releases/tag/v1.0.0) 下载 [Vcamp-1.0.0.zip](https://github.com/lamzihin334455-creator/Vcamp/releases/download/v1.0.0/Vcamp-1.0.0.zip) 与 [SHA256SUMS.txt](https://github.com/lamzihin334455-creator/Vcamp/releases/download/v1.0.0/SHA256SUMS.txt)。也可按根 README 从源码构建。GitHub 自动生成的 Source code ZIP 不是浏览器安装包。

当前版本为 `1.0.0`，支持桌面 Chrome/Chromium 149 及以上；本轮安装和主要自动化检查运行于 Chromium 149.0.7827.55。维护者另在已登录的 zihin 浏览器完成候选版真实字幕与默认配置确认。其它浏览器与更新版本需结合验收记录，不能把版本下限理解为所有 Chromium 衍生浏览器都已测试。

## 安装

1. 核对发布页校验值：PowerShell 运行 `Get-FileHash .\Vcamp-版本.zip -Algorithm SHA256`，与 `SHA256SUMS.txt` 比较。
2. 解压至长期保留的独立目录，不要选择 ZIP 或临时清理目录。
3. 打开 `chrome://extensions`（Edge 使用 `edge://extensions`），开启开发者模式。
4. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的目录。源码构建对应 `extension/dist`。
5. 打开 Bilibili 视频页并点击扩展图标，按 [API 配置](api-settings.md) 保存连接、拉取并录入模型。

安装包不含 API Key。只拉取模型目录不会自动启用全部模型。安装完成后的图文操作流程见 [使用说明](usage.md)。

## 权限

| 权限 | 用途 |
| --- | --- |
| sidePanel | 浏览器侧栏 |
| tabs、webNavigation | 视频身份、导航与任务绑定 |
| scripting | 在受支持页面读取信息及用户请求的画面 |
| storage | 本机设置和受限 API 连接配置 |
| downloads | 用户主动导出资料 |
| Bilibili 与字幕来源 | 视频、字幕及相关证据 |
| 已列出的 API 来源 | 对应模型服务 |
| 可选 HTTPS 来源 | 保存自定义地址时申请该来源 |

HTML 学习页在限制联网和宿主访问的沙箱中执行，仍可能包含错误内容或消耗过多资源，见 [安全说明](../SECURITY.md)。

## 更新、身份与恢复

更新前导出 `.vcamp` 备份并保存旧安装包。使用原安装目录替换生产文件，在扩展管理页点击重新加载；不要先卸载。重新打开侧栏确认已有资料、模型与偏好。

未签名的开发者扩展身份与安装方式、路径有关。换路径、换浏览器、换 profile 或卸载重装可能形成新 ID，旧数据不会自动出现在新身份下。请在新扩展导入备份，并重新配置 API Key，备份不包含 Key。原有数据仍在时不要删除旧扩展。

迁移验证以 [发布记录](release/status.md) 为准。能读旧备份不表示旧代码能读取升级后的数据库。回退时先保存当前资料，再使用匹配版本及兼容备份恢复；不要让旧代码直接操作未知的新 schema。

## 排错

- 无字幕：核对支持的视频页、站点提供情况、登录状态和网络；不承诺自动完整转写无字幕音频。
- 模型不可选：确认已保存连接、勾选录入且支持文本。
- API 不可达：核对 HTTPS Base URL 与来源权限，勿填写控制台网页或含 Key 的 URL。
- 更新后资料为空：先核对 ID、路径和 profile，再尝试备份导入。
- 旧 HTML 行为不同：旧导出是独立文件，需在新版中重新导出才能获得新包装逻辑。
