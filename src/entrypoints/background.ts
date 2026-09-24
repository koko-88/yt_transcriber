// Background service worker entrypoint.
// Responsibilities: open the side panel (action click / Ctrl+Shift+Y),
// route panel requests to the YouTube content script of the relevant tab,
// and relay content-script notifications to open panel pages.

import { browser } from "wxt/browser";
import { defineBackground } from "#imports";
import { z } from "zod";
import { bus } from "../platform/messaging.js";
import { openSidePanel } from "../platform/panel.js";
import { logger } from "../core/logger.js";
import { AppError } from "../core/errors.js";
import {
  getSettings,
  saveSettings,
  SettingsPatchSchema,
} from "../storage/settings.js";
import { saveTranscript, getTranscript } from "../storage/transcripts.js";
import {
  recordRecent,
  listLibrary,
  deleteTranscriptCascade,
} from "../storage/recents.js";
import { TranscriptSchema } from "../core/schemas.js";
import type { Transcript } from "../core/model.js";
import {
  exportLibraryBackup,
  importLibraryBackup,
  sanitizeBackupJson,
  MAX_BACKUP_BYTES,
} from "../storage/backup.js";
import {
  listNotesForVideo,
  upsertNote,
  deleteNote,
  listHighlightsForVideo,
  upsertHighlight,
  deleteHighlight,
} from "../storage/notes.js";
import { AI_PROVIDERS } from "../ai/registry.js";
import { runAi, testAi } from "../ai/runner.js";
import type { AiRunRequest } from "../ai/types.js";
import { setSecret, deleteSecret, getSecret } from "../storage/secrets.js";
import { videoIdFromUrl } from "../providers/youtube/session.js";

/** True when a tab URL is a YouTube watch/shorts page we can acquire from. */
function isYoutubeVideoTab(url: string | undefined): boolean {
  return url != null && videoIdFromUrl(url) != null;
}

/**
 * Resolve the YouTube tab a panel request should act on.
 * Never use the extension-page sender tab — when the panel is opened as a
 * normal tab (E2E, "Open in tab"), sender.tab is the panel itself.
 */
async function resolveTargetTabId(
  _senderTabId: number | undefined,
): Promise<number> {
  const [active] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (active?.id != null && isYoutubeVideoTab(active.url)) {
    return active.id;
  }

  const candidates = await browser.tabs.query({
    url: ["https://www.youtube.com/watch*", "https://www.youtube.com/shorts/*"],
  });
  const current = await browser.windows.getCurrent().catch(() => null);
  const sameWindow = current
    ? candidates.filter((t) => t.windowId === current.id)
    : [];
  const pick = sameWindow[0] ?? candidates[0];
  if (pick?.id != null) return pick.id;

  throw new AppError({
    code: "ACQ_NO_PLAYER",
    message: "no youtube video tab open",
  });
}

async function forwardToContent<T>(
  type: string,
  payload: unknown,
  senderTabId: number | undefined,
): Promise<T> {
  const tabId = await resolveTargetTabId(senderTabId);
  return bus.request<T>(type, payload, tabId);
}

export default defineBackground(() => {
  browser.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (!change.url || !tab.active) return;
    const videoId = videoIdFromUrl(change.url);
    if (!videoId) return;
    browser.runtime
      .sendMessage({ type: "panel.videoChanged", payload: { videoId } })
      .catch(() => undefined);
  });
  // Open the panel on toolbar click and on the keyboard shortcut.
  browser.action.onClicked.addListener((tab) => {
    openSidePanel(tab.id, tab.windowId).catch((e) =>
      logger.error("background", "openSidePanel failed", { error: String(e) }),
    );
  });

  browser.commands?.onCommand.addListener((command) => {
    if (command === "_execute_action") {
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => openSidePanel(tab?.id, tab?.windowId));
    }
  });

  // ---- routing: panel -> content script ----

  bus.on("panel.open", z.object({}), ["extension-page"], async (_p, sender) => {
    await openSidePanel(sender.tab?.id, sender.tab?.windowId);
    return { ok: true };
  });

  bus.on("acq.getState", z.object({}), ["extension-page"], (_p, sender) =>
    forwardToContent("acq.getState", {}, sender.tab?.id),
  );

  bus.on(
    "acq.acquire",
    z.object({ trackId: z.string().optional() }),
    ["extension-page"],
    (p, sender) => forwardToContent("acq.acquire", p, sender.tab?.id),
  );

  bus.on(
    "acq.seek",
    z.object({ timeMs: z.number().int().nonnegative() }),
    ["extension-page"],
    (p, sender) => forwardToContent("acq.seek", p, sender.tab?.id),
  );

  bus.on("playback.getTime", z.object({}), ["extension-page"], (_p, sender) =>
    forwardToContent("playback.getTime", {}, sender.tab?.id),
  );

  // ---- relay: content script -> all panel pages ----

  bus.on(
    "page.videoChanged",
    z.object({ videoId: z.string().nullable() }),
    ["content-script"],
    async (p) => {
      browser.runtime
        .sendMessage({ type: "panel.videoChanged", payload: p })
        .catch(() => undefined);
      return { ok: true };
    },
  );

  registerStorageHandlers();
  registerAiHandlers();
  logger.info("background", "background worker started");
});

