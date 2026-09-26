// Resolved media requests are scoped to the active tab and video. Session
// storage survives MV3 worker restarts and is cleared when the browser exits.
import { browser } from "wxt/browser";
import { videoIdFromUrl } from "./session.js";
import { safeMediaUrl, type ObservedMedia } from "./audio-source.js";

interface MediaSession {
  videoId: string | null;
  token: string;
}

interface Observation extends ObservedMedia {
  token: string;
  expiresAt: number;
}

const MAX_AGE_MS = 10 * 60_000;
const SESSION_PREFIX = "stt-media-session:";
const OBSERVATION_PREFIX = "stt-media-observation:";
// Only pending writes are kept in memory; URLs live in storage.session.
const pendingSessions = new Map<number, Promise<void>>();

function sessionKey(tabId: number): string {
  return `${SESSION_PREFIX}${tabId}`;
}

function observationKey(tabId: number, videoId: string): string {
  return `${OBSERVATION_PREFIX}${tabId}:${videoId}`;
}

async function readSession(tabId: number): Promise<MediaSession | null> {
  const value = (await browser.storage.session.get(sessionKey(tabId)))[
    sessionKey(tabId)
  ];
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<MediaSession>;
  return (typeof record.videoId === "string" || record.videoId === null) &&
    typeof record.token === "string"
    ? (record as MediaSession)
    : null;
}

async function readObservation(
  tabId: number,
  videoId: string,
): Promise<Observation | null> {
  const key = observationKey(tabId, videoId);
  const value = (await browser.storage.session.get(key))[key];
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<Observation>;
  return typeof record.url === "string" &&
    typeof record.mimeType === "string" &&
    typeof record.token === "string" &&
    typeof record.expiresAt === "number"
    ? (record as Observation)
    : null;
}

export function noteMediaSession(
  tabId: number,
  videoId: string | null,
  forceNew = false,
): Promise<void> {
  if (!browser.storage.session) return Promise.resolve();
  const previous = pendingSessions.get(tabId) ?? Promise.resolve();
  const update = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await readSession(tabId);
      if (!forceNew && current?.videoId === videoId) return;
      await browser.storage.session.set({
        [sessionKey(tabId)]: {
          videoId,
          token: crypto.randomUUID(),
        } satisfies MediaSession,
      });
      if (current?.videoId) {
        await browser.storage.session.remove(
          observationKey(tabId, current.videoId),
        );
      }
    });
  pendingSessions.set(tabId, update);
  void update
    .finally(() => {
      if (pendingSessions.get(tabId) === update) pendingSessions.delete(tabId);
    })
    .catch(() => undefined);
  return update;
}

export async function getObservedMedia(
  tabId: number,
  videoId: string,
): Promise<ObservedMedia | undefined> {
  if (!browser.storage.session) return undefined;
  await pendingSessions.get(tabId);
  const tab = await browser.tabs.get(tabId);
  if (!tab.active || videoIdFromUrl(tab.url ?? "") !== videoId)
    return undefined;
  const [session, observation] = await Promise.all([
    readSession(tabId),
    readObservation(tabId, videoId),
  ]);
  if (
    !session ||
    session.videoId !== videoId ||
    !observation ||
    observation.token !== session.token
  )
    return undefined;
  if (observation.expiresAt <= Date.now() || !safeMediaUrl(observation.url)) {
    await browser.storage.session.remove(observationKey(tabId, videoId));
    return undefined;
  }
  const latestTab = await browser.tabs.get(tabId);
  if (!latestTab.active || videoIdFromUrl(latestTab.url ?? "") !== videoId)
    return undefined;
  return { url: observation.url, mimeType: observation.mimeType };
}

async function captureObservedMedia(
  tabId: number,
  url: string,
  mimeType: string,
  expiresAt: number,
): Promise<void> {
  await pendingSessions.get(tabId);
  const tab = await browser.tabs.get(tabId);
  const videoId = videoIdFromUrl(tab.url ?? "");
  if (!tab.active || !videoId) return;
  let session = await readSession(tabId);
  if (!session || session.videoId !== videoId) {
    await noteMediaSession(tabId, videoId);
    session = await readSession(tabId);
  }
  if (!session || session.videoId !== videoId) return;
  const token = session.token;
  const current = await readObservation(tabId, videoId);
  // Prefer audio-only requests when YouTube also requests video-only data.
  if (
    current?.token === token &&
    current.mimeType.startsWith("audio/") &&
    mimeType.startsWith("video/")
  )
    return;
  const [latestTab, latestSession] = await Promise.all([
    browser.tabs.get(tabId),
    readSession(tabId),
  ]);
  if (
    !latestTab.active ||
    videoIdFromUrl(latestTab.url ?? "") !== videoId ||
    latestSession?.token !== token
  )
    return;
  await browser.storage.session.set({
    [observationKey(tabId, videoId)]: {
      url,
      mimeType,
      token,
      expiresAt,
    } satisfies Observation,
  });
}

async function forgetTab(tabId: number): Promise<void> {
  await pendingSessions.get(tabId)?.catch(() => undefined);
  const values = await browser.storage.session.get(null);
  const keys = Object.keys(values).filter(
    (key) =>
      key === sessionKey(tabId) ||
      key.startsWith(`${OBSERVATION_PREFIX}${tabId}:`),
  );
  if (keys.length) await browser.storage.session.remove(keys);
}

export function registerMediaObservation(): void {
  if (!browser.webRequest?.onBeforeRequest || !browser.storage.session) return;
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (
        details.tabId < 0 ||
        !/^https:\/\/(www\.|m\.)?youtube\.com$/.test(details.initiator ?? "")
      )
        return undefined;
      const url = safeMediaUrl(details.url);
      if (!url) return undefined;
      const parsed = new URL(url);
      const mimeType = parsed.searchParams.get("mime") ?? "";
      if (mimeType && !/^(audio|video)\/(webm|mp4)$/.test(mimeType))
        return undefined;
      const urlExpiry = Number(parsed.searchParams.get("expire")) * 1000;
      const expiresAt =
        Number.isFinite(urlExpiry) && urlExpiry > 0
          ? Math.min(urlExpiry, Date.now() + MAX_AGE_MS)
          : Date.now() + MAX_AGE_MS;
      void captureObservedMedia(details.tabId, url, mimeType, expiresAt).catch(
        () => undefined,
      );
      return undefined;
    },
    { urls: ["https://*.googlevideo.com/*"] },
  );
  browser.tabs.onRemoved.addListener((tabId) => {
    void forgetTab(tabId).catch(() => undefined);
  });
}
