# Pre-build knowledge and gap evaluation

**Inspection:** 2026-10-09; source/documentation only.  
**Decision:** knowledge consolidation ready; no new feature or runtime acceptance cleared.

This is the single pre-build source index, historical review record, and gap owner, replacing two overlapping packet files.

## Existing source/evidence index

- Product and policy: [PRODUCT](../../PRODUCT.md), [README](../../README.md), [SECURITY](../../SECURITY.md), [PRIVACY](../../PRIVACY.md).
- Architecture, browser permissions: [ARCHITECTURE](../../ARCHITECTURE.md), [wxt.config.ts](../../wxt.config.ts), `src/platform/`, `src/providers/youtube/`.
- Panel/export: [App](../../src/ui/App.tsx), [ExportView](../../src/ui/views/ExportView.tsx), [ActionsMenu](../../src/ui/components/ActionsMenu.tsx), [template registry](../../src/core/export-templates.ts), [document renderers](../../src/core/export-docs.ts), `tokens/` and `src/ui/`.
- Caption/STT/translation: [track selection](../../src/providers/youtube/track-select.ts), [media reader](../../src/stt/media-reader.ts), [model profile](../../src/stt/model-profile.ts), [translation worker](../../src/translation/worker.ts), [Arabic timed transcript](../../src/translation/transcript.ts).
- Persistence/state: [database](../../src/storage/db.ts), `src/storage/`, `src/ui/store.ts`.
- Executed test/build definitions: [CI](../../.github/workflows/ci.yml), [package scripts](../../package.json), [TESTING](../../TESTING.md), [RELEASE](../../RELEASE.md), `tests/`, `e2e/`, `scripts/`.
- Dated architectural rationale: [ADR-0001](../../docs/adr/0001-transcript-acquisition.md), [ADR-0002](../../docs/adr/0002-hardening-deviations.md). Historical claims do not override current code or product scope.

## Retired task documents: meaningful content

The old project-wide `tasks/plan.md` covered saved-library search, multiple tracks, language filtering and pagination beyond 50 recents; video-bound navigation from saved transcripts; timestamp-linked notes and Markdown export; original/corrected transcript/undo with correct export identity; local STT checkpoint resume for matching video/model/duration, no persisted media URLs, partial previews, and bounded Mediabunny windows (25 seconds with 4 seconds of overlap). It also described a now-superseded remote AI history/full-video work item. These were work objectives, **not current passed acceptance**.

The old `tasks/review.md` (2026-09-28) reviewed `c83f74e` against `0c34ac5` and recorded:

- **P1:** asynchronous STT status/start/error could overwrite a newly opened saved transcript while the current video ID stayed unchanged. The recorded fix used view/request epochs, saved-view guards and cancellation invalidation.
- **P2:** a legacy AI cue starting at 5500 ms was sent as `[0:05]`, but timestamp equality discarded that valid citation. The documented correction compared the actual second-resolution anchors and continued rejecting fabricated citations.

The review distinguished pre-fix passing checks (26 files, 169 tests) from post-fix checks **not run at that time**. It is a dated receipt, not a fresh CI pass.

The retired ad-hoc `build-out.txt` / `test-out*.txt` were local console captures containing dated build output, test passes (including 22 files/156 tests), obsolete provider-permission text, and a Vitest hanging-process warning. Current GitHub CI is the appropriate live verification record.

## Historical original plan provenance

The 82 KB [original research/planning revision](https://github.com/koko-88/yt_transcriber/blob/2fb40899f70af7ff8197d21e4978176e33671c21/transcript_extension_plan.md) is recoverable from Git history. It was explicitly a planning pass, not executed product verification. Material lessons carried into the active owners:

- Player `baseUrl` may lack the session `pot` token; HTTP 200/empty or a partial/wrong-video response does not constitute transcript acquisition.
- YouTube DOM captions are not equivalent to reliable browser `video.textTracks` discovery. Capture strategies and restoration need actual session evidence.
- Page MAIN-world JavaScript is untrusted; a random page-side token alone is no security boundary.
- Preserve canonical transcript models, privacy, least-privilege hosts, validation, no operator-run backend, truthful error states, reproducible npm and independent browser acceptance.
- The original research considered WXT vs Plasmo/CRXJS/manual bundling, UI/data alternatives and a reference-only `ANcpLua/yt-transcript` fork; current WXT code is authoritative.
- The old M0 matrix proposed, but **did not prove**, many-video tests across manual/ASR/translation/no-caption, gated and signed-in access, Shorts, SPA transitions, long videos, Chrome/Brave/Firefox and different sessions.
- Remote AI-provider workflows, telemetry, optional hosted backends and real-time tabCapture were superseded; do not treat them as active requirements.

The original detailed decision register, rejected alternatives and unexecuted M0 matrix remain available at the historical Git link. No current requirement is inferred merely from the old plan.

## Unresolved gaps before a new feature

- [ ] User approval of current PRODUCT inventory, chosen feature, target journeys, failure states and desired design.
- [ ] ROADMAP feature boundaries, dependency graph, ownership and acceptance coverage.
- [ ] Constitution ratification, actual agent route/model qualification, bounded review and retry limits.
- [ ] Official Spec Kit CLI/template and relevant Codex/Cursor/OpenCode integrations; markdown structure alone does not install them.
- [ ] Feature-specific runtime/design evidence and approved `spec.md`, `plan.md`, `tasks.md`, linked acceptance matrix and review.
- [ ] Actual live-YouTube and Arabic/English transcript/STT verification, Firefox local-STT host gap, cancellation and generated document/PDF RTL quality.
- [ ] Separate decision about dormant `src/ai/` and `aiCache`/`aiHistory`/`secrets` migration; do not delete user data or working code as documentation cleanup.
- [ ] Security audit issue `GHSA-wq5f-xc86-pv6w` on transitive sharp observed in CI on 2026-10-09.
- [ ] Actual GitHub ruleset/security/store-environment settings verification beyond repository YAML.

This was source documentation migration only. No user browser acceptance, model qualification, dependency remediation or app implementation is implied.
