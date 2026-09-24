import { describe, it, expect } from "vitest";
import {
  parseJson3,
  parseSrv3,
  parseVtt,
  parseCaption,
} from "../src/core/parsers";

describe("parseJson3", () => {
  it("parses events with segment runs", () => {
    const raw = JSON.stringify({
      events: [
        {
          tStartMs: 0,
          dDurationMs: 1500,
          segs: [{ utf8: "Hello " }, { utf8: "world" }],
        },
        { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: "Next line" }] },
      ],
    });
    const segs = parseJson3(raw);
    expect(segs).toHaveLength(2);
    expect(segs![0]).toMatchObject({
      startMs: 0,
      endMs: 1500,
      text: "Hello world",
    });
    expect(segs![1]!.startMs).toBe(2000);
  });

  it("skips events without text", () => {
    const raw = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 500 }] });
    expect(parseJson3(raw)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseJson3("not json")).toBeNull();
  });
});

describe("parseVtt", () => {
  it("parses cues with dot timestamps", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.500
Hello world

00:00:02.000 --> 00:00:03.000
Second cue
`;
    const segs = parseVtt(vtt);
    expect(segs).toHaveLength(2);
    expect(segs![0]).toMatchObject({
      startMs: 0,
      endMs: 1500,
      text: "Hello world",
    });
  });

  it("strips inline tags", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
<c>Tagged</c> text
`;
    const segs = parseVtt(vtt);
    expect(segs![0]!.text).toBe("Tagged text");
  });
});

describe("parseSrv3", () => {
  it("parses XML text elements with second-based timestamps", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<timedtext><body>
<text start="0" dur="1.5">Hello world</text>
<text start="2" dur="1">Next &amp; more</text>
</body></timedtext>`;
    const segs = parseSrv3(xml);
    expect(segs).toHaveLength(2);
    expect(segs![0]).toMatchObject({
      startMs: 0,
      endMs: 1500,
      text: "Hello world",
    });
    expect(segs![1]!.text).toBe("Next & more");
  });
});

describe("parseCaption", () => {
  it("dispatches on format", () => {
    expect(
      parseCaption(
        '{"events":[{"tStartMs":0,"dDurationMs":100,"segs":[{"utf8":"hi"}]}]}',
      ),
    ).not.toBeNull();
    expect(
      parseCaption("WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n"),
    ).not.toBeNull();
    expect(
      parseCaption(
        '<?xml version="1.0"?><timedtext><body><text start="0" dur="1">hi</text></body></timedtext>',
      ),
    ).not.toBeNull();
  });
});
