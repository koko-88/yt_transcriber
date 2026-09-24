# Contributing

Thanks for helping improve Transcript Workbench. This project is deliberately
small and strict about a few things: typed boundaries, local-first privacy and
deterministic tests.

## Setup

```bash
npm ci          # Node >= 24, npm >= 11
npm run dev     # or: npm run dev:firefox
```

## Before every commit

```bash
npm run verify
```

That is the same gate CI runs: strict TypeScript, ESLint (0 warnings), Prettier,
vitest, both browser builds, bundle budgets and license checks. Fix the root
cause rather than disabling a rule; if a rule genuinely should not apply, use a
narrow inline disable with a comment explaining why.

## Rules of the codebase

1. **Respect the layering.** `src/core` is pure (no browser, no React), the UI
   never touches privileged APIs directly, and the MAIN-world bridge is treated
   as untrusted input.
2. **Validate everything that crosses a boundary** with zod: bus payloads,
   MAIN→ISOLATED messages, provider responses, stored records, settings patches.
   Declare the sender class for every new bus handler.
3. **Never log or serialize secrets.** Use `Secret` for key material; never add
   a payload to a log line; never put a key in a URL.
4. **No remote code, no HTML injection.** No `eval`, `new Function`,
   `innerHTML`, `dangerouslySetInnerHTML`, or scripts loaded from the network.
   Render untrusted text as text.
5. **One module, one idea.** If a file passes ~300 lines or a component owns
   more than one concern, split it.
6. **Fail closed and honestly.** Surface a specific availability/error state
   instead of an empty result; never report a partial success as success.
7. **Add a regression test** with every bug fix, in the suite that owns the
   module.
8. **Keep user-facing strings in `core/i18n.ts`** — English and Arabic, and keep
   the two catalogs in sync (there is a test for parity).

## Commit style

`type(scope): summary` — e.g. `fix(ai): send Gemini key in header`,
`test(parsers): cover hour-less VTT timestamps`. Keep refactors separate from
behaviour changes.

## Pull requests

- Describe the user-visible effect and the verification you ran.
- Keep the diff reviewable; avoid unrelated reformatting.
- CI must be green. Any new permission or host permission must be justified in
  the PR description and added to the rationale table in `SECURITY.md`.

## Reporting security issues

Do **not** open a public issue — see [SECURITY.md](SECURITY.md).
