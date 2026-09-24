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
  seekTo?: (s: number, a?: boolean) => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
}

interface SavedPlaybackState {
  hadCaptions: boolean;
  prevTrack: unknown;
  wasPaused: boolean;
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
    return { hadCaptions: has, prevTrack: prev ?? null };
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
  };
  if (typeof p.languageCode !== "string" || !p.languageCode) {
    respond(req, false, undefined, "bad-track-payload");
    return;
  }
  try {
    const st = currentCaptionTrack(player);
    savedState = { ...st, wasPaused: player.getPlayerState?.() !== 1 };
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
  try {
    if (player?.setOption) {
      const prev = savedState;
      if (prev?.hadCaptions && prev.prevTrack) {
        player.loadModule?.("captions");
        player.setOption("captions", "track", prev.prevTrack);
      } else {
        player.setOption("captions", "track", {});
        player.unloadModule?.("captions");
      }
      if (prev?.wasPaused) player.pauseVideo?.();
    }
    savedState = null;
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
    player.mute?.();
    const t = player.getCurrentTime?.() ?? 0;
    const d = player.getDuration?.() ?? Infinity;
    if (t < 0.5 || t >= d - 0.5)
      player.seekTo?.(Math.min(2, Math.max(0, d / 10)), true);
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
