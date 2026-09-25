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

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (playbackMs >= item.startMs && playbackMs < item.endMs) return i;
  }

  // After the last cue ends: stay on the last item.
  const last = items[items.length - 1]!;
  if (playbackMs >= last.endMs) return items.length - 1;

  // In a gap: prefer the most recent item that has started.
  let best = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.startMs <= playbackMs) best = i;
    else break;
  }
  return best;
}
