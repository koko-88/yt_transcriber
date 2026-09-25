// Runtime validation schemas for all untrusted data crossing context boundaries.
// Used for: message payloads, backup imports, MAIN-world bridge events (validated
// in the ISOLATED world), and storage records on read.

import { z } from "zod";

export const LiveStateSchema = z.enum([
  "none",
  "live",
  "upcoming",
  "post-live",
]);

export const ChapterSchema = z.object({
  title: z.string().max(500),
  startMs: z.number().int().nonnegative(),
});

export const VideoMetadataSchema = z.object({
  provider: z.literal("youtube"),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/),
  canonicalUrl: z.string().url().max(2048),
  title: z.string().max(1000),
  channelName: z.string().max(300).optional(),
  channelId: z.string().max(100).optional(),
  durationMs: z.number().nonnegative().optional(),
  thumbnailUrl: z.string().url().max(2048).optional(),
  chapters: z.array(ChapterSchema).max(500).optional(),
  liveState: LiveStateSchema,
  capturedAt: z.number(),
});

export const TrackKindSchema = z.enum(["manual", "asr", "translated"]);

export const TranscriptTrackSchema = z.object({
  trackId: z.string().min(1).max(200),
  languageCode: z.string().min(1).max(20),
  languageLabel: z.string().max(200),
  kind: TrackKindSchema,
  translatedFrom: z.string().max(20).optional(),
  isDefaultForVideo: z.boolean(),
  // sourceRef is session-only and opaque; it is stripped before persistence.
  sourceRef: z.unknown().optional(),
});

export const TranscriptSegmentSchema = z.object({
  index: z.number().int().nonnegative(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  text: z.string().max(30 * 1024 * 1024),
  speaker: z.string().max(200).optional(),
});

export const TranscriptSourceSchema = z.object({
  method: z.enum([
    "yt-static-url",
    "yt-player-url",
    "yt-player-observed",
    "yt-transcript-panel",
  ]),
  format: z.enum(["json3", "srv3", "vtt"]),
  completeness: z
    .object({
      status: z.literal("complete"),
      firstCueMs: z.number().nonnegative(),
      lastCueEndMs: z.number().nonnegative(),
      videoDurationMs: z.number().nonnegative().optional(),
    })
    .optional(),
});

export const MAX_SEGMENTS = 100_000;

export const TranscriptSchema = z.object({
  id: z.string().regex(/^youtube:[A-Za-z0-9_-]{6,20}:.{1,200}$/),
  schemaVersion: z.number().int().positive(),
  video: VideoMetadataSchema,
  track: TranscriptTrackSchema,
  segments: z.array(TranscriptSegmentSchema).max(MAX_SEGMENTS),
  source: TranscriptSourceSchema,
  acquiredAt: z.number(),
  textHash: z.string().max(64),
});

export const AvailabilitySchema = z.enum([
  "available",
  "available-partial",
  "no-captions",
  "login-required",
  "age-restricted",
  "members-only",
  "live-in-progress",
  "upcoming",
  "not-a-video-page",
  "fetch-empty",
  "needs-player-interaction",
  "parse-failed",
  "unsupported-page-structure",
  "network-error",
  "player-state-restore-failed",
  "player-initializing",
  "unknown",
]);

export const StageTraceSchema = z.object({
  stage: z.string().max(100),
  method: z.string().max(100),
  durationMs: z.number().nonnegative(),
  success: z.boolean(),
  error: z.string().max(500).optional(),
  httpStatus: z.number().int().optional(),
});

export const AcquisitionResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    transcript: TranscriptSchema,
    tracks: z.array(TranscriptTrackSchema).max(500),
  }),
  z.object({
    ok: z.literal(false),
    reason: AvailabilitySchema,
    retryable: z.boolean(),
    diagnostics: z.array(StageTraceSchema).max(50),
  }),
]);
