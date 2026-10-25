# T09 旧自定义模板夹具来源

`t09-legacy-custom-backup.json` 在修复生产代码之前生成，数据来自原 BASE `6c0842618c60cb09e3167ce2a59143bcfb8c0b00` 的 `extension/src/data/template-store.ts`、`indexed-store.ts` 和 `contracts/template.ts`。

用 `git show BASE:path` 提取上述原实现，仅重定向模块导入到作者工作区的依赖，使用 fake-indexeddb，在原 `IndexedTemplateStore.create` 创建自由 HTML 自定义模板、原 `IndexedWorkspaceStore.open/save` 保存已绑定 v1 的草稿。通过公开 `IndexedBackupStore.export` 导出，将 manifest.formatVersion 标为原有 format2（payload 未使用任何 format3 字段，checksum 未变）。未使用修复后的模板创建接口伪造旧数据。

修复前运行 `t09-template-compat.test.ts` 第一项，freezeChat 错误成功，产生同时含自由 HTML 要求和 knowledgeFormat:1 的 queued job。原 01 证据仍固定在提交 `8e8f8a4feab7426a3277c29aa96fa71b4369dbe0` 的 `docs/reports/integration/762ce1a3898a/{report.md,repro.test.ts,repro.log}`，不改写。
