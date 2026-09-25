import { describe, expect, it } from "vitest";
import { findActiveItemIndex } from "../src/core/playback-index";

/** Must stay in sync with FOLLOW_PLAYBACK_POLL_MS / IDLE_PLAYBACK_POLL_MS in store.ts */
const FOLLOW_POLL_MS = 250;
const IDLE_POLL_MS = 1000;

const items = [
  { startMs: 0, endMs: 1000 },
  { startMs: 1500, endMs: 3000 },
  { startMs: 3000, endMs: 5000 },
];

describe("findActiveItemIndex", () => {
  it("returns -1 for empty lists", () => {
    expect(findActiveItemIndex([], 100)).toBe(-1);
  });

  it("finds the containing segment", () => {
    expect(findActiveItemIndex(items, 0)).toBe(0);
    expect(findActiveItemIndex(items, 1600)).toBe(1);
    expect(findActiveItemIndex(items, 4500)).toBe(2);
  });

  it("stays on the last item past the end", () => {
    expect(findActiveItemIndex(items, 9000)).toBe(2);
  });

  it("uses the previous item inside a gap", () => {
    expect(findActiveItemIndex(items, 1200)).toBe(0);
  });

  it("works for paragraph-sized ranges", () => {
    const paragraphs = [
      { startMs: 0, endMs: 4000 },
      { startMs: 4000, endMs: 9000 },
    ];
    expect(findActiveItemIndex(paragraphs, 3500)).toBe(0);
    expect(findActiveItemIndex(paragraphs, 4000)).toBe(1);
  });

  it("does not reuse a segment index as a paragraph index", () => {
    const segments = [
      { startMs: 0, endMs: 500 },
      { startMs: 500, endMs: 1000 },
      { startMs: 1000, endMs: 1500 },
    ];
    const paragraphs = [{ startMs: 0, endMs: 1500 }];
    expect(findActiveItemIndex(segments, 1200)).toBe(2);
    expect(findActiveItemIndex(paragraphs, 1200)).toBe(0);
  });
});

describe("follow playback cadence", () => {
  it("uses a sub-second follow interval and a slower idle interval", () => {
    expect(FOLLOW_POLL_MS).toBe(250);
    expect(IDLE_POLL_MS).toBe(1000);
    expect(FOLLOW_POLL_MS).toBeLessThan(IDLE_POLL_MS);
  });
});
