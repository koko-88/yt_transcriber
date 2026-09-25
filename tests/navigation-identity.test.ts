import { describe, expect, it } from "vitest";
import { panelContextForTab } from "../src/platform/tab-context";
import { videoIdFromUrl } from "../src/providers/youtube/session";

/**
 * Navigation identity: watch↔Short transitions must resolve distinct
 * video IDs so the panel clears stale transcripts on change.
 */
describe("watch / Shorts navigation identity", () => {
  const watchA = "https://www.youtube.com/watch?v=AAAAAAAAAAA";
  const watchB = "https://www.youtube.com/watch?v=BBBBBBBBBBB";
  const shortA = "https://www.youtube.com/shorts/AAAAAAAAAAA";
  const shortB = "https://www.youtube.com/shorts/CCCCCCCCCCC";

  it("watch A → watch B changes video id", () => {
    expect(videoIdFromUrl(watchA)).toBe("AAAAAAAAAAA");
    expect(videoIdFromUrl(watchB)).toBe("BBBBBBBBBBB");
    expect(videoIdFromUrl(watchA)).not.toBe(videoIdFromUrl(watchB));
  });

  it("Short A → Short B changes video id", () => {
    expect(videoIdFromUrl(shortA)).toBe("AAAAAAAAAAA");
    expect(videoIdFromUrl(shortB)).toBe("CCCCCCCCCCC");
    expect(videoIdFromUrl(shortA)).not.toBe(videoIdFromUrl(shortB));
  });

  it("Short → watch keeps the same id when the media is the same", () => {
    expect(videoIdFromUrl(shortA)).toBe(videoIdFromUrl(watchA));
  });

  it("watch → Short uses Shorts path for a different clip", () => {
    expect(videoIdFromUrl(watchA)).not.toBe(videoIdFromUrl(shortB));
  });

  it("panelContextForTab tracks each surface", () => {
    expect(panelContextForTab({ id: 1, url: watchA })).toEqual({
      status: "video",
      videoId: "AAAAAAAAAAA",
    });
    expect(panelContextForTab({ id: 1, url: shortB })).toEqual({
      status: "video",
      videoId: "CCCCCCCCCCC",
    });
  });
});
