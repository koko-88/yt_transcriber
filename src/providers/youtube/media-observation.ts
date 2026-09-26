// Observe the active YouTube tab's own resolved media requests. No request is
// modified, replayed here, or associated with another tab or video session.
import { browser } from "wxt/browser";
import { videoIdFromUrl } from "./session.js";
import { safeMediaUrl, type ObservedMedia } from "./audio-source.js";

interface Observation extends ObservedMedia {
  videoId: string;
  expiresAt: number;
}

const byTab = new Map<number, Observation>();
const sessionByTab = new Map<number, { videoId: string | null; epoch: number }>();
const MAX_AGE_MS = 10 * 60_000;

export function forgetObservedMedia(tabId: number): void {
  byTab.delete(tabId);
}

export function noteMediaSession(tabId: number, videoId: string | null): void {
  const previous = sessionByTab.get(tabId);
  if (previous?.videoId === videoId) return;
  sessionByTab.set(tabId, { videoId, epoch: (previous?.epoch ?? 0) + 1 });
  forgetObservedMedia(tabId);
}

export function getObservedMedia(tabId: number, videoId: string): ObservedMedia | undefined {
  const item = byTab.get(tabId);
  if (!item || item.videoId !== videoId || item.expiresAt <= Date.now()) return undefined;
  return { url: item.url, mimeType: item.mimeType };
}

export function registerMediaObservation(): void {
  if (!browser.webRequest?.onBeforeRequest) return;
  browser.webRequest.onBeforeRequest.addListener((details) => {
    if (details.tabId < 0 || !/^https:\/\/(www\.|m\.)?youtube\.com$/.test(details.initiator ?? "")) return undefined;
    const url = safeMediaUrl(details.url);
    if (!url) return undefined;
    const parsed = new URL(url);
    const mimeType = parsed.searchParams.get("mime") ?? "";
    if (mimeType && !/^(audio|video)\/(webm|mp4)$/.test(mimeType)) return undefined;
    const epoch = sessionByTab.get(details.tabId)?.epoch ?? 0;
    void browser.tabs.get(details.tabId).then((tab) => {
      if (!tab.active) return;
      const videoId = videoIdFromUrl(tab.url ?? "");
      if (!videoId) return;
      if ((sessionByTab.get(details.tabId)?.epoch ?? 0) !== epoch) return;
      const current = byTab.get(details.tabId);
      // Prefer audio-only requests when YouTube also requests video-only data.
      if (current?.videoId === videoId && current.mimeType.startsWith("audio/") &&
          mimeType.startsWith("video/")) return;
      const urlExpiry = Number(parsed.searchParams.get("expire")) * 1000;
      byTab.set(details.tabId, {
        videoId,
        url,
        mimeType,
        expiresAt: Number.isFinite(urlExpiry) && urlExpiry > 0
          ? Math.min(urlExpiry, Date.now() + MAX_AGE_MS)
          : Date.now() + MAX_AGE_MS,
      });
    }).catch(() => undefined);
    return undefined;
  }, { urls: ["https://*.googlevideo.com/*"] });
  browser.tabs.onRemoved.addListener((tabId) => {
    forgetObservedMedia(tabId);
    sessionByTab.delete(tabId);
  });
}
