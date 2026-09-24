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
import { AI_PROVIDERS } from "../ai/registry.js";
import { runAi, testAi } from "../ai/runner.js";
import type { AiRunRequest } from "../ai/types.js";
import { setSecret, deleteSecret, getSecret } from "../storage/secrets.js";

/** Resolve the tab a panel request should act on: the sender's tab, else the active tab. */
async function resolveTargetTabId(
  senderTabId: number | undefined,
): Promise<number> {
  if (senderTabId != null) return senderTabId;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new AppError({ code: "ACQ_NO_PLAYER", message: "no active tab" });
  }
  return tab.id;
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
