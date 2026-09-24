// Search — RTL/Arabic-aware text normalization and BM25 search
// Per plan: own normalizer (Arabic/diacritics/CJK), minisearch for Q&A retrieval

import type { TranscriptSegment } from "./model";

/** Arabic diacritical marks Unicode range */
const ARABIC_DIACRITICS =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g;

/** Normalize text for search — handles Arabic, diacritics, case, whitespace */
export function normalizeForSearch(text: string): string {
  return (
    text
      // Normalize Unicode
      .normalize("NFKD")
      // Remove combining diacritical marks (Latin accents)
      .replace(/[\u0300-\u036f]/g, "")
      // Remove Arabic diacritics (tashkeel)
      .replace(ARABIC_DIACRITICS, "")
      // Normalize Arabic characters (alef variants -> bare alef)
      .replace(/[\u0622\u0623\u0625\u0627]/g, "\u0627")
      // Normalize taa marbuta to haa
      .replace(/\u0629/g, "\u0647")
      // Lowercase
      .toLowerCase()
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Search result with match positions */
export interface SearchResult {
  readonly segment: TranscriptSegment;
  readonly matchRanges: readonly { start: number; end: number }[];
}

/**
 * Cache of normalized segment text keyed by the segments array identity.
 * Transcript segment arrays are immutable and stable between keystrokes, so
 * normalization (the expensive part of search on long transcripts) runs once
 * per transcript instead of once per query.
 */
const normalizedCache = new WeakMap<readonly TranscriptSegment[], string[]>();

function normalizedTexts(segments: readonly TranscriptSegment[]): string[] {
  let cached = normalizedCache.get(segments);
  if (!cached) {
    cached = segments.map((s) => normalizeForSearch(s.text));
    normalizedCache.set(segments, cached);
  }
  return cached;
}

/**
 * Simple substring search with Arabic/diacritic normalization.
 * Returns segments that contain the query, with match ranges for highlighting.
 */
export function searchSegments(
  segments: readonly TranscriptSegment[],
  query: string,
): SearchResult[] {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return [];

  const texts = normalizedTexts(segments);
  const results: SearchResult[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const normalizedText = texts[i]!;
    const matchRanges: { start: number; end: number }[] = [];

    let searchFrom = 0;
    while (true) {
      const idx = normalizedText.indexOf(normalizedQuery, searchFrom);
      if (idx === -1) break;

      // Map back to original text positions (approximate for diacritics)
      const ratio = segment.text.length / normalizedText.length;
      matchRanges.push({
        start: Math.round(idx * ratio),
        end: Math.round((idx + normalizedQuery.length) * ratio),
      });
      searchFrom = idx + 1;
    }

    if (matchRanges.length > 0) {
      results.push({ segment, matchRanges });
    }
  }

  return results;
}

/**
 * BM25 retrieval for AI Q&A context selection.
 * Returns the top-k most relevant segments for a query.
 */
export function bm25Retrieve(
  segments: readonly TranscriptSegment[],
  query: string,
  topK: number = 20,
): TranscriptSegment[] {
  const queryTerms = normalizeForSearch(query).split(" ").filter(Boolean);
  if (queryTerms.length === 0) return [];
  if (segments.length === 0) return [];

  const N = segments.length;
  const texts = normalizedTexts(segments);
  const docTerms = texts.map((t) => t.split(" ").filter(Boolean));
  const avgDl = docTerms.reduce((sum, terms) => sum + terms.length, 0) / N;
  const k1 = 1.2;
  const b = 0.75;

  // Document frequency for each term
  const df = new Map<string, number>();
  for (const terms of docTerms) {
    for (const t of new Set(terms)) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  // Score each segment
  const scores = segments.map((seg, i) => {
    const terms = docTerms[i]!;
    const dl = terms.length;
    let score = 0;

    for (const qt of queryTerms) {
      const n = df.get(qt) ?? 0;
      const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
      const tf = terms.filter((t) => t === qt).length;
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl)));
      score += idf * tfNorm;
    }

    return { segment: seg, score };
  });

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter((s) => s.score > 0)
    .sort((a, b) => a.segment.index - b.segment.index)
    .map((s) => s.segment);
}
