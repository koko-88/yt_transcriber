import { describe, it, expect } from "vitest";
import { toParagraphs } from "../src/core/paragraphs";
import type { TranscriptSegment } from "../src/core/model";

describe("toParagraphs", () => {
  it("returns empty for no segments", () => {
    expect(toParagraphs([])).toEqual([]);
  });

  it("groups contiguous segments into one paragraph", () => {
    const segs: TranscriptSegment[] = [
      { startMs: 0, endMs: 900, text: "one" },
      { startMs: 1000, endMs: 1900, text: "two" },
      { startMs: 2000, endMs: 2900, text: "three" },
    ];
    const paras = toParagraphs(segs);
    expect(paras).toHaveLength(1);
    expect(paras[0]!.text).toContain("one");
    expect(paras[0]!.text).toContain("three");
    expect(paras[0]!.startMs).toBe(0);
  });

  it("splits on pauses longer than the threshold", () => {
    const segs: TranscriptSegment[] = [
      { startMs: 0, endMs: 900, text: "first part" },
      { startMs: 10_000, endMs: 11_000, text: "second part" },
    ];
    const paras = toParagraphs(segs);
    expect(paras).toHaveLength(2);
  });

  it("caps paragraph length at max segments", () => {
    const segs: TranscriptSegment[] = Array.from({ length: 40 }, (_, i) => ({
      startMs: i * 1000,
      endMs: i * 1000 + 900,
      text: `seg${i}`,
    }));
    const paras = toParagraphs(segs);
    expect(paras.length).toBeGreaterThan(1);
    for (const p of paras) {
      expect(p.segmentRange[1] - p.segmentRange[0] + 1).toBeLessThanOrEqual(15);
    }
  });
});
