import { describe, expect, it } from "vitest";
import { acquireTranscript } from "../src/providers/youtube/acquire";
import { assessCompleteness } from "../src/providers/youtube/completeness";
import { buildTrackEntries } from "../src/providers/youtube/track-select";
import type { BridgeClient } from "../src/providers/youtube/bridge-client";
import type {
  PlayerSnapshot,
  TimedTextCapture,
} from "../src/providers/youtube/bridge-protocol";

const videoId = "abcdefghijk";
const captionUrl = (name = "main") =>
  `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&name=${name}&fmt=json3`;
const bodyTo = (endMs: number) =>
  JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "First" }] },
      { tStartMs: endMs - 1000, dDurationMs: 1000, segs: [{ utf8: "Last" }] },
    ],
  });
const snapshot = (tracks: PlayerSnapshot["tracks"]): PlayerSnapshot => ({
  videoId,
  title: "Video",
  channelName: "Channel",
  channelId: null,
  durationSeconds: 2700,
  isLive: false,
  isUpcoming: false,
  playabilityStatus: "OK",
  playabilityReason: null,
  tracks: [...tracks],
  captionsApiAvailable: true,
});

function bridgeFor(snap: PlayerSnapshot, responses: TimedTextCapture[] = []) {
  let listener: ((capture: TimedTextCapture) => void) | null = null;
  const actions: string[] = [];
  const bridge: BridgeClient = {
    hello: async () => {},
    getPlayerSnapshot: async () => snap,
    enableTrack: async () => {
      actions.push("enableTrack");
      for (const response of responses) listener?.(response);
    },
    ensurePlaying: async () => {
      actions.push("ensurePlaying");
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
    getPlaybackTime: async () => ({ timeSeconds: 0, playing: false }),
    onTimedText: (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    destroy: () => {},
  };
  return { bridge, actions };
}

describe("whole-track acquisition", () => {
  it("gets a full track on a paused, captions-off page without touching playback", async () => {
    const snap = snapshot([{ languageCode: "en", baseUrl: captionUrl() }]);
    const { bridge, actions } = bridgeFor(snap);
    const result = await acquireTranscript({
      bridge,
      videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 200, body: bodyTo(2_670_000) }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transcript.segments.at(-1)?.endMs).toBe(2_670_000);
      expect(result.transcript.source.method).toBe("yt-static-url");
    }
    expect(actions).toEqual([]);
  });

  it("rejects a truncated static response and retries the player's full response", async () => {
    const snap = snapshot([{ languageCode: "en", baseUrl: captionUrl() }]);
    const { bridge, actions } = bridgeFor(snap, [
      { url: captionUrl(), status: 200, body: bodyTo(2_665_000) },
    ]);
    const result = await acquireTranscript({
      bridge,
      videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 200, body: bodyTo(90_000) }),
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.transcript.source.method).toBe("yt-player-observed");
    expect(actions).toContain("restorePlayback");
  });

  it("reports PARTIAL when both whole-track methods return only an opening fragment", async () => {
    const snap = snapshot([{ languageCode: "en", baseUrl: captionUrl() }]);
    const { bridge } = bridgeFor(snap, [
      { url: captionUrl(), status: 200, body: bodyTo(90_000) },
    ]);
    const result = await acquireTranscript({
      bridge,
      videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => ({ status: 200, body: bodyTo(90_000) }),
    });
    expect(result).toMatchObject({ ok: false, reason: "available-partial" });
  });

  it("accepts only the selected same-language named track", async () => {
    const tracks = [
      { languageCode: "en", baseUrl: captionUrl("one"), vssId: ".en.one" },
      { languageCode: "en", baseUrl: captionUrl("two"), vssId: ".en.two" },
    ];
    const wanted = buildTrackEntries(tracks)[1]!.track.trackId;
    const { bridge } = bridgeFor(snapshot(tracks), [
      { url: captionUrl("one"), status: 200, body: bodyTo(2_650_000) },
      { url: captionUrl("two"), status: 200, body: bodyTo(2_660_000) },
    ]);
    const result = await acquireTranscript({
      bridge,
      videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      requestedTrackId: wanted,
      fetchCaption: async () => ({ status: 403, body: "" }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transcript.track.trackId).toBe(wanted);
      expect(result.transcript.segments.at(-1)?.endMs).toBe(2_660_000);
    }
  });

  it("distinguishes no caption track from acquisition failure", async () => {
    const { bridge, actions } = bridgeFor(snapshot([]));
    const result = await acquireTranscript({
      bridge,
      videoId,
      signal: new AbortController().signal,
      preferredLangs: ["en"],
      fetchCaption: async () => {
        throw new Error("must not fetch");
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "no-captions" });
    expect(actions).toEqual([]);
  });
});

describe("completeness evidence", () => {
  const cue = (startMs: number, endMs: number) => [
    { index: 0, startMs, endMs, text: "speech" },
  ];
  it("rejects 9 minutes from a 3-hour video", () => {
    expect(
      assessCompleteness(cue(0, 540_000), 10_800, captionUrl()).complete,
    ).toBe(false);
  });
  it("allows normal outro silence", () => {
    expect(
      assessCompleteness(cue(1000, 2_520_000), 2700, captionUrl()).complete,
    ).toBe(true);
  });
  it("rejects ranged or sequence responses even when cues appear late", () => {
    expect(
      assessCompleteness(cue(0, 2_650_000), 2700, `${captionUrl()}&sq=5`)
        .complete,
    ).toBe(false);
  });
});
