// Acquisition ladder (ISOLATED world). Implements the ADR-0001 decision:
// C1 static-url attempt -> C3b player-observed capture, with full diagnostics,
// stale-video guard, abort support, and player state restoration.

import type { AcquisitionResult, Availability, StageTrace } from '../../core/result.js';
import { RETRYABLE, mapSnapshotToAvailability } from './availability.js';
import type { BridgeClient } from './bridge-client.js';
import type { PlayerSnapshot, TimedTextCapture } from './bridge-protocol.js';
import { detectWireFormat } from './bridge-protocol.js';
import { parseCaption } from '../../core/parsers.js';
import { hashText, segmentsToText } from '../../core/hash.js';
import { makeTranscriptId, TRANSCRIPT_SCHEMA_VERSION, type Transcript, type TranscriptSegment, type VideoMetadata } from '../../core/model.js';
import { buildTrackEntries, selectTrack, type TrackEntry } from './track-select.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

const CAPTURE_TIMEOUT_MS = 10_000;
const MAX_TRACK_ATTEMPTS = 2;

export interface CaptionFetchResult {
  status: number;
  body: string;
}

export interface AcquireDeps {
  bridge: BridgeClient;
  /** Same-origin caption fetch executed in the content-script context. */
  fetchCaption: (url: string, signal: AbortSignal) => Promise<CaptionFetchResult>;
  /** The video this run is for; aborts as stale if the page navigated. */
  videoId: string;
  signal: AbortSignal;
  preferredLangs: readonly string[];
  /** Specific track id requested by the user, if any. */
  requestedTrackId?: string | undefined;
  now?: () => number;
}

class Tracer {
  readonly traces: StageTrace[] = [];
  constructor(private readonly now: () => number) {}

