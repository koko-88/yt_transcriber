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
| Background service worker                       | Most trusted                              | Permissions, media/session routing and storage                                   |
| Side panel (extension page)                     | Trusted                                   | UI only; privileged work is requested over the message bus                       |

### Assets and how they are protected

1. **Untrusted input.** Page state, MAIN-world messages, caption bodies and
   stored records are validated with zod before use. Bridge events carry a
   per-session nonce; responses are matched by `op#reqId`; timeouts are bounded
   per operation.
2. **Network egress.** Core network access is restricted to YouTube caption
   data, Googlevideo media for the no-caption path, and Hugging Face model
   assets. The product does not request optional OpenAI/Gemini/OpenRouter/etc.
   provider origins and exposes no API-key setup flow.
3. **Local model execution.** Full-audio recognition and English-to-Arabic
   translation run in extension workers. Media is read in bounded windows rather
   than loaded as one full decoded PCM file. Model weights can be cached by
   Transformers.js in the browser profile.
4. **Rendering.** Transcript text and titles are rendered as text nodes only —
   no Markdown-to-HTML step. Exported filenames are sanitized.
5. **Message bus.** Every handler declares its accepted sender classes
   (`content-script` / `extension-page` / `untrusted`) and a payload schema;
   unknown message types and wrong sender classes are rejected before the
   handler runs. There is no `externally_connectable` entry and no
   `web_accessible_resources`, so no web page and no other extension can reach
   these handlers.

### Permissions rationale

| Permission                    | Why it is needed                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `storage`                     | Save settings and the local workspace                                                              |
| `unlimitedStorage`            | Long transcripts, generated tracks and libraries can exceed default extension storage quotas       |
| `sidePanel` (Chromium only)   | Opens the workbench in the browser's side panel                                                    |
| `offscreen` (Chromium only)   | Hosts cancellable local speech/translation workers independently of the visible panel              |
| `webRequest` (Chromium only)  | Passively observes the active video's already-resolved media request for the no-caption local path |
| `https://www.youtube.com/*`   | Content scripts and caption acquisition on video pages                                             |
| `https://*.googlevideo.com/*` | Bounded media reads for local no-caption transcription                                             |
| Hugging Face model hosts      | On-demand local model/tokenizer downloads                                                          |

The extension does **not** request `scripting`, `history`, `cookies`,
`<all_urls>`, remote AI-provider origins, `web_accessible_resources` or
`externally_connectable`. Manifest assertions enforcing this are part of the
build (`npm run check:manifest`).

### Known accepted risks

- **Extensions are not a sandbox against other extensions or local users.**
  Anything another privileged local process can read from the browser profile is
  outside this extension's security boundary.
- **YouTube internals are undocumented.** Acquisition depends on player metadata,
  signed caption/media URLs and the player's own request behavior. If YouTube
  changes these surfaces, the extension fails closed with explicit availability
  states rather than attempting signature deciphering or bypassing access
  controls.
- **On-demand model supply chain.** Local model weights are fetched from named
  Hugging Face repositories. Model identifiers are code-pinned and the browser
  cache reduces repeated downloads; release review must treat model changes as a
  dependency/security change.
- **Firefox local-STT gap.** Firefox currently lacks the Chromium offscreen
  execution host used by the no-caption pipeline. Caption-track and YouTube
  translation flows remain available there.

## Hardening checklist for contributors

- Never add `innerHTML`, `eval`, `new Function`, or remote script URLs.
- Add a schema for every new bus message and declare its sender class.
- Prefer feature detection over user-agent sniffing.
- Keep host permissions limited to the core YouTube/media/model flow.
- Treat model-ID changes like dependency changes: review provenance, license and
  browser compatibility before merging.
