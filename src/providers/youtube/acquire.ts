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
  currentVideoId?: () => string | null;
  signal: AbortSignal;
  preferredLangs: readonly string[];
  /** Specific track id requested by the user, if any. */
  requestedTrackId?: string | undefined;
  now?: () => number;
}

function assertCurrent(deps: AcquireDeps): void {
  if (
    deps.signal.aborted ||
    (deps.currentVideoId && deps.currentVideoId() !== deps.videoId)
  ) {
    throw new AppError({
      code: "ACQ_STALE_VIDEO",
      message: "video changed during acquisition",
    });
  }
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
class RestoreError extends Error {}

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
  assertCurrent(deps);
  if (res.status !== 200)
    throw new HttpError(res.status, `timedtext http ${res.status}`);
  if (!res.body || res.body.trim().length === 0) {
    tracer.traces.push({
      stage: "c1-static-url",
      method: "validateBody",
      durationMs: 0,
      success: false,
      error: "HTTP 200 with empty caption body",
    });
    return null;
  }
  const segments = parseCaption(res.body, "json3");
  if (!segments) throw new Error("caption parse failed");
  const snapshot = await deps.bridge.getPlayerSnapshot();
  assertCurrent(deps);
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
  let nudgePromise: Promise<void> | null = null;
  const run = async (): Promise<Transcript | null> => {
    await tracer.run("c3b-capture", "startCapture", () =>
      deps.bridge.startCapture(),
    );
    const capturePromise = captureNonEmpty(
      deps,
      entry,
      CAPTURE_TIMEOUT_MS,
      captureAbort.signal,
    );
    let captureSettled = false;
    void capturePromise.then(
      () => {
        captureSettled = true;
      },
      () => {
        captureSettled = true;
      },
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
        nudgePromise = (async () => {
          await deps.bridge.enableTrack({
            languageCode: entry.track.languageCode,
            ...(entry.track.kind === "asr" ? { kind: "asr" } : {}),
            ...(entry.vssId ? { vssId: entry.vssId } : {}),
            forceReload: true,
          });
          if (!captureSettled && !deps.signal.aborted) {
            await deps.bridge.ensurePlaying(true);
          }
        })().catch(() => undefined);
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
    assertCurrent(deps);
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
  };
  let result: Transcript | null = null;
  let acquisitionFailed = false;
  let acquisitionError: unknown;
  let restoreError: unknown;
  try {
    result = await run();
  } catch (error) {
    acquisitionFailed = true;
    acquisitionError = error;
  } finally {
    if (nudgeTimer) clearTimeout(nudgeTimer);
    captureAbort.abort();
    // A running reload must finish before restoration.
    if (nudgePromise) await nudgePromise;
    try {
      await tracer.run("restore", "restorePlayback", () =>
        deps.bridge.restorePlayback(),
      );
    } catch (error) {
      restoreError = error;
    } finally {
      await deps.bridge.stopCapture().catch(() => undefined);
    }
  }
  if (restoreError) {
    throw new RestoreError(
      `player state restoration failed: ${String(restoreError)}`,
    );
  }
  if (acquisitionFailed) throw acquisitionError;
  return result;
}

interface TranscriptStrategy {
  readonly id: "static-url" | "player-observed";
  readonly canHandle: (
    entry: TrackEntry,
    entries: readonly TrackEntry[],
  ) => boolean;
  readonly acquire: (
    deps: AcquireDeps,
    tracer: Tracer,
    entry: TrackEntry,
  ) => Promise<Transcript | null>;
}

const strategies: readonly TranscriptStrategy[] = [
  {
    id: "static-url",
    canHandle: (entry) => !!entry.baseUrl,
    acquire: tryStaticFetch,
  },
  {
    id: "player-observed",
    canHandle: (entry, entries) => {
      const peers = entries.filter(
        (other) =>
          other.track.languageCode === entry.track.languageCode &&
          other.track.kind === entry.track.kind,
      );
      const name = captionName(entry.baseUrl);
      return (
        peers.length <= 1 ||
        (!!name &&
          !peers.some(
            (other) => other !== entry && captionName(other.baseUrl) === name,
          ))
      );
    },
    acquire: tryPlayerObserved,
  },
];

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
  assertCurrent(deps);

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

  assertCurrent(deps);
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

  let sawEmptyBody = false;
  let sawTimeout = false;
  let sawPartial = false;
  let sawParseFailure = false;
  let sawNetworkFailure = false;
  let sawAmbiguousTrack = false;
  let sawRestoreFailure = false;

  // A run is bound to one track. Fall back across mechanisms, never languages.
  for (const strategy of strategies) {
    assertCurrent(deps);
    if (!strategy.canHandle(first, entries)) {
      if (strategy.id === "player-observed") sawAmbiguousTrack = true;
      continue;
    }
    try {
      const transcript = await strategy.acquire(deps, tracer, first);
      assertCurrent(deps);
      if (transcript) {
        return {
          ok: true,
          transcript,
          tracks: entries.map((entry) => entry.track),
        };
      }
      sawEmptyBody = true;
    } catch (error) {
      assertCurrent(deps);
      if (error instanceof RestoreError) sawRestoreFailure = true;
      if (error instanceof PartialCaptionError) sawPartial = true;
      if (
        error instanceof Error &&
        (error.message === "caption parse failed" ||
          error.message === "caption format unknown")
      )
        sawParseFailure = true;
      if (
        error instanceof TypeError ||
        (error instanceof HttpError && error.status >= 500)
      )
        sawNetworkFailure = true;
      if (error instanceof AppError && error.code === "ACQ_TIMEOUT")
        sawTimeout = true;
      logger.warn("acquire", `${strategy.id} failed`, {
        error: String(error),
        track: first.track.trackId,
      });
    }
  }

  if (sawRestoreFailure) return fail("player-state-restore-failed", tracer);
  if (sawPartial) return fail("available-partial", tracer);
  if (sawParseFailure) return fail("parse-failed", tracer);
  if (sawNetworkFailure) return fail("network-error", tracer);
  if (sawAmbiguousTrack) return fail("unsupported-page-structure", tracer);
  if (sawEmptyBody) return fail("fetch-empty", tracer);
  if (sawTimeout) return fail("needs-player-interaction", tracer);
  return fail("unknown", tracer);
}
