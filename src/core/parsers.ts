// JSON3 caption parser — YouTube's primary caption format
// Parses the fmt=json3 response into TranscriptSegment[]

import type { TranscriptSegment } from './model';

/** Shape of a json3 caption event */
interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string; tOffset?: number }>;
  aAppend?: number;
  wWinId?: number;
}

interface Json3Response {
  events?: Json3Event[];
  wireMagic?: string;
}

/** Size limits to prevent abuse */
const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_SEGMENTS = 100_000;

/**
 * Parse a YouTube json3 caption response into segments.
 * Returns null if the data is invalid or empty.
 */
export function parseJson3(raw: string): TranscriptSegment[] | null {
  if (!raw || raw.length > MAX_BODY_BYTES) return null;

  let data: Json3Response;
  try {
    data = JSON.parse(raw) as Json3Response;
  } catch {
    return null;
  }

  if (!data.events || !Array.isArray(data.events)) return null;

  const segments: TranscriptSegment[] = [];
  let index = 0;

  for (const event of data.events) {
    if (index >= MAX_SEGMENTS) break;

    // Skip window/style events and append events
    if (event.aAppend !== undefined) continue;
    if (!event.segs || event.segs.length === 0) continue;
    if (event.tStartMs === undefined) continue;

    const startMs = event.tStartMs;
    const durationMs = event.dDurationMs ?? 0;
    const endMs = startMs + durationMs;

    // Concatenate all text segments
    const text = event.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\n+/g, ' ')
      .trim();

    if (!text) continue;

    segments.push({
      index,
      startMs,
      endMs,
      text,
    });
    index++;
  }

  return segments.length > 0 ? segments : null;
}

/**
 * Parse SRV3 (XML-based) caption format.
 * This is the older XML format YouTube sometimes returns.
 */
export function parseSrv3(raw: string): TranscriptSegment[] | null {
  if (!raw || raw.length > MAX_BODY_BYTES) return null;

  // Use regex since DOMParser may not be available in all contexts
  const segmentRegex =
    /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/g;
  const segments: TranscriptSegment[] = [];
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = segmentRegex.exec(raw)) !== null) {
    if (index >= MAX_SEGMENTS) break;

    const startSec = parseFloat(match[1] ?? '0');
    const durSec = parseFloat(match[2] ?? '0');
    const rawText = match[3] ?? '';

    const text = decodeXmlEntities(rawText).replace(/\n+/g, ' ').trim();
    if (!text) continue;

    const startMs = Math.round(startSec * 1000);
    const endMs = Math.round((startSec + durSec) * 1000);

    segments.push({ index, startMs, endMs, text });
    index++;
  }

  return segments.length > 0 ? segments : null;
}

/**
 * Parse VTT (WebVTT) caption format.
 */
export function parseVtt(raw: string): TranscriptSegment[] | null {
  if (!raw || raw.length > MAX_BODY_BYTES) return null;

  const lines = raw.split('\n');
  const segments: TranscriptSegment[] = [];
  let index = 0;
  let i = 0;

  // Skip header
  while (i < lines.length && !lines[i]?.includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    if (index >= MAX_SEGMENTS) break;

    const line = lines[i] ?? '';
    const timeMatch = line.match(
      /((?:\d{2}:)?\d{2}:\d{2}[.:]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[.:]\d{3})/
    );

    if (timeMatch) {
      const startMs = parseVttTime(timeMatch[1] ?? '');
      const endMs = parseVttTime(timeMatch[2] ?? '');
      i++;

      const textLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim() !== '') {
        const tl = (lines[i] ?? '').trim();
        // Strip VTT positioning tags
        textLines.push(tl.replace(/<[^>]+>/g, ''));
        i++;
      }

      const text = textLines.join(' ').trim();
      if (text) {
        segments.push({ index, startMs, endMs, text });
        index++;
      }
    } else {
      i++;
    }
  }

  return segments.length > 0 ? segments : null;
}

/** Parse VTT timestamp (HH:MM:SS.mmm or MM:SS.mmm) to milliseconds */
function parseVttTime(time: string): number {
  const normalized = time.replace('.', ':');
  const parts = normalized.split(':');
  if (parts.length === 4) {
    return (
      parseInt(parts[0] ?? '0', 10) * 3600000 +
      parseInt(parts[1] ?? '0', 10) * 60000 +
      parseInt(parts[2] ?? '0', 10) * 1000 +
      parseInt(parts[3] ?? '0', 10)
    );
  } else if (parts.length === 3) {
    return (
      parseInt(parts[0] ?? '0', 10) * 60000 +
      parseInt(parts[1] ?? '0', 10) * 1000 +
      parseInt(parts[2] ?? '0', 10)
    );
  }
  return 0;
}

/** Decode common XML entities */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code as string, 10)));
}

/** Auto-detect format and parse */
export function parseCaption(
  raw: string,
  format?: 'json3' | 'srv3' | 'vtt'
): TranscriptSegment[] | null {
  if (!raw) return null;

  if (format === 'json3' || (!format && raw.trimStart().startsWith('{'))) {
    return parseJson3(raw);
  }
  if (format === 'srv3' || (!format && raw.trimStart().startsWith('<?xml'))) {
    return parseSrv3(raw);
  }
  if (format === 'vtt' || (!format && raw.trimStart().startsWith('WEBVTT'))) {
    return parseVtt(raw);
  }

  // Try each parser
  return parseJson3(raw) ?? parseSrv3(raw) ?? parseVtt(raw);
}
