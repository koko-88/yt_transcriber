# Transcript Workbench for YouTube

A private transcript workspace for YouTube. Read, search, export and save video
transcripts in a browser side panel — and optionally analyse them with an AI
provider **you** choose. AI requests go directly to the provider you authorize. Caption/media and model downloads use their source hosts; there is no server of ours.

- **Panel:** Chromium side panel (`Ctrl+Shift+Y`), Firefox sidebar.
- **Local first:** transcripts, notes and settings live in the browser's own
  storage. No analytics, no telemetry, no accounts.
- **Your AI, your key:** OpenAI, OpenRouter, Groq, Mistral, Google Gemini, or a
  local Ollama / LM Studio server. API keys stay in the extension's storage.
- **Strict Local Mode:** one toggle that blocks _all_ remote AI providers.
- **Bilingual:** English and Arabic UI with full RTL support.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works, [SECURITY.md](SECURITY.md)
for the threat model, and [PRIVACY.md](PRIVACY.md) for exactly what is stored.

## Features

| Area                | What you get                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Transcript          | Paragraph/segment views, follow playback, video-bound timestamp actions, explicit source-video opening                     |
| Corrections         | Segment editing, separate original/corrected versions, persisted undo for the last 100 edits; export the displayed version |
| Search              | Arabic-aware transcript search; full-text saved-library search and language filtering                                      |
| Library             | All saved transcripts and language tracks, paginated display, local backup/import                                          |
| Notes               | Timestamp-linked creation, viewing, editing, deletion and Markdown export                                                  |
| Export              | TXT, Markdown, SRT, VTT, JSON, CSV, DOCX, PDF and PPTX                                                                     |
| AI                  | Full-video section processing, progress/coverage, saved per-video answers and clickable validated citations                |
| Local transcription | Existing Chromium worker/media pipeline with partial previews and recoverable recognition checkpoints                      |

## Requirements

- Node.js **>= 24** and npm **>= 11** for development.
- Chrome/Edge/Brave **128+** (Side Panel API) or Firefox **142+** (MV2 sidebar;
  built-in data-collection consent).

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

`npm run verify` covers the core CI checks. CI also runs the dependency security audit, add-on lint and smoke tests. `npm run test -- tests` runs Node tests without browser tests. `npm run audit:security` requires registry access.

## Using the extension

1. Open any YouTube video page.
2. Click the toolbar icon (or press `Ctrl+Shift+Y`) to open the panel.
3. The transcript is acquired automatically; pick another track from the
   dropdown if the video has more than one.
4. Use _Follow playback_ to keep the active line in view, and click any
   timestamp to seek the video.
5. _Save to library_ keeps a copy locally; _Export_ writes a file to your
   downloads.
6. For AI features: open the **AI** tab, choose a provider, paste your API key,
   grant the provider permission when prompted, and run a pipeline. The first
   run per provider asks for explicit consent.

### AI provider setup notes

- **OpenAI / OpenRouter / Groq / Mistral / Gemini** need an API key and a
  one-time optional permission grant for that origin.
- **Ollama / LM Studio** run on `http://localhost` and need no API key. They are
  the only providers allowed while Strict Local Mode is on.
- Strict Local Mode: _Settings → Strict Local Mode_. When enabled, remote
  providers are refused before any network call is made.

### Saved work and recovery

- Library lists every saved track; the separate recents list remains capped at 50.
- Opening saved work pins it in the panel. **Return to active video** restores live acquisition. A timestamp opens the correct source when another video is active.
- **Notes** provides a timestamped notebook. Adding a note or correction, or completing AI analysis, also saves the transcript locally.
- **Transcript corrections** switches between original and corrected versions. Copy/export and AI operate on the displayed version. Undo retains the last 100 changes.
- AI analysis keeps running while switching panel tabs. Closing the panel or changing its transcript/provider cancels an unfinished request. Completed answers remain in per-video history and in library backups; they are separate from the evictable request cache.
- Long-video summaries/takeaways/chapters process every section before combining results. This can require multiple provider requests and additional cost. Q&A remains based on retrieved excerpts. Failed/cancelled runs never claim complete coverage.
- Speech recognition saves text and overlap state after each completed window. **Resume** reacquires and validates the source; completed recognition is skipped, although the unchanged media reader may decode earlier audio again. Recovery checkpoints expire after seven days and are removed on completion or explicit restart. They contain no media URLs or audio and are excluded from backups.
- IndexedDB upgrades from version 1 to 2 preserve existing transcripts and notes. Backups remain compatible with older version-1 files; new backups include originals, corrections and AI history.

## Known limitations

- Live streams in progress and premieres are not supported (`live-in-progress`,
  `upcoming`).
- Transcript acquisition requires the player to be able to play the video
  briefly only if the session caption URL does not work while paused. The panel
  captures one caption resource, then restores the previous caption, mute,
  position and pause state. It does not record captions as the video plays.
  Clearly truncated responses are reported as partial and retried through the
  other acquisition method. If playback is blocked, the panel reports
  `needs-player-interaction` and you can retry.
- Videos with no YouTube caption track report `no-captions`. Audio transcription
  uses a local speech model when Chromium exposes a usable media source. Audio
  stays local; model assets may be downloaded. Firefox does not currently have
  the required offscreen-document runtime.
- YouTube translated caption options are not advertised as tracks until they
  can be retrieved and verified as full, distinct tracks in the current session.
- Members-only, age-restricted or sign-in-gated videos surface the matching
  state instead of a transcript.
- Shorts URLs are handled, but YouTube itself redirects them to `/watch`.

## Project layout

```
src/
  core/        pure domain: model, parsers, search, export, i18n, errors, logger
  providers/   YouTube acquisition (MAIN bridge + ISOLATED ladder)
  platform/    messaging bus, network gate, permissions, panel
  storage/     IndexedDB + browser.storage adapters
  ai/          provider registry, pipelines, runner
  ui/          React side panel (views + zustand store)
  entrypoints/ background, content scripts, side panel bootstrap
tests/         vitest unit/integration suites
e2e/           Playwright extension smoke test
scripts/       manifest / bundle-budget / license gates
docs/adr/      architecture decision records
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
