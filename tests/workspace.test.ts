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
