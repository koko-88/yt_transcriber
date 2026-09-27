import { describe, expect, it, vi } from "vitest";
import {
  runFullVideo,
  splitTranscript,
  SECTION_CHARS,
} from "../src/ai/full-video";
import { fixture } from "./helpers/transcript";
import { buildMessages } from "../src/ai/pipelines";
import type { ChatMessage } from "../src/ai/types";

describe("complete-video AI", () => {
  it("processes the middle and end of a long transcript and reduces every section", async () => {
    const t = {
      ...fixture(),
      segments: Array.from({ length: 900 }, (_, index) => ({
        index,
        startMs: index * 1000,
        endMs: (index + 1) * 1000,
        text: "unique-marker-" + index + " " + "content ".repeat(15),
      })),
    };
    const chunks = splitTranscript(t);
    expect(chunks.length).toBeGreaterThan(3);
    const call = vi.fn(
      async (_messages: ChatMessage[]) =>
        "Section result " + call.mock.calls.length,
    );
    const progress = vi.fn();
    const result = await runFullVideo(
      "summary",
      t,
      undefined,
      call,
      undefined,
      progress,
    );
    const requests = call.mock.calls
      .slice(0, chunks.length)
      .map((args) => args[0][1]!.content)
      .join("\n");
    for (const segment of t.segments) expect(requests).toContain(segment.text);
    const reduction = call.mock.calls
      .slice(chunks.length)
      .map((args) => args[0][1]!.content)
      .join("\n");
    for (let n = 1; n <= chunks.length; n++)
      expect(reduction).toContain("Section result " + n);
    expect(result.coverage).toEqual({
      processed: chunks.length,
      total: chunks.length,
    });
  });
  it("splits huge individual cues without losing text", () => {
    const text = "مرحبا ".repeat(7000);
    const t = {
      ...fixture(),
      segments: [{ index: 0, startMs: 0, endMs: 1000, text }],
    };
    const chunks = splitTranscript(t);
    expect(
      chunks
        .flat()
        .map((s) => s.text)
        .join(""),
    ).toBe(text);
    expect(
      chunks.every(
        (chunk) =>
          buildMessages("summary", { ...t, segments: chunk })[1]!.content
            .length <
          SECTION_CHARS + 1000,
      ),
    ).toBe(true);
  });
  it("stops on a failed section without reporting full coverage", async () => {
    const t = {
      ...fixture(),
      segments: [
        { index: 0, startMs: 0, endMs: 1000, text: "x".repeat(40000) },
      ],
    };
    const call = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("offline"));
    const progress = vi.fn();
    await expect(
      runFullVideo("summary", t, undefined, call, undefined, progress),
    ).rejects.toThrow("offline");
    expect(progress.mock.lastCall?.[0].processed).toBe(1);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("does not make another request after cancellation", async () => {
    const controller = new AbortController();
    const t = {
      ...fixture(),
      segments: [
        { index: 0, startMs: 0, endMs: 1000, text: "x".repeat(40000) },
      ],
    };
    const call = vi.fn(async () => {
      controller.abort();
      return "first";
    });
    await expect(
      runFullVideo("summary", t, undefined, call, controller.signal),
    ).rejects.toThrow("Cancelled");
    expect(call).toHaveBeenCalledOnce();
  });
});
