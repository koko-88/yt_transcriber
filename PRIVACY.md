# Privacy Policy

_Transcript Workbench for YouTube_ — last updated 2026-09-28.

## Summary

The extension has no backend, accounts or analytics. Saved work lives in your
browser profile. Caption/media requests and on-demand local-model downloads
contact only their source hosts. Transcript text is not sent to a hosted AI
provider by this product.

## What is stored, and where

| Data                                                                      | Where                                                         | Why                                                  | Leaves your device?                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| Settings (theme and language)                                             | `browser.storage.local`                                       | Remember your preferences                            | No                                        |
| Saved transcripts and video metadata                                      | IndexedDB (`yt-transcript-workbench`) in the extension origin | Library and exports                                  | No                                        |
| Notes and highlights                                                      | IndexedDB                                                     | Timestamp-linked annotations                         | No (local backup export only)             |
| Recognition/translation results                                           | IndexedDB                                                     | Reuse locally generated Arabic/English tracks        | No                                        |
| Diagnostics log (in-memory ring buffer, last 500 events; values redacted) | Memory of the panel/background                                | Troubleshooting; copied only if you press the button | No                                        |
| Playback position polling                                                 | Not stored                                                    | Follow-along highlighting                            | No                                        |

No browsing history, no keystrokes, no analytics, no crash reporting, no
remote configuration and no product API keys are collected.

## Workspace persistence

Original and corrected transcripts, the last 100 undo operations per transcript,
notes and locally generated language tracks are stored in extension-origin
IndexedDB. Local backups include saved workspace data but do not include media
URLs, audio or model files.

Speech-recognition checkpoints contain the video ID, model/profile identity,
duration, recognized text and overlap state. They do not contain audio or media
URLs. They are excluded from backups, expire after seven days, and are removed
when recognized work completes or you explicitly discard it.

The media observation cache uses temporary browser session storage for expiring,
tab/video-bound Googlevideo URLs; it is not permanent library storage.

## Network requests we make

1. **YouTube caption data** — when you open a video page, the content script
   reads caption-track metadata from the player and fetches the caption resource
   for the chosen track. If YouTube marks a source track translatable, the
   extension can request an Arabic or English timedtext translation from YouTube
   using the same caption service.
2. **YouTube/Googlevideo media** — only for the no-caption local transcription
   path. The extension acquires the active video's full audio media resource in
   bounded ranges; it does not need to record playback in real time.
3. **Hugging Face model assets** — local speech-recognition and local
   English-to-Arabic translation model/tokenizer files are downloaded on first
   use and can be cached in the browser profile. Inference itself runs locally.

No transcript is transmitted to OpenAI, Gemini, OpenRouter, Groq, Mistral,
Ollama, LM Studio or any other user-configured inference provider by the product.

## Your controls

- Delete a saved transcript: **Library → Remove**.
- Export / import a library backup: **Settings → Backup**.
- Discard interrupted transcription progress: **Discard progress and restart**.
- Remove everything: uninstalling the extension deletes its IndexedDB and
  `storage.local`/`storage.session` data with it.
- Diagnostics: **Settings → Copy diagnostics** copies a redacted log to the
  clipboard only when you click it. It is never sent anywhere by the extension.

## Data we never collect

Authentication information, personal communications, health information,
financial information, location, web history, advertising identifiers or user
activity outside the YouTube transcript workflow.

## Limited Use statement

Data accessed by this extension is used only to provide its single purpose —
showing, translating, searching, exporting and saving the transcript of the
YouTube video you are looking at. It is not sold, used for advertising,
creditworthiness or lending decisions, or transferred to a hosted AI provider.

## Contact

Open an issue in the project repository, or use a private security advisory for
security-sensitive reports (see [SECURITY.md](SECURITY.md)).
