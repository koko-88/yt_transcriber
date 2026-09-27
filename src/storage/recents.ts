// Recents + library listing helpers.

import { normalizeForSearch } from "../core/search.js";
import { getDb, type Recent } from "./db.js";
import { logger } from "../core/logger.js";
import type { Transcript } from "../core/model.js";

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
    ...(transcript.video.channelName
      ? { channelName: transcript.video.channelName }
      : {}),
    ...(transcript.video.thumbnailUrl
      ? { thumbnailUrl: transcript.video.thumbnailUrl }
      : {}),
  };
  await db.put("recents", entry);

  // GC: keep only the newest MAX_RECENTS
  const keys = await db.getAllKeysFromIndex("recents", "by-viewed");
  if (keys.length > MAX_RECENTS) {
    const toDelete = keys.slice(0, keys.length - MAX_RECENTS);
    const tx = db.transaction("recents", "readwrite");
    for (const k of toDelete) void tx.store.delete(k);
    await tx.done;
  }
}

export async function listLibrary(
  query = "",
  language = "",
): Promise<LibraryListItem[]> {
  const db = await getDb();
  const recents = await db.getAll("recents");
  const viewed = new Map(recents.map((r) => [r.transcriptId, r.viewedAt]));
  const items: LibraryListItem[] = [];
  let cursor = await db.transaction("transcripts").store.openCursor();
  while (cursor) {
    const t = cursor.value;
    if (matchesLibraryQuery(t, query, language))
      items.push({
        videoId: t.video.videoId,
        transcriptId: t.id,
        title: t.video.title,
        channelName: t.video.channelName,
        thumbnailUrl: t.video.thumbnailUrl,
        viewedAt: viewed.get(t.id) ?? t.acquiredAt,
        languageCode: t.track.languageCode,
        segmentCount: t.segments.length,
      });
    cursor = await cursor.continue();
  }
  return items.sort(
    (a, b) =>
      b.viewedAt - a.viewedAt || a.transcriptId.localeCompare(b.transcriptId),
  );
}

export function matchesLibraryQuery(
  t: Transcript,
  query: string,
  language: string,
): boolean {
  if (language && t.track.languageCode !== language) return false;
  const q = normalizeForSearch(query.trim());
  return (
    !q ||
    normalizeForSearch(
      [
        t.video.title,
        t.video.channelName ?? "",
        t.video.videoId,
        ...t.segments.map((s) => s.text),
      ].join(" "),
    ).includes(q)
  );
}

export async function deleteTranscriptCascade(
  transcriptId: string,
): Promise<void> {
  const db = await getDb();
  const t = await db.get("transcripts", transcriptId);
  const tx = db.transaction(
    ["transcripts", "edits", "notes", "highlights", "aiHistory"],
    "readwrite",
  );
  await tx.objectStore("transcripts").delete(transcriptId);
  await tx.objectStore("edits").delete(transcriptId);
  for (const store of ["notes", "highlights", "aiHistory"] as const) {
    let cursor = await tx.objectStore(store).openCursor();
    while (cursor) {
      if (cursor.value.transcriptId === transcriptId) await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await tx.done;
  if (!t) {
    logger.info("storage", "deleted transcript record", { transcriptId });
    return;
  }

  const videoId = t.video.videoId;
  const recent = await db.get("recents", videoId);
  if (recent?.transcriptId === transcriptId)
    await db.delete("recents", videoId);

  // Only drop the video metadata once no transcript references it, so deleting
  // one track does not orphan the other tracks of the same video.
  const remaining = await db.getAllFromIndex(
    "transcripts",
    "by-video",
    videoId,
  );
  if (remaining.length === 0) await db.delete("videos", videoId);

  logger.info("storage", "deleted transcript", { transcriptId, videoId });
}
