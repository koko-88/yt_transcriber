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
│   (long AI network calls do NOT run here — see ADR-0002 §5)        │
└────────────────────────────┬───────────────────────────────────────┘
                             │ runtime message bus
┌────────────────────────────▼───────────────────────────────────────┐
│ Side panel (extension page, trusted)                               │
│   ui/App + views + zustand store                                   │
│   ai/runner executes provider fetches here (survives >30s TTFB)    │
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

| Store                        | Contents                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `transcripts`                | Full transcripts (keyed by `youtube:<videoId>:<trackId>`)                            |
| `videos`                     | Video metadata                                                                       |
| `recents`                    | Library list, capped at 50 entries (oldest pruned)                                   |
| `aiCache`                    | AI results, capped at 200 entries (oldest pruned)                                    |
| `secrets`                    | Provider API keys (extension origin)                                                 |
| `notes`, `highlights`        | Timestamp-linked notes and segment highlights (V1)                                   |
| `tags`, `video_tags`, `meta` | Reserved for tags surface; created in the v1 schema so using them needs no migration |

`browser.storage.local` holds settings only, validated on read and on write.
Database upgrades run through a versioned `upgrade()` callback; a blocked
upgrade closes the connection and reopens instead of corrupting state.

## AI layer

- `registry.ts` — provider definitions (id, base URL, default model, whether a
  key is required, whether it is local). Every remote provider maps to an
  optional host permission origin.
- `pipelines.ts` — prompt construction with a versioned prompt
  (`PROMPT_VERSION`) and a character budget; transcript lines are timestamp-
  anchored; Q&A uses BM25 retrieval; `validateCitations` / `groundAiOutput`
  strip invented timestamps so they are never presented as valid.
- `runner.ts` — the order of checks is deliberate: strict mode → consent →
  host permission → secret → cache → rate limit → call. Failures map to the
  typed `AI_*` error codes. **Execution runs in the side panel**, not the
  background service worker (Chrome may terminate a SW when first-byte
  latency exceeds ~30s).

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
- Unit/integration tests run in vitest (node environment, no browser needed);
  `e2e/` holds a Playwright smoke test that loads the built extension.
- Architecture decisions are recorded in `docs/adr/`.
