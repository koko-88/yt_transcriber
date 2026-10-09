# YT Transcriber workload profile

**Status: SOURCE-DERIVED; NO MODEL QUALIFICATION.**

Mirrors the role of Web Reconstruction's workload profile, using the different extension workload from [PRODUCT](../PRODUCT.md), [ARCHITECTURE](../ARCHITECTURE.md), [SECURITY](../SECURITY.md) and the existing tests.

- **Product/architecture:** privacy, cross-browser parity, source of truth, design and historical consistency.
- **Caption acquisition:** undocumented YouTube responses, video identity, player restoration, completeness, navigation race conditions.
- **Local ML/media:** bounded ranged decode, offscreen/worker lifecycle, Whisper, English-to-Arabic output, cancellation and checkpoint/recovery.
- **Extension security:** untrusted MAIN world vs ISOLATED/background, message schemas, permissions, data egress and browser differences.
- **UI/export:** React/Storybook, narrow panel, Arabic RTL, readability, timestamp choices and PDF/PPTX/DOCX template rendering.
- **Persistent state:** IndexedDB, edits/undo, notes, library, backups and migration.
- **Verification/release:** unit/browser checks, WXT manifests, Firefox AMO and GitHub Actions.

No workloads here are benchmarks or permissions to delegate Critical execution.
