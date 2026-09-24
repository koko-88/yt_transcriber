# ADR 0001: YouTube transcript acquisition ladder

- Status: Accepted (M0-A, 2026-09-24)
- Deciders: engineering
- Evidence: the M0-A headful acquisition spike ran against live YouTube with
  Playwright (`spike/acquisition-spike.mjs`, reports `report-v1.json`,
  `report.json`, `report-v3.json`). The spike and its raw reports were removed
  from the tree once this decision was recorded; the findings below are the
  durable record.

## Context

The plan (D01/D02) requires an in-page acquisition ladder with graceful
degradation. Candidate mechanisms:

- **C1** — static `captionTracks[].baseUrl` from the player response + `fmt=json3`
- **C2** — `movie_player.getOption('captions','tracklist')`
- **C3b** — enable a caption track via the player API and capture the player's
  **own** `/api/timedtext` request **and response body** (which carries the
  runtime `pot` token), restoring caption/playback state afterwards

## Evidence summary

| Video                       | C1 static fetch                            | C2 tracklist             | C3b capture                                                                         |
| --------------------------- | ------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------- |
| dQw4w9WgXcQ (manual+asr ×6) | HTTP 200, **0 bytes**                      | 5 tracks, **no baseUrl** | cues rendered once playback actually started                                        |
| jNQXAC9IVRw (manual en+de)  | HTTP 200, **0 bytes**                      | 2 tracks, no baseUrl     | XHR captured, `pot` in URL, **HTTP 200, 683 bytes, valid json3** (`wireMagic: pb3`) |
| 9bZkp7q19f0 (ASR ko)        | HTTP 200, **0 bytes**                      | unavailable              | request observed with `pot`; empty body in flagged context                          |
| eKFTSSKCzWA (no captions)   | n/a (0 tracks)                             | n/a                      | n/a → `no-captions`                                                                 |
| Shorts URL (`/shorts/<id>`) | redirects to `/watch`; normal path applies | —                        | —                                                                                   |

Environment finding: in automation-flagged contexts (headless + automation
flags), YouTube returns **HTTP 200 with empty bodies even for the player's own
requests** (`cuesVisible=false`). With `--disable-blink-features=AutomationControlled`
the identical code path returns full json3 bodies and cues render. The empty-200
soft-block is therefore environment detection, not a mechanism failure. Production
must surface this as the retryable `fetch-empty` state.

## Decision

1. **Primary mechanism: C3b** — enable the target track through the official
   player API and capture the player's own timedtext **response body**
   (fetch + XHR hooks installed _before_ enabling the track). Never construct
   or refetch timedtext URLs ourselves: `pot` tokens are effectively
   single-use/context-bound, and refetches return empty 200s.
2. **C1 retained as a cheap first attempt** (one fetch, no playback side
   effects) for regions/experiments where static URLs still serve content;
   any empty body falls through to C3b.
3. **C2 used for enumeration cross-check only** (it exposes no `baseUrl`).
4. Player state is always restored (previous caption track, pause state)
   after acquisition; `restorePlayback` runs in `finally`.
5. Playback requirement: captions only load while playing. The bridge mutes,
   seeks off the boundary if needed, and calls `playVideo()`. If the player
   refuses to play, acquisition ends as `needs-player-interaction` (retryable).
6. If no timedtext response arrives within the capture window after a track
   was already loaded, the ladder retries once with a seek nudge, then tries
   the next-best track (max 2 track attempts per acquisition run).

## Consequences

- The MAIN-world bridge is minimal and untrusted; all payloads validated by
  zod in the ISOLATED world (`bridge-protocol.ts`).
- No media downloads are triggered intentionally; the player may buffer small
  amounts of media during the capture window (same as a user pressing play).
- `fetch-empty` and `needs-player-interaction` are first-class retryable
  availability states in the UI.
