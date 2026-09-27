import { z } from "zod";
import { getDb } from "./db.js";
import { TranscriptSegmentSchema } from "../core/schemas.js";
import type { SttCheckpoint } from "./workspace-types.js";
import type { SttModelProfile } from "../stt/model-profile.js";

const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const cue = z.object({
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  text: z.string(),
});
const schema = z.object({
  videoId: z.string(),
  profileKey: z.string(),
  durationMs: z.number().nonnegative().nullable(),
  endSeconds: z.number().nonnegative(),
  state: z.object({
    pending: z.array(cue).max(100_000).nullable(),
    output: z.array(TranscriptSegmentSchema).max(100_000),
  }),
  preview: z.array(TranscriptSegmentSchema).max(100_000),
  updatedAt: z.number(),
});
export function checkpointProfileKey(profile: SttModelProfile): string {
  return JSON.stringify({
    version: 1,
    profile,
    windowSeconds: 25,
    overlapSeconds: 4,
  });
}
export function compatibleCheckpoint(
  raw: unknown,
  videoId: string,
  profile: SttModelProfile,
  durationMs?: number,
): SttCheckpoint | null {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  if (
    value.videoId !== videoId ||
    value.profileKey !== checkpointProfileKey(profile) ||
    Date.now() - value.updatedAt > MAX_AGE
  )
    return null;
  if (
    durationMs !== undefined &&
    (value.durationMs === null ||
      Math.abs(value.durationMs - durationMs) > 2000)
  )
    return null;
  return value;
}
export async function readCheckpoint(
  videoId: string,
  profile: SttModelProfile,
  durationMs?: number,
): Promise<SttCheckpoint | null> {
  const db = await getDb();
  const raw = await db.get("sttCheckpoints", videoId);
  const value = compatibleCheckpoint(raw, videoId, profile, durationMs);
  if (raw && !value) await db.delete("sttCheckpoints", videoId);
  return value;
}
export async function saveCheckpoint(checkpoint: SttCheckpoint): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("sttCheckpoints", "readwrite");
  await tx.store.put(checkpoint);
  // Remove expired recovery data; never persist media URLs or PCM.
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (Date.now() - cursor.value.updatedAt > MAX_AGE) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
export async function deleteCheckpoint(videoId: string): Promise<void> {
  await (await getDb()).delete("sttCheckpoints", videoId);
}
export async function checkpointStatus(
  videoId: string,
  profile: SttModelProfile,
) {
  const checkpoint = await readCheckpoint(videoId, profile);
  return checkpoint
    ? {
        videoId,
        phase: "cancelled" as const,
        progress: checkpoint.durationMs
          ? Math.min(
              0.99,
              (checkpoint.endSeconds * 1000) / checkpoint.durationMs,
            )
          : 0,
        partialSegments: checkpoint.preview,
        checkpointAvailable: true,
      }
    : { videoId: null, phase: "idle" as const, progress: 0 };
}
