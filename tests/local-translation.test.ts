import { describe, expect, it } from "vitest";
import type { Transcript } from "../src/core/model";
import { buildArabicTranscript } from "../src/translation/transcript";
import {
  LOCAL_ARABIC_TRACK_ID,
  LOCAL_ENGLISH_TRACK_ID,
} from "../src/stt/model-profile";

const english: Transcript = {
  id: `youtube:dQw4w9WgXcQ:${LOCAL_ENGLISH_TRACK_ID}`,
  schemaVersion: 1,
  video: {
    provider: "youtube",
    videoId: "dQw4w9WgXcQ",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Example",
    liveState: "none",
    capturedAt: 1,
  },
  track: {
    trackId: LOCAL_ENGLISH_TRACK_ID,
    languageCode: "en",
    languageLabel: "English (generated locally)",
    kind: "asr",
    isDefaultForVideo: true,
  },
  segments: [
    { index: 0, startMs: 1000, endMs: 2500, text: "hello world" },
    { index: 1, startMs: 2600, endMs: 4000, text: "second line" },
  ],
  source: {
    method: "local-whisper",
    format: "stt",
    completeness: {
      status: "complete",
      firstCueMs: 1000,
      lastCueEndMs: 4000,
      videoDurationMs: 5000,
    },
  },
  acquiredAt: 2,
  textHash: "old",
};

describe("buildArabicTranscript", () => {
  it("preserves timing and creates an Arabic translated track", () => {
    const result = buildArabicTranscript(
      english,
      ["مرحبا بالعالم", "السطر الثاني"],
      3,
    );
    expect(result.id).toBe(`youtube:dQw4w9WgXcQ:${LOCAL_ARABIC_TRACK_ID}`);
    expect(result.track).toMatchObject({
      trackId: LOCAL_ARABIC_TRACK_ID,
      languageCode: "ar",
      kind: "translated",
      translatedFrom: "en",
    });
    expect(result.source.method).toBe("local-translation");
    expect(
      result.segments.map((segment) => [segment.startMs, segment.endMs]),
    ).toEqual([
      [1000, 2500],
      [2600, 4000],
    ]);
    expect(result.segments.map((segment) => segment.text)).toEqual([
      "مرحبا بالعالم",
      "السطر الثاني",
    ]);
  });

  it("rejects a mismatched translation result", () => {
    expect(() => buildArabicTranscript(english, ["مرحبا"])).toThrow(
      /segment count/i,
    );
  });
});
