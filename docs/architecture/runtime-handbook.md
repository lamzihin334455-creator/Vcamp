# 运行手册与协作契约

2026-10-16 当前交付入口：T22正式包、安装／升级／恢复与人工验收（历史内部记录，未纳入公开源码：`../reports/T22/efaf388bb016/integrator/manual-acceptance.md`）。T01—T21已按获派范围集成；下文按时间保留的“尚未接入／未集成”说明属于历史阶段，不代表当前功能。当前数据库v8／备份format3，支持严格JSON交互知识、附件、自主视觉和独立联网取证；真实质量与完整兼容仍待验。

## T02 候选增量（2026-10-14）

W2-T02-FIX-01 定向回归为 `npx vitest run tests/unit/t02-fixes.test.ts` 与 `npx playwright test t02-fixes.spec.ts`。新增 MP4 是固定 03 探针的合成 8 秒视频，验证实际解码元素／产品时间按钮；不是 B 站媒体。缺 player/cid 时失效实时操作，但已确认本地空间仍可访问；有绑定的服务 403 提供“重新读取字幕”，缺 host 权限仍需原生授权。`node tests/manual/t02-real.mjs --smoke` 仅复验普通字幕／暂停与播放定位；通过 CDP 对实际运行 Worker 及导入脚本读取源码并只归档哈希，与 dist 对照，原始脚本／字幕正文不进入报告。

当前 T01/R2 已集成状态以固定集成报告与派工 BASE 为准；下文历史“未集成”抬头保留。T02 候选现在由 `src/video` 装配生产视频绑定，`src/content/observer.ts` 是独立无 import 的 isolated 内容脚本入口。`dist` 不含实验 driver、测试绑定或业务夹具；`dist-test` 仍只用于 T01 固定绑定回归。

完整验证依旧为 typecheck/test/build/build:test/test:e2e；T02 定向 `npx vitest run tests/unit/video.test.ts tests/unit/subtitles.test.ts tests/unit/video-router.test.ts`、`npx playwright test t02-video.spec.ts`。后者复制正式 JS/CSS 到忽略的 `.tmp` 包，仅测试 manifest 将三项可选来源改为已授予主机；外部页面／HTTP 字幕是 synthetic，不能当实站证据。`node tests/manual/t02-real.mjs` 在 Chrome 专用 profile 安装正式 dist，等待用户手动登录与站点授权；按终端提示在本轮 output 写 continue 标记后运行，仅存日期、公开媒体身份、字幕统计／指纹和结构验证，不写正文／cookie／带签名 URL。T02_PROFILE/T02_OUTPUT 可明确复用自己 profile 与独立输出；每次 CDP 重装需重新核对权限。

正式操作：打开 B 站 BV 视频，在 Vcamp 点击“授权读取 B 站”并确认 Chrome 提示；标题显示完整读取、就绪、无字幕、鉴权或失败，失败可重新读取。绑定确认后输入立即通过原 IndexedDB 草稿事务保存。字幕模块显示完整原始轨道，时间按钮保持原播放状态；侧栏关闭／重开重新查询，不从磁盘加载原字幕。AI 未接入始终禁用发送；无字幕也保留本地空间。固定 reader 不抓原字幕，不提供时间操作。

T02 的共享 DTO／权限／消费者兼容与信任边界见 `docs/decisions/T02.md`。生产草稿保存必须带固定 target 的 workspaceId/chatId；新 ApplicationClient 自动带所属窗口 ID，查询按那个窗口的活动标签绑定。原 schemaVersion=1、稳定空间键、chatId、事务确认及 revision 保留，无数据库迁移。T03/T05/T11/T15/T16 仍需独立派工。

2026-10-13；作者 01。仅 PREP → T01 候选，未集成，未经过 02/03 独立验证。R1 尚未启动。

## 目录、命令和构建

