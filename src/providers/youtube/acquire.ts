// Acquisition ladder (ISOLATED world). Implements the ADR-0001 decision:
// C1 static-url attempt -> C3b player-observed capture, with full diagnostics,
// stale-video guard, abort support, and player state restoration.

import type {
  AcquisitionResult,
  Availability,
  StageTrace,
} from "../../core/result.js";
import { RETRYABLE, mapSnapshotToAvailability } from "./availability.js";
import type { BridgeClient } from "./bridge-client.js";
import type { PlayerSnapshot, TimedTextCapture } from "./bridge-protocol.js";
import { detectWireFormat } from "./bridge-protocol.js";
import { parseCaption } from "../../core/parsers.js";
import { hashText, segmentsToText } from "../../core/hash.js";
import {
  makeTranscriptId,
  TRANSCRIPT_SCHEMA_VERSION,
  type Transcript,
  type TranscriptSegment,
  type VideoMetadata,
} from "../../core/model.js";
import {
  buildTrackEntries,
  selectTrack,
  type TrackEntry,
} from "./track-select.js";
import { timedTextMatchesTrack } from "./timedtext-match.js";
import { assessCompleteness } from "./completeness.js";
import { AppError } from "../../core/errors.js";
import { logger } from "../../core/logger.js";

const CAPTURE_TIMEOUT_MS = 10_000;
/** Mid-window nudge so the player re-issues the track after an empty 200. */
const EMPTY_RESPONSE_NUDGE_MS = 1_500;
const MAX_TRACK_ATTEMPTS = 2;

export interface CaptionFetchResult {
  status: number;
  body: string;
}

export interface AcquireDeps {
  bridge: BridgeClient;
  /** Same-origin caption fetch executed in the content-script context. */
  fetchCaption: (
    url: string,
    signal: AbortSignal,
  ) => Promise<CaptionFetchResult>;
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

  async run<T>(
    stage: string,
    method: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = this.now();
    try {
      const out = await fn();
      this.traces.push({
        stage,
        method,
        durationMs: Math.round(this.now() - start),
        success: true,
      });

      return out;
    } catch (e) {
      this.traces.push({
        stage,
        method,
        durationMs: Math.round(this.now() - start),
        success: false,
        error:
          e instanceof Error
            ? e.message.slice(0, 300)
            : String(e).slice(0, 300),
        ...(e instanceof HttpError ? { httpStatus: e.status } : {}),
      });
      throw e;
    }
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class PartialCaptionError extends Error {}

function captionName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("name");
  } catch {
    return null;
  }
}

function requireComplete(
  transcript: Transcript,
  snapshot: PlayerSnapshot,
  responseUrl: string,
  tracer: Tracer,
): Transcript {
  const check = assessCompleteness(
    transcript.segments,
    snapshot.durationSeconds,
    responseUrl,
  );
  tracer.traces.push({
    stage: "completeness",
    method: transcript.source.method,
    durationMs: 0,
    success: check.complete,
    ...(!check.complete
      ? { error: `${check.reason}; last cue ${check.lastCueEndMs} ms` }
      : {}),
  });
  if (!check.complete) throw new PartialCaptionError(check.reason);
  return {
    ...transcript,
    source: {
      ...transcript.source,
      completeness: {
        status: "complete",
        firstCueMs: check.firstCueMs,
        lastCueEndMs: check.lastCueEndMs,
        ...(snapshot.durationSeconds != null
          ? { videoDurationMs: snapshot.durationSeconds * 1000 }
          : {}),
      },
    },
  };
}

function fail(reason: Availability, tracer: Tracer): AcquisitionResult {
  return {
    ok: false,
    reason,
    retryable: RETRYABLE.has(reason),

    diagnostics: tracer.traces,
  };
}

