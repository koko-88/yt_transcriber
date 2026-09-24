# Testing

## Automated gates (run locally / CI)

```bash
npm ci
npm run compile
npm run lint
npm run format:check
npm run test                 # vitest unit + integration (offline)
npm run build
npm run build:firefox
npm run check:manifest
npm run check:bundle
npm run check:licenses
npm run web-ext:lint         # after Firefox build
npx playwright install chromium   # once; required for extension E2E
npm run test:e2e             # Playwright + axe (needs Chrome for Testing)
```

`npm run verify` runs compile, lint, format, unit tests, both builds, bundle and
license checks.

### What each layer proves

| Layer                   | Proves                                                                                                                          | Does **not** prove        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Vitest unit/integration | Parsers, search/highlight alignment, track selection, timedtext URL matching, citation grounding, backup schema, security gates | Real YouTube `pot` gating |
| Playwright E2E          | Extension boot, panel tabs, Strict Local Mode, theme/RTL, library empty, not-a-video banner, axe A/AA                           | Live caption acquisition  |
| Live manual / canary    | Real acquisition (gated videos, SPA nav, restore)                                                                               | —                         |

### Playwright / Chrome note

Branded Chrome **137+** ignores `--load-extension`. E2E must use Playwright's
Chromium build (Chrome for Testing), **not** `channel: "chrome"`. If Chromium
is missing, the suite skips with an install hint rather than failing CI opaque
timeouts.

## Manual acceptance (release)

1. Load unpacked Chromium build (`.output/chrome-mv3`) and Firefox
   (`.output/firefox-mv2`).
2. Open several YouTube videos: manual captions, ASR, multi-language, Shorts,
   no-captions, long video, paused-before-open, SPA navigate A→B.
3. Confirm player caption/mute/pause/position are restored after acquisition.
4. Search Arabic text with/without diacritics; follow mode in paragraph view.
5. Save → Library search → backup export/import → confirm secrets absent from
   backup JSON.
6. AI: Strict Local Mode blocks remote; Ollama/LM Studio and one remote provider
   with consent; cancel mid-run; invented timestamps in chapters are marked `[?]`.
7. Keyboard-only pass through all tabs; RTL Arabic UI; light/dark themes;
   panel widths ~320px and ~600px.
8. Brave smoke once per release (CWS Chromium build).

## Accessibility

- Automated: `@axe-core/playwright` on Transcript / Library / AI / Settings tabs
  (WCAG 2 A/AA tags; critical/serious must be empty).
- Manual: tab order, visible focus, status announcements, contrast, reduced
  motion, RTL.
