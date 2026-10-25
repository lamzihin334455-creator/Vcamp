# 阶段一隔离界面预览

在 extension 目录运行 `npm ci`、`npm run dev -- --port 4179`，打开：

- `http://127.0.0.1:4179/rectification-preview.html`：真实 App 与模块呈现层，示例回答、本地工作空间及编辑测试。
- `http://127.0.0.1:4179/rectification-preview.html?design=1`：待确认的 HTML 页面/初始化、视频理解移位、随笔时间块、视频切换状态示意。

入口不属于 Vite 生产构建，示意组件不由生产入口导入。
预览使用 `vcamp-rectification-a-preview` 独立 IndexedDB 与 `rectify-preview.*` 本地偏好；复用生产工作空间、笔记、随笔及模板存储实现。
示例视频、字幕、模型列表、回答只用于视觉对照；没有真实凭证。Provider 的修改/请求与 generation 的所有非查询操作明确拒绝，未接视频捕获、定位或资料库。
本页验证不能替代已安装扩展、真实视频及系统中文输入法验收。

## OPT-UI-01 补充

本轮预览使用 `vcamp-opt-ui-preview` 独立数据库，新增13个示例视频/多P与两个收藏文件夹。
资料库查询、收藏、删除预览复用真实服务与存储；打开视频/阅读器仅报告示例目标，不启动外站或正式阅读器。
`?task=failed` 显示静态失败夹具，重试只在内存切为running，停止只切为stopped；这些是本地UI接线演示，不产生模型请求。
`?sample=empty` 可看空白布局。生产构建不包含此HTML入口。
识别开关复用现有配置适配器按workspaceId/chatId隔离，不再读旧全局值。预览偏好只写此页面的localStorage；扩展写chrome.storage.local。
