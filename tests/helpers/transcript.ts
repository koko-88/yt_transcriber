import type { Transcript } from "../../src/core/model";
export function fixture(n = 0, language = "en"): Transcript {
  const videoId = String(n).padStart(11, "0");
  return {
    id: "youtube:" + videoId + ":" + language,
    schemaVersion: 1,
    video: {
      provider: "youtube",
      videoId,
      canonicalUrl: "https://www.youtube.com/watch?v=" + videoId,
      title: "Lesson " + n,
      liveState: "none",
      capturedAt: 1,
    },
    track: {
      trackId: language,
      languageCode: language,
      languageLabel: language,
      kind: "manual",
      isDefaultForVideo: true,
    },
    segments: [
      { index: 0, startMs: 5000, endMs: 9000, text: "Original mitochondria" },
      { index: 1, startMs: 9000, endMs: 13000, text: "العِلْمُ" },
    ],
    source: { method: "yt-player-observed", format: "json3" },
    acquiredAt: n + 1,
    textHash: "base",
  };
}
