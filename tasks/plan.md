# Production workflow implementation

Authorized scope: all seven features from the production review. Keep the current caption fallback, local model profile, WebGPU/WASM worker, and Mediabunny 25s/4s streaming architecture.

## Sequence and acceptance

1. Library: enumerate every saved transcript, search transcript text, filter language, retain multiple tracks, paginate results. Verify more than 50 saved items.
2. Source navigation: pin a saved transcript while browsing, bind seeks to its video, provide an explicit open-at-time action. Verify a different active video is never sought.
3. Notes: list/create/edit/delete timestamp notes and export Markdown. Preserve notes when the panel changes tabs.
4. Corrections: edit segments, persist original and corrected versions, undo, export whichever version is displayed. Verify source timestamps and original text survive edits.
5. AI: process all sections of long transcripts with bounded requests, show coverage/progress, retain per-video history, validate clickable citations. Keep consent and strict-local checks.
6. STT: persist normalizer checkpoints without media URLs, restore only matching video/model/duration checkpoints, preview partial text and resume after source reacquisition. Keep streaming/window behavior.
7. Release verification: focused regression tests, compile, lint, formatting, production builds and existing CI gates. No browser/E2E loops; runtime acceptance remains manual.

## Design and risks

Use existing IndexedDB, message bus, Zustand and visual tokens; English/Arabic labels and native accessible controls. Version the database additively. Never mix partial transcripts with complete saved transcripts. AI summaries use section reduction rather than dropping the middle; failures never claim complete coverage. Tab changes must not discard saved work. Guard asynchronous updates against stale transcript identity.
