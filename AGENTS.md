# AGENTS.md — YT Transcriber

Tool-neutral entry point for coding agents. The organizational pattern follows `koko-88/website_reconstruct`; no Web Reconstruction product requirements are imported.

## Progressive read path

1. [Constitution](.specify/memory/constitution.md): shared rules (PROVISIONAL; ratification pending).
2. [PRODUCT.md](PRODUCT.md): current product inventory and known boundaries.
3. [ROADMAP.md](ROADMAP.md): project-wide decomposition gate. No new feature is approved yet.
4. [ARCHITECTURE.md](ARCHITECTURE.md): technical runtime and trust boundaries for implementation tasks.
5. [Pre-build evaluation](implementation-scope/pre-build-packet/evaluation.md): consolidated source index, historical findings, contradictions and missing evidence.
6. Only **after choosing a feature**: that feature's `spec.md`, `plan.md`, `tasks.md`, checklists and necessary contracts.
7. For execution routing: [workload profile](model-selection/workload-profile.md), [routing policy](model-selection/routing-policy.md), [runtime route registry](model-selection/runtime-route-registry.md). No route is qualified by this documentation change.
8. For relevant tasks: `TESTING.md`, `RELEASE.md`, `package.json`, and `.github/workflows/`; distinguish documented commands from checks actually run.

Do not recursively read the entire repository or use historical notes as current requirements.

## Canonical owners

- General project principles: `.specify/memory/constitution.md`.
- Product purpose, exposed features, platform limits: `PRODUCT.md`.
- Feature inventory, ownership, dependencies and roadmap: `ROADMAP.md`.
- Live technical architecture: `ARCHITECTURE.md` and relevant implementation modules.
- Significant historical decisions: `docs/adr/`. These retain their original context, including now-superseded AI behavior.
- Source observation/readiness: `implementation-scope/pre-build-packet/evaluation.md`.
- Approved feature specification/execution: `specs/<feature>/` once created.
- Model/agent routing and qualification: `model-selection/`.
- Executable verification: code, tests and CI; user-performed manual browser acceptance remains separate.
- Public-facing usage/security/privacy/release instructions: existing `README.md`, `SECURITY.md`, `PRIVACY.md`, `TESTING.md`, `RELEASE.md`.

## Legacy material

The retired historical planning revision, former project-wide tasks/review/todo, and local text logs were extracted into the canonical owners. Their original Git revision remains available [here](https://github.com/koko-88/yt_transcriber/blob/2fb40899f70af7ff8197d21e4978176e33671c21/transcript_extension_plan.md); the [evaluation](implementation-scope/pre-build-packet/evaluation.md) records material findings. Dated ADRs are history, not active task authorization.

The current UI exposes Transcript, Library, Notes, Export + Actions, Settings (`src/ui/App.tsx`). The historical BYOK AI view is not a visible tab and its remote origins were removed from the manifest. Old `src/ai/` and IndexedDB stores still exist: do not re-enable or delete them by inference.

## Work admission and completion

- Resolve material requirement conflicts before coding; never silently invent missing scope.
- Prefer durable implementation aligned with the approved final feature behavior over deliberately temporary scaffolds.
- Inspect the current Git tree and uncommitted work; avoid overlapping agent writes.
- Use acceptance references and relevant deterministic tests; agent self-report or green CI does not prove live YouTube/Arabic PDF behavior.
- User performs final live-browser/manual visual acceptance; no open-ended browser testing loops from agents without a specific request.
- Do not add provider/API subscriptions, account systems, hosted inference, telemetry, or unapproved product scope.
- Official Spec Kit CLI initialization, generated templates and coding-agent integration manifests are **not installed by this GitHub-only documentation change**. Do not claim a working `specify` integration until actual initialization/diff review.
