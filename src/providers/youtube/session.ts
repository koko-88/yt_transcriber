// ISOLATED-world YouTube session manager. Owns the bridge client lifecycle,
// SPA navigation detection, in-flight acquisition dedupe/cancellation, and the
// content-script message surface used by the background/panel.

import { z } from "zod";
import { browser } from "wxt/browser";
import { bus } from "../../platform/messaging.js";
import { logger } from "../../core/logger.js";
import { AppError } from "../../core/errors.js";
import type { AcquisitionResult, Availability } from "../../core/result.js";
import type { TranscriptTrack, VideoMetadata } from "../../core/model.js";
import { createBridgeClient, type BridgeClient } from "./bridge-client.js";
import { acquireTranscript } from "./acquire.js";
import { buildTrackEntries } from "./track-select.js";
import { mapSnapshotToAvailability } from "./availability.js";
import type { PlayerSnapshot } from "./bridge-protocol.js";

export interface VideoPageState {
  videoId: string | null;
  availability: Availability;
  tracks: TranscriptTrack[];
  metadata: VideoMetadata | null;
}

const VIDEO_ID_RE = /^[\w-]{11}$/;

export function videoIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "www.youtube.com" && u.hostname !== "m.youtube.com")
      return null;
    if (u.pathname === "/watch") {
      const v = u.searchParams.get("v");
      return v && VIDEO_ID_RE.test(v) ? v : null;
    }
    const shorts = u.pathname.match(/^\/shorts\/([\w-]{11})/);
    return shorts?.[1] ?? null;
  } catch {
    return null;
  }
}

export function metadataFromSnapshot(
  snapshot: PlayerSnapshot,
): VideoMetadata | null {
  const videoId = snapshot.videoId;
  if (!videoId) return null;
  return {
    provider: "youtube",
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: snapshot.title ?? "",
    ...(snapshot.channelName ? { channelName: snapshot.channelName } : {}),
    ...(snapshot.channelId ? { channelId: snapshot.channelId } : {}),
    ...(snapshot.durationSeconds != null
      ? { durationMs: Math.round(snapshot.durationSeconds * 1000) }
      : {}),
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    liveState: snapshot.isLive
      ? "live"
      : snapshot.isUpcoming
        ? "upcoming"
        : "none",
    capturedAt: Date.now(),
  };
}

const MAX_CAPTION_BODY = 30 * 1024 * 1024;

async function fetchCaption(
  url: string,
  signal: AbortSignal,
): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    credentials: "include",
    signal,
    redirect: "follow",
  });
  if (!res.body) return { status: res.status, body: "" };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CAPTION_BODY) {
      void reader.cancel();
      throw new Error("caption body exceeds 30MB cap");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { status: res.status, body: new TextDecoder("utf-8").decode(merged) };
}

