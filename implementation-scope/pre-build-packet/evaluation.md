# Pre-build knowledge evaluation

**Inspection:** 2026-10-09. **Decision:** KNOWLEDGE INTAKE READY; FEATURE IMPLEMENTATION NOT YET CLEARED.

## Evidence collected without new testing

- Current five tabs and removal of AI navigation: `src/ui/App.tsx`.
- Current Chromium/Firefox manifest and commands: `wxt.config.ts`, `package.json`.
- Existing caption/STT/translation/export modules and CI test definitions are present.
- IndexedDB `src/storage/db.ts` still defines `secrets`, `aiCache`, `aiHistory` even though the new top navigation/manifest does not expose remote BYOK.
- All observations above describe source state. No real YouTube or rendered PDF test was executed.

## Contradictions and historic artifacts

- Former `ARCHITECTURE.md` described active remote AI; current code/product does not. The architecture documentation is reconciled in this adoption without changing historical ADRs.
- `docs/adr/0001-transcript-acquisition.md` predates current YouTube translation; it says translated tracks are not offered.
- `docs/adr/0002-hardening-deviations.md` includes old provider permissions and AI lifecycle. Its decisions remain historical, not current manifest policy.
- `TESTING.md`, `RELEASE.md`, and parts of `CONTRIBUTING.md` refer to AI-tab/API-key workflows removed from the current visible product.
- `transcript_extension_plan.md` and `tasks/*` predate changes to product and architecture.
- Legacy AI modules/storage remain. Removal/migration is a **separate decision**, not implied by new documentation.

## Remaining checklist

- [ ] User approves the product inventory and selects the next feature and its precise acceptance requirements.
- [ ] Approve ROADMAP feature inventory/decomposition, mapping, dependencies and feature ID.
- [ ] Ratify the provisional constitution and decide the execution routing and review/attempt budget.
- [ ] Officially install Spec Kit with its CLI and selected agent integrations; GitHub-only docs do **not** install it.
- [ ] Generate the feature spec, plan, tasks and applicable contracts/checklists only after feature selection.
- [ ] Obtain any missing browser/design/model evidence and visual/runtime acceptance for that feature.
- [ ] Correct stale TESTING/RELEASE/CONTRIBUTING AI references before relying on them for release.
- [ ] Decide separately whether dormant AI code/schema should be maintained or migrated.
- [ ] Manual real-browser acceptance remains with the user; CI alone does not verify YouTube availability/export appearance.

This assessment authorizes **source organization**, not automatic feature implementation.
