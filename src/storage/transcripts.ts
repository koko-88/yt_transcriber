import { getDb } from './db';
import type { Transcript, VideoMetadata } from '@/core/model';
import { AppError } from '@/core/errors';
import { logger } from '@/core/logger';

export async function saveTranscript(transcript: Transcript): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(['transcripts', 'videos'], 'readwrite');
    await tx.objectStore('transcripts').put(transcript);
    await tx.objectStore('videos').put(transcript.video);
    await tx.done;
  } catch (err: any) {
    logger.error('storage', 'Failed to save transcript', { id: transcript.id, error: err.message });
    throw new AppError({
      code: 'STORE_WRITE_FAILED',
      message: 'Failed to save transcript to library',
      cause: err,
    });
  }
}

export async function getTranscript(id: string): Promise<Transcript | undefined> {
  try {
    const db = await getDb();
    return await db.get('transcripts', id);
  } catch (err: any) {
    logger.error('storage', 'Failed to read transcript', { id, error: err.message });
    throw new AppError({
      code: 'STORE_READ_FAILED',
      message: 'Failed to read transcript',
      cause: err,
    });
  }
}

export async function getTranscriptsForVideo(videoId: string): Promise<Transcript[]> {
  try {
    const db = await getDb();
    return await db.getAllFromIndex('transcripts', 'by-video', videoId);
  } catch (err: any) {
    logger.error('storage', 'Failed to read transcripts for video', { videoId, error: err.message });
    return [];
  }
}

export async function deleteTranscript(id: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('transcripts', id);
  } catch (err: any) {
    logger.error('storage', 'Failed to delete transcript', { id, error: err.message });
    throw new AppError({
      code: 'STORE_WRITE_FAILED',
      message: 'Failed to delete transcript',
      cause: err,
    });
  }
}

export async function getAllVideos(): Promise<VideoMetadata[]> {
  try {
    const db = await getDb();
    return await db.getAll('videos');
  } catch (err: any) {
    logger.error('storage', 'Failed to get videos', { error: err.message });
    return [];
  }
}
