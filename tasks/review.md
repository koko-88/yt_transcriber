# Completed-feature review

Date: 2026-09-28
Scope: commit c83f74e (saved-transcript workspace), compared with 0c34ac5. Initial review followed by the two authorized fixes below.

## Findings addressed

- [x] P1: Reject pending STT responses after opening saved work. In src/ui/store.ts:534 and :547, startTranscription checks only the active video ID. openSaved pins a different transcript without changing that ID, so an outstanding status/start response overwrites the pinned transcript. A direct reproduction using the actual store returned transcript A while savedView remained true after opening B. Guard the operation with a view/request epoch and savedView at every async boundary, including errors. Add regression cases for both status and start responses.
- [x] P2: Validate AI citations against the anchors actually sent to the model. src/ai/runner.ts:181 and src/ui/components/AiHistory.tsx:81 use zero tolerance against millisecond cue starts; formatAnchoredSegments floors starts to seconds. Reproduction: cue 5500–8500 ms is sent as [0:05], but Evidence [0:05] becomes Evidence [?] and loses its link. Match formatted source anchors (without broadly accepting fabricated timestamps), and cover fractional first cues and cues after gaps.

## Verification before fixes

- Compile, lint and format:check: passed.
- Node suite: 26 files, 169 tests passed.
- Dependency audit: passed with only the two existing exact-path PptxGenJS/image-size exceptions. Initial sandboxed audit failed without a report; authorized network execution succeeded.
- Chrome and Firefox production builds: passed.
- Manifest, bundle budget and license checks: passed.
- Two focused in-memory reproductions confirmed the findings above. They ran actual modules bundled with esbuild and did not edit source or add files.
- Browser/E2E and human runtime acceptance were not run.

Builds: K:/yt_extension/yt_transcriber/.output/chrome-mv3 and K:/yt_extension/yt_transcriber/.output/firefox-mv2.

## Continuation

Both findings have been addressed in source. STT status/start/error responses now require the same view and request epoch; cancellation invalidates pending requests. Citation validation now matches the second-resolution source anchors, including fractional starts, and rejects invented anchors by default. Prompt/cache version advanced to 4 so newly requested answers do not reuse previously stripped citations. Existing saved answers are retained unchanged.

Regression cases were added for delayed status/start success and failure, cancellation, the current live view, fractional first cues, gaps, fabricated anchors, absent anchors, and saved citation history. They have NOT been run, per the user's explicit instruction. No post-fix compile, lint, audit, browser or E2E checks were run. Source diff was reviewed and changed files formatted. Chrome MV3 and Firefox MV2 production builds were refreshed successfully for manual acceptance. The automatic Chrome postbuild manifest check passed. No test suite was executed. The earlier passing checks above describe the pre-fix commit only.

No commit or push was made. Do not restart a whole-project review or run tests without a new user instruction.
