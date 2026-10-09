# PRODUCT — Transcript Workbench for YouTube

**Status: CURRENT SOURCE INVENTORY; NOT final runtime acceptance.**  
Source baseline: the pre-adoption `main` documentation and implementation, inspected 2026-10-09.

## Product intent and boundaries

Local-first, open-source browser side-panel transcript workbench for YouTube. No product backend, account, telemetry, analytics or user-facing BYOK remote AI flow. Transcripts and saved work stay in extension-origin local storage. Source: [README](README.md), [Privacy](PRIVACY.md), [Security](SECURITY.md), [App](src/ui/App.tsx).

## User-visible workspaces

- **Transcript:** search and display paragraphs/segments; caption selection, playback-follow/seek, corrections and undo.
- **Library:** saved video transcripts and language tracks, search and backups.
- **Notes:** timestamp-linked edits/notes and Markdown export.
- **Export + Actions:** copy; TXT/Markdown/SRT/VTT/JSON/CSV/DOCX/PDF/PPTX. `ExportView.tsx` selects from three code-defined document templates (`clean-transcript`, `study-notes`, `report`), then passes selection to `ActionsMenu.tsx`.
- **Settings:** local preferences, backup and diagnostic controls.

The current top navigation is fixed in `src/ui/App.tsx`; it contains no AI tab.

## Track acquisition and bilingual behavior

1. When a usable caption source exists, acquire its real cues rather than requiring visible CC to be ON. Direct acquisition is followed by bounded player-observed fallback if needed; player state restoration and stale-video guards matter. Source: [ADR-0001](docs/adr/0001-transcript-acquisition.md), [Architecture](ARCHITECTURE.md).
2. English and Arabic are first-class requested outputs. `src/providers/youtube/track-select.ts` synthesizes a missing `en` or `ar` track via YouTube `tlang` **only when** an actual source track is marked translatable. This does not promise success for arbitrary YouTube videos.
3. On **no usable captions**, Chromium has a full-audio, playback-independent local STT path. `src/stt/media-reader.ts` uses bounded decoding windows (25-second window/4-second overlap); `src/stt/model-profile.ts` configures multilingual Whisper English-pivot output, and `src/translation/worker.ts` configures local English-to-Arabic generation with the source time boundaries preserved.
4. Firefox currently lacks the Chromium offscreen local-STT host. Caption and YouTube translation paths are distinct from that limitation. First-time local model assets download from Hugging Face and can be cached; inference is local but initial use is not fully offline.

## Safety, data and target platforms

- Current video/tab/view identity binds results, seeking, edits and recovery. A pending old request must not overwrite a newly opened saved transcript.
- Playback restoration, meaningful failure states, actual transcript completeness and timestamp integrity are product constraints, not optional UI cosmetics.
- IndexedDB holds saved transcripts, notes, corrections and STT checkpoints. Temporary media observations must not turn into permanent backup entries.
- WXT builds Chromium MV3 and Firefox MV2. `wxt.config.ts` declares Chrome minimum 128 and Firefox minimum 142; `package.json` requires Node >=24, npm >=11.
- CI/build/package success does not establish all runtime or visual behavior.

## Explicitly unsupported/unverified in this inventory

- No claim of end-to-end successful behavior for every YouTube session, audio resource, translation, long video, local model or Arabic document export.
- Firefox no-caption local STT is a documented gap.
- The source still contains historical AI code/storage, but the current exposed product has no BYOK/remote-provider UI or corresponding manifest permission.
- Existing templates are code-defined; no Canva integration or approved external template-design package is evidenced.
- No next-feature design, implementation scope, feature priority or acceptance matrix has yet been selected.

Use [ROADMAP](ROADMAP.md) to select and bound a feature; use the [pre-build evaluation](implementation-scope/pre-build-packet/evaluation.md) to resolve contradictions.

## Reconciled earlier engineering context

The [original planning revision](https://github.com/koko-88/yt_transcriber/blob/2fb40899f70af7ff8197d21e4978176e33671c21/transcript_extension_plan.md) prioritized a single WXT extension, local-first workspace, canonical transcript identity, strict trust boundaries, least-privilege permissions, explicit error states, reproducible npm builds and independent browser acceptance. Its original remote AI-provider panel, telemetry variants and real-time tabCapture fallback were **later superseded**; those former plans must not be used as current product scope. It distinguished Chrome/Brave/Firefox from best-effort Tor behavior. No compiled manifest by itself proves runtime parity.
