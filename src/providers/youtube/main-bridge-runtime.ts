// MAIN-world bridge runtime: message loop and playback/caption manipulation.
// Everything here executes in page context and is treated as untrusted.

import type {
  BridgeEvent,
  BridgeRequest,
  BridgeResponse,
} from "./bridge-protocol.js";
import { BRIDGE_NS } from "./bridge-protocol.js";
import { snapshotFromPlayerResponse } from "./main-bridge.js";
import { installCapture, uninstallCapture } from "./main-bridge-capture.js";

interface YtPlayerRt {
  getPlayerResponse?: () => unknown;
  getPlayerState?: () => number;
  getOption?: (m: string, o: string) => unknown;
  setOption?: (m: string, o: string, v: unknown) => void;
  loadModule?: (n: string) => void;
  unloadModule?: (n: string) => void;
  playVideo?: () => void;
  pauseVideo?: () => void;
  mute?: () => void;
  unMute?: () => void;
  isMuted?: () => boolean;
  seekTo?: (s: number, a?: boolean) => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
}

/**
 * Captured once at the start of an acquisition run. Retries must NOT overwrite
 * this — otherwise the "original" state becomes whatever the previous attempt
 * left behind.
 */
interface SavedPlaybackState {
  player: YtPlayerRt;
  videoId: string | null;
  hadCaptions: boolean;
  prevTrack: unknown;
  wasPaused: boolean;
  wasMuted: boolean;
  timeSeconds: number;
  /** True if ensurePlaying sought away from the user's position. */
  didSeek: boolean;
  /** True if ensurePlaying muted a previously unmuted player. */
  didMute: boolean;
}

let activeNonce: string | null = null;
let savedState: SavedPlaybackState | null = null;

function post(msg: BridgeResponse | BridgeEvent): void {
  window.postMessage(msg, location.origin);
}

function respond(
  req: BridgeRequest,
  ok: boolean,
  data?: unknown,
  error?: string,
): void {
  const res: BridgeResponse = {
    ns: BRIDGE_NS,
    dir: "res",
    nonce: req.nonce,
    reqId: req.reqId,
    op: req.op,
    ok,
  };
  if (data !== undefined) res.data = data;
  if (error !== undefined) res.error = error.slice(0, 500);
  post(res);
}

function getPlayer(): YtPlayerRt | null {
  return document.getElementById(
    "movie_player",
  ) as unknown as YtPlayerRt | null;
}

function currentCaptionTrack(player: YtPlayerRt): {
  hadCaptions: boolean;
  prevTrack: unknown;
} {
  try {
    const prev = player.getOption?.("captions", "track");
    const has =
      !!prev &&
      typeof prev === "object" &&
      typeof (prev as { languageCode?: unknown }).languageCode === "string";
    const pressed = document
      .querySelector?.(".ytp-subtitles-button")
      ?.getAttribute("aria-pressed");
    return {
      hadCaptions: pressed === "true" ? true : pressed === "false" ? false : has,
      prevTrack: prev ?? null,
    };
  } catch {
    return { hadCaptions: false, prevTrack: null };
  }
}

async function waitFor(
  pred: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return pred();
}

function captureOriginalState(player: YtPlayerRt): void {
  // Only the first mutation in a run may snapshot — retries must preserve it.
  if (savedState?.player !== player) savedState = null;
  if (savedState) return;
  const st = currentCaptionTrack(player);
  let wasMuted = false;
  try {
    wasMuted = player.isMuted?.() === true;
  } catch {
    wasMuted = false;
  }
  savedState = {
    player,
    videoId: playerVideoId(player),
    ...st,
    wasPaused: player.getPlayerState?.() !== 1,
    wasMuted,
    timeSeconds: player.getCurrentTime?.() ?? 0,
    didSeek: false,
    didMute: false,
  };
}

function playerVideoId(player: YtPlayerRt): string | null {
  const response = player.getPlayerResponse?.() as
    { videoDetails?: { videoId?: string } } | undefined;
  return response?.videoDetails?.videoId ?? null;
}

async function handleEnableTrack(
  req: BridgeRequest,
  player: YtPlayerRt,
): Promise<void> {
  if (!player.setOption) {
    respond(req, false, undefined, "captions-api-unavailable");
    return;
  }
  const p = (req.payload ?? {}) as {
    languageCode?: string;
    kind?: string;
    vssId?: string;
    forceReload?: boolean;
  };
  if (typeof p.languageCode !== "string" || !p.languageCode) {
    respond(req, false, undefined, "bad-track-payload");
    return;
  }
  try {
    captureOriginalState(player);
    if (p.forceReload) {
      player.setOption("captions", "track", {});
      player.unloadModule?.("captions");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    player.loadModule?.("captions");
    const track: Record<string, string> = { languageCode: p.languageCode };
    if (p.kind) track["kind"] = p.kind;
    if (p.vssId) track["vssId"] = p.vssId;
    player.setOption("captions", "track", track);
    respond(req, true);
  } catch (e) {
    respond(req, false, undefined, String(e));
  }
}

async function handleRestore(
  req: BridgeRequest,
  player: YtPlayerRt | null,
): Promise<void> {
  const prev = savedState;
  savedState = null;
  try {
    if (
      player &&
      prev &&
      prev.player === player &&
      prev.videoId === playerVideoId(player)
    ) {
      if (player.setOption) {
        if (prev?.hadCaptions && prev.prevTrack) {
          player.loadModule?.("captions");
          player.setOption("captions", "track", prev.prevTrack);
        } else {
          player.setOption("captions", "track", {});
          player.unloadModule?.("captions");
        }
        // The selected track and the visible CC toggle are separate state in
        // YouTube. Let the player settle, then restore the toggle explicitly.
        await new Promise((resolve) => setTimeout(resolve, 250));
        const button = document.querySelector?.(
          ".ytp-subtitles-button",
        ) as HTMLButtonElement | null | undefined;
        if (button) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const pressed = button.getAttribute("aria-pressed") === "true";
            if (pressed === prev.hadCaptions) break;
            button.click();
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (prev.hadCaptions && prev.prevTrack) {
            player.setOption("captions", "track", prev.prevTrack);
          }
        }
      }
      // Undo mute only when we muted a previously unmuted player.
      if (prev?.didMute && !prev.wasMuted) {
        try {
          player.unMute?.();
        } catch {
          /* ignore */
        }
      }
      // Undo seek so the user is not left at the nudge position.
      if (prev?.didSeek && Number.isFinite(prev.timeSeconds)) {
        try {
          player.seekTo?.(prev.timeSeconds, true);
          const reached = await waitFor(
            () => Math.abs((player.getCurrentTime?.() ?? prev.timeSeconds) - prev.timeSeconds) < 1.5,
            1200,
          );
          if (!reached) {
            const media = document.querySelector?.(
              "video.html5-main-video",
            ) as HTMLVideoElement | null | undefined;
            if (media) media.currentTime = prev.timeSeconds;
            player.seekTo?.(prev.timeSeconds, true);
          }
        } catch {
          /* ignore */
        }
      }
      if (prev?.wasPaused) player.pauseVideo?.();
    }
    respond(req, true);
  } catch (e) {
    respond(req, false, undefined, String(e));
  }
}

