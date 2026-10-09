# YT Transcriber Constitution

**Status: PROVISIONAL; product-owner ratification pending.**  
Principles adapted from `website_reconstruct/.specify/memory/constitution.md` and existing YT repository obligations.

## I. Canonical authority and progressive disclosure

Start from [AGENTS.md](../../AGENTS.md). Follow each decision's canonical owner. Read task-specific context, not all repository history. Neither model memory nor an old document overrides current evidence.

## II. Evidence integrity and explicit uncertainty

Separate observed runtime facts, source-implemented behavior, historical statements, assumptions, decisions and unknowns. Preserve old reports/ADRs with their dated scope. Missing browser or model evidence is not a PASS.

## III. Fidelity without destructive simplification

Preserve scoped transcript completeness, timestamps, audio/playback independence, restoration, state identity, document semantics, Arabic/RTL, accessibility and privacy. Do not pass by hiding UI, removing required behavior or pretending partial/generated work is complete. An interim implementation needs an explicitly justified engineering transition.

## IV. Verification over agent self-report

Critical changes require named acceptance and actual relevant checks. Unit tests, CI, export appearance and live YouTube behavior are distinct proofs. Do not weaken tests, thresholds or fixtures to disguise a failure. User handles final manual live-browser acceptance.

## V. Portable specifications and reproducible execution

Specify user behavior and acceptance independently of a model vendor. Technical design belongs in Architecture/ADRs, agent selection in `model-selection/`, and feature planning in `specs/`. Record source revision and executed check evidence; bound failed attempts and stop for unresolved gaps.

## Existing project constraints

Current product intent is local-first without a user-facing remote AI provider/API-key flow; language-source truth, Chromium/Firefox capability boundaries, sender validation and storage migration safety must be respected. Details live in [PRODUCT.md](../../PRODUCT.md), [ARCHITECTURE.md](../../ARCHITECTURE.md), [SECURITY.md](../../SECURITY.md) and [PRIVACY.md](../../PRIVACY.md), not duplicated here.

## Governance

Maintain one owner per rule/decision. Use ADRs for material long-lived engineering choices, not every small edit. Do not create competing governance Markdown files. Implementation follows approved scope, bounded tasks, review, deterministic checks and explicitly separate manual acceptance.

This document does not certify that Spec Kit has been initialized or any route has been qualified.
