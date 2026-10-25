# v1.0 standards review

Review date: 2026-10-26. Axis: documented standards and labelled Fowler smell heuristics. This is a source review, not a release-gate pass.

## Revision and method

- Fixed point: `3c91506a9358fc4db4b4d45800fdd851047f7b29` (`release-empty-root`).
- Reviewed head: `fe026729becdd20d34ea8ac2f9b6d5dc4b2907d9`.
- Requested comparison: `git diff release-empty-root...HEAD`; pinned equivalent used during concurrent release edits: `git diff release-empty-root...fe026729becdd20d34ea8ac2f9b6d5dc4b2907d9`.
- Commit list: `fe02672 chore: freeze sanitized Vcamp 0.1.82 release baseline`.
- Diff inventory: 646 added files, 46,276 added lines, including 177 files under `extension/src`.
- Source was read through `git show fe02672:path` and searched with `git grep ... fe02672 -- ...`; concurrent working-tree implementation edits are outside this report.
- No API calls, browser/UI actions, actual credentials or user data. Two targeted reproductions ran on synthetic in-memory IndexedDB data. No implementation/test files were written. Typecheck, lint, complete tests, builds, dependency audit and package-content checks were not rerun by this reviewer.

Standards read: `CONTRIBUTING.md`; authoritative `docs/release-scope.md`; `docs/architecture/data-contract.md`, `runtime-handbook.md`, `backup.md`, `library.md`, `markdown.md`, `interactive-knowledge.md`, `instruction-viewer.md`, `attachments.md`, `user-prompts.md`; `extension/src/video/README.md`. Historical schema/version and old feature exclusions were not treated as current requirements when release scope or newer sections supersede them.

## Confirmed documented-standard findings

### STD-01 — P2: duplicate export entries bypass a fixed scribble reader's resource boundary

Primary location: `extension/src/data/document-store.ts:29` (also lines 25–30, 81). Authorization caller: `extension/src/app/message-router.ts:61`–70.

The router validates each requested target against the fixed reader URL. The export store then counts scribble entries before deduplication and replaces any group containing more than one entry with `id: '*'`. Its later filter interprets that as every nondeleted scribble in the workspace. Consequently a reader fixed to scribble S can send two copies of the otherwise permitted S export request and receive unrelated scribble T. This does not require a cross-workspace target, write command, guessed token, malformed envelope or UI action. Two genuinely distinct selections also expand to all scribbles rather than just those selected.

Standard: `docs/release-scope.md:30`–31 requires “workspace/resource ownership and reader read-only enforcement ... even when requests bypass the visible UI.” The invariant must survive normalization after router authorization. Existing `tests/unit/opt-export.test.ts:7` describes export as an “exact selection snapshot”; its grouping case has only two available notes and therefore does not detect the third-note case.

Reproduction performed: create one workspace with two synthetic scribbles, S=`SELECTED_FIXTURE` and T=`UNSELECTED_FIXTURE`; use sender `chrome-extension://review/reader.html?workspaceId=<workspace>&scribbleId=<S>` with matching extension id and frame 0. Send a valid v1 `library.export` envelope with `selection: [pickS, pickS]`, where `pickS={target:{workspaceId,entityType:'scribble',id:S},format:'txt'}`. The real router and real `IndexedDocumentStore` were used; the injected library port only forwarded the authorized selection into that store.

Observed output:

```json
{"ok":true,"files":1,"unselectedIncluded":true,"errors":[]}
```

Fix: deduplicate before grouping; aggregate a set of explicitly selected IDs, preserving the permitted resource set. Interpret `'*'` only when it was explicitly requested and authorized. Add a fixed-reader duplicate-selection regression and a two-of-three selection regression. Confirmed authorization defect, not evidence of remote code execution or cross-workspace disclosure.

### STD-02 — P2: a successful backup can exceed the restore limit and be unusable

