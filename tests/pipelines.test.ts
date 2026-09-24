import { describe, it, expect } from "vitest";
import {
  buildMessages,
  formatAnchoredSegments,
  parseTimestampToken,
  validateCitations,
  groundAiOutput,
} from "../src/ai/pipelines";
import type { Transcript } from "../src/core/model";

const transcript: Transcript = {
  id: "youtube:abc:en~manual",
  schemaVersion: 1,
  video: {
    provider: "youtube",
    videoId: "abcdefghijk",
    canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    title: "Demo",
    liveState: "none",
    capturedAt: 1,
  },
  track: {
    trackId: "en~manual",
    languageCode: "en",
    languageLabel: "English",
    kind: "manual",
    isDefaultForVideo: true,
  },
  segments: [
    { index: 0, startMs: 0, endMs: 2000, text: "Hello world" },
    { index: 1, startMs: 65_000, endMs: 68_000, text: "Minute one" },
    { index: 2, startMs: 125_000, endMs: 130_000, text: "Two minutes in" },
  ],
  source: { method: "yt-player-observed", format: "json3" },
  acquiredAt: 1,
  textHash: "x",
};

describe("formatAnchoredSegments", () => {
  it("prefixes each line with a timestamp", () => {
    const text = formatAnchoredSegments(transcript.segments);
    expect(text).toContain("[0:00] Hello world");
    expect(text).toContain("[1:05] Minute one");
  });
});

describe("buildMessages", () => {
  it("includes timestamp anchors for summary", () => {
    const msgs = buildMessages("summary", transcript);
    expect(msgs[1]!.content).toContain("[1:05]");
  });

  it("uses BM25 excerpts with anchors for Q&A", () => {
    const msgs = buildMessages("qa", transcript, "minute");
    expect(msgs[1]!.content).toContain("[1:05]");
    expect(msgs[1]!.content).toContain("Question: minute");
  });

  it("instructs the model that transcript content is untrusted", () => {
    const msgs = buildMessages("summary", transcript);
    expect(msgs[0]!.content.toLowerCase()).toContain("untrusted");
  });
});

describe("validateCitations", () => {
  it("keeps timestamps that match segment starts", () => {
    const { text, valid, invalid } = validateCitations(
      "See [1:05] for details",
      transcript.segments,
    );
    expect(text).toContain("[1:05]");
    expect(valid).toEqual([65_000]);
    expect(invalid).toHaveLength(0);
  });

  it("replaces invented timestamps so they are not presented as valid", () => {
    const { text, invalid } = validateCitations(
      "At [9:99] nothing happened",
      transcript.segments,
    );
    expect(text).not.toContain("[9:99]");
    expect(invalid.length).toBeGreaterThan(0);
  });

  it("flags far-off timestamps as invalid", () => {
    const { text, invalid } = validateCitations(
      "See [10:00] later",
      transcript.segments,
      5_000,
    );
    expect(text).toContain("[?]");
    expect(invalid).toContain(600_000);
  });
});

describe("groundAiOutput", () => {
  it("appends a notice when citations were stripped", () => {
    const out = groundAiOutput(
      "chapters",
      "[0:00] Intro\n[9:00] Invented",
      transcript,
    );
    expect(out).toContain("removed");
  });

  it("leaves summary text unchanged", () => {
    expect(groundAiOutput("summary", "plain summary", transcript)).toBe(
      "plain summary",
    );
  });
});

describe("parseTimestampToken", () => {
  it("parses M:SS and H:MM:SS", () => {
    expect(parseTimestampToken("1:05")).toBe(65_000);
    expect(parseTimestampToken("[1:05:00]")).toBe(3_900_000);
  });
});
