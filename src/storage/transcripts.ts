import { getDb } from "./db";
import type { Transcript } from "@/core/model";
import { AppError } from "@/core/errors";
import { logger } from "@/core/logger";

export async function saveTranscript(transcript: Transcript): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(["transcripts", "videos"], "readwrite");
    await tx.objectStore("transcripts").put(transcript);
    await tx.objectStore("videos").put(transcript.video);
    await tx.done;
  } catch (err: unknown) {
    logger.error("storage", "Failed to save transcript", {
      id: transcript.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AppError({
      code: "STORE_WRITE_FAILED",
      message: "Failed to save transcript to library",
      cause: err,
    });
  }
}

export async function getTranscript(
  id: string,
): Promise<Transcript | undefined> {
  try {
    const db = await getDb();
    return await db.get("transcripts", id);
  } catch (err: unknown) {
    logger.error("storage", "Failed to read transcript", {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AppError({
      code: "STORE_READ_FAILED",
      message: "Failed to read transcript",
      cause: err,
    });
  }
}