Primary location: `extension/src/data/backup-store.ts:61`; legacy export has the same omission at line 94. Restore enforcement: `extension/src/data/backup-store.ts:101`, `extension/src/data/backup-validation.ts:18`.

Both export paths serialize `project(raw, preferences)` without the aggregate graph limit applied on import. Individual table schemas permit the fixture below, and normal data creation is not constrained by the aggregate backup limit. Import counts top-level records **plus nested Chats** and refuses totals over 20,000. The export can therefore complete with a valid manifest/checksums while the same version cannot restore it to an empty database. Users may rely on the successful backup before moving an extension identity or removing the source profile.

Standard: `docs/architecture/backup.md:9`: “资料数量与单字段限制保留，超限报错，不截断、不自动删资料.” `docs/release-scope.md:37`–42 requires recoverable large-input handling and independent import/recovery verification.

Reproduction performed: in fake IndexedDB, create a valid workspace/Chat through `IndexedWorkspaceStore.open`, then insert 19,999 schema-valid synthetic scribbles in one transaction. Run `IndexedBackupStore.beginExport`, read every export part, and pass those same parts to `beginImport`/`appendImport`/`finishImport` on a fresh database.

Observed output:

```json
{"exportSucceeded":true,"parts":14,"topLevelRecords":20000,"recordsIncludingChats":20001,"importCode":"resource-limit"}
```

Fix: preflight both export formats with the same graph/aggregate constraints as fresh import, before reporting a successful export; alternatively make restore support the intended exported size. Keep the limit explicit and preserve all data on failure. Add export-to-fresh-import coverage at the aggregate boundary, including nested Chats and preset dependencies. Confirmed reproducible restore failure; no source records were deleted or corrupted in this reproduction.

## Baseline smell judgment

### STD-03 — P3: possible Duplicated Code in immutable prompt-version storage

Locations: `extension/src/data/role-store.ts:26`–40, `style-store.ts:28`–42, `template-store.ts:27`–41. All repeat the same expected-revision checks, preset-history prefix repair, deletion branch, new UUID/revision creation and immutable-history append. Representative shared hunk:

```ts
if (old && old.revision !== expectedRevision)
  return fail(new ApplicationError('revision-conflict'));
const occupied = new Set(history.result.filter(/* owner */).map(/* revision */));
for (const revision of presetRevisions.filter(/* owner, prefix, unoccupied */))
  revisions.add(revision);
```

This is a maintenance judgment under the supplied Duplicated Code heuristic, not a documented-standard breach or a reason to expand release scope. A focused helper for immutable-history prefix preservation/append would make future compatibility fixes apply uniformly while leaving entity schemas, ordering and retirement rules explicit. Existing version semantics take precedence; a broad generic repository rewrite is not recommended.

## Coverage and limits

Every source filename was inventoried; all directories below were included in boundary-pattern searches. Focused reading followed trust boundaries and the two confirmed defects. This does **not** claim line-by-line review of all 177 source files.

