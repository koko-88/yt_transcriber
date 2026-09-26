// Same-session media discovery. Sources are resolved before the STT pipeline;
// no provider performs signature deciphering or changes player state.
import type { VideoMetadata } from "../../core/model.js";
import { watchPlayerResponse, metadataFromSnapshot } from "./session.js";
import { snapshotFromPlayerResponse } from "./main-bridge.js";

export interface AudioSource {
  videoId: string;
  tabId?: number;
  url: string;
  mimeType: string;
  metadata: VideoMetadata;
  strategy: "player-response" | "observed-request";
}

export interface ObservedMedia {
  url: string;
  mimeType: string;
}

interface SourceContext {
  videoId: string;
  response: Record<string, unknown>;
  metadata: VideoMetadata;
  observed?: ObservedMedia | undefined;
}

export interface MediaSourceProvider {
  readonly id: AudioSource["strategy"];
  resolve(context: SourceContext): AudioSource | null;
}

export function safeMediaUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)googlevideo\.com$/.test(url.hostname) ||
      url.pathname !== "/videoplayback"
    )
      return null;
    const expiry = Number(url.searchParams.get("expire"));
    if (Number.isFinite(expiry) && expiry > 0 && expiry * 1000 <= Date.now())
      return null;
    // A player request can address only one byte range. Remove that transport
    // range so the media reader can issue its own bounded HTTP Range requests.
    const signed = (url.searchParams.get("sparams") ?? "").split(",");
    if (url.searchParams.has("range") && signed.includes("range")) return null;
    url.searchParams.delete("range");
    return url.toString();
  } catch {
    return null;
  }
}

const directProvider: MediaSourceProvider = {
  id: "player-response",
  resolve({ videoId, response, metadata }) {
    const streaming = response["streamingData"] as
      { adaptiveFormats?: unknown[] } | undefined;
    const formats = (streaming?.adaptiveFormats ?? []).filter(
      (
        value,
      ): value is {
        url: string;
        mimeType: string;
        bitrate?: number;
      } => {
        const f = value as Record<string, unknown>;
        return (
          typeof f?.["url"] === "string" &&
          typeof f["mimeType"] === "string" &&
          /^audio\/(webm|mp4)/.test(f["mimeType"] as string)
        );
      },
    );
    formats.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    for (const format of formats) {
      const url = safeMediaUrl(format.url);
      if (url)
        return {
          videoId,
          url,
          mimeType: format.mimeType,
          metadata,
          strategy: this.id,
        };
    }
    return null;
  },
};

const observedProvider: MediaSourceProvider = {
  id: "observed-request",
  resolve({ videoId, response, observed, metadata }) {
    if (!observed) return null;
    const url = safeMediaUrl(observed.url);
    if (!url) return null;
    const observedUrl = new URL(url);
    const formats =
      (response["streamingData"] as { adaptiveFormats?: unknown[] } | undefined)
        ?.adaptiveFormats ?? [];
    // The tab can also request ad media. Match the request to a format in the
    // active video's player response before treating it as that video's audio.
    const matched = formats.find((entry) => {
      const format = entry as {
        itag?: number;
        mimeType?: string;
        url?: string;
        signatureCipher?: string;
        cipher?: string;
      };
      if (!/^(audio|video)\/(webm|mp4)/.test(format.mimeType ?? ""))
        return false;
      if (
        format.itag == null ||
        String(format.itag) !== observedUrl.searchParams.get("itag")
      )
        return false;
      const cipher = format.signatureCipher ?? format.cipher;
      const playerUrl =
        format.url ?? (cipher ? new URLSearchParams(cipher).get("url") : null);
      if (!playerUrl) return false;
      try {
        const expected = new URL(playerUrl);
        return (
          expected.hostname === observedUrl.hostname &&
          expected.pathname === observedUrl.pathname &&
          !!expected.searchParams.get("id") &&
          expected.searchParams.get("id") === observedUrl.searchParams.get("id")
        );
      } catch {
        return false;
      }
    });
    return matched
      ? {
          videoId,
          url,
          mimeType: (matched as { mimeType: string }).mimeType,
          metadata,
          strategy: this.id,
        }
      : null;
  },
};

const providers: readonly MediaSourceProvider[] = [
  directProvider,
  observedProvider,
];

export async function getAudioSource(
  videoId: string,
  observed?: ObservedMedia,
): Promise<AudioSource | null> {
  const response = await watchPlayerResponse(videoId);
  if (!response) return null;
  const snapshot = snapshotFromPlayerResponse(response, null);
  if (
    snapshot.videoId !== videoId ||
    snapshot.playabilityStatus !== "OK" ||
    snapshot.isLive ||
    snapshot.isUpcoming
  )
    return null;
  const metadata = metadataFromSnapshot(snapshot);
  if (!metadata) return null;
  const context: SourceContext = { videoId, response, metadata, observed };
  for (const provider of providers) {
    const source = provider.resolve(context);
    if (source) return source;
  }
  return null;
}
