import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireTranscript } from "../src/providers/youtube/acquire";
import type { BridgeClient } from "../src/providers/youtube/bridge-client";
import type {
  PlayerSnapshot,
  TimedTextCapture,
} from "../src/providers/youtube/bridge-protocol";
import { AppError } from "../src/core/errors";

const videoId = "abcdefghijk";
const enUrl = (extra = "") =>
  `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3${extra}`;
const deUrl = () =>
  `https://www.youtube.com/api/timedtext?v=${videoId}&lang=de&fmt=json3`;

const fullBody = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hello" }] },
    { tStartMs: 2_650_000, dDurationMs: 1000, segs: [{ utf8: "Bye" }] },
  ],
});

const snap: PlayerSnapshot = {
  videoId,
  title: "Video",
  channelName: "Channel",
  channelId: null,
  durationSeconds: 2700,
  isLive: false,
  isUpcoming: false,
  playabilityStatus: "OK",
  playabilityReason: null,
  tracks: [{ languageCode: "en", baseUrl: enUrl(), vssId: ".en" }],
  captionsApiAvailable: true,
};

function makeBridge() {
  const listeners = new Set<(c: TimedTextCapture) => void>();
  const actions: string[] = [];
  let enableCount = 0;
  const bridge: BridgeClient = {
    hello: async () => {},
    getPlayerSnapshot: async () => snap,
    enableTrack: async (opts) => {
      enableCount += 1;
      actions.push(opts?.forceReload ? "enableTrack:force" : "enableTrack");
    },
    ensurePlaying: async (force) => {
      actions.push(force ? "ensurePlaying:force" : "ensurePlaying");
    },
    restorePlayback: async () => {
      actions.push("restorePlayback");
    },
    startCapture: async () => {
      actions.push("startCapture");
    },
    stopCapture: async () => {
      actions.push("stopCapture");
    },
    seek: async () => {},
    getPlaybackTime: async () => ({ timeSeconds: 12, playing: false }),
    onTimedText: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => {},
  };
  return {
    bridge,
    actions,
    enableCount: () => enableCount,
    emit: (c: TimedTextCapture) => {
      for (const cb of [...listeners]) cb(c);
    },
  };
}

describe("empty timedtext response fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps observing after matching HTTP 200 empty, then accepts a later non-empty match", async () => {
    const { bridge, actions, emit } = makeBridge();
    const run = acquireTranscript({
      bridge,
      videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 403, body: "" }),
    });

    // Let enableTrack run, then deliver empty then full on the same track.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    emit({ url: enUrl(), status: 200, body: "" });
    emit({ url: enUrl(), status: 200, body: "   " });
    emit({ url: enUrl(), status: 200, body: fullBody });

    const result = await run;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transcript.source.method).toBe("yt-player-observed");
      expect(result.transcript.segments.length).toBe(2);
    }
    expect(actions).toContain("restorePlayback");
    expect(actions).toContain("stopCapture");
  });

  it("returns fetch-empty after repeated matching empty responses until timeout", async () => {
    const { bridge, actions, emit } = makeBridge();
    const run = acquireTranscript({
      bridge,
      videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 403, body: "" }),
    });

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    emit({ url: enUrl(), status: 200, body: "" });
    await vi.advanceTimersByTimeAsync(2_000);
    emit({ url: enUrl(), status: 200, body: "" });
    await vi.advanceTimersByTimeAsync(9_000);

    const result = await run;
    expect(result).toMatchObject({ ok: false, reason: "fetch-empty" });
    expect(actions).toContain("restorePlayback");
    expect(actions).toContain("stopCapture");
  });

  it("ignores unrelated non-empty responses from another language/track", async () => {
    const { bridge, emit } = makeBridge();
    const run = acquireTranscript({
      bridge,
      videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 403, body: "" }),
    });

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    // Wrong language — must not finish acquisition.
    emit({ url: deUrl(), status: 200, body: fullBody });
    emit({
      url: enUrl("&kind=asr"),
      status: 200,
      body: fullBody,
    });
    // Still waiting — empty for the correct track.
    emit({ url: enUrl(), status: 200, body: "" });
    // Correct non-empty.
    emit({ url: enUrl(), status: 200, body: fullBody });

    const result = await run;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transcript.track.languageCode).toBe("en");
      expect(result.transcript.track.kind).not.toBe("asr");
    }
  });

  it("aborts cleanly on navigation while waiting for a non-empty body", async () => {
    const { bridge, actions, emit } = makeBridge();
    const ac = new AbortController();
    const run = acquireTranscript({
      bridge,
      videoId,
      signal: ac.signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 403, body: "" }),
    });

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    emit({ url: enUrl(), status: 200, body: "" });
    ac.abort();

    await expect(run).rejects.toBeInstanceOf(AppError);
    await expect(run).rejects.toMatchObject({ code: "ACQ_STALE_VIDEO" });
    expect(actions).toContain("restorePlayback");
    expect(actions).toContain("stopCapture");
  });

  it("restores player state on success after empty-then-full capture", async () => {
    const { bridge, actions, emit } = makeBridge();
    const run = acquireTranscript({
      bridge,
      videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 403, body: "" }),
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    emit({ url: enUrl(), status: 200, body: "" });
    emit({ url: enUrl(), status: 200, body: fullBody });
    await run;
    const restoreIdx = actions.indexOf("restorePlayback");
    const stopIdx = actions.indexOf("stopCapture");
    expect(restoreIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeGreaterThan(restoreIdx - 1);
    expect(actions.filter((a) => a === "restorePlayback")).toHaveLength(1);
  });

  it("waits for an in-flight reload nudge before restoring user state", async () => {
    const { bridge, actions, emit } = makeBridge();
    let finishReload: (() => void) | undefined;
    bridge.enableTrack = async (opts) => {
      if (!opts.forceReload) return;
      actions.push("reload-started");
      await new Promise<void>((resolve) => {
        finishReload = resolve;
      });
      actions.push("reload-finished");
    };

    const run = acquireTranscript({
      bridge,
      videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 403, body: "" }),
    });
    await vi.advanceTimersByTimeAsync(1800);
    expect(actions).toContain("reload-started");
    emit({ url: enUrl(), status: 200, body: fullBody });
    await vi.advanceTimersByTimeAsync(0);

    expect(actions).not.toContain("restorePlayback");
    finishReload?.();
    const result = await run;
    expect(result.ok).toBe(true);
    expect(actions.indexOf("restorePlayback")).toBeGreaterThan(
      actions.indexOf("reload-finished"),
    );
  });

  it("restores player state on empty-response timeout", async () => {
    const { bridge, actions, emit } = makeBridge();
    const run = acquireTranscript({
      bridge,
      videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 403, body: "" }),
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    emit({ url: enUrl(), status: 200, body: "" });
    await vi.advanceTimersByTimeAsync(11_000);
    const result = await run;
    expect(result).toMatchObject({ ok: false, reason: "fetch-empty" });
    expect(actions).toContain("restorePlayback");
    expect(actions).toContain("stopCapture");
  });
});
