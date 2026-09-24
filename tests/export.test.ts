import { describe, it, expect } from 'vitest';
import {
  formatTimestamp,
  exportSrt,
  exportVtt,
  exportTxt,
  exportMarkdown,
  exportJson,
  copyPlainText,
  copyWithTimestamps,
  makeExportFilename,
  makeYouTubeTimestampUrl,
} from '../src/core/export';
import type { Transcript, TranscriptSegment } from '../src/core/model';

const segments: TranscriptSegment[] = [
  { startMs: 0, endMs: 1500, text: 'Hello world' },
  { startMs: 1500, endMs: 3661000, text: 'Second line' },
];

const transcript: Transcript = {
  id: 't1',
  schemaVersion: 1,
  video: {
    videoId: 'abc123',
    url: 'https://www.youtube.com/watch?v=abc123',
    canonicalUrl: 'https://www.youtube.com/watch?v=abc123',
    title: 'Test Video: A/B?',
    channelName: 'Chan',
    durationSeconds: 120,
  },
  track: { trackId: 'en-manual', languageCode: 'en', languageLabel: 'English', kind: 'manual' },
  segments,
  acquiredAt: 1700000000000,
  acquisitionMethod: 'static-fetch',
};

describe('formatTimestamp', () => {
  it('formats mm:ss below one hour', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(1500)).toBe('0:01');
    expect(formatTimestamp(65_000)).toBe('1:05');
  });
  it('formats h:mm:ss at one hour and beyond', () => {
    expect(formatTimestamp(3_661_000)).toBe('1:01:01');
  });
});

describe('exportSrt', () => {
  it('produces numbered cues with comma milliseconds', () => {
    const srt = exportSrt(segments);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:01,500\nHello world');
    expect(srt).toContain('2\n00:00:01,500 --> 01:01:01,000\nSecond line');
  });
});

describe('exportVtt', () => {
  it('has WEBVTT header and dot milliseconds', () => {
    const vtt = exportVtt(segments);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.500');
  });
});

describe('exportTxt / copyPlainText', () => {
  it('joins segment text with spaces', () => {
    expect(copyPlainText(segments)).toBe('Hello world Second line');
    expect(exportTxt(transcript)).toContain('[0:00] Hello world');
  });
});

describe('exportMarkdown', () => {
  it('includes title heading and metadata', () => {
    const md = exportMarkdown(transcript);
    expect(md).toContain('# Test Video');
    expect(md).toContain('Chan');
  });
});

describe('exportJson', () => {
  it('round-trips through JSON.parse', () => {
    const parsed = JSON.parse(exportJson(transcript));
    expect(parsed.video.videoId).toBe('abc123');
    expect(parsed.segments).toHaveLength(2);
  });
});

describe('copyWithTimestamps', () => {
  it('prefixes each line with [m:ss]', () => {
    expect(copyWithTimestamps(segments)).toBe('[0:00] Hello world\n[0:01] Second line');
  });
});

describe('makeExportFilename', () => {
  it('sanitizes unsafe characters', () => {
    const name = makeExportFilename('Test Video: A/B?', 'en', 'txt');
    expect(name).not.toMatch(/[:/?]/);
    expect(name.endsWith('.txt')).toBe(true);
  });
});

describe('makeYouTubeTimestampUrl', () => {
  it('appends t parameter in seconds', () => {
    expect(makeYouTubeTimestampUrl('abc123', 90_000)).toBe(
      'https://www.youtube.com/watch?v=abc123&t=90s',
    );
  });
});
