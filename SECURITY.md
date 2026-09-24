# Security Policy

## Supported versions

Only the latest published version of _Transcript Workbench for YouTube_ is
supported with security fixes.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub Security Advisories
("Report a vulnerability" on the repository's **Security** tab) rather than in a
public issue. Include reproduction steps, the extension version, browser version
and, if relevant, the YouTube video state involved.

We aim to acknowledge reports within 3 business days and to ship a fix or a
documented mitigation for confirmed issues before public disclosure.

## Threat model (summary)

The extension runs in four contexts with different trust levels:

| Context                                         | Trust                                     | Can do                                                                           |
| ----------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| MAIN-world bridge (`youtube-bridge.content.ts`) | **Untrusted** (page JavaScript runs here) | Read player state, toggle captions, observe the player's own `timedtext` traffic |
| ISOLATED content script (`youtube.content.ts`)  | Trusted                                   | Validate bridge payloads, fetch same-origin captions, talk to background         |
| Background service worker                       | Most trusted                              | Permissions, secrets, network egress, storage                                    |
| Side panel (extension page)                     | Trusted                                   | UI only; all privileged work is requested over the message bus                   |

### Assets and how they are protected

1. **API keys.** Stored in the extension's own IndexedDB (or `storage.session`
   when "session only" is enabled). They are never logged: the `Secret` type
   serializes to `[redacted]`, the logger redacts any key/secret/token-shaped
   field and deep-redacts nested objects, and the bus error path logs only the
   message _type_, never the payload. Gemini keys are sent in the
   `x-goog-api-key` header so they never appear in a URL (and therefore never in
   logs or error text).
2. **Untrusted input.** Page state, MAIN-world messages, caption bodies,
   provider responses and stored records are all validated with zod before use.
   Bridge events carry a per-session nonce; responses are matched by
   `op#reqId`; times out bounded per operation.
3. **Network egress.** All provider traffic flows through
   `gatedFetch()` (`src/platform/network.ts`): HTTPS-only (except loopback),
   `credentials: 'omit'`, `redirect: 'error'` so a provider cannot bounce a
   credentialed request to another origin, a hard timeout, and a 4 MB response
   body cap. Remote providers are additionally refused outright when Strict
   Local Mode is on, and every remote origin requires an explicit runtime
   permission grant.
4. **Rendering.** Transcript text, titles and AI output are rendered as text
   nodes only — no `dangerouslySetInnerHTML`, no Markdown-to-HTML step and no
   `innerHTML` anywhere in the UI. Exported filenames are sanitized.
5. **Message bus.** Every handler declares its accepted sender classes
   (`content-script` / `extension-page` / `untrusted`) and a payload schema;
   unknown message types and wrong sender classes are rejected before the
   handler runs. There is no `externally_connectable` entry and no
   `web_accessible_resources`, so no web page and no other extension can reach
   these handlers.

### Permissions rationale

| Permission                  | Why it is needed                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `storage`                   | Save settings, library, AI cache                                                                  |
| `unlimitedStorage`          | Long transcripts and libraries exceed the default 10 MB quota in Firefox/Chromium for some videos |
| `sidePanel` (Chromium only) | Opens the workbench in the browser's side panel                                                   |
| `https://www.youtube.com/*` | Content scripts must run on video pages to read captions                                          |
| Optional AI origins         | Requested at runtime, per provider, only when you configure it                                    |

The extension does **not** request `scripting`, `tabs`, `history`, `cookies`,
`<all_urls>`, and does not use `web_accessible_resources` or
`externally_connectable`. Manifest assertions enforcing this are part of the
build (`npm run check:manifest`).

### Known accepted risks

- **Extensions are not a sandbox against other extensions or local users.**
  Anything the browser exposes to extension contexts (including stored API keys)
  is readable by a compromised extension with the same privileges. Keys are
  stored as-is, in the extension origin, per the documented threat model; there
  is no OS keychain integration.
- **Dev-only dependency advisories.** The test toolchain is not shipped in the
  packaged extension. We keep `vitest`/`@vitest/coverage-v8` on a patched
  release and audit with `npm audit --omit=dev` in CI; findings that only affect
  test-time code are documented rather than force-upgraded.
- **YouTube internals are undocumented.** Acquisition depends on the player's
  own caption request; if YouTube changes it, the extension fails closed with an
  explicit availability state (`unsupported-page-structure`,
  `needs-player-interaction`) rather than guessing.

## Hardening checklist for contributors

- Never add `innerHTML`, `eval`, `new Function`, or remote script URLs.
- Never log a payload, key, or full request URL of a provider call.
- Add a schema for every new bus message and declare its sender class.
- Prefer feature detection over user-agent sniffing.
- Keep new host permissions optional unless they are required for the core
  YouTube flow.
