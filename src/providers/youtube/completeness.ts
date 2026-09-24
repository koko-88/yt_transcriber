import type { TranscriptSegment } from "../../core/model.js";

export interface Completeness {
  complete: boolean;
  reason?: string;
  firstCueMs: number;
  lastCueEndMs: number;
}

/** Conservative evidence check: a full response must cover the video's timeline. */
export function assessCompleteness(
  segments: readonly TranscriptSegment[],
  durationSeconds: number | null,
  responseUrl: string,
): Completeness {
  let firstCueMs = Infinity;
  let lastCueEndMs = 0;
  for (const s of segments) {
    firstCueMs = Math.min(firstCueMs, s.startMs);
    lastCueEndMs = Math.max(lastCueEndMs, s.endMs);
  }
  const partial = (reason: string): Completeness => ({
    complete: false,
    reason,
    firstCueMs,
    lastCueEndMs,
  });
  if (!segments.length) return partial("no caption cues");
  if (
    segments.some(
      (s) =>
        !Number.isFinite(s.startMs) ||
        !Number.isFinite(s.endMs) ||
        s.startMs < 0 ||
        s.endMs < s.startMs,
    )
  ) {
    return partial("invalid cue timing");
  }
  try {
    const url = new URL(responseUrl);
    const start = Number(url.searchParams.get("start"));
    if (url.searchParams.has("start") && start > 0)
      return partial("ranged caption response");
    const end = Number(url.searchParams.get("end"));
    if (
      durationSeconds != null &&
      url.searchParams.has("end") &&
      end * 1000 <
        durationSeconds * 1000 - Math.max(30_000, durationSeconds * 200)
    ) {
      return partial("ranged caption response");
    }
    if (url.searchParams.has("sq") || url.searchParams.has("sequence")) {
      return partial("caption sequence response");
    }
  } catch {
    return partial("invalid caption URL");
  }
  if (durationSeconds != null && durationSeconds > 0) {
    const durationMs = durationSeconds * 1000;
    const headAllowance = Math.min(120_000, durationMs * 0.15);
    const tailAllowance = Math.max(30_000, durationMs * 0.2);
    if (firstCueMs > headAllowance) return partial("captions begin too late");
    if (lastCueEndMs < durationMs - tailAllowance) {
      return partial("captions end far before video duration");
    }
  }
  return { complete: true, firstCueMs, lastCueEndMs };
}
