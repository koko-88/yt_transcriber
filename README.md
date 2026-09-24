# Transcript Workbench for YouTube

A private transcript workspace for YouTube. Read, search, export and save video
transcripts in a browser side panel — and optionally analyse them with an AI
provider **you** choose. Nothing leaves your machine unless you explicitly send
it to a provider, and never through a server of ours (there isn't one).

- **Panel:** Chromium side panel (`Ctrl+Shift+Y`), Firefox sidebar / popup window.
- **Local first:** transcripts, notes and settings live in the browser's own
  storage. No analytics, no telemetry, no accounts.
- **Your AI, your key:** OpenAI, OpenRouter, Groq, Mistral, Google Gemini, or a
  local Ollama / LM Studio server. API keys stay in the extension's storage.
- **Strict Local Mode:** one toggle that blocks _all_ remote AI providers.
- **Bilingual:** English and Arabic UI with full RTL support.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works, [SECURITY.md](SECURITY.md)
for the threat model, and [PRIVACY.md](PRIVACY.md) for exactly what is stored.

## Features

| Area       | What you get                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Transcript | Paragraph or raw segment view, timestamps, follow-along with playback, click-to-seek           |
| Search     | Diacritic- and Arabic-aware search with in-place highlighting                                  |
| Tracks     | Manual, auto-generated (ASR) and translated tracks; switch without leaving the panel           |
| Notes      | Timestamp-linked notes; Alt+click a segment to highlight it                                    |
| Export     | TXT, Markdown (with timestamp links), SRT, VTT, JSON, plus copy-as-text / copy-with-timestamps |
| Library    | Save transcripts, searchable recents, remove; backup export/import (never includes API keys)   |
| AI         | Summary, key takeaways, chapter suggestions, and grounded Q&A with citation validation         |

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

`npm run verify` is the same gate CI runs. Every command is offline; no network
access is needed for the test suite.

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
  is a separate future capability: it would need a consented way to obtain
  audio and a local or user-configured speech model. This release does not
  upload video or audio to a service for transcription.
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
