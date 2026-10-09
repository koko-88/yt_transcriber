# ROADMAP — YT Transcriber

**Status: DECOMPOSITION REQUIRED**

Canonical project-wide Spec-of-Specs owner, following `website_reconstruct/ROADMAP.md`. Do not invent feature count, IDs or dependencies without actual product ownership.

## Epic

Transcript Workbench for YouTube. Current product intent: [PRODUCT.md](PRODUCT.md).

## Existing experience/work inventory (not feature boundaries)

- Caption acquisition, state restoration and English/Arabic track selection/YouTube translation.
- Chromium no-caption full-audio local STT, Arabic generation, checkpoint/resume; Firefox local-STT gap.
- Transcript reader, search, playback follow/seek, corrections and undo.
- Saved library, notes, highlights and backup.
- Export + Actions; text, subtitle and document export; templates.
- Settings, privacy/security, cross-browser behavior, verification and release.

Grounding: `README.md`, `src/ui/App.tsx`, `src/stt/`, `src/translation/`, and the dated work inventory recorded in [pre-build evaluation](implementation-scope/pre-build-packet/evaluation.md). The historical AI work item is not automatically a current feature.

## Decomposition status

- Product/source inventory: collected in `PRODUCT.md`.
- Confirmed product-owner sign-off: **PENDING**.
- Approved feature IDs/names/count/boundaries: **NOT DEFINED**.
- Requirement-to-feature coverage and cross-feature dependency graph: **NOT DEFINED**.
- Current selected feature: **NOT PROVIDED**.
- Current `specs/<feature>/` implementation package: **NOT CREATED**.

## Roadmap gate

- [ ] Resolve material contradictory old documentation and confirm current product boundaries.
- [ ] Select the feature to implement, target user journeys and acceptance obligations.
- [ ] Derive coherent, independently testable feature boundaries and ownership.
- [ ] Assign all relevant product obligations once; find duplicate, missing or ambiguous owners.
- [ ] Resolve dependency ordering and explicitly record the feature coverage map.
- [ ] Approve feature ID/name before creating feature-specific Spec Kit artifacts.
- [ ] Link established code/tests/ADRs instead of duplicating whole historical plans.

Former global task plans and unchecked todo were retired after their useful observations were indexed in the pre-build evaluation. Future executable task plans belong to an approved `specs/<feature>/tasks.md`.
