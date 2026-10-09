# Testing and acceptance

Executable checks and their actual results, not dated console logs, determine verified status. See [PRODUCT.md](PRODUCT.md) for user obligations and [ARCHITECTURE.md](ARCHITECTURE.md) for code boundaries.

## Automated checks

```bash
npm ci
npm run compile
npm run lint
npm run format:check
npm run test
npm run build
npm run build:firefox
npm run check:manifest
npm run check:bundle
npm run check:licenses
npm run audit:security
npm run web-ext:lint
npm run test:e2e
```

`npm run verify` covers typecheck, lint, format, Vitest, both builds, and manifest/bundle/license checks. CI additionally runs security audit, Mozilla lint, Playwright extension smoke testing, ZIP packaging, checksums and artifact upload.

**Limits:** Vitest covers unit/integration and configured Storybook browser tests. Playwright E2E uses the supported Playwright Chromium extension loader, not live YouTube availability; branded Chrome 137+ ignores the old `--load-extension` workflow. A skipped E2E test or green build does not prove player `pot` acquisition, translation, full-audio STT, real browser parity or actual document appearance.

## User manual runtime and visual acceptance

These are historical and source-derived acceptance scenarios; they have **not been executed in this documentation cleanup**.

1. Manual/ASR captions, multi-language, paused-before-open, Shorts, SPA A-to-B navigation, player caption/mute/playback restoration.
2. Arabic and English language availability only where a real source/YouTube translation/local completion exists; explicit errors for missing/partial output.
3. Chromium no-caption full-audio processing independent of real-time playback, bounded memory, progress, cancel, resume and generated Arabic. Firefox local-STT offscreen host is a documented gap.
4. Search Arabic/RTL, playback follow and seek identity, saved library, notes, corrections/undo, local backup/import.
5. Export + Actions selected template, timestamps and content for text/subtitle formats and visual DOCX/PDF/PPTX output. The current PDF uses rasterized pages, not selectable/searchable PDF text.
6. Keyboard focus and accessible semantics, light/dark, RTL, and approximately 320–600 CSS px panel widths. Brave requires release smoke.

The old AI provider setup/Strict Local Mode and AI-tab checklist is **not** current product acceptance. The user performs final browser/visual approval; do not substitute repeated agent browser-open/close loops.

## Accessibility

Storybook a11y and `@axe-core/playwright` support automated review. Manual keyboard order, focus, announcements, contrast, reduced-motion and RTL remain necessary acceptance surfaces. Current navigation: Transcript, Library, Notes, Export + Actions, Settings.
