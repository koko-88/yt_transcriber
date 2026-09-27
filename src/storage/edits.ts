import { persistableTranscript } from "./transcripts.js";
import { getDb } from "./db.js";
import type { Transcript } from "../core/model.js";
import { hashText, segmentsToText } from "../core/hash.js";
import type { TranscriptEdit } from "./workspace-types.js";

export function applySegmentEdit(
  record: TranscriptEdit,
  index: number,
  text: string,
): TranscriptEdit {
  const segment = record.corrected.segments.find((s) => s.index === index);
  if (!segment || !text.trim() || text.length > 50_000)
    throw new Error("Invalid segment correction");
  const segments = record.corrected.segments.map((s) =>
    s.index === index ? { ...s, text: text.trim() } : s,
  );
  return {
    ...record,
    corrected: {
      ...record.corrected,
      segments,
      textHash: hashText(segmentsToText(segments)),
    },
    undo: [...record.undo, { index, text: segment.text }].slice(-100),
    updatedAt: Date.now(),
  };
}
export function undoSegmentEdit(record: TranscriptEdit): TranscriptEdit {
  const last = record.undo.at(-1);
  if (!last) return record;
  const segments = record.corrected.segments.map((segment) =>
    segment.index === last.index ? { ...segment, text: last.text } : segment,
  );
  return {
    ...record,
    corrected: {
      ...record.corrected,
      segments,
      textHash: hashText(segmentsToText(segments)),
    },
    undo: record.undo.slice(0, -1),
    updatedAt: Date.now(),
  };
}
export async function getVersions(
  transcript: Transcript,
): Promise<TranscriptEdit> {
  const db = await getDb();
  return (
    (await db.get("edits", transcript.id)) ?? {
      transcriptId: transcript.id,
      original: transcript,
      corrected: transcript,
      undo: [],
      updatedAt: Date.now(),
    }
  );
}
export async function editSegment(
  transcript: Transcript,
  index: number,
  text: string,
  expectedHash: string,
): Promise<TranscriptEdit> {
  transcript = persistableTranscript(transcript);
  const db = await getDb();
  const tx = db.transaction(["edits", "transcripts", "videos"], "readwrite");
  const existing = await tx.objectStore("edits").get(transcript.id);
  const record = existing ?? {
    transcriptId: transcript.id,
    original: transcript,
    corrected: transcript,
    undo: [],
    updatedAt: Date.now(),
  };
  if (record.corrected.textHash !== expectedHash) {
    await tx.done;
    throw new Error("Transcript changed. Reopen the editor and try again.");
  }
  const next = applySegmentEdit(record, index, text);
  await tx.objectStore("transcripts").put(next.corrected);
  await tx.objectStore("videos").put(transcript.video);
  await tx.objectStore("edits").put(next);
  await tx.done;
  return next;
}
export async function undoEdit(
  transcriptId: string,
  expectedHash: string,
): Promise<TranscriptEdit> {
  const db = await getDb();
  const tx = db.transaction(["edits", "transcripts"], "readwrite");
  const record = await tx.objectStore("edits").get(transcriptId);
  if (!record || record.corrected.textHash !== expectedHash) {
    await tx.done;
    throw new Error("Transcript changed. Reopen the editor and try again.");
  }
  const next = undoSegmentEdit(record);
  await tx.objectStore("edits").put(next);
  await tx.objectStore("transcripts").put(next.corrected);
  await tx.done;
  return next;
}
