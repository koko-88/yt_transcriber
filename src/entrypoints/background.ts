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
import { videoIdFromUrl } from "../providers/youtube/session.js";
import { panelContextForTab } from "../platform/tab-context.js";
import type { AudioSource } from "../providers/youtube/audio-source.js";
import {
  registerMediaObservation,
  getObservedMedia,
  noteMediaSession,
} from "../providers/youtube/media-observation.js";
import { checkpointStatus } from "../storage/stt-checkpoints.js";
import { getVersions, editSegment, undoEdit } from "../storage/edits.js";
import { makeYouTubeTimestampUrl } from "../core/export.js";
import {
  DEFAULT_STT_PROFILE,
  LOCAL_ARABIC_TRACK_ID,
} from "../stt/model-profile.js";

let activeSttSession: { tabId: number; videoId: string } | null = null;

function cancelStaleStt(
  tabId: number,
  videoId: string | null,
  forceNew = false,
): void {
  void noteMediaSession(tabId, videoId, forceNew).catch((error) =>
    logger.warn("background", "media session update failed", {
      error: String(error),
    }),
  );
  if (
    !forceNew &&
    activeSttSession?.tabId === tabId &&
    activeSttSession.videoId === videoId
  )
    return;
  if (activeSttSession?.tabId !== tabId) return;
  activeSttSession = null;
  void browser.runtime
    .sendMessage({ target: "stt-offscreen", type: "cancel" })
    .catch(() => undefined);
}

let offscreenCreation: Promise<void> | null = null;
async function hasSttDocument(): Promise<boolean> {
  const runtime = browser.runtime as unknown as {
    getContexts?: (options: {
      contextTypes: string[];
      documentUrls: string[];
    }) => Promise<unknown[]>;
  };
  if (!runtime.getContexts) return offscreenCreation !== null;
  const contexts = await runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [
      new URL(
        "/stt-offscreen.html",
        browser.runtime.getURL("/sidepanel.html"),
      ).toString(),
    ],
  });
  return contexts.length > 0;
}
async function ensureSttDocument(): Promise<void> {
  const offscreen = (
    browser as unknown as {
      offscreen?: {
        createDocument(options: {
          url: string;
          reasons: string[];
          justification: string;
        }): Promise<void>;
      };
    }
  ).offscreen;
  if (!offscreen)
    throw new Error(
      "Local transcription requires Chromium offscreen documents",
    );
  if (!offscreenCreation) {
    if (await hasSttDocument()) {
      offscreenCreation = Promise.resolve();
      return;
    }
    offscreenCreation = offscreen
      .createDocument({
        url: "stt-offscreen.html",
        reasons: ["WORKERS"],
        justification:
          "Run cancellable local speech recognition independently of the side panel and service worker",
      })
      .catch((error: unknown) => {
        if (!/already exists|single offscreen/i.test(String(error)))
          throw error;
      });
  }
  try {
    await offscreenCreation;
  } catch (error) {
    offscreenCreation = null;
    throw error;
  }
}

/** The active browser tab is the only valid transcript target. */
async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Resolve the YouTube tab a panel request should act on. */
async function resolveTargetTabId(expectedVideoId?: string): Promise<number> {
  const active = await activeTab();
  const activeVideoId = videoIdFromUrl(active?.url ?? "");
  if (expectedVideoId && activeVideoId !== expectedVideoId) {
    throw new AppError({
      code: "ACQ_STALE_VIDEO",
      message: "active video changed",
    });
  }
  if (active?.id != null && activeVideoId) return active.id;
  throw new AppError({
    code: "ACQ_NO_PLAYER",
    message: "active tab is not a YouTube video",
  });
}

async function forwardToContent<T>(
  type: string,
  payload: unknown,
  expectedVideoId?: string,
): Promise<T> {
  const tabId = await resolveTargetTabId(expectedVideoId);
  const result = await bus.request<T>(type, payload, tabId);
  if (
    expectedVideoId &&
    (await resolveTargetTabId(expectedVideoId)) !== tabId
  ) {
    throw new AppError({
      code: "ACQ_STALE_VIDEO",
      message: "active tab changed",
    });
  }
  return result;
}