  async run<T>(stage: string, method: string, fn: () => Promise<T>): Promise<T> {
    const start = this.now();
    try {
      const out = await fn();
      this.traces.push({ stage, method, durationMs: Math.round(this.now() - start), success: true });
      return out;
    } catch (e) {
      this.traces.push({
        stage,
        method,
        durationMs: Math.round(this.now() - start),
        success: false,
        error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
        ...(e instanceof HttpError ? { httpStatus: e.status } : {}),
      });
      throw e;
    }
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function fail(reason: Availability, tracer: Tracer): AcquisitionResult {
  return { ok: false, reason, retryable: RETRYABLE.has(reason), diagnostics: tracer.traces };
}

function buildTranscript(
  snapshot: PlayerSnapshot,
  entry: TrackEntry,
  segments: readonly TranscriptSegment[],
  method: Transcript['source']['method'],
  format: Transcript['source']['format'],
  now: number,
): Transcript {
  const videoId = snapshot.videoId as string;
  const video: VideoMetadata = {
    provider: 'youtube',
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: snapshot.title ?? '',
    ...(snapshot.channelName ? { channelName: snapshot.channelName } : {}),
    ...(snapshot.channelId ? { channelId: snapshot.channelId } : {}),
    ...(snapshot.durationSeconds != null ? { durationMs: Math.round(snapshot.durationSeconds * 1000) } : {}),
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    liveState: snapshot.isLive ? 'live' : snapshot.isUpcoming ? 'upcoming' : 'none',
    capturedAt: now,
  };
  return {
    id: makeTranscriptId(videoId, entry.track.trackId),
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    video,
    track: entry.track,
    segments,
    source: { method, format },
    acquiredAt: now,
    textHash: hashText(segmentsToText(segments)),
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AppError({ code: 'ACQ_STALE_VIDEO', message: 'aborted' }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function tryStaticFetch(deps: AcquireDeps, tracer: Tracer, entry: TrackEntry): Promise<Transcript | null> {
  if (!entry.baseUrl) return null;
  const u = new URL(entry.baseUrl);
  u.searchParams.set("fmt", "json3");
  const res = await tracer.run("c1-static-url", "fetch", () => deps.fetchCaption(u.toString(), deps.signal));
  if (res.status !== 200) throw new HttpError(res.status, `timedtext http ${res.status}`);
  if (!res.body || res.body.length === 0) return null;
  const segments = parseCaption(res.body, "json3");
  if (!segments) return null;
  const snapshot = await deps.bridge.getPlayerSnapshot();
  if (snapshot.videoId !== deps.videoId) {
    throw new AppError({ code: "ACQ_STALE_VIDEO", message: "video changed during acquisition" });
  }
  return buildTranscript(snapshot, entry, segments, "yt-static-url", "json3", (deps.now ?? Date.now)());
}

async function captureOnce(deps: AcquireDeps, entry: TrackEntry, timeoutMs: number): Promise<TimedTextCapture> {
  return new Promise<TimedTextCapture>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new AppError({ code: "ACQ_TIMEOUT", message: "no timedtext response observed", retryable: true }));
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      unsub();
      reject(new AppError({ code: "ACQ_STALE_VIDEO", message: "aborted" }));
    };
    const matches = (c: TimedTextCapture): boolean => {
      if (c.status !== 200) return false;
      const url = c.url;
      const lang = entry.track.languageCode;
      return url.includes(`lang=${encodeURIComponent(lang)}`) || url.includes("lang=");
    };
    const unsub = deps.bridge.onTimedText((c) => {
      if (!matches(c)) return;
      clearTimeout(timer);
      deps.signal.removeEventListener("abort", onAbort);
      unsub();
      resolve(c);
    });
    deps.signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function tryPlayerObserved(deps: AcquireDeps, tracer: Tracer, entry: TrackEntry): Promise<Transcript | null> {
  await tracer.run("c3b-capture", "startCapture", () => deps.bridge.startCapture());
  try {
    const capturePromise = captureOnce(deps, entry, CAPTURE_TIMEOUT_MS);
    await tracer.run("c3b-capture", "enableTrack", () =>
      deps.bridge.enableTrack({ languageCode: entry.track.languageCode, ...(entry.track.kind === "asr" ? { kind: "asr" } : {}) }));
    await tracer.run("c3b-capture", "ensurePlaying", () => deps.bridge.ensurePlaying());

    let capture: TimedTextCapture;
    try {
      capture = await capturePromise;
    } catch (e) {
      // Retry once with a seek nudge in case the track was already cached.
      if (e instanceof AppError && e.code === "ACQ_TIMEOUT") {
        const retryPromise = captureOnce(deps, entry, CAPTURE_TIMEOUT_MS);
        await deps.bridge.ensurePlaying().catch(() => undefined);
        capture = await retryPromise;
      } else {
        throw e;
      }
    }

    if (!capture.body) return null; // soft-blocked empty 200 -> fetch-empty upstream
    const format = detectWireFormat(capture.url, capture.body);
    if (!format) return null;
    const segments = parseCaption(capture.body, format);
    if (!segments) return null;
    const snapshot = await deps.bridge.getPlayerSnapshot();
    if (snapshot.videoId !== deps.videoId) {
      throw new AppError({ code: "ACQ_STALE_VIDEO", message: "video changed during acquisition" });
    }
    return buildTranscript(snapshot, entry, segments, "yt-player-observed", format, (deps.now ?? Date.now)());
  } finally {
    await deps.bridge.restorePlayback().catch(() => undefined);
    await deps.bridge.stopCapture().catch(() => undefined);
  }
}

/**
 * Run the full acquisition ladder for the current video page.
 * Never throws for expected failure modes; only AppError(ACQ_STALE_VIDEO)
 * propagates on abort/staleness.
 */
export async function acquireTranscript(deps: AcquireDeps): Promise<AcquisitionResult> {
  const now = deps.now ?? Date.now;
  const tracer = new Tracer(now);

  let snapshot: PlayerSnapshot;
  try {
    await tracer.run("bridge", "hello", () => deps.bridge.hello());
    snapshot = await tracer.run("snapshot", "getPlayerSnapshot", () => deps.bridge.getPlayerSnapshot());
  } catch (e) {
    if (e instanceof AppError && e.code === "ACQ_STALE_VIDEO") throw e;
    logger.warn("acquire", "bridge unavailable", { error: String(e) });
    return fail("unsupported-page-structure", tracer);
  }

  if (!snapshot.videoId) return fail("not-a-video-page", tracer);
  if (snapshot.videoId !== deps.videoId) {
    throw new AppError({ code: "ACQ_STALE_VIDEO", message: `snapshot video ${snapshot.videoId} != ${deps.videoId}` });
  }

  const availability = mapSnapshotToAvailability(snapshot);
  if (availability !== "available") return fail(availability, tracer);

  const entries = buildTrackEntries(snapshot.tracks);
  const requested = deps.requestedTrackId ? entries.find((e) => e.track.trackId === deps.requestedTrackId) : undefined;
  const first = requested ?? selectTrack(entries, deps.preferredLangs);
  if (!first) return fail("no-captions", tracer);

  const attempts: TrackEntry[] = [first];
  if (!requested) {
    const second = selectTrack(entries.filter((e) => e !== first), deps.preferredLangs);
    if (second) attempts.push(second);
  }

  let sawEmptyBody = false;
  let sawTimeout = false;

  for (const entry of attempts.slice(0, MAX_TRACK_ATTEMPTS)) {
    if (deps.signal.aborted) throw new AppError({ code: "ACQ_STALE_VIDEO", message: "aborted" });

    // ---- C1: static URL (cheap, no playback side effects) ----
    try {
      const t = await tryStaticFetch(deps, tracer, entry);
      if (t) return { ok: true, transcript: t, tracks: entries.map((e) => e.track) };
    } catch (e) {
      if (e instanceof AppError && e.code === "ACQ_STALE_VIDEO") throw e;
      if (e instanceof HttpError && (e.status === 403 || e.status === 404)) {
        logger.info("acquire", "static url rejected, continuing ladder", { status: e.status });
      } else {
        logger.info("acquire", "static fetch failed, continuing ladder", { error: String(e) });
      }
    }

    // ---- C3b: player-observed capture ----
    try {
      const t = await tryPlayerObserved(deps, tracer, entry);
      if (t) return { ok: true, transcript: t, tracks: entries.map((e) => e.track) };
      sawEmptyBody = true;
    } catch (e) {
      if (e instanceof AppError && e.code === "ACQ_STALE_VIDEO") throw e;
      if (e instanceof AppError && e.code === "ACQ_TIMEOUT") {
        sawTimeout = true;
        logger.info("acquire", "capture timed out for track", { track: entry.track.trackId });
      } else {
        logger.warn("acquire", "player-observed capture failed", { error: String(e) });
      }
    }
  }

  if (sawEmptyBody) return fail("fetch-empty", tracer);
  if (sawTimeout) return fail("needs-player-interaction", tracer);
  return fail("unknown", tracer);
}
