import { describe, expect, it } from "vitest";
import { mapSnapshotToAvailability } from "../src/providers/youtube/availability";
import { videoIdFromUrl } from "../src/providers/youtube/session";
import type { PlayerSnapshot } from "../src/providers/youtube/bridge-protocol";

const baseSnap = (): PlayerSnapshot => ({
  videoId: "abcdefghijk",
  title: "T",
  channelName: "C",
  channelId: null,
  durationSeconds: 100,
  isLive: false,
  isUpcoming: false,
  playabilityStatus: "OK",
  playabilityReason: null,
  tracks: [
    {
      languageCode: "en",
      baseUrl: "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en",
    },
  ],
  captionsApiAvailable: true,
});

describe("availability terminals", () => {
  it("maps ad playback to player-initializing", () => {
    expect(mapSnapshotToAvailability({ ...baseSnap(), adPlaying: true })).toBe(
      "player-initializing",
    );
  });

  it("maps zero tracks to no-captions without retryable mutation", () => {
    expect(mapSnapshotToAvailability({ ...baseSnap(), tracks: [] })).toBe(
      "no-captions",
    );
  });

  it("treats mismatched snapshot video id as initializing (ad media)", () => {
    // acquireTranscript short-circuits before strategies when videoId differs;
    // availability mapping for the intended target remains player-initializing
    // when adPlaying is set.
    expect(
      mapSnapshotToAvailability({
        ...baseSnap(),
        videoId: "admedia0001",
        adPlaying: true,
        tracks: [],
      }),
    ).toBe("player-initializing");
  });
});

describe("shorts URL identity", () => {
  it("resolves Shorts and watch video ids", () => {
    expect(videoIdFromUrl("https://www.youtube.com/shorts/abcdefghijk")).toBe(
      "abcdefghijk",
    );
    expect(videoIdFromUrl("https://www.youtube.com/watch?v=abcdefghijk")).toBe(
      "abcdefghijk",
    );
  });
});
