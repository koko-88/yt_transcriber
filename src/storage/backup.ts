// Library backup export/import. Secrets are NEVER included.
// Schema-validated on import; oversized or corrupt files are rejected.

import { z } from "zod";
import { getDb, type Note, type Highlight } from "./db.js";
import { TranscriptSchema } from "../core/schemas.js";
import { AppError } from "../core/errors.js";
import type { Transcript } from "../core/model.js";
import type { TranscriptEdit, AiHistoryEntry } from "./workspace-types.js";
import { persistableTranscript } from "./transcripts.js";
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

const EditBackupSchema = z
  .object({
    transcriptId: z.string(),
    original: TranscriptSchema,
    corrected: TranscriptSchema,
    undo: z
      .array(
        z.object({
          index: z.number().int().nonnegative(),
          text: z.string().max(30 * 1024 * 1024),
        }),
      )
      .max(100),
    updatedAt: z.number(),
  })
  .refine(
    (e) =>
      e.transcriptId === e.original.id &&
      e.original.id === e.corrected.id &&
      e.original.video.videoId === e.corrected.video.videoId &&
      e.original.track.trackId === e.corrected.track.trackId &&
      e.original.segments.length === e.corrected.segments.length &&
      e.original.segments.every(
        (s, i) =>
          s.index === e.corrected.segments[i]?.index &&
          s.startMs === e.corrected.segments[i]?.startMs &&
          s.endMs === e.corrected.segments[i]?.endMs,
      ),
    "Correction identity/timing mismatch",
  );
const AiHistoryBackupSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  transcriptId: z.string(),
  transcriptHash: z.string(),
  pipeline: z.enum(["summary", "takeaways", "chapters", "qa"]),
  question: z.string().max(10_000).optional(),
  provider: z.string(),
  model: z.string(),
  text: z.string().max(1_000_000),
  createdAt: z.number(),
  coverage: z.object({
    processed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  citations: z.array(z.number().nonnegative()).max(100_000),
});

export const BackupSchema = z.object({
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  exportedAt: z.number(),
  transcripts: z.array(TranscriptSchema).max(5_000),
  notes: z.array(NoteBackupSchema).max(20_000).default([]),
  highlights: z.array(HighlightBackupSchema).max(50_000).default([]),
  edits: z.array(EditBackupSchema).max(5_000).default([]),
  aiHistory: z.array(AiHistoryBackupSchema).max(20_000).default([]),
});

export type LibraryBackup = z.infer<typeof BackupSchema>;

export async function exportLibraryBackup(): Promise<{
  schemaVersion: number;
  exportedAt: number;
  transcripts: Transcript[];
  notes: Note[];
  highlights: Highlight[];
  edits: TranscriptEdit[];
  aiHistory: AiHistoryEntry[];
}> {
  const db = await getDb();
  const [transcripts, notes, highlights, edits, aiHistory] = await Promise.all([
    db.getAll("transcripts"),
    db.getAll("notes"),
    db.getAll("highlights"),
    db.getAll("edits"),
    db.getAll("aiHistory"),
  ]);
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: Date.now(),
    transcripts,
    notes,
    highlights,
    edits,
    aiHistory,
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
    [
      "transcripts",
      "videos",
      "notes",
      "highlights",
      "recents",
      "edits",
      "aiHistory",
    ],
    "readwrite",
  );
  for (const t of backup.transcripts) {
    await tx.objectStore("transcripts").put(persistableTranscript(t));
    await tx.objectStore("edits").delete(t.id);
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
  for (const e of backup.edits) {
    if (!backup.transcripts.some((t) => t.id === e.transcriptId)) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new Error("Correction has no transcript");
    }
    const record: TranscriptEdit = {
      ...e,
      original: persistableTranscript(e.original),
      corrected: persistableTranscript(e.corrected),
    };
    await tx.objectStore("edits").put(record);
    await tx.objectStore("transcripts").put(record.corrected);
  }
  for (const entry of backup.aiHistory) {
    const { question, ...rest } = entry;
    await tx
      .objectStore("aiHistory")
      .put({ ...rest, ...(question !== undefined ? { question } : {}) });
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
