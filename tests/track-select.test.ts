import { describe, it, expect } from "vitest";
import {
  buildTrackEntries,
  selectTrack,
} from "../src/providers/youtube/track-select";
import type { BridgeTrack } from "../src/providers/youtube/bridge-protocol";

const track = (over: Partial<BridgeTrack>): BridgeTrack => ({
  languageCode: "en",
  ...over,
});

describe("buildTrackEntries", () => {
  it("maps bridge tracks to entries with kind and deterministic ids", () => {
    const entries = buildTrackEntries([
      track({}),
      track({ kind: "asr" }),
      track({ kind: "asr" }),
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.track.kind).toBe("manual");
    expect(entries[1]!.track.kind).toBe("asr");
    // duplicate kinds get disambiguated ids
    expect(new Set(entries.map((e) => e.track.trackId)).size).toBe(3);
  });

  it("does not advertise unverified translated tracks", () => {
    const entries = buildTrackEntries([
      track({ languageCode: "ar", kind: "translated" }),
      track({ languageCode: "en" }),
    ]);
    expect(entries.map((entry) => entry.track.languageCode)).toEqual(["en"]);
  });

  it("preserves baseUrl for static fetch", () => {
    const entries = buildTrackEntries([
      track({ baseUrl: "https://example.com/timedtext" }),
    ]);
    expect(entries[0]!.baseUrl).toBe("https://example.com/timedtext");
  });
});

describe("selectTrack", () => {
  const entries = buildTrackEntries([
    track({ languageCode: "ar", label: "Arabic", kind: "asr" }),
    track({ languageCode: "en", label: "English", kind: "asr" }),
    track({ languageCode: "en", label: "English" }),
    track({ languageCode: "fr", label: "French" }),
  ]);

  it("prefers manual over ASR for the same preferred language", () => {
    expect(selectTrack(entries, ["en"])!.track.kind).toBe("manual");
  });

  it("follows preferred language order within the same kind", () => {
    const asrOnly = buildTrackEntries([
      track({ languageCode: "ar", kind: "asr" }),
      track({ languageCode: "fr", kind: "asr" }),
    ]);
    expect(selectTrack(asrOnly, ["fr", "ar"])!.track.languageCode).toBe("fr");
  });

  it("matches by language prefix (en-US matches en)", () => {
    const enUS = buildTrackEntries([
      track({ languageCode: "en-US", label: "English (US)" }),
    ]);
    expect(selectTrack(enUS, ["en"])!.track.languageCode).toBe("en-US");
  });

  it("falls back to any manual track when no preference matches", () => {
    expect(selectTrack(entries, ["de"])!.track.kind).toBe("manual");
  });

  it("returns null for empty list", () => {
    expect(selectTrack([], ["en"])).toBeNull();
  });
});
