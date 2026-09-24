// Paragraph grouping — derived view from segments
// Groups consecutive segments into readable paragraphs by pause duration

import type { TranscriptSegment, Paragraph } from "./model";

/** Default pause threshold (ms) between segments to start a new paragraph */
const DEFAULT_PAUSE_MS = 1500;
/** Maximum number of segments per paragraph */
const MAX_SEGMENTS_PER_PARA = 15;

/**
 * Group transcript segments into paragraphs based on pauses and speaker changes.
 */
export function toParagraphs(
  segments: readonly TranscriptSegment[],
  pauseThresholdMs: number = DEFAULT_PAUSE_MS,
): Paragraph[] {
  if (segments.length === 0) return [];

  const paragraphs: Paragraph[] = [];
  let currentTexts: string[] = [];
  let currentStart = 0;
  let currentEnd = 0;
  let currentSegStart = 0;
  let currentSpeaker: string | undefined;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;

    if (i === 0) {
      currentTexts = [seg.text];
      currentStart = seg.startMs;
      currentEnd = seg.endMs;
      currentSegStart = 0;
      currentSpeaker = seg.speaker;
      continue;
    }

    const prevSeg = segments[i - 1]!;
    const pause = seg.startMs - prevSeg.endMs;
    const speakerChanged =
      seg.speaker !== undefined && seg.speaker !== currentSpeaker;
    const tooLong = currentTexts.length >= MAX_SEGMENTS_PER_PARA;

    if (pause > pauseThresholdMs || speakerChanged || tooLong) {
      // Flush current paragraph
      paragraphs.push({
        index: paragraphs.length,
        startMs: currentStart,
        endMs: currentEnd,
        text: currentTexts.join(" "),
        segmentRange: [currentSegStart, i - 1] as const,
        speaker: currentSpeaker,
      });

      currentTexts = [seg.text];
      currentStart = seg.startMs;
      currentEnd = seg.endMs;
      currentSegStart = i;
      currentSpeaker = seg.speaker;
    } else {
      currentTexts.push(seg.text);
      currentEnd = seg.endMs;
    }
  }

  // Flush last paragraph
  if (currentTexts.length > 0) {
    paragraphs.push({
      index: paragraphs.length,
      startMs: currentStart,
      endMs: currentEnd,
      text: currentTexts.join(" "),
      segmentRange: [currentSegStart, segments.length - 1] as const,
      speaker: currentSpeaker,
    });
  }

  return paragraphs;
}
