import { describe, it, expect } from "vitest";
import {
  formatTimestamp,
  exportSrt,
  exportVtt,
  exportTxt,
  exportMarkdown,
  exportJson,
  copyPlainText,
  copyWithTimestamps,
  makeExportFilename,
  makeYouTubeTimestampUrl,
} from "../src/core/export";
import type { Transcript, TranscriptSegment } from "../src/core/model";

const segments: TranscriptSegment[] = [
  { startMs: 0, endMs: 1500, text: "Hello world" },
  { startMs: 1500, endMs: 3661000, text: "Second line" },
];

const transcript: Transcript = {
  id: "t1",
  schemaVersion: 1,
  video: {
    videoId: "abc123",
    url: "https://www.youtube.com/watch?v=abc123",
    canonicalUrl: "https://www.youtube.com/watch?v=abc123",
    title: "Test Video: A/B?",
    channelName: "Chan",
    durationSeconds: 120,
  },
  track: {
    trackId: "en-manual",
    languageCode: "en",
    languageLabel: "English",
    kind: "manual",
  },
  segments,
  acquiredAt: 1700000000000,
  acquisitionMethod: "static-fetch",
};

describe("formatTimestamp", () => {
  it("formats mm:ss below one hour", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(1500)).toBe("0:01");
    expect(formatTimestamp(65_000)).toBe("1:05");
  });
  it("formats h:mm:ss at one hour and beyond", () => {
    expect(formatTimestamp(3_661_000)).toBe("1:01:01");
  });
});

describe("exportSrt", () => {
  it("produces numbered cues with comma milliseconds", () => {
    const srt = exportSrt(segments);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,500\nHello world");
    expect(srt).toContain("2\n00:00:01,500 --> 01:01:01,000\nSecond line");
  });
});

describe("exportVtt", () => {
  it("has WEBVTT header and dot milliseconds", () => {
    const vtt = exportVtt(segments);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:01.500");
  });
});

describe("exportTxt / copyPlainText", () => {
  it("joins segment text with spaces", () => {
    expect(copyPlainText(segments)).toBe("Hello world Second line");
    expect(exportTxt(transcript)).toContain("[0:00] Hello world");
  });
});

describe("exportMarkdown", () => {
  it("includes title heading and metadata", () => {
    const md = exportMarkdown(transcript);
    expect(md).toContain("# Test Video");
    expect(md).toContain("Chan");
  });
});

describe("exportJson", () => {
  it("round-trips through JSON.parse", () => {
    const parsed = JSON.parse(exportJson(transcript));
    expect(parsed.video.videoId).toBe("abc123");
    expect(parsed.segments).toHaveLength(2);
  });
});

describe("copyWithTimestamps", () => {
  it("prefixes each line with [m:ss]", () => {
    expect(copyWithTimestamps(segments)).toBe(
      "[0:00] Hello world\n[0:01] Second line",
    );
  });
});

describe("makeExportFilename", () => {
  it("sanitizes unsafe characters", () => {
    const name = makeExportFilename("Test Video: A/B?", "en", "txt");
    expect(name).not.toMatch(/[:/?]/);
    expect(name.endsWith(".txt")).toBe(true);
  });
});

describe("makeYouTubeTimestampUrl", () => {
  it("appends t parameter in seconds", () => {
    expect(makeYouTubeTimestampUrl("abc123", 90_000)).toBe(
      "https://www.youtube.com/watch?v=abc123&t=90s",
    );
  });
});

describe("large multilingual transcript exports", () => {
  it("keeps every timed cue and Unicode text across TXT, MD, JSON, SRT and VTT", () => {
    const samples = [
      "العربية، أهلاً",
      "English — hello 👋",
      "混合 نص text",
      "Élève déjà vu",
    ];
    const longCue = "نص طويل 👩🏽‍💻 — ".repeat(800);
    const many: TranscriptSegment[] = Array.from(
      { length: 10_000 },
      (_, index) => ({
        index,
        startMs: index * 900,
        endMs: index * 900 + 800,
        text: index === 5000 ? longCue : samples[index % samples.length]!,
      }),
    );
    const data: Transcript = {
      id: "youtube:abcdefghijk:ar~manual",
      schemaVersion: 1,
      video: {
        provider: "youtube",
        videoId: "abcdefghijk",
        canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        title: "Long Arabic/English video",
        channelName: "Channel",
        durationMs: 9_000_000,
        liveState: "none",
        capturedAt: 1,
      },
      track: {
        trackId: "ar~manual",
        languageCode: "ar",
        languageLabel: "العربية",
        kind: "manual",
        isDefaultForVideo: true,
        sourceRef: { secret: "never-export" },
      },
      segments: many,
      source: {
        method: "yt-static-url",
        format: "json3",
        completeness: {
          status: "complete",
          firstCueMs: 0,
          lastCueEndMs: many.at(-1)!.endMs,
          videoDurationMs: 9_000_000,
        },
      },
      acquiredAt: 2,
      textHash: "hash",
    };
    const txt = exportTxt(data);
    const md = exportMarkdown(data);
    const srt = exportSrt(many);
    const vtt = exportVtt(many);
    const json = exportJson(data);
    expect(txt).toContain(longCue);
    expect(md).toContain(longCue);
    expect(md).toContain("https://www.youtube.com/watch?v=abcdefghijk&t=0s");
    expect(srt.match(/^\d+\n/gm)).toHaveLength(10_000);
    expect(vtt.match(/ --> /g)).toHaveLength(10_000);
    for (const sample of samples) {
      expect(txt).toContain(sample);
      expect(srt).toContain(sample);
      expect(vtt).toContain(sample);
    }
    const parsed = JSON.parse(json);
    expect(parsed.segments).toEqual(many);
    expect(parsed.video.channelName).toBe("Channel");
    expect(parsed.source.completeness.lastCueEndMs).toBe(many.at(-1)!.endMs);
    expect(json).not.toContain("never-export");
    expect(copyWithTimestamps(many)).toContain("[2:29:59]");
  });
});
