// Timestamp-linked notes and segment highlights.

import { getDb, type Note, type Highlight } from "./db.js";

export async function listNotesForVideo(videoId: string): Promise<Note[]> {
  const db = await getDb();
  const notes = await db.getAllFromIndex("notes", "by-video", videoId);
  return notes.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
}

export async function upsertNote(
  note: Omit<Note, "createdAt" | "updatedAt"> & {
    createdAt?: number;
    updatedAt?: number;
  },
): Promise<Note> {
  const db = await getDb();
  const now = Date.now();
  const existing = await db.get("notes", note.id);
  const record: Note = {
    id: note.id,
    videoId: note.videoId,
    transcriptId: note.transcriptId,
    text: note.text.slice(0, 50_000),
    ...(note.startMs != null ? { startMs: note.startMs } : {}),
    createdAt: existing?.createdAt ?? note.createdAt ?? now,
    updatedAt: now,
  };
  await db.put("notes", record);
  return record;
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("notes", id);
}

export async function listHighlightsForVideo(
  videoId: string,
): Promise<Highlight[]> {
  const db = await getDb();
  const items = await db.getAllFromIndex("highlights", "by-video", videoId);
  return items.sort((a, b) => a.startMs - b.startMs);
}

export async function upsertHighlight(h: Highlight): Promise<Highlight> {
  const db = await getDb();
  await db.put("highlights", h);
  return h;
}

export async function deleteHighlight(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("highlights", id);
}
