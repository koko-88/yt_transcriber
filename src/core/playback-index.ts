// Resolve the active row index for the currently rendered transcript model.
// Segment mode uses segments; paragraph mode uses paragraphs. Never mix them.

export interface TimedRange {
  startMs: number;
  endMs: number;
}

/**
 * Index of the item that contains `playbackMs`, or the last item that started
 * at/before it when the cursor sits in a gap. Returns -1 when empty / before start.
 */
export function findActiveItemIndex(
  items: readonly TimedRange[],
  playbackMs: number,
): number {
  if (items.length === 0) return -1;
  if (playbackMs < 0) return -1;

  // Cues are ordered by start time. Binary search keeps playback updates cheap
  // even for hour-long transcripts with tens of thousands of cues.
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid]!.startMs <= playbackMs) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