export function registerStorageHandlers(): void {
  bus.on("settings.get", z.object({}), ["extension-page"], async () =>
    getSettings(),
  );

  bus.on(
    "settings.set",
    z.object({ patch: SettingsPatchSchema }),
    ["extension-page"],
    async (p) => saveSettings(p.patch),
  );

  bus.on(
    "library.save",
    z.object({ transcript: TranscriptSchema }),
    ["extension-page"],
    async (p) => {
      await saveTranscript(p.transcript as Transcript);
      await recordRecent(p.transcript as Transcript);
      return { ok: true };
    },
  );

  bus.on("library.list", z.object({}), ["extension-page"], async () =>
    listLibrary(),
  );

  bus.on(
    "library.delete",
    z.object({ transcriptId: z.string() }),
    ["extension-page"],
    async (p) => {
      await deleteTranscriptCascade(p.transcriptId);
      return { ok: true };
    },
  );

  bus.on(
    "transcript.get",
    z.object({ id: z.string() }),
    ["extension-page"],
    async (p) => {
      return (await getTranscript(p.id)) ?? null;
    },
  );

  bus.on("library.backup.export", z.object({}), ["extension-page"], async () =>
    exportLibraryBackup(),
  );

  bus.on(
    "library.backup.import",
    z.object({ data: z.unknown() }),
    ["extension-page"],
    async (p) => {
      const json = JSON.stringify(p.data);
      if (json.length > MAX_BACKUP_BYTES) {
        throw new AppError({
          code: "INVALID_INPUT",
          message: "Backup file too large",
        });
      }
      return importLibraryBackup(sanitizeBackupJson(p.data));
    },
  );

  bus.on(
    "notes.list",
    z.object({ videoId: z.string() }),
    ["extension-page"],
    async (p) => listNotesForVideo(p.videoId),
  );

  bus.on(
    "notes.upsert",
    z.object({
      id: z.string(),
      videoId: z.string(),
      transcriptId: z.string(),
      text: z.string().max(50_000),
      startMs: z.number().int().nonnegative().optional(),
    }),
    ["extension-page"],
    async (p) =>
      upsertNote({
        id: p.id,
        videoId: p.videoId,
        transcriptId: p.transcriptId,
        text: p.text,
        ...(p.startMs != null ? { startMs: p.startMs } : {}),
      }),
  );

  bus.on(
    "notes.delete",
    z.object({ id: z.string() }),
    ["extension-page"],
    async (p) => {
      await deleteNote(p.id);
      return { ok: true };
    },
  );

  bus.on(
    "highlights.list",
    z.object({ videoId: z.string() }),
    ["extension-page"],
    async (p) => listHighlightsForVideo(p.videoId),
  );

  bus.on(
    "highlights.upsert",
    z.object({
      id: z.string(),
      videoId: z.string(),
      transcriptId: z.string(),
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().nonnegative(),
      color: z.string().max(40),
      createdAt: z.number(),
    }),
    ["extension-page"],
    async (p) => upsertHighlight(p),
  );

  bus.on(
    "highlights.delete",
    z.object({ id: z.string() }),
    ["extension-page"],
    async (p) => {
      await deleteHighlight(p.id);
      return { ok: true };
    },
  );
}
export function registerAiHandlers(): void {
  bus.on("ai.providers", z.object({}), ["extension-page"], async () =>
    AI_PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      defaultModel: p.defaultModel,
      requiresKey: p.requiresKey,
      isLocal: p.isLocal,
      originPattern: p.originPattern,
    })),
  );

  bus.on(
    "ai.run",
    z.object({
      request: z.object({
        pipeline: z.enum(["summary", "takeaways", "chapters", "qa"]),
        transcript: TranscriptSchema,
        providerId: z.string(),
        model: z.string(),
        question: z.string().max(2000).optional(),
      }),
      consent: z.boolean().optional(),
    }),
    ["extension-page"],
    async (p) => runAi(p.request as AiRunRequest, p.consent ?? false),
  );

  bus.on(
    "ai.test",
    z.object({ providerId: z.string(), model: z.string() }),
    ["extension-page"],
    async (p) => testAi(p.providerId, p.model),
  );

  bus.on(
    "ai.secret.set",
    z.object({
      providerId: z.string(),
      key: z.string(),
      sessionOnly: z.boolean().optional(),
    }),
    ["extension-page"],
    async (p) => {
      await setSecret(p.providerId, p.key, p.sessionOnly ?? false);
      return { ok: true };
    },
  );

  bus.on(
    "ai.secret.delete",
    z.object({ providerId: z.string() }),
    ["extension-page"],
    async (p) => {
      await deleteSecret(p.providerId);
      return { ok: true };
    },
  );

  bus.on(
    "ai.secret.has",
    z.object({ providerId: z.string() }),
    ["extension-page"],
    async (p) => {
      return { has: (await getSecret(p.providerId)) != null };
    },
  );
}
