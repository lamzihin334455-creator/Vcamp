# Spec-axis release review

Date: 2026-10-26. Reviewed baseline: `fe026729becdd20d34ea8ac2f9b6d5dc4b2907d9`
(`chore: freeze sanitized Vcamp 0.1.82 release baseline`). Fixed point:
`3c91506a9358fc4db4b4d45800fdd851047f7b29` (`release-empty-root`). Comparison:
`git diff release-empty-root...HEAD`; one imported baseline commit, 646 files.
Line references below refer to that baseline, before release fixes.

The acceptance source is `docs/release-scope.md`, which explicitly supersedes
historical prototypes. `docs/api-settings.md` supplies the supported provider and
long-output behavior. Historical PRD/decision documents were not treated as
requirements. This is the independent Spec axis, not a standards review.

## Findings

### SPEC-01 — P2: backend silently removes historical pictures for text-only requests

**Requirement.** `docs/api-settings.md:41`: “已有历史图片的对话应改用支持视觉的
DeepSeek 模型，或新建文本对话。” The included scope promises
“capability-specific restrictions” (`docs/release-scope.md:12-13`).

**Evidence.** `extension/src/data/generation-store.ts:159-172` sets
`remainingImages` to zero when `visionDeclared` is false, then filters every
historical `attachmentId` out before checking `imageIds.length && !visionDeclared`.
Consequently that final check cannot detect the historical pictures. The UI
correctly disables this combination at `extension/src/app/App.tsx:270-275`; a
background send does not have equivalent enforcement.

**Reproduction executed.** In a fresh in-memory fake IndexedDB, add a valid PNG,
freeze an image question with visual support, mark its attempt failed, write a
text follow-up, then call `freezeChat(..., visionDeclared=false)`. It succeeds;
the earlier question remains in `historyProjection`, while its attachment array
becomes `[]`. Probe output:

```json
{"accepted":true,"userMessageImageIds":[[]],"historyText":["What is in this image?"]}
```

The same store is reached from `createTaskService` after its model check. This
silently changes the evidence used for the follow-up. It does not delete the
saved PNG and is therefore P2, rather than a confirmed data-loss P1.

**Focused regression test.** Seed one historical manual/uploaded image and one
automatic assistant-frame image in separate cases. Submit via `createTaskService`
with a third-party text model or a native text-only model. Assert
`unsupported-capability`, no executor creation, no new job/user message, and an
unchanged draft. Retain the current vision-capable history-budget behavior and
verify that a fresh text conversation remains usable.

### SPEC-02 — P2: unsupported output-only models can be imported and made default

**Requirement.** `docs/api-settings.md:43`: “仅支持图片或音频输出的模型不能作为
文本模型录入；这类条目不会让整份列表拉取失败。”

**Evidence.** `extension/src/generation/provider-service.ts:124-129` only checks
that requested IDs exist in the catalogue. It imports entries with
`text: 'unsupported'` and can choose the first such entry as `defaultModelId`.
Model discovery already identifies these entries correctly in
`extension/src/generation/model-list.ts:45-48`; the missing check is at intake.

**Reproduction executed.** A local transport stub returned `audio-only` with
`input_modalities: ['text']`, `output_modalities: ['audio']`, plus a supported
text model. After importing both IDs, the service returned:

```json
{"models":[{"id":"audio-only","text":"unsupported"},{"id":"text-model","text":"declared"}],"defaultModelId":"audio-only"}
```

Normal generation subsequently rejects that default, leaving a saved connection
with an unusable selected model despite another usable imported model. This is
recoverable by selecting the text model, hence P2.

**Focused regression test.** Discover a mixed text/image/audio catalogue; assert
discovery succeeds and retains the unsupported entries as nonselectable catalogue
metadata. Submit unsupported IDs directly through `provider.import-models` and
assert atomic rejection without a storage write or revision/default change.
Import supported IDs and assert the default is usable. Update the existing
compatibility fixture that currently imports `image-only` and merely checks that
the picker hides it. Include removal of the current default and migration of
previously saved unsupported defaults.

### SPEC-03 — P2: long saved output still hits the old two-million-character export cap

