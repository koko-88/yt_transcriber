# Testing

Everything runs offline; no test requires network access or a real YouTube
session. Live YouTube verification is a manual, pre-release step (see
[RELEASE.md](RELEASE.md)) and is never a required CI gate.

## Commands

```bash
npm run test              # vitest unit + integration suites
npm run test:coverage     # with V8 coverage
npm run test:e2e          # Playwright: loads the built extension in Chromium
npm run web-ext:lint      # Mozilla linter against the Firefox build
npm run verify            # full local gate (see below)
```

`npm run verify` runs, in order: `tsc --noEmit`, ESLint, Prettier check, vitest,
the Chromium build, the Firefox build, the bundle-budget check and the license
check. It is what CI runs.

## What the suites cover

| Suite                        | Focus                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/parsers.test.ts`      | json3 / srv3 / VTT parsing, format sniffing, empty and cue-less bodies, malformed timestamps                                                                       |
| `tests/track-select.test.ts` | Track ids, dedupe, manual-over-ASR preference, language ordering                                                                                                   |
| `tests/paragraphs.test.ts`   | Paragraph grouping and segment ranges                                                                                                                              |
| `tests/search.test.ts`       | Normalization (Arabic diacritics, alef forms), substring search, BM25 retrieval                                                                                    |
| `tests/export.test.ts`       | TXT/MD/SRT/VTT/JSON output, timestamp formats, filename sanitizing                                                                                                 |
| `tests/core.test.ts`         | i18n interpolation and en/ar parity, `Secret` redaction, hashing determinism, availability mapping, manifest-independent invariants                                |
| `tests/security.test.ts`     | Network gate (HTTPS-only, loopback, redirect refusal, body caps), settings-patch validation, bus rejection of unknown/oversized payloads, secret non-serialization |
| `e2e/smoke.spec.ts`          | Built extension loads, service worker starts, panel renders, no console errors                                                                                     |

Unit tests run in the `node` environment: they exercise pure logic plus
injected-dependency adapters (`gatedFetch` takes a `fetchImpl`), which is why no
browser emulator dependency is needed.

## Conventions

- Tests must be deterministic: no timers without fake clocks, no network, no
  reliance on wall-clock ordering.
- Assert observable behaviour, not private structure.
- Every fixed defect gets a regression test in the suite that owns the module.
- Fixtures must mirror real observed formats (the parser fixtures are trimmed
  real caption payloads).

## Manual pre-release checklist

1. Load the built extension (see [RELEASE.md](RELEASE.md)).
2. Verify: manual-caption video, ASR-only video, multi-track video, no-caption
   video, Shorts URL, SPA navigation between two videos, back/forward
   navigation, paused video, captions initially disabled.
3. Confirm acquisition never leaves the video paused with captions forced on.
4. Run one AI pipeline against a real provider key; confirm consent, permission
   prompt, cancellation/error surfacing and cache reuse on a second run.
5. Switch language to العربية and confirm RTL layout in every tab.
