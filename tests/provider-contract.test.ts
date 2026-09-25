import { describe, expect, it, vi } from "vitest";
import { acquireTranscript } from "../src/providers/youtube/acquire";
import type { BridgeClient } from "../src/providers/youtube/bridge-client";
import type {
  PlayerSnapshot,
  TimedTextCapture,
} from "../src/providers/youtube/bridge-protocol";
import { AppError } from "../src/core/errors";

const videoId = "abcdefghijk";
const captionUrl = (lang: string) =>
  `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`;
const body = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "First" }] },
    { tStartMs: 9000, dDurationMs: 1000, segs: [{ utf8: "Last" }] },
  ],
});
const snapshot: PlayerSnapshot = {
  videoId,
  title: "Fixture",
  channelName: "Channel",
  channelId: null,
  durationSeconds: 10,
  isLive: false,
  isUpcoming: false,
  playabilityStatus: "OK",
  playabilityReason: null,
  captionsApiAvailable: true,
  tracks: [
    { languageCode: "en", vssId: ".en", baseUrl: captionUrl("en") },
    { languageCode: "de", vssId: ".de", baseUrl: captionUrl("de") },
  ],
};

function bridge(overrides: Partial<BridgeClient> = {}) {
  const listeners = new Set<(capture: TimedTextCapture) => void>();
  const client: BridgeClient = {
    hello: async () => {},
    getPlayerSnapshot: async () => snapshot,
    enableTrack: async () => {},
    restorePlayback: async () => {},
    ensurePlaying: async () => {},
    startCapture: async () => {},
    stopCapture: async () => {},
    seek: async () => {},
    getPlaybackTime: async () => ({ timeSeconds: 0, playing: false }),
    onTimedText: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: () => {},
    ...overrides,
  };
  return {
    client,
    emit: (capture: TimedTextCapture) => {
      for (const listener of listeners) listener(capture);
    },
  };
}

describe("YouTube provider contract", () => {
  it("returns the selected full transcript without invoking the player fallback", async () => {
    const enableTrack = vi.fn(async () => {});
    const result = await acquireTranscript({
      bridge: bridge({ enableTrack }).client,
      videoId,
      currentVideoId: () => videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 200, body }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transcript.video.videoId).toBe(videoId);
      expect(result.transcript.track.trackId).toBe("en~manual~.en");
      expect(result.transcript.segments.at(-1)?.endMs).toBe(10_000);
    }
    expect(enableTrack).not.toHaveBeenCalled();
  });

  it("never switches to another language after the selected track fails", async () => {
    const requested: string[] = [];
    const result = await acquireTranscript({
      bridge: bridge({
        enableTrack: async ({ languageCode }) => {
          requested.push(languageCode);
          throw new Error("player unavailable");
        },
      }).client,
      videoId,
      currentVideoId: () => videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async (url) => {
        requested.push(new URL(url).searchParams.get("lang") ?? "");
        return { status: 200, body: "" };
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          stage: "c1-static-url",
          method: "validateBody",
          success: false,
        }),
      );
    }
    expect(requested).toEqual(["en", "en"]);
  });

  it("rejects an old result if navigation happens during a fetch that ignores abort", async () => {
    let current = videoId;
    const result = await acquireTranscript({
      bridge: bridge().client,
      videoId,
      currentVideoId: () => current,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => {
        current = "ABCDEFGHIJK";
        return { status: 200, body };
      },
    }).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(AppError);
    expect(result).toMatchObject({ code: "ACQ_STALE_VIDEO" });
  });

  it("does not report success when player state restoration fails", async () => {
    const { client, emit } = bridge({
      enableTrack: async () => {
        queueMicrotask(() =>
          emit({ url: captionUrl("en"), status: 200, body }),
        );
      },
      restorePlayback: async () => {
        throw new Error("restore failed");
      },
    });
    const result = await acquireTranscript({
      bridge: client,
      videoId,
      currentVideoId: () => videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 200, body: "" }),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "player-state-restore-failed",
    });
  });
});
