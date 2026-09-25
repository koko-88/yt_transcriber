// Availability enum and acquisition result types
// Covers all states a transcript can be in per plan section 12

import type { Transcript, TranscriptTrack } from "./model";

/** All possible availability/error states */
export type Availability =
  | "available"
  | "available-partial"
  | "no-captions"
  | "login-required"
  | "age-restricted"
  | "members-only"
  | "live-in-progress"
  | "upcoming"
  | "not-a-video-page"
  | "fetch-empty"
  | "needs-player-interaction"
  | "parse-failed"
  | "unsupported-page-structure"
  | "network-error"
  | "player-state-restore-failed"
  | "player-initializing"
  | "unknown";

/** Diagnostic information from an acquisition stage */
export interface StageTrace {
  readonly stage: string;
  readonly method: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string | undefined;
  readonly httpStatus?: number | undefined;
}

/** Successful acquisition */
export interface AcquisitionSuccess {
  readonly ok: true;
  readonly transcript: Transcript;
  readonly tracks: readonly TranscriptTrack[];
}

/** Failed acquisition — never contains transcript data */
export interface AcquisitionFailure {
  readonly ok: false;
  readonly reason: Availability;
  readonly retryable: boolean;
  readonly diagnostics: readonly StageTrace[];
}

/** The result of attempting to acquire a transcript */
export type AcquisitionResult = AcquisitionSuccess | AcquisitionFailure;
