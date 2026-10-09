# Release Process

## Versioning

`package.json` `version` is the single source of truth; `wxt.config.ts` mirrors
it in the manifest (`manifest.version`). Bump both in the same commit and keep
them equal — `npm run check:manifest` fails if the name/permissions/CSP drift,
and the release workflow fails if the tag does not match the manifest version.

## 1. Pre-flight

```bash
npm ci
npm run verify          # typecheck, lint, format, tests, both builds, budgets, licenses
npm run web-ext:lint    # Mozilla linter; inspect warnings before submission
```

Then run the manual checklist in [TESTING.md](TESTING.md) — live YouTube
behaviour cannot be covered by CI.

## 2. Build artifacts

```bash
npm run zip:all
```

This produces:

| Artifact                                       | Contents                         |
| ---------------------------------------------- | -------------------------------- |
| `.output/yt-transcriber-<version>-chrome.zip`  | Chromium MV3 store package       |
| `.output/yt-transcriber-<version>-firefox.zip` | Firefox MV2 package for AMO      |
| `.output/yt-transcriber-<version>-sources.zip` | Buildable sources for AMO review |

## 3. Checksums and provenance

```bash
npm run checksums       # writes .output/SHA256SUMS.txt
```

The release workflow attaches the zips and `SHA256SUMS.txt` to the GitHub
release and requests artifact attestations
(`actions/attest-build-provenance`), so the published bytes can be tied back to
the workflow run that produced them.

## 4. Reproducible build instructions (for reviewers)

1. `npm ci` (the lockfile pins the whole tree).
2. `npm run build && npm run build:firefox`.
3. Compare `.output/*/manifest.json` and the JS chunk hashes against the release
   artifacts. Bundles are deterministic for the same lockfile, Node major
   version and OS path length; `wxt` records sourcemaps in the sources zip.

AMO review note: no remote script URLs or declared
`web_accessible_resources` are intended. Mozilla static lint warnings may
still flag bundled code and must be examined before store submission.

## 5. Publishing

```bash
npm run submit:dry      # validates the package/submission config without uploading
npm run submit          # real submission (requires credentials)
```

Store credentials are supplied through the environment
(`CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`,
`CHROME_REFRESH_TOKEN`, `FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`,
`FIREFOX_JWT_SECRET`) and are only read by `wxt submit`. They are never
committed and never printed; add them as _protected environment_ secrets in the
GitHub `release` environment if you automate submission.

The GitHub release workflow is intentionally split:

- `package` job — builds, lints, checksums, attests. Runs on tag push.
- `publish-stores` job — commented out until credentials exist. It requires the
  `release` environment (manual approval), so a tag alone can never push an
  irreversible store update.

## 6. Store listing material

- **Name:** Transcript Workbench for YouTube (trademark-safe: descriptive, no
  Google/YouTube branding assets).
- **Short description:** "Private transcript workspace for YouTube. Your saved
  work stays local."
- **Categories:** Productivity.
- **Permissions justification:** copy the table from [SECURITY.md](SECURITY.md).
- **Privacy policy URL:** the repository's `PRIVACY.md` (or the Pages rendering
  of it).
- **Screenshots:** capture the transcript tab (paragraph view), the library tab,
  Export + Actions with a selected document template, and the Arabic RTL
  layout at 400 px panel width.
  `docs/screenshots/` is the intended location; keep them 1280×800 or 640×400.
- **Release notes:** summarise changes since the last tag; mention when the
  acquisition ladder or permissions changed.

## GitHub operations and account configuration

This section replaces the former separate GitHub setup runbook. The following are account-level settings to **verify**; a repository Markdown/YAML file is not proof these UI controls are enabled.

- **Ruleset:** protect `main` with PR review, required status checks such as `verify`, up-to-date branches, linear history and no forced pushes/deletions. Confirm exact approval and bypass behavior in GitHub Settings.
- **Actions:** maintain read-only default workflow permissions; release jobs request scoped write/provenance permissions. Review fork approval and action-access settings.
- **Security:** verify Dependabot alerts and security updates, secret scanning/push protection, private vulnerability reporting and CodeQL default setup. The repo includes `.github/dependabot.yml` and `.github/workflows/dependency-review.yml`, but these are not all account-level toggles.
- **Release environment:** the commented-out store-publishing job requires a protected `release` environment, human reviewer, eligible tags/branches and store secrets listed above before activation.
- **Web presence:** no GitHub Pages workflow currently ships. Policy URLs can point to repository Markdown or a later approved public website.
- **Repository metadata:** update description/topics for the current local-first non-BYOK product, not the former AI-provider positioning; preserve the non-affiliation disclaimer in `THIRD_PARTY_NOTICES.md`.

GitHub governance, package creation, store publishing and actual installed-product behavior are different acceptance layers.
