# Architecture

_Transcript Workbench for YouTube_ is a Manifest V3 (Chromium) / Manifest V2
(Firefox) extension built with [WXT](https://wxt.dev), React 19, TypeScript
(strict) and zod. Data lives in IndexedDB via `idb`; panel state is a single
zustand store.

## Contexts and trust boundaries

```
┌─────────────────────────── YouTube page ───────────────────────────┐
│ MAIN world  (untrusted)                                            │
│   youtube-bridge.content.ts → main-bridge-runtime.ts               │
│     - reads movie_player: player response, caption tracks          │
│     - toggles caption track, mutes/seeks/plays for capture         │
│     - hooks fetch/XHR to observe the player's OWN timedtext traffic│
│                    │ window.postMessage (nonce + reqId)            │
│ ISOLATED world (trusted)                                           │
│   youtube.content.ts → providers/youtube/session.ts                │
│     - zod-validates every MAIN→ISOLATED payload                    │
│     - acquisition ladder (ADR-0001) + diagnostics + stale guard    │
│     - same-origin caption fetch, 30 MB body cap                    │
└────────────────────────────┬───────────────────────────────────────┘
                             │ runtime message bus (schema + sender class)
┌────────────────────────────▼───────────────────────────────────────┐
│ Background service worker (trusted router)                         │
│   bus handlers → storage/*, permission checks                      │
│   session, media/STT messaging and persistent storage routes      │
└────────────────────────────┬───────────────────────────────────────┘
                             │ runtime message bus
┌────────────────────────────▼───────────────────────────────────────┐
│ Side panel (extension page, trusted)                               │
│   ui/App + views + zustand store                                   │
│   current Transcript/Library/Notes/Export/Settings workspaces     │
└────────────────────────────────────────────────────────────────────┘
```

Rules that keep the boundaries honest:

- `src/core/**` is pure TypeScript — no browser APIs, no React, no provider
  knowledge. It is the only place where transcript shapes are defined.
- The MAIN-world bridge never constructs network requests and never sees
  secrets; it is treated as hostile input by the ISOLATED world.
- The side panel never talks to the YouTube page directly; acquisition goes
  through the background → content-script bus. Privileged storage and
  secrets are accessed from trusted extension contexts only.
- Every bus message has a zod payload schema and an explicit sender-class
  allow-list; misclassification is rejected before the handler runs.

## Transcript acquisition (ADR-0001)

1. **Bridge handshake** → `getPlayerSnapshot()` yields video identity, duration,
   liveness, playability status and the caption track list.
2. **Availability mapping** (`availability.ts`) turns that into a canonical
   state (`no-captions`, `login-required`, `live-in-progress`, …) before any
   network call.
3. **Track selection** (`track-select.ts`) prefers a manual track in one of your
   browser languages, then ASR in those languages, then any manual, then any
   track.
4. **C1 — static URL attempt:** fetch the track's own `baseUrl` (one request, no
   playback side effects). A 200 with an empty body is _not_ success; it falls
   through.
5. **C3b — player-observed capture:** install the fetch/XHR observers, enable
   the selected track, mute + play (seeking off a boundary if needed), and
   capture the caption response the player requests itself — including the
   short-lived `pot` token. At most two track attempts, 10 s per capture.
6. **Restore** the previous caption track and pause state in a `finally` block.
7. **Fail closed** with an explicit availability state plus a stage trace; a
   stale video id aborts the run instead of returning the wrong transcript.

Parsing (`core/parsers.ts`) auto-detects `json3`, `srv3` and `vtt` and returns
`null` for empty or cue-less bodies, which is what makes "empty HTTP success" a
failure rather than a blank transcript.

## Storage

The IndexedDB schema in `src/storage/db.ts` currently contains:

- `transcripts`: saved transcript text and track identity.
- `videos`: video metadata.
- `recents`: recently visited library entries (documented cap: 50).
- `notes`, `highlights`: transcript-linked annotations.
- `edits`: persistent transcript corrections and undo information.
- `sttCheckpoints`: local no-caption transcription recovery.
- `tags`, `video_tags`, `meta`: existing tag and metadata stores.
- `aiCache`, `aiHistory`, `secrets`: historical AI-provider
  storage schemas still present, though not exposed as current UI features.

`browser.storage.local` holds settings only, validated on read and on write.
Database upgrades run through a versioned `upgrade()` callback; a blocked
upgrade closes the connection and reopens instead of corrupting state.

## Current STT and translation

- `src/stt/media-reader.ts` uses Mediabunny range/lazy media reads
  with bounded PCM windows (25 s / 4 s overlap). This no-caption
  path does not require watching the video in real time.
- `src/stt/model-profile.ts` defines Whisper's English pivot.
  `src/translation/worker.ts` and `src/translation/transcript.ts`
  define local Arabic generation with unchanged cue timing.
- First-time local models download from Hugging Face to browser
  cache. Firefox currently lacks Chromium's offscreen local-STT host.
- `src/providers/youtube/track-select.ts` synthesizes Arabic/English
  translated tracks when YouTube marks a source translatable.
  The older ADR-0001 exclusion is historical.

## Current panel and export

- `src/ui/App.tsx` exposes Transcript, Library, Notes,
  Export + Actions and Settings, not the historical remote AI tab.
- `src/ui/views/ExportView.tsx` selects a code-defined template and
  passes it to `ActionsMenu.tsx`; `src/core/export-templates.ts`
  defines three template IDs.
- `src/core/export-docs.ts` owns generated documents. Its
  browser-rendered PDF path supports Arabic glyph rendering but
  uses page images, not selectable PDF text.
- `src/ai/` and prior IndexedDB AI stores remain as legacy
  source/schema, not active user-facing remote AI.
  Their migration or removal is not decided here.

## Error handling

`AppError` carries a `code`, `retryable`, `userMessageKey` and redacted
`context`. UI strings come from `core/i18n.ts` by key, so user-facing text stays
translatable and never leaks internal detail.

## Build & tooling

- WXT generates both manifests from `wxt.config.ts`; `npm run check:manifest`
  asserts permission minimality, CSP and the absence of
  `web_accessible_resources`/`externally_connectable` after every build.
- `scripts/check-bundle-size.mjs` enforces per-chunk size budgets.
- `scripts/check-licenses.mjs` verifies runtime dependency licenses and that
  `THIRD_PARTY_NOTICES.md` lists them.
- Vitest includes unit/integration plus configured Storybook browser tests;
  `e2e/` holds a Playwright smoke test that loads the built extension.
  Live YouTube behavior and rendered document appearance remain
  separate acceptance.
- Architecture decisions are recorded in `docs/adr/`.

## Document authority

[PRODUCT.md](PRODUCT.md) owns current product intent.
[ROADMAP.md](ROADMAP.md) owns future feature decomposition.
[Pre-build evaluation](implementation-scope/pre-build-packet/evaluation.md)
records remaining contradictions and runtime-proof gaps. Dated ADRs
are historical decisions, not authorization to restore old remote AI.