export default defineBackground(() => {
  registerMediaObservation();
  browser.runtime.onMessage.addListener((raw, sender) => {
    const message = raw as {
      target?: string;
      type?: string;
      tabId?: number;
      videoId?: string;
    };
    if (
      message.target !== "stt-guard" ||
      message.type !== "current" ||
      sender.id !== browser.runtime.id ||
      !Number.isInteger(message.tabId) ||
      !message.videoId
    )
      return undefined;
    return browser.tabs
      .get(message.tabId!)
      .then(
        (tab) =>
          tab.active && videoIdFromUrl(tab.url ?? "") === message.videoId,
      )
      .catch(() => false);
  });
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
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (!change.url && change.status !== "loading") return;
    const videoId = videoIdFromUrl(change.url ?? tab.url ?? "");
    cancelStaleStt(tabId, videoId, change.status === "loading");
    if (!tab.active) return;
    notifyVideoChanged(videoId);
  });
  browser.tabs.onActivated.addListener(({ tabId }) => {
    if (activeSttSession && activeSttSession.tabId !== tabId) {
      const stale = activeSttSession;
      cancelStaleStt(stale.tabId, null);
    }
    void browser.tabs
      .get(tabId)
      .then((tab) => notifyVideoChanged(videoIdFromUrl(tab.url ?? "")))
      .catch(() => undefined);
  });

  const toolbarAction = browser.action ?? browser.browserAction;
  toolbarAction.onClicked.addListener(() => {
    if ((browser as unknown as { sidePanel?: unknown }).sidePanel) return;
    void toggleFirefoxSidebar().catch((error) =>
      logger.error("background", "native sidebar open failed", {
        error: String(error),
      }),
    );
  });

  bus.on("panel.context", z.object({}), ["extension-page"], async () => {
    return panelContextForTab(await activeTab());
  });

  bus.on(
    "acq.getState",
    z.object({ videoId: z.string().optional() }),
    ["extension-page"],
    (p) => forwardToContent("acq.getState", p, p.videoId),
  );

  bus.on(
    "acq.acquire",
    z.object({
      trackId: z.string().optional(),
      videoId: z.string().optional(),
      allowPlaybackMutation: z.boolean().optional(),
    }),
    ["extension-page"],
    (p) => forwardToContent("acq.acquire", p, p.videoId),
  );

  bus.on(
    "acq.seek",
    z.object({
      timeMs: z.number().int().nonnegative(),
      videoId: z.string().regex(/^[\w-]{11}$/),
    }),
    ["extension-page"],
    (p) => forwardToContent("acq.seek", p, p.videoId),
  );

  bus.on(
    "video.open",
    z.object({
      videoId: z.string().regex(/^[\w-]{11}$/),
      timeMs: z.number().int().nonnegative(),
    }),
    ["extension-page"],
    async (p) => {
      const tab = await activeTab();
      if (videoIdFromUrl(tab?.url ?? "") === p.videoId) {
        return forwardToContent("acq.seek", p, p.videoId);
      }
      await browser.tabs.create({
        url: makeYouTubeTimestampUrl(p.videoId, p.timeMs),
        active: true,
      });
      return { ok: true };
    },
  );

  bus.on("playback.getTime", z.object({}), ["extension-page"], () =>
    forwardToContent("playback.getTime", {}),
  );

  bus.on(
    "stt.start",
    z.object({
      videoId: z.string().regex(/^[\w-]{11}$/),
      restart: z.boolean().optional(),
    }),
    ["extension-page"],
    async ({ videoId, restart }) => {
      const tabId = await resolveTargetTabId(videoId);
      const observed = await getObservedMedia(tabId, videoId).catch(
        () => undefined,
      );
      const source = await forwardToContent<AudioSource | null>(
        "stt.source",
        { videoId, observed },
        videoId,
      );
      if (!source || source.videoId !== videoId)
        throw new Error(
          "No usable full audio source is exposed for this video",
        );
      await ensureSttDocument();
      if ((await resolveTargetTabId(videoId)) !== tabId)
        throw new Error("Active source changed");
      activeSttSession = { tabId, videoId };
      return browser.runtime.sendMessage({
        target: "stt-offscreen",
        type: "start",
        source: { ...source, tabId },
        restart,
      });
    },
  );

  bus.on(
    "stt.status",
    z.object({ videoId: z.string().regex(/^[\w-]{11}$/) }),
    ["extension-page"],
    async ({ videoId }) => {
      if (await hasSttDocument()) {
        const current = await browser.runtime.sendMessage({
          target: "stt-offscreen",
          type: "status",
          videoId,
        });
        if (current?.videoId === videoId && current.phase !== "idle")
          return current;
      }
      const [english, arabic] = await Promise.all([
        getTranscript(`youtube:${videoId}:${DEFAULT_STT_PROFILE.trackId}`),
        getTranscript(`youtube:${videoId}:${LOCAL_ARABIC_TRACK_ID}`),
      ]);
      if (english) {
        return {
          videoId,
          phase: "ready",
          progress: 1,
          transcript: english,
          tracks: [english.track, ...(arabic ? [arabic.track] : [])],
        };
      }
      return checkpointStatus(videoId, DEFAULT_STT_PROFILE);
    },
  );

  bus.on("stt.cancel", z.object({}), ["extension-page"], async () => {
    activeSttSession = null;
    if (!(await hasSttDocument()))
      return { videoId: null, phase: "idle", progress: 0 };
    return browser.runtime.sendMessage({
      target: "stt-offscreen",
      type: "cancel",
    });
  });

  bus.on(
    "page.videoChanged",
    z.object({ videoId: z.string().nullable() }),
    ["content-script"],
    async (p, sender) => {
      const tab = await activeTab();
      if (sender.tab?.id != null) cancelStaleStt(sender.tab.id, p.videoId);
      if (sender.tab?.id === tab?.id) notifyVideoChanged(p.videoId);
      return { ok: true };
    },
  );

  registerStorageHandlers();
  logger.info("background", "background worker started");
});

export function registerStorageHandlers(): void {
  bus.on(
    "transcript.versions",
    z.object({ transcript: TranscriptSchema }),
    ["extension-page"],
    (p) => getVersions(p.transcript),
  );
  bus.on(
    "transcript.edit",
    z.object({
      transcript: TranscriptSchema,
      index: z.number().int().nonnegative(),
      text: z.string().trim().min(1).max(50_000),
      expectedHash: z.string(),
    }),
    ["extension-page"],
    (p) => editSegment(p.transcript, p.index, p.text, p.expectedHash),
  );
  bus.on(
    "transcript.undo",
    z.object({ transcriptId: z.string(), expectedHash: z.string() }),
    ["extension-page"],
    (p) => undoEdit(p.transcriptId, p.expectedHash),
  );
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

  bus.on(
    "library.list",
    z.object({
      query: z.string().max(1000).default(""),
      language: z.string().max(20).default(""),
    }),
    ["extension-page"],
    async (p) => listLibrary(p.query, p.language),
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
