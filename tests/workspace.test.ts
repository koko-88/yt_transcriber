import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/storage/db";
import { saveTranscript, getTranscript } from "../src/storage/transcripts";
import {
  listLibrary,
  recordRecent,
  deleteTranscriptCascade,
} from "../src/storage/recents";
import { editSegment, undoEdit } from "../src/storage/edits";
import { upsertNote, listNotesForVideo } from "../src/storage/notes";
import { exportNotes } from "../src/core/notes-export";
import { exportSrt } from "../src/core/export";
import { bus } from "../src/platform/messaging";
import { usePanelStore } from "../src/ui/store";
import { fixture } from "./helpers/transcript";
import {
  exportLibraryBackup,
  importLibraryBackup,
} from "../src/storage/backup";
import { saveAiHistory, listAiHistory } from "../src/storage/ai-history";

beforeEach(async () => {
  vi.restoreAllMocks();
  const db = await getDb();
  for (const store of db.objectStoreNames) await db.clear(store);
});
describe("saved workspace", () => {
  it("keeps more than 50 saved transcripts and all language tracks searchable", async () => {
    for (let n = 0; n < 65; n++) {
      const t = fixture(n);
      await saveTranscript(t);
      await recordRecent(t);
    }
    await saveTranscript(fixture(0, "ar"));
    expect((await getDb()).version).toBe(2);
    expect(await listLibrary()).toHaveLength(66);
    expect(await listLibrary("mitochondria")).toHaveLength(66);
    expect(await listLibrary("العلم", "ar")).toHaveLength(1);
    expect(
      (await listLibrary()).some((t) => t.videoId === fixture(0).video.videoId),
    ).toBe(true);
  });
  it("preserves originals and timing across edits, undo, reacquisition and exports", async () => {
    const original = fixture();
    const first = await editSegment(
      original,
      0,
      "Corrected name",
      original.textHash,
    );
    expect(first.original).toEqual(original);
    expect(exportSrt(first.corrected.segments)).toContain("Corrected name");
    expect(first.corrected.segments[0]?.startMs).toBe(5000);
    await saveTranscript(original);
    expect((await getTranscript(original.id))?.segments[0]?.text).toBe(
      "Corrected name",
    );
    const undone = await undoEdit(original.id, first.corrected.textHash);
    expect(undone.corrected.segments).toEqual(original.segments);
    await expect(
      editSegment(original, 0, "Stale edit", "outdated"),
    ).rejects.toThrow("changed");
  });
  it("exports timestamp-linked notes and deletes only the removed transcript's notes", async () => {
    const t = fixture();
    await saveTranscript(t);
    await saveTranscript(fixture(0, "ar"));
    const note = await upsertNote({
      id: "one",
      videoId: t.video.videoId,
      transcriptId: t.id,
      text: "Important",
      startMs: 5000,
    });
    await upsertNote({ ...note, id: "two", transcriptId: fixture(0, "ar").id });
    expect(exportNotes(t.video.title, t.video.videoId, [note])).toContain(
      "t=5s",
    );
    await deleteTranscriptCascade(t.id);
    expect(await listNotesForVideo(t.video.videoId)).toHaveLength(1);
  });
});
describe("saved source binding", () => {
  it("opens the saved source instead of seeking a different active video", async () => {
    const t = fixture();
    usePanelStore.setState({
      transcript: t,
      videoId: "different11",
      savedView: true,
    });
    const request = vi
      .spyOn(bus, "request")
      .mockImplementation(async (type) =>
        type === "panel.context"
          ? { status: "video", videoId: "different11" }
          : { ok: true },
      );
    await usePanelStore.getState().seek(5000);
    expect(request).toHaveBeenCalledWith("video.open", {
      videoId: t.video.videoId,
      timeMs: 5000,
    });
    expect(request.mock.calls.some((c) => c[0] === "acq.seek")).toBe(false);
  });
  it("includes the transcript video identity on a matching-tab seek", async () => {
    const t = fixture();
    usePanelStore.setState({ transcript: t });
    const request = vi
      .spyOn(bus, "request")
      .mockImplementation(async (type) =>
        type === "panel.context"
          ? { status: "video", videoId: t.video.videoId }
          : { ok: true },
      );
    await usePanelStore.getState().seek(5000);
    expect(request).toHaveBeenCalledWith("acq.seek", {
      videoId: t.video.videoId,
      timeMs: 5000,
    });
  });
});

