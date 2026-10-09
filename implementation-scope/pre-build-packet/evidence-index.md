# Existing knowledge and evidence index

This file points to existing source; it does not duplicate source or claim new runtime observations.

## Product and interface

- [README](../../README.md), [Privacy](../../PRIVACY.md), [Security](../../SECURITY.md): documented current product boundaries and known limitations.
- [App.tsx](../../src/ui/App.tsx): current five-tab navigation.
- [ExportView.tsx](../../src/ui/views/ExportView.tsx), [ActionsMenu.tsx](../../src/ui/components/ActionsMenu.tsx): template selection/format actions.
- [export-templates.ts](../../src/core/export-templates.ts), [export-docs.ts](../../src/core/export-docs.ts): code-defined templates and PDF/PPTX/DOCX rendering.
- [UI engineering](../../docs/UI_ENGINEERING.md): tokens, Storybook, narrow side-panel design and RTL guidance.

## Media, persistence, architecture

- [track-select.ts](../../src/providers/youtube/track-select.ts): source and YouTube-translated tracks.
- [media-reader.ts](../../src/stt/media-reader.ts), [model-profile.ts](../../src/stt/model-profile.ts): bounded local STT/English pivot.
- [translation worker](../../src/translation/worker.ts), [translation model](../../src/translation/transcript.ts): local Arabic generation.
- [db.ts](../../src/storage/db.ts): current schema and legacy retained stores.
- [Architecture](../../ARCHITECTURE.md), [ADR-0001](../../docs/adr/0001-transcript-acquisition.md), [ADR-0002](../../docs/adr/0002-hardening-deviations.md): technical context and historical decisions.

## Existing executable and historical material

- [package.json](../../package.json), [wxt.config.ts](../../wxt.config.ts), [CI](../../.github/workflows/ci.yml): build, browser manifests and gates.
- [TESTING.md](../../TESTING.md), [RELEASE.md](../../RELEASE.md): check/release guidance, with stale AI references.
- [Original plan](../../transcript_extension_plan.md), [old plan](../../tasks/plan.md), [old review](../../tasks/review.md), [old checklist](../../tasks/todo.md): useful historical work, not live new-feature authority.
