# PREP 固化记录

日期：2026-10-13（用户时区 Asia/Shanghai）。授权来源：本次用户明确要求只执行 01 的 PREP → T01；working-agreement 第 2 条允许该首次默认任务无需另填派工单。

- 原目录：`[private local design reference]`。
- 实查原 HEAD：`ea80835fe1bf8774675d4a100d4dc5e6eabc4cd1`，main，仅跟踪已由用户删除的根 AGENTS.md。未恢复该文件；上级未发现其他 AGENTS.md。prototype/AGENTS.md 已阅读，原型内容未改。
- 基线提交 BASELINE_SHA：`720d155ed769497b6b09d2b50515b24967e47bc2`，78 个现存文件、1 个既有删除。原始 main 留在此基线，干净。
- 集成分支 `codex/vcamp-integration`，工作区 `[private local design reference]`，HEAD 为上述基线。保持干净、未合入 T01。
- T01 BASE_SHA 同上述基线；候选分支 `codex/vcamp-t01-shell`，工作区 `[private local design reference]`。两个工作区均由 Codex create_worktree 管理并附于当前对话，没有另建对话／发消息／派子 Agent。
- 正式建工作区前已入库全部批准输入及必要原型参考；工作区内启动包完整，四份批准资料按 CRLF 归一化比较无内容变化。

## 选择性入库清单

1. PRD、主 HTML 原型、工程规格 0.2、开发计划 0.2。
2. `docs/launch/` 全部启动文件、工作约定、测试矩阵、任务看板和模板。
3. 复现原型所需源码、public 资源、参考与 QA 图片、package/锁文件、Vite 配置、导出脚本、原型测试、Sites 原型 worker 及空 hosting 配置。
4. `.gitignore` 排除 node_modules、dist、dist-test、覆盖率、测试输出、profile、临时文件、环境文件和日志。
5. 根 AGENTS.md 的既有删除。

未使用 `git add .`。入库前扫描候选文本中的私钥、Bearer、认证 token、常见 API Key 形态；三处命中均为同一原型密码框的 demo 占位值。没有真实 Key、认证日志、个人 profile 或依赖／构建目录入库。截图采用已批准留存文件。

完整路径和两份 SHA-256 见 `baseline-manifest.json`。四个原始输入哈希与 BASELINE.md 完全相同。Git core.autocrlf 检出改变了主 HTML／两份规格的字节换行，检出哈希因此不同；PRD 字节哈希相同。仅归一化 CRLF 后逐份相等；没有把不同字节称为相同哈希，也没有修改产品内容。

## 首次默认派工核验

- TASK_IDS：PREP、T01。
- 依赖：PREP 基线提交已存在；T01 没有其他功能前置。
- WRITE_SET：extension/ 正式工程／测试；docs/architecture/；最终 docs/reports/T01/；docs/launch/TASK-BOARD.md 的 T01 证据行。基线阶段另包含上述选择性入库清单。
- TARGET_SHA：候选提交后固定，由阶段报告列出；未用不完整 SHA 让下游建空工作区。
- 未启动 R1、T03 或其他节点；generation.ts 仅冻结后续语义类型，不执行任务引擎。
- 推荐模型为 gpt-6-astra/high。当前可见指令只确认 GPT-6 系列，无法核实用户选择的精确模型／推理档位；未宣称切换模型。

最终候选与报告分别提交；无独立测试／审查证据前不得合入集成分支、不得将 T01 标 done 或放行 R1。