**Requirement.** The release includes “Markdown notes”, generated HTML, and
“backup, import and export” (`docs/release-scope.md:10-16`). Supported long-output
behavior states “400 万字符是浏览器数据结构的工程边界”
(`docs/api-settings.md:80`); `extension/src/contracts/output-limits.ts:3` sets the
common text/Markdown/HTML bound to 4,000,000.

**Evidence.** `extension/src/data/document-store.ts:38` rejects a single export
file over 2,000,000 characters. Saved Markdown and HTML may legitimately exceed
this: generation/checkpoint and note-save paths use the four-million bound.
The same old cap also rejects a long chat export. A single document cannot be
made smaller by selecting fewer library items.

**Reproduction executed.** Seed a saved Markdown revision containing 2,100,000
characters, then export that one note as Markdown. Result:

```json
{"files":0,"errors":[{"file":"markdown:long-note.md","reason":"此文件内容超限，请缩小资料范围"}]}
```

**Severity assessment.** P2 despite export being a core included feature: the
stored content remains intact, the operation returns an explicit error, and the
full backup path supports long content. No general data loss or inability to
recover the library was demonstrated. If document export is separately promoted
as the only supported recovery path, that stronger contract would warrant
reassessing priority; it is not the current contract.

**Focused regression test.** Save a note through the normal note-save store with
2.1 million characters, export only it, and assert byte-equivalent content plus
the normal provenance header. Exercise a complete HTML page and a long chat in
the same supported interval. Check the documented upper boundary with export
wrappers/headers included and retain independent batch/file-count resource
limits. Align response schemas and download/portable-export paths so lifting
this check alone does not move the failure downstream.

## Coverage and limits

Reviewed implementation paths:

- IndexedDB schema 1–10 upgrade entry, transaction completion/abort behavior,
  workspace identity and revision checks: `data/database.ts`, `indexed-store.ts`.
- Backup projection, legacy version decoding, graph validation, conflict-group
  merge, preview fencing, atomic import writes and preference restoration:
  `data/backup-format.ts`, `backup-validation.ts`, `backup-merge.ts`,
  `backup-store.ts`, `backup-stream.ts` interfaces and associated tests.
- Task freezing, claim/checkpoint/commit/finish, attempt fencing, manual retry,
  worker host recovery and cancellation cleanup: `data/generation-store.ts`,
  `generation/task-service.ts`, `executor.ts`, `run-chat.ts`, `run-subtitle.ts`.
- Provider selection/profile identity, discovery/intake, late discovery results,
  credentials, redirects, streaming completion and output policy:
  `provider-service.ts`, `credential-store.ts`, `model-list.ts`,
  `provider-port.ts`, `output-policy.ts`, `purpose-policy.ts`.
- Native/saved subtitle ownership, video/session navigation checks and late read
  suppression: `data/subtitle-store.ts`, `video/sessions.ts`, `chrome-video.ts`,
  `subtitles.ts`, `contracts/video.ts`.
- Library retention, favorites/trash cancellation and restore, cache eligibility,
  document export, and reader/router authorization: `data/library-store.ts`,
  `management-store.ts`, `cache-store.ts`, `document-store.ts`,
  `library/service.ts`, `Reader.tsx`, `app/message-router.ts`, `application.ts`.
- Inspected relevant migration/rollback, provider, attachment, retention and
  backup tests, including populated legacy upgrades and injected quota aborts.
  These already contain independent upgrade/rollback cases; no missing clean-
  install-only migration requirement was established.

Three deterministic probes ran via `node --input-type=module` using esbuild's
in-memory `write:false` bundle, fake-indexeddb and local transport stubs. Runtime:
Node v24.16.0, npm 11.13.0. All three produced the results quoted above. No API
requests, browser automation or repository code edits were performed. The root
agent owns full-suite execution and release assertions; this review makes no
claim that those suites or real-provider/browser release gates passed.

No additional confirmed P0/P1 issue or unjustified scope expansion was found in
these paths. HTML sandbox/export hardening was not exhaustively audited here and
remains subject to the separate security axis. Final count: **3 P2 Spec findings**.