export function startYouTubeSession(): void {
  const bridge: BridgeClient = createBridgeClient();
  let bridgeReady = false;
  let inFlight: {
    key: string;
    controller: AbortController;
    promise: Promise<AcquisitionResult>;
  } | null = null;
  let lastCancelled: Promise<void> = Promise.resolve();

  async function ensureBridge(): Promise<boolean> {
    if (bridgeReady) return true;
    for (let i = 0; i < 8; i++) {
      try {
        await bridge.hello();
        bridgeReady = true;
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
    logger.warn("session", "main-world bridge never became ready");
    return false;
  }

  async function currentSnapshot(): Promise<PlayerSnapshot | null> {
    if (!(await ensureBridge())) return null;
    try {
      return await bridge.getPlayerSnapshot();
    } catch {
      return null;
    }
  }

  function cancelInFlight(reason: string): void {
    if (inFlight) {
      logger.info("session", `cancelling in-flight acquisition: ${reason}`);
      const cancelled = inFlight;
      cancelled.controller.abort();
      lastCancelled = cancelled.promise.then(
        () => undefined,
        () => undefined,
      );
      inFlight = null;
    }
  }

  function clearInFlight(controller: AbortController): void {
    if (inFlight?.controller === controller) inFlight = null;
  }

  bus.on(
    "acq.getState",
    z.object({ videoId: z.string().optional() }),
    ["extension-page"],
    async (payload): Promise<VideoPageState> => {
      const videoId = videoIdFromUrl(location.href);
      if (payload.videoId && payload.videoId !== videoId) {
        throw new AppError({
          code: "ACQ_STALE_VIDEO",
          message: "active video changed",
        });
      }
      if (!videoId)
        return {
          videoId: null,
          availability: "not-a-video-page",
          tracks: [],
          metadata: null,
        };
      const snapshot = await currentSnapshot();
      if (!snapshot)
        return {
          videoId,
          availability: "unsupported-page-structure",
          tracks: [],
          metadata: null,
        };
      if (snapshot.videoId !== videoId)
        return {
          videoId,
          availability: "unsupported-page-structure",
          tracks: [],
          metadata: null,
        };
      return {
        videoId,
        availability: mapSnapshotToAvailability(snapshot),
        tracks: buildTrackEntries(snapshot.tracks).map((e) => e.track),
        metadata: metadataFromSnapshot(snapshot),
      };
    },
  );

  bus.on(
    "acq.acquire",
    z.object({
      trackId: z.string().optional(),
      videoId: z.string().optional(),
    }),
    ["extension-page"],
    async (payload): Promise<AcquisitionResult> => {
      const videoId = videoIdFromUrl(location.href);
      if (payload.videoId && payload.videoId !== videoId) {
        throw new AppError({
          code: "ACQ_STALE_VIDEO",
          message: "active video changed",
        });
      }
      if (!videoId) {
        return {
          ok: false,
          reason: "not-a-video-page",
          retryable: false,
          diagnostics: [],
        };
      }
      const key = `${videoId}:${payload.trackId ?? "auto"}`;
      for (;;) {
        if (inFlight?.key === key) return inFlight.promise;
        if (inFlight) cancelInFlight("superseded");
        await lastCancelled;
        if (inFlight) continue;
        if (videoIdFromUrl(location.href) !== videoId) {
          throw new AppError({
            code: "ACQ_STALE_VIDEO",
            message: "active video changed",
          });
        }
        break;
      }

      const controller = new AbortController();
      const promise = (async (): Promise<AcquisitionResult> => {
        try {
          return await acquireTranscript({
            bridge,
            fetchCaption,
            videoId,
            currentVideoId: () => videoIdFromUrl(location.href),
            signal: controller.signal,
            preferredLangs: [...navigator.languages],
            ...(payload.trackId ? { requestedTrackId: payload.trackId } : {}),
          });
        } finally {
          clearInFlight(controller);
        }
      })();
      inFlight = { key, controller, promise };
      return promise;
    },
  );

  bus.on(
    "acq.seek",
    z.object({ timeMs: z.number().int().nonnegative() }),
    ["extension-page"],
    async (payload) => {
      if (!(await ensureBridge())) return { ok: false };
      try {
        await bridge.seek(payload.timeMs / 1000);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
  );

  bus.on("playback.getTime", z.object({}), ["extension-page"], async () => {
    if (!(await ensureBridge())) return { timeSeconds: 0, playing: false };
    try {
      return await bridge.getPlaybackTime();
    } catch {
      return { timeSeconds: 0, playing: false };
    }
  });

  // ---- SPA navigation detection ----

  let lastVideoId = videoIdFromUrl(location.href);
  function checkNav(): void {
    const nowId = videoIdFromUrl(location.href);
    if (nowId === lastVideoId) return;
    lastVideoId = nowId;
    cancelInFlight("navigation");
    bridgeReady = false; // re-handshake on next use; player object changed
    browser.runtime
      .sendMessage({ type: "page.videoChanged", payload: { videoId: nowId } })
      .catch(() => undefined);
  }
  document.addEventListener("yt-navigate-finish", checkNav);
  setInterval(checkNav, 1000);

  // Warm the bridge handshake early so first acquire is fast.
  void ensureBridge();
  logger.info("session", "youtube session started");
}
