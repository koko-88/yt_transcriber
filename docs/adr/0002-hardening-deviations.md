# ADR 0002: Hardening deviations from the implementation plan

- Status: Accepted (hardening pass, 2026-09-24)
- Deciders: engineering

This records where the shipped implementation intentionally differs from
`transcript_extension_plan.md`, with the evidence that justified each change.
Everything else in the plan is implemented as written.

## 1. The provider boundary is structural, not nominal

The plan named a `TranscriptProvider { detectVideo, listTracks, fetchTrack,
seek, subscribePlayback }` interface as the acquisition boundary. The shipped
code realises the same boundary as a session module plus injected dependencies:

- `providers/youtube/session.ts` owns the message surface
  (`acq.getState` / `acq.acquire` / `acq.seek` / `playback.getTime`).
- `providers/youtube/acquire.ts` takes an `AcquireDeps` object (bridge, caption
  fetch, video id, abort signal, language preferences), which is what makes the
  ladder unit-testable without a browser.

**Evidence:** with exactly one provider, the nominal interface had no second
implementation, was never imported by any module, and would have added a
translation layer between the session and the ladder for no behavioural gain.
The unused `src/providers/index.ts` was deleted; the boundary guarantees are
enforced by the layered layout and the tests instead. If a second provider ever
lands, the interface can be reintroduced with two real implementations to
shape it.

## 2. AI runs receive the transcript inline

The plan modelled `ai.run` as `{ transcriptId }` with the background loading the
record from IndexedDB. The shipped request carries the transcript object.

**Evidence:** the panel had to call `library.save` before every AI run to make
the id resolvable, which silently wrote to the user's library — contradicting
the documented explicit-save rule and the privacy statement. Passing the
transcript inline removes the implicit write, removes a storage round-trip and
two failure modes (`AI_NO_TRANSCRIPT` from a missing record), and lets the AI
tab work on a transcript the user has not chosen to keep. The payload is
schema-validated in the background (`TranscriptSchema`, ≤100 000 segments) and
the AI cache is keyed by the transcript's text hash, so caching behaviour is
unchanged.

## 3. Firefox ships MV2 with `optional_permissions`

The plan assumed MV3 plus `sidebar_action` for Firefox. WXT's Firefox target
emits MV2, and MV2 has no `optional_host_permissions` key — the generated
manifest silently dropped every AI provider origin, so a Firefox user could
never grant provider access.

**Evidence:** the generated `.output/firefox-mv2/manifest.json` contained no
optional origins at all. The config now mirrors `optional_host_permissions` into
`optional_permissions` for the Firefox branch, and
`scripts/check-manifest.mjs` fails the build if the AI origins are not
requestable in _either_ browser's manifest. Firefox also gets
`browser_specific_settings.gecko.data_collection_permissions` (empty), required
by AMO for new submissions.

## 4. One network choke point

Two independent fetch gates existed: `platform/fetch-gate.ts` (policy object,
allow-list, rate limiter, unused) and `platform/network.ts` (used by the AI
providers). The unused one was deleted; the surviving gate gained the checks the
dead code was supposed to provide — `redirect: 'error'`, `credentials: 'omit'`,
loopback host handling, and a 4 MB response-body cap — plus a `fetchImpl`
injection point so the guarantees are unit-tested.

**Evidence:** `fetch-gate.ts` had no importers; the shipped gate was tested only
implicitly through provider calls. Security regressions now fail in
`tests/security.test.ts`.
