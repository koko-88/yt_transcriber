// Export — copy variants and text/subtitle/json/csv serializers.
// Binary document formats (DOCX/PDF/PPTX) live in export-docs.ts and are
// loaded lazily so they stay out of the sidepanel startup chunk.

import type { Transcript, TranscriptSegment } from "./model";
import { toParagraphs } from "./paragraphs";

/** Format milliseconds to HH:MM:SS */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${minutes}:${pad2(seconds)}`;
}

/** Format milliseconds to HH:MM:SS,mmm (SRT format) */
function formatSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(millis)}`;
}

/** Format milliseconds to HH:MM:SS.mmm (VTT format) */
function formatVttTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

/** Generate YouTube URL for a timestamp */
export function makeYouTubeTimestampUrl(videoId: string, ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`;
}

export type CopyMode =
  | "plain"
  | "paragraph"
  | "segment"
  | "paragraph-timestamps"
  | "segment-timestamps"
  | "markdown";

export interface ExportTextOptions {
  /** Prefer paragraph grouping when the format allows it. */
  view: "paragraph" | "segment";
  timestamps: boolean;
  metadata: boolean;
}

const DEFAULT_TEXT_OPTS: ExportTextOptions = {
  view: "segment",
  timestamps: true,
  metadata: true,
};

function metadataHeader(transcript: Transcript): string {
  return [
    transcript.video.title,
    transcript.video.canonicalUrl,
    `${transcript.track.languageLabel} (${transcript.track.kind})`,
    transcript.video.channelName
      ? `Channel: ${transcript.video.channelName}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Export as plain text (optional timestamps / paragraph vs segment). */
export function exportTxt(
  transcript: Transcript,
  opts: Partial<ExportTextOptions> = {},
): string {
  const o = { ...DEFAULT_TEXT_OPTS, ...opts };
  const header = o.metadata ? `${metadataHeader(transcript)}\n\n` : "";
  if (o.view === "paragraph") {
    const paragraphs = toParagraphs(transcript.segments);
    const body = paragraphs
      .map((p) =>
        o.timestamps ? `[${formatTimestamp(p.startMs)}] ${p.text}` : p.text,
      )
      .join("\n\n");
    return header + body;
  }
  const body = transcript.segments
    .map((s) =>
      o.timestamps ? `[${formatTimestamp(s.startMs)}] ${s.text}` : s.text,
    )
    .join("\n");
  return header + body;
}

/** Export as Markdown with optional timestamp links. */
export function exportMarkdown(
  transcript: Transcript,
  opts: Partial<ExportTextOptions> = {},
): string {
  const o = { ...DEFAULT_TEXT_OPTS, view: "paragraph" as const, ...opts };
  const videoId = transcript.video.videoId;
  const header = o.metadata
    ? [
        `# ${transcript.video.title}`,
        "",
        `**URL:** ${transcript.video.canonicalUrl}`,
        `**Language:** ${transcript.track.languageLabel} (${transcript.track.kind})`,
        transcript.video.channelName
          ? `**Channel:** ${transcript.video.channelName}`
          : "",
        "",
        "---",
        "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  if (o.view === "segment") {
    const body = transcript.segments
      .map((s) => {
        if (!o.timestamps) return s.text;
        const url = makeYouTubeTimestampUrl(videoId, s.startMs);
        return `[${formatTimestamp(s.startMs)}](${url}) ${s.text}`;
      })
      .join("\n\n");
    return header + body;
  }

  const paragraphs = toParagraphs(transcript.segments);
  const body = paragraphs
    .map((p) => {
      if (!o.timestamps) return p.text;
      const url = makeYouTubeTimestampUrl(videoId, p.startMs);
      return `[${formatTimestamp(p.startMs)}](${url}) ${p.text}`;
    })
    .join("\n\n");
  return header + body;
}

/** Export as SRT subtitle file */
export function exportSrt(segments: readonly TranscriptSegment[]): string {
  return segments
    .map((s, i) => {
      return `${i + 1}\n${formatSrtTime(s.startMs)} --> ${formatSrtTime(s.endMs)}\n${s.text}\n`;
    })
    .join("\n");
}

/** Export as WebVTT subtitle file */
export function exportVtt(segments: readonly TranscriptSegment[]): string {
  const header = "WEBVTT\n\n";
  const body = segments
    .map((s) => {
      return `${formatVttTime(s.startMs)} --> ${formatVttTime(s.endMs)}\n${s.text}\n`;
    })
    .join("\n");
  return header + body;
}

/** Export as JSON (the full transcript object) */
export function exportJson(transcript: Transcript): string {
  return JSON.stringify(
    {
      ...transcript,
      track: { ...transcript.track, sourceRef: undefined },
    },
    null,
    2,
  );
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Export as CSV (one row per segment). */
export function exportCsv(transcript: Transcript): string {
  const rows = [
    ["index", "startMs", "endMs", "timestamp", "text"].join(","),
    ...transcript.segments.map((s) =>
      [
        String(s.index),
        String(s.startMs),
        String(s.endMs),
        formatTimestamp(s.startMs),
        csvEscape(s.text),
      ].join(","),
    ),
  ];
  return rows.join("\n");
}

/** Generate a safe filename for export */
export function makeExportFilename(
  title: string,
  languageCode: string,
  ext: string,
): string {
  const safe = title
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 100);
  return `${safe}_${languageCode}.${ext}`;
}

/** Copy-friendly text variants — output matches the requested granularity. */
export function copyTranscript(transcript: Transcript, mode: CopyMode): string {
  switch (mode) {
    case "plain":
      return transcript.segments.map((s) => s.text).join(" ");
    case "paragraph":
      return toParagraphs(transcript.segments)
        .map((p) => p.text)
        .join("\n\n");
    case "segment":
      return transcript.segments.map((s) => s.text).join("\n");
    case "paragraph-timestamps":
      return toParagraphs(transcript.segments)
        .map((p) => `[${formatTimestamp(p.startMs)}] ${p.text}`)
        .join("\n\n");
    case "segment-timestamps":
      return transcript.segments
        .map((s) => `[${formatTimestamp(s.startMs)}] ${s.text}`)
        .join("\n");
    case "markdown":
      return exportMarkdown(transcript, {
        view: "paragraph",
        timestamps: true,
        metadata: true,
      });
  }
}

/** @deprecated Prefer copyTranscript(..., "plain") */
export function copyPlainText(segments: readonly TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(" ");
}

/** @deprecated Prefer copyTranscript(..., "segment-timestamps") */
export function copyWithTimestamps(
  segments: readonly TranscriptSegment[],
): string {
  return segments
    .map((s) => `[${formatTimestamp(s.startMs)}] ${s.text}`)
    .join("\n");
}
