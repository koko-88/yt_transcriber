// MAIN-world bridge logic. Runs in the page context and is therefore treated
// as UNTRUSTED by the rest of the extension. Kept deliberately small: it only
// reads player state, toggles captions, and observes the player's own
// timedtext responses. No network construction, no secrets, no zod.

import type { PlayerSnapshot, BridgeTrack } from "./bridge-protocol.js";

interface YtPlayerLike {
  getPlayerResponse?: () => unknown;
  getPlayerState?: () => number;
  getVideoData?: () => {
    video_id?: string;
    title?: string;
    author?: string;
    channelId?: string;
  };
  getOption?: (module: string, option: string) => unknown;
  setOption?: (module: string, option: string, value: unknown) => void;
  loadModule?: (name: string) => void;
  unloadModule?: (name: string) => void;
  playVideo?: () => void;
  pauseVideo?: () => void;
  mute?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
}

interface RawCaptionTrack {
  languageCode?: string;
  languageName?: { runs?: { text?: string }[]; simpleText?: string };
  name?: { runs?: { text?: string }[]; simpleText?: string };
  displayName?: { runs?: { text?: string }[]; simpleText?: string };
  kind?: string;
  vssId?: string;
  baseUrl?: string;
  isTranslatable?: boolean;
}

function labelOf(t: RawCaptionTrack): string | undefined {
  const n = t.languageName ?? t.name ?? t.displayName;
  if (!n) return undefined;
  if (typeof n.simpleText === "string") return n.simpleText;
  if (Array.isArray(n.runs)) return n.runs.map((r) => r.text ?? "").join("");
  return undefined;
}

export function snapshotFromPlayerResponse(
  pr: Record<string, unknown> | null,
  player: YtPlayerLike | null,
): PlayerSnapshot {
  const vd = (pr?.["videoDetails"] ?? {}) as Record<string, unknown>;
  const playability = (pr?.["playabilityStatus"] ?? {}) as Record<
    string,
    unknown
  >;
  const captions = pr?.["captions"] as Record<string, unknown> | undefined;
  const renderer = captions?.["playerCaptionsTracklistRenderer"] as
    Record<string, unknown> | undefined;
  const rawTracks =
    (renderer?.["captionTracks"] as RawCaptionTrack[] | undefined) ?? [];

  const tracks: BridgeTrack[] = rawTracks
    .filter((t) => typeof t?.languageCode === "string")
    .map((t) => ({
      languageCode: t.languageCode as string,
      label: labelOf(t),
      kind: t.kind,
      vssId: t.vssId,
      baseUrl:
        typeof t.baseUrl === "string" ? t.baseUrl.slice(0, 4096) : undefined,
      isTranslatable: t.isTranslatable,
    }));

  let videoId: string | null =
    typeof vd["videoId"] === "string" ? (vd["videoId"] as string) : null;
  let title: string | null =
    typeof vd["title"] === "string" ? (vd["title"] as string) : null;
  let channelName: string | null =
    typeof vd["author"] === "string" ? (vd["author"] as string) : null;
  let channelId: string | null =
    typeof vd["channelId"] === "string" ? (vd["channelId"] as string) : null;
  try {
    const data = player?.getVideoData?.();
    videoId = videoId ?? data?.video_id ?? null;
    title = title ?? data?.title ?? null;
    channelName = channelName ?? data?.author ?? null;
    channelId = channelId ?? data?.channelId ?? null;
  } catch {
    /* optional */
  }
  if (!videoId) {
    try {
      videoId = new URLSearchParams(location.search).get("v");
    } catch {
      /* ignore */
    }
  }
  if (!videoId) {
    try {
      const shorts = location.pathname.match(/^\/shorts\/([\w-]{11})/);
      videoId = shorts?.[1] ?? null;
    } catch {
      /* ignore */
    }
  }

  const lenRaw = vd["lengthSeconds"];
  const durationSeconds =
    typeof lenRaw === "string" || typeof lenRaw === "number"
      ? Number(lenRaw)
      : null;

  return {
    videoId: videoId && videoId.length <= 20 ? videoId : null,
    title,
    channelName,
    channelId,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    isLive: vd["isLive"] === true,
    isUpcoming: vd["isUpcoming"] === true || vd["isUpcoming"] === "true",
    playabilityStatus:
      typeof playability["status"] === "string"
        ? (playability["status"] as string)
        : null,
    playabilityReason:
      typeof playability["reason"] === "string"
        ? (playability["reason"] as string)
        : null,
    tracks,
    captionsApiAvailable:
      !!player &&
      typeof player.setOption === "function" &&
      typeof player.getOption === "function",
    adPlaying: (() => {
      try {
        const el = player instanceof Element ? player : document.querySelector(".html5-video-player");
        if (el?.classList.contains("ad-showing")) return true;
        return !!el?.querySelector?.(
          ".ytp-ad-player-overlay, .ytp-ad-module .ytp-ad-player-overlay-layout",
        );
      } catch {
        return false;
      }
    })(),
  };
}