it("round-trips originals, corrected versions and AI history through backup", async () => {
  const t = fixture();
  const edited = await editSegment(t, 0, "Saved correction", t.textHash);
  await saveAiHistory({
    id: "answer",
    videoId: t.video.videoId,
    transcriptId: t.id,
    transcriptHash: edited.corrected.textHash,
    pipeline: "summary",
    provider: "local",
    model: "test",
    text: "Answer [0:05]",
    createdAt: 1,
    coverage: { processed: 3, total: 3 },
    citations: [5000],
  });
  const backup = await exportLibraryBackup();
  expect(backup).not.toHaveProperty("secrets");
  const db = await getDb();
  for (const store of db.objectStoreNames) await db.clear(store);
  await importLibraryBackup(backup);
  expect((await db.get("edits", t.id))?.original.segments[0]?.text).toBe(
    "Original mitochondria",
  );
  expect((await getTranscript(t.id))?.segments[0]?.text).toBe(
    "Saved correction",
  );
  expect(await listAiHistory(t.video.videoId)).toHaveLength(1);
});

describe("STT responses stay bound to the live view", () => {
  it.each([
    ["stt.status", false],
    ["stt.start", false],
    ["stt.status", true],
    ["stt.start", true],
  ] as const)(
    "ignores pending %s after opening saved work (reject=%s)",
    async (pendingType, rejects) => {
      const active = fixture(1);
      const saved = fixture(2);
      let resolveResponse!: (value: unknown) => void;
      let rejectResponse!: (reason: Error) => void;
      const response = new Promise((resolve, reject) => {
        resolveResponse = resolve;
        rejectResponse = reject;
      });
      let reached!: () => void;
      const waiting = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const request = vi
        .spyOn(bus, "request")
        .mockImplementation(async (type) => {
          if (type === pendingType) {
            reached();
            return response;
          }
          if (type === "stt.status")
            return { videoId: null, phase: "idle", progress: 0 };
          if (type === "transcript.get") return saved;
          throw new Error("Unexpected request: " + type);
        });
      usePanelStore.setState({
        videoId: active.video.videoId,
        transcript: null,
        savedView: false,
      });
      const pending = usePanelStore.getState().startTranscription();
      await waiting;
      await usePanelStore.getState().openSaved(saved.id);
      const pinned = usePanelStore.getState();
      if (rejects) rejectResponse(new Error("Late transcription failure"));
      else
        resolveResponse({
          videoId: active.video.videoId,
          phase: "ready",
          progress: 1,
          transcript: active,
        });
      await pending;
      expect(usePanelStore.getState().transcript).toEqual(saved);
      expect(usePanelStore.getState().savedView).toBe(true);
      expect(usePanelStore.getState().sttPhase).toBe(pinned.sttPhase);
      expect(usePanelStore.getState().sttError).toBe(pinned.sttError);
      if (pendingType === "stt.status")
        expect(request.mock.calls.some(([type]) => type === "stt.start")).toBe(
          false,
        );
    },
  );

  it("does not start transcription when a pending status request was cancelled", async () => {
    const active = fixture();
    let resolveStatus!: (value: unknown) => void;
    const status = new Promise((resolve) => {
      resolveStatus = resolve;
    });
    const request = vi
      .spyOn(bus, "request")
      .mockImplementation(async (type) => {
        if (type === "stt.status") return status;
        if (type === "stt.cancel") return { phase: "cancelled" };
        throw new Error("Unexpected request: " + type);
      });
    usePanelStore.setState({
      videoId: active.video.videoId,
      transcript: null,
      savedView: false,
    });
    const pending = usePanelStore.getState().startTranscription();
    await usePanelStore.getState().cancelTranscription();
    resolveStatus({ videoId: null, phase: "idle", progress: 0 });
    await pending;
    expect(usePanelStore.getState().sttPhase).toBe("cancelled");
    expect(request.mock.calls.some(([type]) => type === "stt.start")).toBe(
      false,
    );
  });

  it("accepts a completed transcript while the live view is still current", async () => {
    const active = fixture();
    vi.spyOn(bus, "request").mockResolvedValue({
      videoId: active.video.videoId,
      phase: "ready",
      progress: 1,
      transcript: active,
    });
    usePanelStore.setState({
      videoId: active.video.videoId,
      transcript: null,
      savedView: false,
    });
    await usePanelStore.getState().startTranscription();
    expect(usePanelStore.getState().transcript).toEqual(active);
    expect(usePanelStore.getState().sttPhase).toBe("ready");
  });
});
