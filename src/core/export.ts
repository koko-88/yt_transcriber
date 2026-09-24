// Export — transcript export in TXT, Markdown, SRT, VTT, JSON formats
// Per plan: copy variants, TXT/MD/SRT/VTT/JSON export

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

/** Export as plain text */
export function exportTxt(transcript: Transcript): string {
  const header = `${transcript.video.title}\n${transcript.video.canonicalUrl}\n${transcript.track.languageLabel} (${transcript.track.kind})\n\n`;
  const body = transcript.segments
    .map((s) => `[${formatTimestamp(s.startMs)}] ${s.text}`)
    .join("\n");
  return header + body;
}

/** Export as Markdown with timestamp links */
export function exportMarkdown(transcript: Transcript): string {
  const videoId = transcript.video.videoId;
  const header = [
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
    .join("\n");

  const paragraphs = toParagraphs(transcript.segments);
  const body = paragraphs
    .map((p) => {
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

/** Copy-friendly text variants */
export function copyPlainText(segments: readonly TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(" ");
}

export function copyWithTimestamps(
  segments: readonly TranscriptSegment[],
): string {
  return segments
    .map((s) => `[${formatTimestamp(s.startMs)}] ${s.text}`)
    .join("\n");
}