async function handleEnsurePlaying(
  req: BridgeRequest,
  player: YtPlayerRt,
): Promise<void> {
  try {
    captureOriginalState(player);
    const prev = savedState;
    if (prev && !prev.wasMuted) {
      player.mute?.();
      prev.didMute = true;
    } else {
      player.mute?.();
    }
    const t = player.getCurrentTime?.() ?? 0;
    const d = player.getDuration?.() ?? Infinity;
    const forceNudge = (req.payload as { forceNudge?: unknown } | undefined)
      ?.forceNudge === true;
    if (forceNudge || t < 0.5 || t >= d - 0.5) {
      const target = forceNudge && t < d - 6
        ? t + 5
        : Math.min(2, Math.max(0, d / 10));
      player.seekTo?.(target, true);
      if (prev) prev.didSeek = true;
    }
    player.playVideo?.();
    const playing = await waitFor(() => player.getPlayerState?.() === 1, 8000);
    respond(
      req,
      playing,
      undefined,
      playing ? undefined : "player-not-playing",
    );
  } catch (e) {
    respond(req, false, undefined, String(e));
  }
}

async function handle(req: BridgeRequest): Promise<void> {
  const player = getPlayer();
  switch (req.op) {
    case "hello":
      activeNonce = req.nonce;
      respond(req, true, { ready: true });
      return;
    case "getPlayerSnapshot":
      if (!player) {
        respond(req, false, undefined, "no-player");
        return;
      }
      respond(
        req,
        true,
        snapshotFromPlayerResponse(
          (player.getPlayerResponse?.() as Record<string, unknown> | null) ??
            null,
          player,
        ),
      );
      return;
    case "enableTrack":
      if (!player) {
        respond(req, false, undefined, "no-player");
        return;
      }
      await handleEnableTrack(req, player);
      return;
    case "disableTrack":
    case "restorePlayback":
      await handleRestore(req, player);
      return;
    case "ensurePlaying":
      if (!player) {
        respond(req, false, undefined, "no-player");
        return;
      }
      await handleEnsurePlaying(req, player);
      return;
    case "startCapture":
      installCapture(
        (evt) => post(evt),
        () => activeNonce,
      );
      respond(req, true);
      return;
    case "stopCapture":
      uninstallCapture();
      respond(req, true);
      return;
    case "seek": {
      const sp = (req.payload ?? {}) as { seconds?: unknown };
      if (
        !player ||
        typeof player.seekTo !== "function" ||
        typeof sp.seconds !== "number" ||
        !Number.isFinite(sp.seconds) ||
        sp.seconds < 0
      ) {
        respond(req, false, undefined, "bad-seek");
        return;
      }
      try {
        player.seekTo(sp.seconds, true);
        respond(req, true);
      } catch (e) {
        respond(req, false, undefined, String(e));
      }
      return;
    }
    case "getPlaybackTime": {
      if (!player) {
        respond(req, false, undefined, "no-player");
        return;
      }
      respond(req, true, {
        timeSeconds: player.getCurrentTime ? player.getCurrentTime() : 0,
        playing: player.getPlayerState ? player.getPlayerState() === 1 : false,
      });
      return;
    }
    default:
      respond(req, false, undefined, "unknown-op");
  }
}

export function startMainBridge(): void {
  window.addEventListener("message", (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const data = ev.data as unknown;
    if (typeof data !== "object" || data === null) return;
    const m = data as Partial<BridgeRequest>;
    if (m.ns !== BRIDGE_NS || m.dir !== "req") return;
    if (
      typeof m.nonce !== "string" ||
      typeof m.op !== "string" ||
      typeof m.reqId !== "string"
    )
      return;
    // Only requests carrying the active session nonce (or 'hello', which
    // establishes it) are processed.
    if (m.op !== "hello" && activeNonce !== null && m.nonce !== activeNonce)
      return;
    void handle(m as BridgeRequest).catch(() => {
      try {
        respond(m as BridgeRequest, false, undefined, "internal-bridge-error");
      } catch {
        /* ignore */
      }
    });
  });
}
