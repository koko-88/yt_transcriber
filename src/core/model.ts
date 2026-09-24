// Core domain model — canonical transcript types
// This module is pure TS with zero browser/extension dependencies.
// It is the single source of truth for transcript shapes across all contexts.

/** Identifies the content provider */
export type Provider = "youtube";

/** Live broadcast state of a video */
export type LiveState = "none" | "live" | "upcoming" | "post-live";

/** Video metadata captured from the page */
export interface VideoMetadata {
  readonly provider: Provider;
  readonly videoId: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly channelName?: string | undefined;
  readonly channelId?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly thumbnailUrl?: string | undefined;
  readonly chapters?: readonly Chapter[] | undefined;
  readonly liveState: LiveState;
  readonly capturedAt: number;
}

/** Chapter marker from the video description */
export interface Chapter {
  readonly title: string;
  readonly startMs: number;
}

/** The kind of caption track */
export type TrackKind = "manual" | "asr" | "translated";

/** A caption track available for a video */
export interface TranscriptTrack {
  readonly trackId: string;
  readonly languageCode: string;
  readonly languageLabel: string;
  readonly kind: TrackKind;
  readonly translatedFrom?: string | undefined;
  readonly isDefaultForVideo: boolean;
  /** Opaque reference for acquisition — session-only, never persisted */
  readonly sourceRef?: unknown;
}

/** A single timed caption segment */
export interface TranscriptSegment {
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly speaker?: string | undefined;
}

/** The method used to acquire the transcript */
export type AcquisitionMethod =
  | "yt-static-url"
  | "yt-player-url"
  | "yt-player-observed"
  | "yt-transcript-panel";

/** The format of the raw caption data */
export type CaptionFormat = "json3" | "srv3" | "vtt";

/** Source information for the acquisition */
export interface TranscriptSource {
  readonly method: AcquisitionMethod;
  readonly format: CaptionFormat;
}

/** Schema version for stored transcripts */
export const TRANSCRIPT_SCHEMA_VERSION = 1;

/** A fully resolved transcript */
export interface Transcript {
  readonly id: string; // 'youtube:<videoId>:<trackId>'
  readonly schemaVersion: number;
  readonly video: VideoMetadata;
  readonly track: TranscriptTrack;
  readonly segments: readonly TranscriptSegment[];
  readonly source: TranscriptSource;
  readonly acquiredAt: number;
  readonly textHash: string;
}

/** Derived paragraph view — not persisted */
export interface Paragraph {
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly segmentRange: readonly [number, number];
  readonly speaker?: string | undefined;
}

/** Build a transcript ID from its components */
export function makeTranscriptId(videoId: string, trackId: string): string {
  return `youtube:${videoId}:${trackId}`;
}
