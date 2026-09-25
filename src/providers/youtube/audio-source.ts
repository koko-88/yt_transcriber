// Same-session media discovery. Only direct audio URLs exposed by YouTube's
// player response are accepted; encrypted/ciphered formats are not bypassed.
import type { VideoMetadata } from "../../core/model.js";
import { watchPlayerResponse, metadataFromSnapshot } from "./session.js";
import { snapshotFromPlayerResponse } from "./main-bridge.js";

export interface AudioSource {
  videoId: string;
  url: string;
  mimeType: string;
  metadata: VideoMetadata;
}

export async function getAudioSource(videoId: string): Promise<AudioSource | null> {
  const response = await watchPlayerResponse(videoId);
  if (!response) return null;
  const snapshot = snapshotFromPlayerResponse(response, null);
  if (snapshot.videoId !== videoId || snapshot.playabilityStatus !== "OK" ||
      snapshot.isLive || snapshot.isUpcoming) return null;
  const streaming = response["streamingData"] as { adaptiveFormats?: unknown[] } | undefined;
  const formats = (streaming?.adaptiveFormats ?? []).filter((value): value is {
    url: string; mimeType: string; bitrate?: number; audioQuality?: string;
  } => {
    const f = value as Record<string, unknown>;
    return typeof f?.["url"] === "string" && typeof f["mimeType"] === "string" &&
      /^audio\/(webm|mp4)/.test(f["mimeType"] as string);
  });
  // Prefer the compact audio-only representation for download/decode memory.
  formats.sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
  const format = formats[0];
  const metadata = metadataFromSnapshot(snapshot);
  if (!format || !metadata) return null;
  const url = new URL(format.url);
  if (url.protocol !== "https:" || !/(^|\.)googlevideo\.com$/.test(url.hostname)) return null;
  return { videoId, url: url.toString(), mimeType: format.mimeType, metadata };
}
