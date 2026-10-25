# Release baseline — 2026-10-26

Public baseline: `pre-v1.0-baseline` (`fe026729becdd20d34ea8ac2f9b6d5dc4b2907d9`).
This is the sanitized 0.1.82 working tree, not just the old integration HEAD.
The integration checkout remains unchanged; release work happens here.

## Completed evidence

- Recovery archive: 5,623 files, 782,310,679 uncompressed bytes; every archived
  file was read back and SHA-256 verified. Git history bundle verified.
- Installed extension path, obtained from browser preferences, points at the
  integration production dist. Extension ID is
  `cbmiccnonkcfhcaecbpmonabppbdmafd` in Chrome and Edge profiles. This is disk
  configuration evidence, not a claim that a live UI inspection passed.
- All 24 production dist files match the 0.1.82 delivery directory byte-for-byte.
- An existing 2026-10-25 user backup (80,000,855 bytes) was copied and hash-verified
  privately. It is not a fresh export of any subsequent edits.
- Scan of 3,573 blobs reachable from local Git refs found no common provider,
  GitHub, AWS or private-key signature, nor the known ENV secret. Historical
  personal paths were present, so public history starts from a sanitized snapshot.
- Public snapshot scan found no known secret or personal machine path after
  cleanup. These checks are bounded pattern scans, not proof of absence of all
  sensitive material. Publication requires an additional final-artifact scan.
- `npm ci --ignore-scripts`, TypeScript and unit baseline passed: 672 passing,
  3 skipped of 675 tests. Full browser baseline is being measured separately.

## Execution constraints and outstanding gates

- API allowance is 300 requests, including failures and retries. Credentials,
  raw private backups and the persistent request ledger live outside this repo.
- The current machine's npm mirror has no audit endpoint; dependency audits use
  the official npm registry explicitly.
- An official audit reported Zod GHSA-mrhx-c7xc-m3w5; dependency upgrade and
  compatibility tests are required before release.
- GitHub CLI is not authenticated and there is no configured remote. No repository
  was uploaded or made public. GitHub private vulnerability reporting must be
  enabled and verified before public release.
- Planned Astra/xhigh Spec review failed with HTTP 429; replacement is
  GPT-6.1 Sol/xhigh. The separate Standards review remains Astra/xhigh. The main
  execution session has no model-switch tool, so presets are recorded routing
  choices, not a claim that its model changed between operations.
- Browser UI control was stopped in an earlier turn by its URL-policy check.
  Automated extension tests use isolated Chromium profiles and synthetic data.

The latest plan and actual results, rather than old prototype notes, determine
whether a gate is complete. No final release acceptance is claimed here.
