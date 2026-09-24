// Library backup export/import. Secrets are NEVER included.
// Schema-validated on import; oversized or corrupt files are rejected.

import { z } from "zod";
import { getDb, type Note, type Highlight } from "./db.js";
import { TranscriptSchema } from "../core/schemas.js";
import { AppError } from "../core/errors.js";
import type { Transcript } from "../core/model.js";
import { recordRecent } from "./recents.js";

export const BACKUP_SCHEMA_VERSION = 1;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

const NoteBackupSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  transcriptId: z.string(),
  text: z.string().max(50_000),
  startMs: z.number().int().nonnegative().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const HighlightBackupSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  transcriptId: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  color: z.string().max(40),
  createdAt: z.number(),
});

export const BackupSchema = z.object({
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  exportedAt: z.number(),
  transcripts: z.array(TranscriptSchema).max(5_000),
  notes: z.array(NoteBackupSchema).max(20_000).default([]),
  highlights: z.array(HighlightBackupSchema).max(50_000).default([]),
});

export type LibraryBackup = z.infer<typeof BackupSchema>;

export async function exportLibraryBackup(): Promise<{
  schemaVersion: number;
  exportedAt: number;
  transcripts: Transcript[];
  notes: Note[];
  highlights: Highlight[];
}> {
  const db = await getDb();
  const [transcripts, notes, highlights] = await Promise.all([
    db.getAll("transcripts"),
    db.getAll("notes"),
    db.getAll("highlights"),
  ]);
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: Date.now(),
    transcripts,
    notes,
    highlights,
  };
}

export async function importLibraryBackup(
  raw: unknown,
): Promise<{ imported: number; notes: number; highlights: number }> {
  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError({
      code: "INVALID_INPUT",
      message: "Invalid backup file",
      retryable: false,
    });
  }
  const backup = parsed.data;
  const db = await getDb();
  const tx = db.transaction(
    ["transcripts", "videos", "notes", "highlights", "recents"],
    "readwrite",
  );
  for (const t of backup.transcripts) {
    await tx.objectStore("transcripts").put(t as Transcript);
    await tx.objectStore("videos").put(t.video as Transcript["video"]);
  }
  for (const n of backup.notes) {
    const note: Note = {
      id: n.id,
      videoId: n.videoId,
      transcriptId: n.transcriptId,
      text: n.text,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      ...(n.startMs != null ? { startMs: n.startMs } : {}),
    };
    await tx.objectStore("notes").put(note);
  }
  for (const h of backup.highlights) {
    await tx.objectStore("highlights").put(h);
  }
  await tx.done;

  // Rebuild recents from imported transcripts (newest first).
  const sorted = [...backup.transcripts].sort(
    (a, b) => b.acquiredAt - a.acquiredAt,
  );
  for (const t of sorted.slice(0, 50)) {
    await recordRecent(t as Transcript);
  }

  return {
    imported: backup.transcripts.length,
    notes: backup.notes.length,
    highlights: backup.highlights.length,
  };
}

/** Strip any accidental secret-like keys from a parsed JSON object. */
export function sanitizeBackupJson(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  delete obj["secrets"];
  delete obj["apiKeys"];
  delete obj["keys"];
  return obj;
}