function buildTranscript(
  snapshot: PlayerSnapshot,
  entry: TrackEntry,
  segments: readonly TranscriptSegment[],
  method: Transcript["source"]["method"],
  format: Transcript["source"]["format"],
  now: number,
): Transcript {
  const videoId = snapshot.videoId as string;
  const video: VideoMetadata = {
    provider: "youtube",
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: snapshot.title ?? "",
    ...(snapshot.channelName ? { channelName: snapshot.channelName } : {}),
    ...(snapshot.channelId ? { channelId: snapshot.channelId } : {}),
    ...(snapshot.durationSeconds != null
      ? { durationMs: Math.round(snapshot.durationSeconds * 1000) }
      : {}),
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    liveState: snapshot.isLive
      ? "live"
      : snapshot.isUpcoming
        ? "upcoming"
        : "none",
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

async function tryStaticFetch(
  deps: AcquireDeps,
  tracer: Tracer,
  entry: TrackEntry,
): Promise<Transcript | null> {
  if (!entry.baseUrl) return null;
  const u = new URL(entry.baseUrl);
  u.searchParams.set("fmt", "json3");
  if (
    !timedTextMatchesTrack(u.toString(), {
      languageCode: entry.track.languageCode,
      videoId: deps.videoId,
      ...(entry.track.kind === "asr" ? { kind: "asr" } : {}),
    })
  )
    return null;
  const res = await tracer.run("c1-static-url", "fetch", () =>
    deps.fetchCaption(u.toString(), deps.signal),
  );
  if (res.status !== 200)
    throw new HttpError(res.status, `timedtext http ${res.status}`);
  if (!res.body || res.body.length === 0) return null;
  const segments = parseCaption(res.body, "json3");
  if (!segments) throw new Error("caption parse failed");
  const snapshot = await deps.bridge.getPlayerSnapshot();
  if (snapshot.videoId !== deps.videoId) {
    throw new AppError({
      code: "ACQ_STALE_VIDEO",
      message: "video changed during acquisition",
    });
  }
  return requireComplete(
    buildTranscript(
      snapshot,
      entry,
      segments,
      "yt-static-url",
      "json3",
      (deps.now ?? Date.now)(),
    ),
    snapshot,
    u.toString(),
    tracer,
  );
}

/**
 * Wait for one matching NON-EMPTY timedtext capture.
 * Matching HTTP 200 responses with an empty body are ignored so observation
 * continues until a full caption payload arrives, the timeout elapses, or
 * acquisition is aborted.
 */
async function captureNonEmpty(
  deps: AcquireDeps,
  entry: TrackEntry,
  timeoutMs: number,
  cleanupSignal: AbortSignal,
): Promise<TimedTextCapture> {
  return new Promise<TimedTextCapture>((resolve, reject) => {
    if (deps.signal.aborted || cleanupSignal.aborted) {
      reject(new AppError({ code: "ACQ_STALE_VIDEO", message: "aborted" }));
      return;
    }
    let sawMatchingEmpty = false;
    const timer = setTimeout(() => {
      unsub();
      deps.signal.removeEventListener("abort", onAbort);
      cleanupSignal.removeEventListener("abort", onAbort);
      reject(
        new AppError({
          code: "ACQ_TIMEOUT",
          message: sawMatchingEmpty
            ? "matching timedtext stayed empty"
            : "no timedtext response observed",
          retryable: true,
          // Distinguishes soft-blocked empty 200s from "player never fired".
          userMessageKey: sawMatchingEmpty
            ? "availability.fetch-empty"
            : undefined,
        }),
      );
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      unsub();
      deps.signal.removeEventListener("abort", onAbort);
      cleanupSignal.removeEventListener("abort", onAbort);
      reject(new AppError({ code: "ACQ_STALE_VIDEO", message: "aborted" }));
    };
    const matches = (c: TimedTextCapture): boolean => {
      if (c.status !== 200) return false;
      const track = entry.track;
      if (track.kind === "translated" && track.translatedFrom) {
        return timedTextMatchesTrack(c.url, {
          languageCode: track.translatedFrom,
          translatedTo: track.languageCode,
          videoId: deps.videoId,
          ...(entry.vssId ? { vssId: entry.vssId } : {}),
        });
      }
      return timedTextMatchesTrack(c.url, {
        languageCode: track.languageCode,
        ...(track.kind === "asr" ? { kind: "asr" } : {}),
        videoId: deps.videoId,
        ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
        ...(entry.vssId ? { vssId: entry.vssId } : {}),
      });
    };
    const unsub = deps.bridge.onTimedText((c) => {
      if (!matches(c)) return;
      if (!c.body || c.body.trim().length === 0) {
        sawMatchingEmpty = true;
        return;
      }
      clearTimeout(timer);
      deps.signal.removeEventListener("abort", onAbort);
      cleanupSignal.removeEventListener("abort", onAbort);
      unsub();
      resolve(c);
    });
    deps.signal.addEventListener("abort", onAbort, { once: true });
    cleanupSignal.addEventListener("abort", onAbort, { once: true });
  });
}

async function tryPlayerObserved(
  deps: AcquireDeps,
  tracer: Tracer,
  entry: TrackEntry,
): Promise<Transcript | null> {
  const captureAbort = new AbortController();
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    await tracer.run("c3b-capture", "startCapture", () =>
      deps.bridge.startCapture(),
    );
    const capturePromise = captureNonEmpty(
      deps,
      entry,
      CAPTURE_TIMEOUT_MS,
      captureAbort.signal,
    );
    void capturePromise.catch(() => undefined);
    await tracer.run("c3b-capture", "enableTrack", () =>
      deps.bridge.enableTrack({
        languageCode: entry.track.languageCode,
        ...(entry.track.kind === "asr" ? { kind: "asr" } : {}),
        ...(entry.vssId ? { vssId: entry.vssId } : {}),
      }),
    );
    const arrivedWithoutPlayback = await Promise.race([
      capturePromise.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    if (!arrivedWithoutPlayback) {
      await tracer
        .run("c3b-capture", "ensurePlaying", () => deps.bridge.ensurePlaying())
        .catch(() => undefined);
      // After an empty 200 the player may need one force-reload nudge while
      // the SAME capture window keeps observing. Do not start a second timeout.
      nudgeTimer = setTimeout(() => {
        void deps.bridge
          .enableTrack({
            languageCode: entry.track.languageCode,
            ...(entry.track.kind === "asr" ? { kind: "asr" } : {}),
            ...(entry.vssId ? { vssId: entry.vssId } : {}),
            forceReload: true,
          })
          .catch(() => undefined);
        void deps.bridge.ensurePlaying(true).catch(() => undefined);
      }, EMPTY_RESPONSE_NUDGE_MS);
    }

    let capture: TimedTextCapture;
    try {
      capture = await capturePromise;
    } catch (e) {
      if (
        e instanceof AppError &&
        e.code === "ACQ_TIMEOUT" &&
        e.userMessageKey === "availability.fetch-empty"
      ) {
        // Matching empty 200(s) only — precise fetch-empty upstream.
        return null;
      }
      throw e;
    }

    const format = detectWireFormat(capture.url, capture.body);
    if (!format) throw new Error("caption format unknown");
    const segments = parseCaption(capture.body, format);
    if (!segments) throw new Error("caption parse failed");
    const snapshot = await deps.bridge.getPlayerSnapshot();
    if (snapshot.videoId !== deps.videoId) {
      throw new AppError({
        code: "ACQ_STALE_VIDEO",
        message: "video changed during acquisition",
      });
    }
    return requireComplete(
      buildTranscript(
        snapshot,
        entry,
        segments,
        "yt-player-observed",
        format,
        (deps.now ?? Date.now)(),
      ),
      snapshot,
      capture.url,
      tracer,
    );
  } finally {
    if (nudgeTimer) clearTimeout(nudgeTimer);
    captureAbort.abort();
    await deps.bridge.restorePlayback().catch(() => undefined);
    await deps.bridge.stopCapture().catch(() => undefined);
  }
}

/**
 * Run the full acquisition ladder for the current video page.
 * Never throws for expected failure modes; only AppError(ACQ_STALE_VIDEO)
 * propagates on abort/staleness.
 */
export async function acquireTranscript(
  deps: AcquireDeps,
): Promise<AcquisitionResult> {
  const now = deps.now ?? Date.now;
  const tracer = new Tracer(now);

  let snapshot: PlayerSnapshot;
  try {
    await tracer.run("bridge", "hello", () => deps.bridge.hello());
    snapshot = await tracer.run("snapshot", "getPlayerSnapshot", () =>
      deps.bridge.getPlayerSnapshot(),
    );
  } catch (e) {
    if (e instanceof AppError && e.code === "ACQ_STALE_VIDEO") throw e;
    logger.warn("acquire", "bridge unavailable", { error: String(e) });
    return fail("unsupported-page-structure", tracer);
  }

  if (!snapshot.videoId) return fail("not-a-video-page", tracer);
  if (snapshot.videoId !== deps.videoId) {
    throw new AppError({
      code: "ACQ_STALE_VIDEO",
      message: `snapshot video ${snapshot.videoId} != ${deps.videoId}`,
    });
  }

  const availability = mapSnapshotToAvailability(snapshot);
  if (availability !== "available") return fail(availability, tracer);

  const entries = buildTrackEntries(snapshot.tracks);
  const requested = deps.requestedTrackId
    ? entries.find((e) => e.track.trackId === deps.requestedTrackId)
    : undefined;
  if (deps.requestedTrackId && !requested)
    return fail("unsupported-page-structure", tracer);
  const first = requested ?? selectTrack(entries, deps.preferredLangs);
  if (!first) return fail("no-captions", tracer);

  const attempts: TrackEntry[] = [first];
  if (!requested) {
    const second = selectTrack(
      entries.filter((e) => e !== first),
      deps.preferredLangs,
    );
    if (second) attempts.push(second);
  }

  let sawEmptyBody = false;
  let sawTimeout = false;
  let sawPartial = false;
  let sawParseFailure = false;
  let sawNetworkFailure = false;
  let sawAmbiguousTrack = false;

  for (const entry of attempts.slice(0, MAX_TRACK_ATTEMPTS)) {
    if (deps.signal.aborted)
      throw new AppError({ code: "ACQ_STALE_VIDEO", message: "aborted" });

    // ---- C1: static URL (cheap, no playback side effects) ----
    try {
      const t = await tryStaticFetch(deps, tracer, entry);
      if (t)
        return { ok: true, transcript: t, tracks: entries.map((e) => e.track) };
    } catch (e) {
      if (e instanceof AppError && e.code === "ACQ_STALE_VIDEO") throw e;
      if (e instanceof PartialCaptionError) sawPartial = true;
      if (e instanceof Error && e.message === "caption parse failed")
        sawParseFailure = true;
      if (e instanceof TypeError || (e instanceof HttpError && e.status >= 500))
        sawNetworkFailure = true;
      if (e instanceof HttpError && (e.status === 403 || e.status === 404)) {
        logger.info("acquire", "static url rejected, continuing ladder", {
          status: e.status,
        });
      } else {
        logger.info("acquire", "static fetch failed, continuing ladder", {
          error: String(e),
        });
      }
    }

    // A same-language duplicate without a unique URL name cannot be safely
    // correlated to a player response. Its own static URL remains usable.
    const peers = entries.filter(
      (e) =>
        e.track.languageCode === entry.track.languageCode &&
        e.track.kind === entry.track.kind,
    );
    const name = captionName(entry.baseUrl);
    if (
      peers.length > 1 &&
      (!name ||
        peers.some((e) => e !== entry && captionName(e.baseUrl) === name))
    ) {
      sawAmbiguousTrack = true;
      continue;
    }

    // ---- C3b: player-observed capture ----
    try {
      const t = await tryPlayerObserved(deps, tracer, entry);
      if (t)
        return { ok: true, transcript: t, tracks: entries.map((e) => e.track) };
      sawEmptyBody = true;
    } catch (e) {
      if (e instanceof AppError && e.code === "ACQ_STALE_VIDEO") throw e;
      if (e instanceof PartialCaptionError) sawPartial = true;
      if (
        e instanceof Error &&
        (e.message === "caption parse failed" ||
          e.message === "caption format unknown")
      )
        sawParseFailure = true;
      if (e instanceof AppError && e.code === "ACQ_TIMEOUT") {
        sawTimeout = true;
        logger.info("acquire", "capture timed out for track", {
          track: entry.track.trackId,
        });
      } else {
        logger.warn("acquire", "player-observed capture failed", {
          error: String(e),
        });
      }
    }
  }

  if (sawPartial) return fail("available-partial", tracer);
  if (sawParseFailure) return fail("parse-failed", tracer);
  if (sawNetworkFailure) return fail("network-error", tracer);
  if (sawAmbiguousTrack) return fail("unsupported-page-structure", tracer);
  if (sawEmptyBody) return fail("fetch-empty", tracer);
  if (sawTimeout) return fail("needs-player-interaction", tracer);
  return fail("unknown", tracer);
}