| Module | Files in inventory | Actual review coverage |
| --- | ---: | --- |
| `app` | 24 | Focused `message-router.ts`, `application.ts`, `chrome-client.ts`; entry/client authority, fixed reader paths, request schemas and preference writes. Other UI/hooks were inventoried and boundary-searched, not deeply reviewed. |
| `background.ts` | 1 | Dependency composition, production-mode selection, credential authorization injection, runtime message/port handlers and executor dispatch. |
| `brand` | 4 | Inventory/boundary search only; no visual/startup audit. |
| `content` | 1 | Observer inventory and runtime/storage/DOM boundary search; no page-lifecycle execution. |
| `contracts` | 28 | Focused application, provider/configuration, generation/diagnostic, knowledge, HTML envelope, video, subtitle limits, documents, library target, library and backup schemas. Remaining domain schemas were inventory/search coverage. |
| `data` | 24 | Focused database migration/transaction completion; indexed workspace ownership/revision save; attachments; knowledge; document export; backup store/format/stream and aggregate/graph validation; role/style/template version stores; prompt ordering. Targeted generation-store freeze/view/finish/retry paths and library-store initial query/entity projection. Backup-merge received targeted identity/reference search, not a complete algorithm audit. |
| `generation` | 31 | Focused credential store, provider service/configuration/endpoint, model list, streaming provider port, provider rejection, instruction trace/service, evidence preparation, web evidence port, executor and task-service authority/recovery. Targeted run-vision decision listener and subtitle-context limits. Remaining vision/planning/output modules were inventoried and boundary-searched. |
| `html` | 2 | Both files read: sandbox initialization/CSP and private navigation bridge/action validation. |
| `library` | 12 | Focused document-download portable sandbox/navigation, DocumentExport selection construction, service dispatch and Reader fixed-scope use. Remaining UI/file helpers inventoried and boundary-searched. |
| `main.tsx` | 1 | Reader/sidepanel entry construction. |
| `prompts` | 2 | Inventory and executable/API/storage boundary search; no deep editorial/prompt-quality review. |
| `shared` | 2 | Inventory/search; time helpers followed through navigation consumers, not an exhaustive numerical review. |
| `video` | 20 | Focused media-host consent/test boundary, playback channel, native subtitle reading/schema; targeted Chrome video fetch/seek/source checks and sessions concurrency/cache entry paths. Other media-control implementations were inventoried/search-only. |
| `workbench` | 25 | Focused HtmlPages host bridge and TimedMarkdown safe rendering; targeted Markdown/Knowledge sensitive-sink search. Remaining visual components and presets inventoried/search-only. |

Additional reviewed surfaces: production manifest, Vite build-mode aliases/entries and local-permission plugin, package scripts, selected router/library/export regression tests. Relevant tests read included `export-html-security.spec.ts`, `release-standards-regressions.test.ts`, `opt-navigation.test.ts`, `opt-export.test.ts`, and targeted router/Chat/library cases. Existing assertions were inspected as evidence of intent; they were not represented as newly passing browser tests.

Positive observations from reviewed source: local credentials wait for `TRUSTED_CONTEXTS`; public provider views omit key-bearing records; model-list and generation HTTP requests use `redirect:'error'`, `credentials:'omit'`, and bounded model/SSE readers; echoed keys are rejected/redacted in the reviewed stream/trace paths. Runtime authorization checks extension id, URL, path and top frame; readers reject mutation/provider/instruction commands. Generated HTML remains in opaque `allow-scripts` sandboxes; narrow navigation uses source-window checks, private tokens and transient activation; Markdown skips raw HTML and remote images. Production Vite configuration selects production adapters and confines seed entries/loopback permission changes to explicit test modes. These are source observations, not a proof against every browser channel or a substitute for inspecting the built ZIP.

Residual limits: no exploit testing of novel HTML/WebRTC realms, actual browser origin policy, Chrome 116 behavior, quota/disk failures, or complete late-result race exploration. Native subtitle `Response.text()` and metadata `.json()` reads are not streaming-byte-bounded in the inspected paths; resource-exhaustion behavior was not reproduced and is not counted as a confirmed vulnerability here. No claim that unreviewed modules are defect-free.

## Reproduction environment

Windows PowerShell; Node.js `v24.16.0`; esbuild `0.25.12`; fake-indexeddb `6.2.4`. Both reproductions were compiled in memory with esbuild `write:false`, loaded into a Node CommonJS module, and used `fake-indexeddb/auto`. An esbuild `onLoad` hook fetched each application `.ts`/`.tsx` source with `git show fe026729becdd20d34ea8ac2f9b6d5dc4b2907d9:extension/<relative path>` so concurrent working-tree edits could not change the result. Dependency packages came from the installed local node_modules. Browser/tool version and package checksum are not applicable to these in-memory reproductions; no release ZIP or browser test was run by this reviewer.

Result: **2 confirmed P2 documented-standard findings, 1 P3 heuristic judgment, 0 confirmed P0/P1 findings in the reviewed coverage.**
