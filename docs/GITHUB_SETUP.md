# GitHub repository setup

Everything that can live in the repository already does. This file lists the
account-level settings that must be applied in the GitHub UI (they cannot be
version-controlled), plus how to verify them.

## 1. Branch protection / ruleset for `main`

Settings → Rules → Rulesets → _New branch ruleset_:

- **Target:** `main`
- **Enforcement:** Active
- **Rules:**
  - Require a pull request before merging (1 approval; dismiss stale approvals)
  - Require status checks to pass: `verify` (the CI job name)
  - Require branches to be up to date before merging
  - Require linear history
  - Block force pushes and deletions
- **Bypass:** repository admins only.

## 2. Actions permissions

Settings → Actions → General:

- Actions permissions: _Allow all actions and reusable workflows_ (the workflows
  only use `actions/*`, `npm/*`).
- Workflow permissions: **Read repository contents** (default). The release
  workflow elevates to `contents: write` for its own job only.
- Enable _Allow GitHub Actions to create and approve pull requests_: **off**.
- Fork pull request workflows: require approval for first-time contributors
  (**on**) — CI never uses secrets, so no secret exposure is possible.

## 3. Security features

Settings → Code security:

- **Dependabot alerts:** on. Config: `.github/dependabot.yml` (npm + Actions,
  weekly).
- **Dependabot security updates:** on.
- **Secret scanning:** on, with **push protection** on.
- **CodeQL:** Default setup, languages: `javascript-typescript`, query suite
  `default`, run on pull requests and on the default branch. No custom workflow
  is needed — do not duplicate it in YAML.
- **Private vulnerability reporting:** on (this is what `SECURITY.md` points
  users at).
- **Dependency review** is enforced per-PR by `dependency-review.yml` (fails on
  high/critical or on GPL-family licenses).

## 4. Release environment

Settings → Environments → _New environment_ named `release`:

- Required reviewers: at least one maintainer (this is the human gate before any
  store submission).
- Deployment branches: `main` and tags matching `v*`.
- Secrets (only needed when you automate store submission):
  `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`,
  `CHROME_REFRESH_TOKEN`, `FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`,
  `FIREFOX_JWT_SECRET`.

The packaging job runs without the environment and therefore without approval;
the `publish-stores` job is commented out in `release.yml` until those
credentials exist.

## 5. GitHub Pages (optional)

The repository ships no Pages workflow: the privacy/security documents are
consumed directly from the repository Markdown. If a store listing needs a
public policy URL, either link to the file on GitHub or enable
Settings → Pages → Source: _GitHub Actions_ with your own workflow.

## 6. Repository metadata

- **Description:** "Private transcript workspace for YouTube — read, search,
  export and analyse transcripts with your own AI provider."
- **Topics:** `browser-extension`, `youtube`, `transcript`, `wxt`, `privacy`,
  `accessibility`, `i18n`.
- **Issues:** enable issue forms (already in `.github/ISSUE_TEMPLATE/`).
- **Trademark note:** the name is descriptive; do not use YouTube/Google logos
  or the words as a product prefix. Keep the "not affiliated with Google"
  disclaimer from `THIRD_PARTY_NOTICES.md` in the store listing.
