import { describe, it, expect } from "vitest";
import { timedTextMatchesTrack } from "../src/providers/youtube/timedtext-match";

const base =
  "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&ei=x&caps=asr&exp=xpe&xoaf=5&hl=en&ip=0.0.0.0&ipbits=0&expire=1&sparams=ip,ipbits,expire,v,ei,caps,exp,xoaf&signature=abc&key=yt8&pot=TOKEN";

describe("timedTextMatchesTrack", () => {
  it("accepts an exact language match for a manual track", () => {
    expect(
      timedTextMatchesTrack(`${base}&lang=en&fmt=json3`, {
        languageCode: "en",
      }),
    ).toBe(true);
  });

  it("rejects a different language even when lang= is present", () => {
    expect(
      timedTextMatchesTrack(`${base}&lang=de&fmt=json3`, {
        languageCode: "en",
      }),
    ).toBe(false);
  });

  it("rejects ASR responses when a manual track was requested", () => {
    expect(
      timedTextMatchesTrack(`${base}&lang=en&kind=asr&fmt=json3`, {
        languageCode: "en",
      }),
    ).toBe(false);
  });

  it("accepts ASR when kind=asr was requested", () => {
    expect(
      timedTextMatchesTrack(`${base}&lang=en&kind=asr&fmt=json3`, {
        languageCode: "en",
        kind: "asr",
      }),
    ).toBe(true);
  });

  it("rejects translated (tlang) responses unless translation was requested", () => {
    expect(
      timedTextMatchesTrack(`${base}&lang=en&tlang=ar&fmt=json3`, {
        languageCode: "en",
      }),
    ).toBe(false);
  });

  it("accepts a matching tlang when translation was requested", () => {
    expect(
      timedTextMatchesTrack(`${base}&lang=en&tlang=ar&fmt=json3`, {
        languageCode: "en",
        translatedTo: "ar",
      }),
    ).toBe(true);
  });

  it("rejects wrong tlang", () => {
    expect(
      timedTextMatchesTrack(`${base}&lang=en&tlang=fr&fmt=json3`, {
        languageCode: "en",
        translatedTo: "ar",
      }),
    ).toBe(false);
  });

  it("normalizes language tags (en_US vs en-us)", () => {
    expect(
      timedTextMatchesTrack(`${base}&lang=en_US&fmt=json3`, {
        languageCode: "en-us",
      }),
    ).toBe(true);
  });

  it("rejects non-timedtext URLs", () => {
    expect(
      timedTextMatchesTrack("https://www.youtube.com/youtubei/v1/player", {
        languageCode: "en",
      }),
    ).toBe(false);
  });

  it("requires video and named-track identity when supplied", () => {
    const target = {
      languageCode: "en",
      videoId: "dQw4w9WgXcQ",
      baseUrl: `${base}&lang=en&name=main`,
    };
    expect(timedTextMatchesTrack(`${base}&lang=en&name=main`, target)).toBe(
      true,
    );
    expect(timedTextMatchesTrack(`${base}&lang=en&name=other`, target)).toBe(
      false,
    );
    expect(
      timedTextMatchesTrack(
        `${base.replace("dQw4w9WgXcQ", "abcdefghijk")}&lang=en&name=main`,
        target,
      ),
    ).toBe(false);
  });

  it("rejects a mismatched vssId when the URL carries one", () => {
    expect(
      timedTextMatchesTrack(`${base}&lang=en&vss_id=.en`, {
        languageCode: "en",
        vssId: ".en",
      }),
    ).toBe(true);
    expect(
      timedTextMatchesTrack(`${base}&lang=en&vss_id=a.en`, {
        languageCode: "en",
        vssId: ".en",
      }),
    ).toBe(false);
  });
});
