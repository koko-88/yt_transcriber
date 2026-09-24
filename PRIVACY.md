# Privacy Policy

_Transcript Workbench for YouTube_ — last updated 2026-09-24.

## Summary

The extension has no backend. It does not collect, transmit or sell personal
data. Everything it stores lives in your own browser profile, and network
requests happen only when you ask the extension to call an AI provider you
configured.

## What is stored, and where

| Data                                                                                     | Where                                                         | Why                                                  | Leaves your device?                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| Settings (theme, language, Strict Local Mode, chosen provider/model, consent timestamps) | `browser.storage.local`                                       | Remember your preferences                            | No                                                             |
| Saved transcripts, video metadata, library list                                          | IndexedDB (`yt-transcript-workbench`) in the extension origin | Library, exports, AI context                         | No                                                             |
| AI provider API keys                                                                     | IndexedDB (or `storage.session` for "session only")           | Authenticate your own provider calls                 | Only to the provider you configured, as the request credential |
| AI results cache (max 200 entries, pruned oldest-first)                                  | IndexedDB                                                     | Avoid re-paying for the same request                 | No                                                             |
| Diagnostics log (in-memory ring buffer, last 500 events; values redacted)                | Memory of the panel/background                                | Troubleshooting; copied only if you press the button | No                                                             |
| Playback position polling                                                                | Not stored                                                    | Follow-along highlighting                            | No                                                             |

No browsing history, no page content, no keystrokes, no analytics, no crash
reporting, no remote configuration.

## Network requests we make

1. **YouTube caption data** — when you open a video page, the content script
   reads caption tracks from the player and the caption data the player itself
   requests, exactly as the page would. This stays between your browser and
   YouTube.
2. **AI providers** — only when you press a pipeline button (or _Test
   connection_) in the **AI** tab. The request goes directly from your browser
   to the provider's API with your API key. The transcript text (or, for Q&A,
   the most relevant excerpts) is included so the model can answer. That
   provider's own privacy policy then applies to that request.
3. **Thumbnails** — the library list loads video thumbnails from
   `i.ytimg.com`, as YouTube's own pages do.

Strict Local Mode (Settings) blocks category 2 entirely except for
`localhost`/`127.0.0.1` servers you run yourself.

## Your controls

- Delete a saved transcript: **Library → ✕**.
- Delete an API key: **AI → Delete**.
- Revoke a provider permission: your browser's extension settings for this
  extension (_Site access_ / _Permissions_).
- Remove everything: uninstalling the extension deletes its IndexedDB and
  `storage.local`/`storage.session` data with it.
- Diagnostics: **Settings → Copy diagnostics** copies a redacted log to the
  clipboard only when you click it. It is never sent anywhere by the extension.

## Data we never collect

Document type, host permissions beyond `youtube.com` unless you grant them,
authentication information, personal communications, health information,
financial information, location, web history, user activity, or website content
beyond the transcript you asked for.

## Limited Use statement

Data accessed by this extension is used only to provide its single purpose —
showing, searching, exporting, saving and analysing the transcript of the
YouTube video you are looking at. It is not transferred to third parties except
as described above (your own configured AI provider), is not used for
advertising, is not used to determine creditworthiness or for lending purposes,
and is not sold.

## Contact

Open an issue in the project repository, or use a private security advisory for
security-sensitive reports (see [SECURITY.md](SECURITY.md)).
