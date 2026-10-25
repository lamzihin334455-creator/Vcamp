# v1.0 release scope and acceptance contract

Frozen 2026-10-26 from the Vcamp 0.1.82 integration working tree. This contract
supersedes older product prototypes and historical decision documents for release
acceptance; it does not claim the release gates have passed.

## Included

- Desktop Chrome/Chromium Manifest V3 side panel for Bilibili video learning.
- Video/part-specific conversations, native subtitles, AI subtitle processing,
  questions, Markdown notes, generated HTML learning pages and time references.
- Existing provider configuration and model selection, with capability-specific
  restrictions; no guarantee that every provider supports every modality/tool.
- Visual evidence capture and explicit gaps; absent subtitles/frames must never
  be represented as evidence that was observed.
- Local library, favorites, trash, cache management, backup, import and export.
- IndexedDB schema 10 and supported legacy backup/HTML formats. Upgrade preserves
  saved content; an extension identity change uses explicit export/import.

## Excluded

ASR Lab, Studio Lab, new sites/providers, major visual redesign, commercial
service infrastructure and Chrome Web Store submission are outside this release.

## Required quality and security behavior

- Credentials remain in trusted extension storage and are excluded from backups,
  messages, diagnostic logs and public artifacts. New HTTPS endpoints require
  explicit origin permission. Redirects must not forward credentials elsewhere.
- Background message sender checks, workspace/resource ownership and reader
  read-only enforcement apply even when requests bypass the visible UI.
- Generated/ imported HTML is untrusted. Preview and portable exports keep an
  opaque sandbox, no automatic network access or host privileges, and controlled
  navigation. Generated code is not run in an extension-privileged context.
- Cancellation, retries, streaming failures, worker termination, late results,
  navigation and video switches cannot commit to the wrong task/workspace.
- No-caption, invalid/empty/large inputs, permission denial, authentication/rate
  limits, network failure and storage quota failure produce recoverable outcomes.
- Production builds exclude test adapters, local HTTP permissions, seed pages,
  credentials, profiles and private data. Tests and build sources remain public.
- Data migration/import and rollback recovery are tested independently of a clean
  install. Clearing data does not count as upgrade testing.
- Every release assertion is tied to its source revision, commands, test counts,
  browser/tool versions and package checksum. Mock and real-provider evidence are
  reported separately. P0/P1 findings block release.

## Distribution

Project-owned code will use MIT. Third-party licenses remain separate and must be
listed. The browser ZIP is unpacked and loaded in developer mode; it is distinct
from GitHub's automatic source archive. Public publication requires a working
private vulnerability-report channel and an authenticated repository owner.

## Source provenance

The integration ancestor is `6b071d1cd7309b9f350d865613b6d890c4fadef9`.
The imported snapshot includes subsequent uncommitted work through 0.1.82.
Historical Git objects and the complete working-tree recovery archive are retained
privately. The public repository starts with a sanitized snapshot to avoid
publishing private paths, local execution histories and unrelated experiments.
Original project and third-party attribution is retained; no claim of new sole
authorship is made by the release preparation.
