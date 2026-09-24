// Background service worker entrypoint.
// Responsibilities: open the side panel (action click / Ctrl+Shift+Y),
// route panel requests to the YouTube content script of the relevant tab,
// and relay content-script notifications to open panel pages.

import { browser } from "wxt/browser";
import { defineBackground } from "#imports";
import { z } from "zod";
import { bus } from "../platform/messaging.js";
import {
  configurePanelAction,
  toggleFirefoxSidebar,
} from "../platform/panel.js";
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
import { setSecret, deleteSecret, getSecret } from "../storage/secrets.js";
import { videoIdFromUrl } from "../providers/youtube/session.js";
import { panelContextForTab } from "../platform/tab-context.js";

/** The active browser tab is the only valid transcript target. */
async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Resolve the YouTube tab a panel request should act on.
 * Never search other windows for a convenient YouTube tab: that can show a
 * transcript belonging to a different video than the one the user is viewing.
 */
async function resolveTargetTabId(): Promise<number> {
  const active = await activeTab();
  if (active?.id != null && videoIdFromUrl(active.url ?? "")) return active.id;

  throw new AppError({
    code: "ACQ_NO_PLAYER",
    message: "active tab is not a YouTube video",
  });
}

async function forwardToContent<T>(type: string, payload: unknown): Promise<T> {
  const tabId = await resolveTargetTabId();
  return bus.request<T>(type, payload, tabId);
}

export default defineBackground(() => {
  void configurePanelAction().catch((error) =>
    logger.error("background", "native side-panel action setup failed", {
      error: String(error),
    }),
  );

  const notifyVideoChanged = (videoId: string | null) => {
    void browser.runtime
      .sendMessage({ type: "panel.videoChanged", payload: { videoId } })
      .catch(() => undefined);
  };
  browser.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (!change.url || !tab.active) return;
    notifyVideoChanged(videoIdFromUrl(change.url));
  });
  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.tabs
      .get(tabId)
      .then((tab) => notifyVideoChanged(videoIdFromUrl(tab.url ?? "")))
      .catch(() => undefined);
  });

  // Chromium's browser action opens its native side panel. Firefox's toolbar
  // click toggles its native sidebar without losing the user gesture.
  const toolbarAction = browser.action ?? browser.browserAction;
  toolbarAction.onClicked.addListener(() => {
    if ((browser as unknown as { sidePanel?: unknown }).sidePanel) return;
    void toggleFirefoxSidebar().catch((error) =>
      logger.error("background", "native sidebar open failed", {
        error: String(error),
      }),
    );
  });

  // ---- routing: panel -> content script ----

  bus.on("panel.context", z.object({}), ["extension-page"], async () => {
    return panelContextForTab(await activeTab());
  });

  bus.on("acq.getState", z.object({}), ["extension-page"], () =>
    forwardToContent("acq.getState", {}),
  );

  bus.on(
    "acq.acquire",
    z.object({ trackId: z.string().optional() }),
    ["extension-page"],
    (p) => forwardToContent("acq.acquire", p),
  );

  bus.on(
    "acq.seek",
    z.object({ timeMs: z.number().int().nonnegative() }),
    ["extension-page"],
    (p) => forwardToContent("acq.seek", p),
  );

  bus.on("playback.getTime", z.object({}), ["extension-page"], () =>
    forwardToContent("playback.getTime", {}),
  );

  // ---- relay: content script -> all panel pages ----

  bus.on(
    "page.videoChanged",
    z.object({ videoId: z.string().nullable() }),
    ["content-script"],
    async (p, sender) => {
      const tab = await activeTab();
      if (sender.tab?.id === tab?.id) notifyVideoChanged(p.videoId);
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
