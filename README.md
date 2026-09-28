# Transcript Workbench for YouTube

A private, local-first transcript workspace for YouTube. Read, search, save and
export video transcripts from a browser side panel. There is no product backend,
account system, analytics service or bring-your-own-AI-key flow.

- **Panel:** Chromium side panel (`Ctrl+Shift+Y`), Firefox sidebar.
- **Local first:** transcripts, notes and settings live in the browser's own
  storage. No analytics, no telemetry, no accounts.
- **Arabic + English first:** native YouTube tracks are used when available;
  translatable YouTube tracks expose the missing Arabic/English counterpart.
- **No-caption fallback:** Chromium can acquire the full audio resource and run
  accelerated local speech recognition independent of playback, then generate
  timestamp-preserving English and Arabic local tracks.
- **Export workspace:** Export + Actions has its own top-level tab with text,
  subtitle, structured-data and document formats plus built-in document
  templates.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works, [SECURITY.md](SECURITY.md)
for the threat model, and [PRIVACY.md](PRIVACY.md) for exactly what is stored.

## Features

| Area                | What you get                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Transcript          | Paragraph/segment views, follow playback, video-bound timestamp actions, Arabic/English track switching                      |
| Corrections         | Segment editing, separate original/corrected versions, persisted undo for the last 100 edits; export the displayed version   |
| Search              | Arabic-aware transcript search; full-text saved-library search and language filtering                                        |
| Library             | Saved transcripts and language tracks, paginated display, local backup/import                                                |
| Notes               | Timestamp-linked creation, viewing, editing, deletion and Markdown export                                                    |
| Export + Actions    | Copy modes; TXT, Markdown, SRT, VTT, JSON, CSV, DOCX, PDF and PPTX; built-in document templates                              |
| Local transcription | Full-audio Chromium pipeline with bounded decoding, partial previews, checkpoints, English pivot and local Arabic generation |

## Requirements

- Node.js **>= 24** and npm **>= 11** for development.
- Chrome/Edge/Brave **128+** (Side Panel API) or Firefox **142+** (MV2 sidebar).

## Install for development

```bash
npm install
npm run dev            # Chromium, HMR
npm run dev:firefox    # Firefox
```

Load the unpacked extension:

- **Chromium:** `chrome://extensions` → enable Developer mode → _Load unpacked_ →
  `.output/chrome-mv3`
- **Firefox:** `about:debugging#/runtime/this-firefox` → _Load Temporary Add-on_ →
  `.output/firefox-mv2/manifest.json`

## Verify, build, package

```bash
npm run verify          # typecheck + lint + format check + tests + both builds + budgets + licenses
npm run build           # Chromium build (+ manifest assertions via postbuild)
npm run build:firefox   # Firefox build
npm run zip:all         # Chrome zip, Firefox zip, Firefox source zip for AMO
npm run web-ext:lint    # Mozilla add-on linter against the Firefox build
npm run test:e2e        # Playwright smoke test (loads the built extension in Chromium)
```

`npm run verify` covers the core CI checks. CI also runs the dependency security
audit, add-on lint, packaging, checksums and artifact upload.

## Using the extension

1. Open any YouTube video page.
2. Click the toolbar icon (or press `Ctrl+Shift+Y`) to open the panel.
3. The transcript is acquired automatically. Arabic and English are treated as
   first-class tracks when YouTube exposes a translatable source.
4. Use _Follow playback_ to keep the active line in view, and click any
   timestamp to seek the video.
5. Use **Export + Actions** for copy/export formats, document templates, saving
   to the library and adding notes.
6. If a video has no usable caption track, Chromium starts the full-audio local
   pipeline. The video does not need to play in real time and seeking/pausing
   does not drive transcription.

### Saved work and recovery

- Library lists every saved track; the separate recents list remains capped at 50.
- Opening saved work pins it in the panel. **Return to active video** restores live acquisition.
- **Notes** provides a timestamped notebook.
- **Transcript corrections** switches between original and corrected versions.
  Copy/export uses the displayed version. Undo retains the last 100 changes.
- Speech recognition saves text and overlap state after each completed window.
  **Resume** reacquires and validates the source. Recovery checkpoints expire
  after seven days and contain no media URLs or audio.

## Bilingual transcript strategy

The project intentionally uses two mature paths instead of treating every video
as an ML problem:

1. When a real YouTube caption track exists, it remains the source of truth. If
   YouTube marks it translatable, the workbench creates missing Arabic/English
   track requests with YouTube timedtext translation (`tlang`) while preserving
   caption timing.
2. When there is no usable caption track, Chromium acquires the full audio media
   resource and runs multilingual Whisper locally with `task: translate` to
   produce the timestamped English pivot. A local English→Arabic translation
   model then translates the same timed segments, preserving every cue boundary.

The local models are downloaded from Hugging Face on first use and cached in the
browser profile. No hosted inference API or API key is used.

## Known limitations

- Live streams in progress and premieres are not supported (`live-in-progress`,
  `upcoming`).
- Caption acquisition may briefly nudge playback only when the signed caption
  URL does not work while paused and the user explicitly retries; player state
  is restored afterward. It does not record captions as the video plays.
- YouTube translation depends on the source track being marked translatable and
  the signed timedtext translation request succeeding in the current session.
- Local no-caption transcription currently needs Chromium offscreen documents;
  Firefox caption-track and YouTube-translation flows work, but Firefox does not
  yet have the local no-caption execution host.
- The first local model use downloads model/tokenizer assets and can take time;
  later runs use the browser cache.
- Members-only, age-restricted or sign-in-gated videos surface the matching
  state instead of a transcript.

## Project layout

```
src/
  core/         pure domain: model, parsers, search, export, i18n, errors, logger
  providers/    YouTube acquisition (MAIN bridge + ISOLATED ladder)
  platform/     messaging bus, network gate, permissions, panel
  storage/      IndexedDB + browser.storage adapters
  stt/          local full-audio speech recognition
  translation/  local timestamp-preserving Arabic generation
  ui/           React side panel (views + zustand store)
  entrypoints/  background, content scripts, side panel bootstrap
tests/          vitest unit/integration suites
e2e/            Playwright extension smoke test
scripts/        manifest / bundle-budget / license gates
docs/adr/       architecture decision records
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
