import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_NS,
  type BridgeRequest,
  type BridgeResponse,
} from "../src/providers/youtube/bridge-protocol";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

async function runtime(initial: {
  playing: boolean;
  muted: boolean;
  time: number;
  track: unknown;
  captionsPressed?: boolean;
}) {
  let playing = initial.playing;
  let muted = initial.muted;
  let time = initial.time;
  let track = initial.track;
  let captionsPressed = initial.captionsPressed ?? initial.track != null;
  let videoId = "abcdefghijk";
  const player = {
    getPlayerResponse: () => ({ videoDetails: { videoId } }),
    getPlayerState: () => (playing ? 1 : 2),
    getOption: () => track,
    setOption: (_module: string, _option: string, value: unknown) => {
      track = value;
      if (value && typeof value === "object" && "languageCode" in value)
        captionsPressed = true;
    },
    loadModule: () => {},
    unloadModule: () => {},
    playVideo: () => {
      playing = true;
    },
    pauseVideo: () => {
      playing = false;
    },
    mute: () => {
      muted = true;
    },
    unMute: () => {
      muted = false;
    },
    isMuted: () => muted,
    seekTo: (seconds: number) => {
      time = seconds;
    },
    getCurrentTime: () => time,
    getDuration: () => 100,
  };
  const responses: BridgeResponse[] = [];
  let listener:
    ((event: { source: unknown; data: BridgeRequest }) => void) | null = null;
  const win = {
    addEventListener: (_event: string, cb: typeof listener) => {
      listener = cb;
    },
    postMessage: (response: BridgeResponse) => {
      responses.push(response);
    },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    getElementById: () => player,
    querySelector: () => ({
      getAttribute: () => (captionsPressed ? "true" : "false"),
      click: () => { captionsPressed = !captionsPressed; },
    }),
  });
  vi.stubGlobal("location", { origin: "https://www.youtube.com" });
  const { startMainBridge } =
    await import("../src/providers/youtube/main-bridge-runtime");
  startMainBridge();
  let reqId = 0;
  async function send(op: BridgeRequest["op"], payload?: unknown) {
    const request: BridgeRequest = {
      ns: BRIDGE_NS,
      dir: "req",
      nonce: "test",
      reqId: String(++reqId),
      op,
      payload,
    };
    listener?.({ source: win, data: request });
    await vi.waitFor(() =>
      expect(responses.find((r) => r.reqId === request.reqId)).toBeDefined(),
    );
    expect(responses.find((r) => r.reqId === request.reqId)?.ok).toBe(true);
  }
  return {
    send,
    state: () => ({ playing, muted, time, track, captionsPressed }),
    changeVideo: (id: string) => {
      videoId = id;
    },
  };
}

describe("temporary player interaction", () => {
  it("restores paused, unmuted, captions-off state and original near-end position", async () => {
    const app = await runtime({
      playing: false,
      muted: false,
      time: 99.8,
      track: null,
    });
    await app.send("hello");
    await app.send("enableTrack", { languageCode: "en", vssId: ".en" });
    await app.send("ensurePlaying");
    expect(app.state()).toMatchObject({ playing: true, muted: true, time: 2, captionsPressed: true });
    await app.send("restorePlayback");
    expect(app.state()).toEqual({
      playing: false,
      muted: false,
      time: 99.8,
      track: {},
      captionsPressed: false,
    });
  });

  it("keeps an already playing video's position and selected caption track", async () => {
    const original = { languageCode: "ar", vssId: ".ar", kind: "asr" };
    const app = await runtime({
      playing: true,
      muted: false,
      time: 53,
      track: original,
      captionsPressed: true,
    });
    await app.send("hello");
    await app.send("enableTrack", { languageCode: "en", vssId: ".en" });
    await app.send("ensurePlaying");
    await app.send("restorePlayback");
    expect(app.state()).toEqual({
      playing: true,
      muted: false,
      time: 53,
      track: original,
      captionsPressed: true,
    });
  });

  it("does not restore old-video state onto a new video", async () => {
    const app = await runtime({
      playing: false,
      muted: false,
      time: 10,
      track: null,
    });
    await app.send("hello");
    await app.send("enableTrack", { languageCode: "en" });
    app.changeVideo("ABCDEFGHIJK");
    await app.send("restorePlayback");
    expect(app.state().track).toEqual({ languageCode: "en" });
  });

  it("keeps CC visually off even when YouTube reports a default selected track", async () => {
    const app = await runtime({
      playing: false, muted: true, time: 40,
      track: { languageCode: "en", vssId: ".en" }, captionsPressed: false,
    });
    await app.send("hello");
    await app.send("enableTrack", { languageCode: "de", vssId: ".de" });
    await app.send("restorePlayback");
    expect(app.state()).toMatchObject({
      playing: false, muted: true, time: 40, captionsPressed: false,
    });
  });
});
