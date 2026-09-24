// Hashing utility for transcript text content

/**
 * Compute a simple hash of transcript text for cache invalidation.
 * Uses a fast non-cryptographic hash (FNV-1a variant) since we only
 * need to detect content changes, not resist adversaries.
 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // FNV prime, stay in u32
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Build the full text content of segments for hashing.
 */
export function segmentsToText(segments: readonly { text: string }[]): string {
  return segments.map((s) => s.text).join('\n');
}
