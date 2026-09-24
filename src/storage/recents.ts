// Recents + library listing helpers.

import { getDb, type Recent } from './db.js';
import { logger } from '../core/logger.js';
import type { Transcript } from '../core/model.js';

const MAX_RECENTS = 50;

export interface LibraryListItem {
  videoId: string;
  transcriptId: string;
  title: string;
  channelName?: string | undefined;
  thumbnailUrl?: string | undefined;
  viewedAt: number;
  languageCode: string;
  segmentCount: number;
}

export async function recordRecent(transcript: Transcript): Promise<void> {
  const db = await getDb();
  const entry: Recent = {
    videoId: transcript.video.videoId,
    transcriptId: transcript.id,
    viewedAt: Date.now(),
    title: transcript.video.title,
    ...(transcript.video.channelName ? { channelName: transcript.video.channelName } : {}),
    ...(transcript.video.thumbnailUrl ? { thumbnailUrl: transcript.video.thumbnailUrl } : {}),
  };
  await db.put('recents', entry);

  // GC: keep only the newest MAX_RECENTS
  const keys = await db.getAllKeysFromIndex('recents', 'by-viewed');
  if (keys.length > MAX_RECENTS) {
    const toDelete = keys.slice(0, keys.length - MAX_RECENTS);
    const tx = db.transaction('recents', 'readwrite');
    for (const k of toDelete) void tx.store.delete(k);
    await tx.done;
  }
}

export async function listLibrary(): Promise<LibraryListItem[]> {
  const db = await getDb();
  const recents = await db.getAllFromIndex('recents', 'by-viewed');
  recents.sort((a, b) => b.viewedAt - a.viewedAt);
  const out: LibraryListItem[] = [];
  for (const r of recents) {
    const t = await db.get('transcripts', r.transcriptId);
    if (!t) continue;
    out.push({
      videoId: r.videoId,
      transcriptId: r.transcriptId,
      title: r.title,
      channelName: r.channelName,
      thumbnailUrl: r.thumbnailUrl,
      viewedAt: r.viewedAt,
      languageCode: t.track.languageCode,
      segmentCount: t.segments.length,
    });
  }
  return out;
}

export async function deleteTranscriptCascade(transcriptId: string): Promise<void> {
  const db = await getDb();
  const t = await db.get('transcripts', transcriptId);
  await db.delete('transcripts', transcriptId);
  if (t) {
    const recent = await db.get('recents', t.video.videoId);
    if (recent?.transcriptId === transcriptId) await db.delete('recents', t.video.videoId);
  }
  logger.info('storage', 'deleted transcript', { transcriptId });
}
