import { describe, it, expect } from 'vitest';
import { normalizeForSearch, searchSegments, bm25Retrieve } from '../src/core/search';
import type { TranscriptSegment } from '../src/core/model';

describe('normalizeForSearch', () => {
  it('strips Latin diacritics and lowercases', () => {
    expect(normalizeForSearch('Héllo WÖRLD')).toBe('hello world');
  });

  it('strips Arabic tashkeel and normalizes alef variants', () => {
    // مُحَمَّد with diacritics -> محمد
    expect(normalizeForSearch('مُحَمَّد')).toBe('محمد');
    // أ إ آ -> ا
    expect(normalizeForSearch('أإآ')).toBe('ااا');
  });

  it('normalizes taa marbuta to haa', () => {
    expect(normalizeForSearch('مدرسة')).toBe('مدرسه');
  });

  it('collapses whitespace', () => {
    expect(normalizeForSearch('  a   b\n c ')).toBe('a b c');
  });
});

describe('searchSegments', () => {
  const segments: TranscriptSegment[] = [
    { startMs: 0, endMs: 1000, text: 'The quick brown fox' },
    { startMs: 1000, endMs: 2000, text: 'jumps over the lazy dog' },
    { startMs: 2000, endMs: 3000, text: 'مرحبا بالعالم' },
  ];

  it('finds case-insensitive substring matches', () => {
    const results = searchSegments(segments, 'QUICK');
    expect(results).toHaveLength(1);
    expect(results[0]!.segment.text).toBe('The quick brown fox');
  });

  it('returns empty for empty query', () => {
    expect(searchSegments(segments, '   ')).toHaveLength(0);
  });

  it('matches Arabic text with diacritic-insensitive query', () => {
    const withTashkeel: TranscriptSegment[] = [
      { startMs: 0, endMs: 1000, text: 'مَرْحَبًا بِالْعَالَمِ' },
    ];
    const results = searchSegments(withTashkeel, 'مرحبا');
    expect(results).toHaveLength(1);
  });

  it('returns no matches for absent text', () => {
    expect(searchSegments(segments, 'zebra')).toHaveLength(0);
  });
});

describe('bm25Retrieve', () => {
  const segments: TranscriptSegment[] = [
    { startMs: 0, endMs: 1000, text: 'machine learning models train on data' },
    { startMs: 1000, endMs: 2000, text: 'the weather is nice today' },
    { startMs: 2000, endMs: 3000, text: 'neural networks are machine learning models' },
    { startMs: 3000, endMs: 4000, text: 'cooking pasta requires boiling water' },
  ];

  it('ranks relevant segments first', () => {
    const results = bm25Retrieve(segments, 'machine learning', 2);
    expect(results.length).toBe(2);
    expect(results[0]!.text).toContain('machine learning');
  });

  it('returns empty for empty query', () => {
    expect(bm25Retrieve(segments, '', 5)).toHaveLength(0);
  });

  it('respects topK', () => {
    const results = bm25Retrieve(segments, 'the', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
