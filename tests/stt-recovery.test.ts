import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { TranscriptNormalizer } from "../src/stt/transcript-normalizer";
import { DEFAULT_STT_PROFILE } from "../src/stt/model-profile";
import {
  checkpointProfileKey,
  compatibleCheckpoint,
  saveCheckpoint,
  readCheckpoint,
} from "../src/storage/stt-checkpoints";
import type { SttCheckpoint } from "../src/storage/workspace-types";

const window = (start: number, last = false) => ({
  audio: new Float32Array(1),
  startSeconds: start,
  endSeconds: start + 25,
  isLast: last,
  durationSeconds: 67,
});
describe("STT recovery", () => {
  it("restores the pending overlap without duplicate or missing words", async () => {
    const uninterrupted = new TranscriptNormalizer();
    uninterrupted.addWindow(window(0), [
      { text: "first", timestamp: [0, 20] },
      { text: "shared boundary", timestamp: [21, 25] },
    ]);
    const checkpoint: SttCheckpoint = {
      videoId: "00000000000",
      profileKey: checkpointProfileKey(DEFAULT_STT_PROFILE),
      durationMs: 67000,
      endSeconds: 25,
      state: uninterrupted.snapshot(),
      preview: uninterrupted.preview(),
      updatedAt: Date.now(),
    };
    // Preview must not flush the pending overlap in the real normalizer.
    expect(uninterrupted.snapshot().pending).not.toBeNull();
    await saveCheckpoint(checkpoint);
    const stored = await readCheckpoint(
      checkpoint.videoId,
      DEFAULT_STT_PROFILE,
      67000,
    );
    expect(stored).not.toHaveProperty("url");
    const resumed = new TranscriptNormalizer(stored!.state);
    const cues = [
      { text: "shared boundary", timestamp: [0, 4] as [number, number] },
      { text: "next", timestamp: [4, 24] as [number, number] },
    ];
    uninterrupted.addWindow(window(21, true), cues);
    resumed.addWindow(window(21, true), cues);
    expect(resumed.finish()).toEqual(uninterrupted.finish());
  });
  it("rejects checkpoints for another video, model, duration, or expired work", () => {
    const c: SttCheckpoint = {
      videoId: "00000000000",
      profileKey: checkpointProfileKey(DEFAULT_STT_PROFILE),
      durationMs: 67000,
      endSeconds: 25,
      state: { pending: null, output: [] },
      preview: [],
      updatedAt: Date.now(),
    };
    expect(
      compatibleCheckpoint(c, "11111111111", DEFAULT_STT_PROFILE, 67000),
    ).toBeNull();
    expect(
      compatibleCheckpoint(
        c,
        c.videoId,
        { ...DEFAULT_STT_PROFILE, modelId: "different" },
        67000,
      ),
    ).toBeNull();
    expect(
      compatibleCheckpoint(c, c.videoId, DEFAULT_STT_PROFILE, 80000),
    ).toBeNull();
    expect(
      compatibleCheckpoint(
        { ...c, updatedAt: 0 },
        c.videoId,
        DEFAULT_STT_PROFILE,
        67000,
      ),
    ).toBeNull();
  });
});