正式工程 `extension/`，不导入 `prototype/` 或原型脚本。工作目录为该目录，依次执行：

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run build:test
npm run test:e2e
```

- Node 24.16.0、npm 11.13.0；TS 5.9.3、React 19.2.0、Vite 6.4.2、Vitest 3.2.4、Playwright 1.61.1、Zod 4.1.12，精确依赖见 package-lock.json。
- `dist/` 是可加载的正式扩展目录，**生产未绑定，不含示例视频或业务记录**。首次数据库打开可建空对象仓库，不会产生 Chat。T02 尚未实现，浏览 B 站也不会自动建立绑定。
- `dist-test/` 仅用于 T01 验证。Vite 的显式 `test-extension` 模式将 `@binding` 指向 `tests/adapters/binding.ts`，其他代码与正式实现相同。测试视频只提供稳定媒体键和标题，空 Chat 和草稿由正式应用／IndexedDB 路径创建；不是预置业务记录。不得将该目录当生产包交付。
- `npm run dev` 只供模块开发，普通网页没有 chrome.runtime，不能用普通网页访问替代已安装扩展验收。
- E2E 需要 `npx playwright install chromium`（本机已存在）。常规扩展测试使用 Playwright Chromium 149.0.7827.55；原生侧栏测试使用本机 Chrome 155.0.8059.39，Windows 默认路径写在测试中，可用 `VCAMP_CHROME` 指定其他 Chrome 可执行文件。
- 原生测试通过浏览器级 CDP `Extensions.loadUnpacked` 安装，需 `--enable-unsafe-extension-debugging`；该参数只用于隔离测试进程。生产安装为 Chrome 扩展管理页加载已解压的 `dist/`。生产最低 manifest 版本声明为 Chrome 116；实际只在上述版本验证，旧版支持未验收。原生测试调用 Chrome 141+ 的 close API，生产代码不依赖该 API。
- `.profiles/`、`.tmp/`、`dist/`、`dist-test/` 不入库。测试每次创建新 profile，并在同一次生命周期测试中复用；不接触用户个人 profile。
- 工具来源：[Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)、[Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)。原生宽度以测试结果为准，不靠源码数值推定。

| 路径 | 运行位置／职责 | 后续写入归属 |
| --- | --- | --- |
| public/manifest.json、vite.config.ts、锁文件、HTML 入口 | MV3 多入口及 CSP | 01 单写 |
| src/background.ts | Service Worker，组装应用和存储，可信消息／订阅入口 | 01 |
| src/contracts/ | 唯一共享 DTO、运行校验、冻结类型 | 01 统一合入，消费者提出兼容变更 |
| src/app/ | ApplicationClient、壳层、模块注册、图标、布局、动效 | 01；S5/S6 通过注册接入 |
| src/data/indexed-store.ts | 无 React／Chrome DOM 依赖的最小存储 | T01 起始实现；T03 起 04 维护设计，迁移编号经 01 串行分配 |
| src/main.tsx | 按固定 HTML 入口创建交互／只读 client | 01 |
| tests/unit、tests/e2e、tests/adapters | A/C/D 测试与外部输入适配 | 作者／02；共享 harness 先协调 |

内容脚本、模型执行器、HTML sandbox 本轮不创建；没有填充未实现功能的空后台模块。CSP `frame-src 'none'` 当前不允许 HTML 执行，R1 后才按验证方案变更。

## 已实现的应用接口

`ApplicationClient` 只有 query、command、subscribe，UI 不读写存储。页面会话由后台根据 **Chrome 提供的 sender.id、sender.url、顶层 frameId** 推导；不接受调用方自报 capability、workspaceId 或 Chat 目标。只允许本扩展 sidepanel.html／reader.html 顶层入口；普通网页、其他扩展、子 frame 及其他路径被拒绝。没有 onMessageExternal，也没有 web_accessible_resources。

```ts
// 客户端 API；draft 必须为完整 schemaVersion=1 DTO。
const view = await client.query();
await client.command({ type: 'draft.save', expectedRevision: view.draft!.revision,
  draft: { ...view.draft!, text: '新的输入' } });

