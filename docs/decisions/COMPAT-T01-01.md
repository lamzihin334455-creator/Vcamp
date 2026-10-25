# COMPAT-T01-01｜Chrome 116—119 实机验证延期

日期：2026-10-13（Asia/Shanghai）。状态：**open / deferred to R1；实机检查 not-run**。

本决定只处理 T01 最低 Chrome 版本的实机证据缺口。固定候选为 `d937f6f73495dae718d5bf06db2050149e2b8e7c`；当前版本安装、API 缺失模拟和源码评估不能证明 Chrome 116—119 整体兼容。STD-01 已经修复并经独立复审关闭，不重新列为开放代码缺陷。

2026-10-13 用户原文“同意延期或降低优先级”由总控在 [W0-T01-QA-03](../launch/dispatches/W0-T01-QA-03.md) 及 [W0-T01-MERGE-01](../launch/dispatches/W0-T01-MERGE-01.md) 明确解释为延期至 R1，允许本次 T01/G0 通过。原始用户文字归档见 [manual-signoff.md](../reports/T01/d937f6f73495/qa/evidence/manual-signoff.md)，来源提交 `341904140bb6edef0b85f7021c3f82decacb6519`；原始编排记录与复制哈希见 [dispatch-sources.json](../reports/integration/14163b7ee5ab/evidence/dispatch-sources.json)。这是已授权延期，不是兼容通过或 manifest 变更。

| 责任／检查点 | 要求 |
| --- | --- |
| 01 | 跟踪开放事项，R1 启动后组织可复现实机条件及风险处置 |
| 02 | 在后续获派范围进行 Chrome 116—119 验证，记录确切构建、浏览器、profile 与结果 |
| 03 | 审查证据及支持范围／风险处置结论 |
| R1 收尾 | 必须给实测证据，或经总控明确支持范围／剩余风险处置；若环境仍不可得，报告总控，不能自动关闭或再次延期 |

本轮保留 manifest 最低版本 116，不宣称旧版完整兼容，不改变产品或接口契约。集成回归实际浏览器为 Chrome 155.0.8059.39 与 Chromium 149.0.7827.55。G0 pass 带此开放例外；R1 仍 planned，须另行人工派工。
