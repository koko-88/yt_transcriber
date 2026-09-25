# ADR 0001: YouTube caption acquisition

- Status: Updated 2026-09-25
- Scope: The active YouTube watch video in the current browser window

## Runtime observations

The player response exposes caption tracks and their `baseUrl` values. In the
automated YouTube environment, direct requests to those URLs returned HTTP 200
with an empty body. A player-issued timedtext response sometimes carried the
full JSON3 track. The page also exposed a `getTranscriptEndpoint` command in
its engagement panel data, but the browser probe did not observe a successful
native transcript response. Its request shape and reliability remain unverified,
so it is not an acquisition strategy.

These observations describe the test environment, not a guarantee about every
YouTube session. Final manual browser acceptance remains necessary.

## Provider contract and order

`acquireTranscript` binds a run to one video ID and one selected caption track.
Two strategies implement the same `canHandle` and `acquire` contract:

1. **Static URL.** Fetch the selected track's player-response `baseUrl` with
   JSON3 format in the content script. This does not change player state.
2. **Player-observed timedtext.** If the static response is empty or fails,
   observe the player's own fetch/XHR timedtext response while temporarily
   selecting the same track. This is bounded by a capture timeout. It is skipped
   when a same-language duplicate cannot be identified unambiguously.

A successful response must parse into nonempty, valid cues and pass the
whole-track completeness check. HTTP 200 with an empty body, a fragment,
or a response for another video or track never counts as success. Failure on
the selected track does not silently switch to another language. The user may
choose another track explicitly. Translated tracks are not offered because their
acquisition has not been verified.

## Session and player safety

The panel sends its expected video ID with state and acquisition requests.
The background checks the exact active tab before and after forwarding. The
content script checks its URL before starting and after async acquisition steps.
YouTube SPA navigation aborts in-flight acquisition; the session waits for cleanup before starting another run. The panel rejects stale
results by epoch and video ID.

The second strategy captures pause/play, mute, position, visible CC, and current
caption selection before changing the player. Restoration runs in `finally`
on success, timeout, parse failure, and cancellation. The MAIN-world bridge
checks the observable playback, mute, CC, and position state before acknowledging
restoration. If that check fails, acquisition returns
`player-state-restore-failed` instead of a transcript. A new video's player
is never mutated to restore an old video's state.

Expected failures include no captions, unavailable or initializing player,
empty caption responses, partial data, parse or network errors, stale
navigation, and restoration failure. Stage diagnostics record acquisition and
restoration timing and errors.

## Validation

Provider contract tests cover track identity, cancellation, completeness,
fallback order, and restoration failure. A local Playwright fixture serves a
YouTube-shaped player response and JSON3 captions, then simulates SPA navigation
from video A to B through the built content script, provider, and panel. It
does not replace real YouTube acceptance.

The extension uses a WXT isolated content script plus a MAIN-world bridge, in
line with [WXT's content-script guidance](https://wxt.dev/guide/essentials/content-scripts).
The active-tab routing uses the browser tabs messaging surface described in
[Chrome's tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs).