// 线上信封，业务层不直接构造。
{ version: 1, requestId: '<UUID>', operation: { type: 'workspace.query' } }
// 返回同一 requestId；ok=true + view 或 ok=false + code。
```

错误码：invalid-message、forbidden、unbound、not-found、revision-conflict、storage-failed、disconnected。Zod strict 校验双向 DTO，拒绝多余字段；错误不带存储内容、认证数据或堆栈。ApplicationSession 本身也校验写命令并拒绝只读写入，后台不是仅靠隐藏按钮防写。

只读入口 `reader.html?workspaceId=<URL 编码稳定 ID>` 固定空间，返回的 draft 为 null，不写最近 Chat，不订阅活动播放器；保存命令在 client 和后台都拒绝。现在仅有空查看容器，实际历史资料／产物是后续任务。

### T01 存储与 T03 扩展点

- 一个 IndexedDB `vcamp`，版本 1，一个 `workspaces` object store，keyPath=id。
- `id=JSON.stringify([platform,videoId,partId])`，不以标题／P 序号为键。记录为 `{id,chatId,source,draft}`；初始 chatId 为随机 UUID。每个已绑定空间本轮仅有一份空 Chat，不实现多 Chat 或最近选择。
- Draft v1：schemaVersion、revision、text、outputType(chat/markdown/html)、template(null 或 templateId+revisionId)、referenceIds、attachmentIds、modelId。模板／引用／附件字段为 T03 扩展兼容位；T01 UI 只编辑文字和产物。模板版本冻结、引用归属验证和附件生命周期由相应任务接入，不能把仅有字段视为功能验收。
- open 原子创建初始记录；save 在同一 readwrite 事务校验 expectedRevision、更新草稿与 revision。事务 **oncomplete 后才成功**；失败／冲突不覆盖旧记录。不依赖 beforeunload，不使用 localStorage 整库覆盖。
- UI 每次文字／产物变更立即发起串行保存，保持版本顺序；切换模块等待所有保存确认。失败保留当前输入、明确未保存，重试或经确认重载；不静默覆写冲突。突然杀进程前仍未获存储确认的输入不保证恢复，界面不会称其已保存。
- 后续迁移应将记录中的 chat/draft 拆入所需实体，保留 stable workspace ID、chatId、全部草稿字段和 revision；版本升级入口须先由 04 提案、01 分配。禁止新建平行数据库或借改名清空数据。T01 没有导入／备份或回滚迁移。

### 订阅与 T05 扩展点

T01 Port 只传 `version=1,type=ready|invalidate`，不含业务正文。服务端先注册再 ready，客户端收到 ready 才查询；草稿提交事务成功后发布失效通知，再读快照；断线显示连接恢复中并每秒重连，旧连接回调被忽略，卸载释放连接。UI 读取版本令牌和待写队列防止迟到快照覆盖正在输入的草稿。

**这不是生成流协议的实现。** T05 必须落实工程规格第 4 节：先注册订阅并缓冲→确认后读带 lastSeq 的一致快照→丢弃 seq≤lastSeq→顺序重放→缺口重新快照。状态、检查点、lastSeq 同事务提交后才能发布；终态也适用。断线旧回调不能更新新会话，必须测试所有完成时间窗口。

`contracts/generation.ts` 冻结后续语言，不提供运行实现：

- SourceBinding 使用 platform/videoId/partId/tabId/documentId/epoch；迟到页面事件不允许修改新的绑定。
- RequestTarget 为 chat(workspaceId,chatId) 或 subtitle(workspaceId,operation) 判别联合。字幕无 Chat 历史／草稿／引用，不造假消息；translate 必须提供 targetLanguage，T05/T12 运行校验补齐。
- ChatRequestSnapshot 包括固定 input、outputType、实际 modelId、webEnabled、模板版本、引用快照、附件及发送前 historyProjection。historyProjection 固定有序消息版本与允许正文；不包含随笔及其操作正文、HTML 源码、未主动引用的成果。重试不加入本请求任何 attempt 输出和后发消息，原输入只加一次。
- 原字幕仅保留定位／指纹，不持久正文；字幕版本引用和原生定位区分。Chat 和字幕独立任务槽，按 jobId 取消；生成提交需要 attemptId/completionToken 去重及目标存活校验。完整执行器／请求快照存储留 T05，不能使用这些类型宣称已完成。

## 模块与查看器契约

`modules.ts` 定义 ModuleId、ModuleRegistration、ArtifactViewerProps。App 接受 registrations，按 active ID 渲染注册的 View，并传 client/view；未接入模块显示空容器。新增注册只改装配入口，不复制标题栏、侧栏、菜单定位或存储逻辑。T03/后续 Chat 通过同一 client 扩展，不在页面读 DB。ArtifactViewer 输入固定 workspaceId、artifactId、mode 和受限 client，onSourceChat 仅显式点击时调用；只读场景不得提供写入能力。HTML payload／实例令牌的运行契约由 R1 验证后实现。

视觉采用原型颜色 #f5f5f3/#fff/#2f8f62、浮动标题、右圆形栏与底部 composer；常驻改变实际内容宽度，悬停只覆盖。固定收起按钮不漂移。模块退场 115ms／入场 220ms；快速切换只应用最新目标，减少动态效果直接切换而不创建动画。未绑定新增入口说明，已绑定空 Chat 无示例消息；未开放工具明确禁用，设置提供说明。生产缺少绑定时编辑禁用，测试适配器才能验草稿闭环。

## 已知验证界限

T01 作者自测不能替代 02/03；真实 OS 输入法、人工动效审阅与页面缩放待补。补充宽度截图来自已安装扩展页面的视口调整，原生默认 360px 另有 headed Chrome 新 profile 证据，不混称。仅在测试绑定视频上验证草稿，未验证 B 站识别、字幕／模型、生成宿主或任意 HTML；这些不在 T01 范围。

## W0-T01-FIX-01 修复增量（2026-10-13）

本轮只改 STD-01／SPEC-01／SPEC-02 及直接回归；没有改变公共 DTO、数据库版本、manifest、锁文件或集成看板。QA 单条测试提交 `7f99ff314bedbb2023b1614ab68bced6cbfac3e2` 通过 cherry-pick -x 吸收，作者对应提交 `8b730928b70fe866e8f502b8e416f91edc32fceb`；不合并其他对话报告分支。

- STD-01：鉴权使用 try/new URL/catch，将解析失败归类 forbidden；sender.id、scheme/host/path 白名单、frameId 和 reader 约束保持不变。删除对 URL.canParse 的运行依赖。[Chromium 发布说明](https://groups.google.com/a/chromium.org/g/blink-dev/c/xYRE__nss_0) 指定该 API 桌面首发 120，因此不能作为 manifest Chrome 116 的必需前置。
- SPEC-01：离开 edge／rail／窗口后安排 **240ms** 关闭；重入取消；固定状态切换和卸载清理计时器。键盘焦点在 rail 内时不隐藏正在聚焦的导航，焦点离开再安排关闭；窗口失焦仍收起。临时状态不写布局偏好。
- SPEC-02：局部 `src/app/use-module-motion.ts` 使用 Web Animations 实现退场 opacity 1→0、Y 0→-5px、blur 0→1.4px、115ms、cubic-bezier(.4,0,1,1)；入场 opacity 0→1、Y 9px→0、blur 1.8px→0、220ms、cubic-bezier(.16,1,.3,1)。下一次导航取消当前 effect，token 拒绝旧完成回调；正常完成移除 effect 恢复默认样式；卸载取消 pending animation 和导航；reduced-motion 不创建两段动画。

新增定向入口（仍在 extension 执行）：

```powershell
npx vitest run tests/unit/router.test.ts tests/unit/storage-abort.test.ts --reporter=verbose
npx playwright test compatibility.spec.ts peek.spec.ts motion.spec.ts lifecycle.spec.ts failure-recovery.spec.ts
```

完整验证仍用上方 ci/typecheck/test/build/build:test/test:e2e。测试绑定原生侧栏恢复用例现在同时验证文字与 Markdown 产物选择，关闭重开和同 profile 完整浏览器重启分别断言。

测试边界说明：compatibility 在实际扩展 Worker 中将 URL.canParse 暂设 undefined，验证 query/Port ready/save/reopen/reader，不冒称 Chrome 116 安装。motion 读取实际渲染的 opacity/transform/filter 与动画 timing；用 currentTime 暂停中间帧截图，同时另录未经暂停的 rAF 帧序列；取消与最终无残留 effect 另验。lifecycle 使用测试目录的 App 挂载 harness 和假 ApplicationClient，因为直接关闭页面无法独立验证 React 卸载；该入口不进入生产构建。failure-recovery 明确区分注入一次 storage-failed 响应与两个真实编辑者／IndexedDB 的 revision 冲突。QA abort 用例只注入 fake-indexeddb 事务失败，不制造磁盘损坏。

### Chrome 116 兼容范围评估

生产本轮新增调用为 URL 构造器、Element.animate/Animation.finished/cancel 和常规 focus/mouse/blur 事件；没有增加 Chrome 专有 API。现有业务 Chrome API 仅 runtime 消息／Port 与 sidePanel.setPanelBehavior（Side Panel 从 Chrome 114 可用；[官方 API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)）。测试里的 loadUnpacked/sidePanel.close/new DOMMatrixReadOnly 等不进入生产包，不据测试 API 抬高 manifest。

源码检查覆盖 IndexedDB 事务、crypto.randomUUID、Promise、URL/URLSearchParams、matchMedia、dialog、inert 与 CSS dvh；未发现另一处必需的 Chrome 116 以后 API。关键布局依赖 [inert 已于 Chrome 102 支持](https://web.dev/articles/inert)、[dvh 于 Chrome 108 支持](https://web.dev/blog/viewport-units)。Vite 6 的默认 modules 转译目标包含 chrome87；转译只处理语法，不能替代 API 兼容验证，React／Zod 等打包依赖也仍受实际环境验证限制。CSS scrollbar-width 在较旧 Chromium 的差异属于滚动条外观；Chrome 路径有原生滚动，不阻断草稿闭环。

本机已发现 Chrome 155.0.8059.39、Playwright Chromium 149（另有两个较新的缓存 revision）；未发现可直接使用的隔离 Chrome 116–119 安装，未下载／替换用户浏览器。因此保留最低版本声明 116，但只报告 API 缺失模拟与当前版实际证据，旧版实机仍 not-run；不对未实现的后续能力扩大兼容承诺。生产扫描及本轮固定 SHA 结果见新作者报告。

### 人工验收接续

采用原始仓库 `docs/launch/dispatches/W0-T01-AC-01.md` 的 AC-A—H，派工资料只读、不为获取它们合并 main 未提交文件。生产 toolbar action 实际点击、Windows 真 IME、原生拖宽／80%/125%/200% 缩放与主观动效签核仍由用户／02 记录。自动产物恢复、失败／冲突、固定 reader 与 API 缺失证据只对应作者新候选，不代替 02/03 独立复验。候选交付后停止，不合入、不放行 R1。

## W2-T02-FIX-02 格式兼容增量

T02 无 cid 前缀源：首次文档按原始导航 BV/P 关联服务器 inline playinfo JSON；SPA 按站点已经生成的 BV/cid playurl 请求关联响应中的视频路径。不得把当前 SPA cid 赋给旧 inline 响应，也不得只用 manifest＋readyState 放行。关联仅页内有界内存；Chrome 文档／导航 epoch、权限和本地草稿目标仍由后台独立管理。未知／歧义源明确未就绪；async 与 seek 前后重复验证元素、currentSrc 和播放源。

FIX-02 定向：`npm test -- --run tests/unit/t02-formats.test.ts`；正式构建后 `npm run test:e2e -- tests/e2e/t02-formats.spec.ts`。实站沿 `tests/manual/t02-real.mjs`，设置独立 `T02_PROFILE`、固定复制包 `T02_PACKAGE`、`T02_TARGET`、新输出 `T02_OUTPUT`，不使用 `--smoke` 代替本轮验收。用户仅手动登录／原生授权；检查实际 Worker/import hash。必须包含普通88条、P2→站点P3、直接P3、cid62131无字幕、刷新旧document和暂停／播放产品时间按钮。响应和字幕正文仅内存比对，归档统计／哈希；失败不替换样本。

## W2-T02-FIX-03 异步身份与定位增量

取证使用原始身份快照，所有检查通过后才提交缓存；定位由 Worker 核对能力并准备 ISOLATED 单次操作，MAIN 只供异步取证和最终同步身份确认。ISOLATED 监听原生 Navigation currententrychange、页面离开／恢复及媒体换源，检查后同步写 currentTime，防止 Worker 事件或 executeScript 传输期间的 ABA。MAIN 中同名对象或确认事件不能替代这项保护。清晰度在准备期间改变会取消该次定位，后续观察和新命令可恢复。已发起的定位不能撤销，见 ADR 的边界说明。

定向：`npm test -- --run tests/unit/t02-formats.test.ts tests/unit/t02-async.test.ts`；正式构建后 `npx playwright test tests/e2e/t02-async.spec.ts`。安装测试使用正式 JS、真实 Navigation 和合成原生 video，只控制 Chrome 传输／站点响应及测试主机授权；断言缓存拒绝后仍无错误新绑定、正常新源恢复，以及 proof/commit ABA 的新增原生时间写入为0。`.tmp/t02-async/installed-*/results.json` 是本机忽略输出。

实站仍用固定包／实际运行哈希和自己的隔离 profile，执行完整 `node tests/manual/t02-real.mjs`。普通88条走实际字幕按钮；无字幕的 cid62131、SPA P3 和直接P3在清空资源计时后走公开定位命令，分别验证暂停30秒／播放45秒（短媒体按时长缩小）。这些没有字幕按钮的样本不得报告为产品字幕按钮通过。新包可能要求用户重新原生授权，收到确认并核 origins 后才继续。
