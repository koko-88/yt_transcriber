import type { TranscriptSegment } from "../core/model.js";
import type { PcmWindow } from "./media-reader.js";
import { OVERLAP_SECONDS } from "./media-reader.js";

export interface SttCue {
  text: string;
  timestamp: [number, number | null];
}

interface Candidate {
  startMs: number;
  endMs: number;
  text: string;
}

function midpoint(cue: Candidate): number {
  return (cue.startMs + cue.endMs) / 2;
}
function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}
function key(word: string): string {
  return word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function duplicatePrefix(previous: string, current: string): number {
  const left = words(previous);
  const right = words(current);
  for (let count = Math.min(left.length, right.length); count > 0; count--) {
    if (
      left
        .slice(-count)
        .every((word, index) => key(word) === key(right[index]!))
    )
      return count;
  }
  return 0;
}

/** Owns the center of each overlap and reconciles repeated boundary words. */
export class TranscriptNormalizer {
  private pending: Candidate[] | null = null;
  private readonly output: TranscriptSegment[] = [];

  addWindow(window: PcmWindow, cues: SttCue[]): void {
    const candidates = cues.flatMap((cue): Candidate[] => {
      const text = cue.text.trim();
      const from = Number(cue.timestamp[0]);
      const to = Number(
        cue.timestamp[1] ?? window.endSeconds - window.startSeconds,
      );
      if (!text || !Number.isFinite(from) || !Number.isFinite(to)) return [];
      const startMs = Math.round(
        Math.max(window.startSeconds, window.startSeconds + from) * 1000,
      );
      const endMs = Math.round(
        Math.min(window.endSeconds, window.startSeconds + to) * 1000,
      );
      return endMs > startMs ? [{ startMs, endMs, text }] : [];
    });
    if (this.pending !== null) {
      const splitMs = Math.round(
        (window.startSeconds + OVERLAP_SECONDS / 2) * 1000,
      );
      for (const cue of this.pending.filter(
        (candidate) => midpoint(candidate) < splitMs,
      ))
        this.append(cue);
      this.pending = candidates.filter(
        (candidate) => midpoint(candidate) >= splitMs,
      );
    } else {
      this.pending = candidates;
    }
    if (window.isLast) this.finish();
  }

  finish(): TranscriptSegment[] {
    for (const cue of this.pending ?? []) this.append(cue);
    this.pending = null;
    return this.output;
  }

  private append(candidate: Candidate): void {
    const previous = this.output.at(-1);
    let text = candidate.text;
    let startMs = candidate.startMs;
    if (previous && candidate.startMs <= previous.endMs + 2000) {
      const repeated = duplicatePrefix(previous.text, text);
      if (repeated) {
        const remaining = words(text).slice(repeated);
        if (!remaining.length) return;
        text = remaining.join(" ");
        startMs = Math.max(startMs, previous.endMs);
      }
    }
    if (previous) startMs = Math.max(startMs, previous.endMs);
    const endMs = Math.max(startMs + 1, candidate.endMs);
    this.output.push({ index: this.output.length, startMs, endMs, text });
  }
}
