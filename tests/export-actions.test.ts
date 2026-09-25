import { describe, expect, it } from "vitest";
import {
  copyTranscript,
  exportCsv,
  exportMarkdown,
  exportTxt,
} from "../src/core/export";
import {
  DOC_TEMPLATES,
  buildDocRenderModel,
  getDocTemplate,
  templateChrome,
} from "../src/core/export-templates";
import type { Transcript, TranscriptSegment } from "../src/core/model";

const segments: TranscriptSegment[] = [
  { index: 0, startMs: 0, endMs: 800, text: "Hello" },
  { index: 1, startMs: 900, endMs: 1600, text: "world" },
  { index: 2, startMs: 4000, endMs: 5000, text: "Later" },
];

const transcript: Transcript = {
  id: "youtube:abc12345678:en-manual",
  schemaVersion: 1,
  video: {
    provider: "youtube",
    videoId: "abc12345678",
    canonicalUrl: "https://www.youtube.com/watch?v=abc12345678",
    title: "Demo",
    channelName: "Chan",
    durationMs: 6000,
    thumbnailUrl: "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg",
    liveState: "none",
    capturedAt: 1,
  },
  track: {
    trackId: "en-manual",
    languageCode: "en",
    languageLabel: "English",
    kind: "manual",
    isDefaultForVideo: true,
  },
  segments,
  source: {
    method: "yt-static-url",
    format: "json3",
    fetchedAt: 1,
  },
  acquiredAt: 1,
  textHash: "x",
};

describe("copyTranscript granularity", () => {
  it("copies plain text as a single space-joined string", () => {
    expect(copyTranscript(transcript, "plain")).toBe("Hello world Later");
  });

  it("copies paragraph text without timestamps", () => {
    const text = copyTranscript(transcript, "paragraph");
    expect(text).toContain("Hello world");
    expect(text).toContain("Later");
    expect(text).not.toContain("[0:00]");
  });

  it("copies segment lines without timestamps", () => {
    expect(copyTranscript(transcript, "segment")).toBe("Hello\nworld\nLater");
  });

  it("copies paragraphs with timestamps", () => {
    const text = copyTranscript(transcript, "paragraph-timestamps");
    expect(text).toMatch(/\[0:00].*Hello world/);
    expect(text).toMatch(/\[0:04].*Later/);
  });

  it("copies segments with timestamps", () => {
    const text = copyTranscript(transcript, "segment-timestamps");
    expect(text).toContain("[0:00] Hello");
    expect(text).toContain("[0:00] world");
    expect(text).toContain("[0:04] Later");
  });

  it("copies markdown with linked timestamps", () => {
    const md = copyTranscript(transcript, "markdown");
    expect(md).toContain("# Demo");
    expect(md).toContain("t=0s");
  });
});

describe("export serializers", () => {
  it("exports CSV with a header row", () => {
    const csv = exportCsv(transcript);
    expect(csv.split("\n")[0]).toBe("index,startMs,endMs,timestamp,text");
    expect(csv).toContain("Hello");
  });

  it("respects paragraph view without timestamps", () => {
    const txt = exportTxt(transcript, {
      view: "paragraph",
      timestamps: false,
      metadata: false,
    });
    expect(txt).toContain("Hello world");
    expect(txt).not.toContain("[0:00]");
    expect(txt).not.toContain("Demo");
  });

  it("exports markdown in segment view when requested", () => {
    const md = exportMarkdown(transcript, {
      view: "segment",
      timestamps: true,
      metadata: false,
    });
    expect(md).toContain(
      "[0:00](https://www.youtube.com/watch?v=abc12345678&t=0s) Hello",
    );
  });
});

describe("document template registry", () => {
  it("lists built-in templates for pdf/pptx/docx", () => {
    expect(DOC_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const t of DOC_TEMPLATES) {
      expect(t.formats).toEqual(
        expect.arrayContaining(["pdf", "pptx", "docx"]),
      );
      expect(getDocTemplate(t.id).id).toBe(t.id);
    }
  });

  it("builds a render model from the transcript", () => {
    const model = buildDocRenderModel(transcript);
    expect(model.title).toBe("Demo");
    expect(model.paragraphs.length).toBeGreaterThan(0);
    expect(templateChrome("study-notes").heading).toBe("Study notes");
  });

  it("generates DOCX/PDF/PPTX bytes for each built-in template", async () => {
    const { generateDocument } = await import("../src/core/export-docs");
    for (const format of ["docx", "pdf", "pptx"] as const) {
      for (const t of DOC_TEMPLATES) {
        const doc = await generateDocument(transcript, format, t.id);
        expect(doc.bytes.byteLength).toBeGreaterThan(100);
        expect(doc.filename).toMatch(new RegExp(`\\.${format}$`));
      }
    }
  }, 60_000);
});
