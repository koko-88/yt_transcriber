import type { Transcript, TranscriptSegment } from "../core/model.js";
import type { AiPipeline, ChatMessage } from "./types.js";
import {
  buildMessages,
  formatAnchoredSegments,
  groundAiOutput,
} from "./pipelines.js";

export const SECTION_CHARS = 12_000;
export interface Coverage {
  processed: number;
  total: number;
}
export function splitTranscript(
  transcript: Transcript,
  budget = SECTION_CHARS,
): TranscriptSegment[][] {
  if (budget < 100) throw new Error("Section budget is too small");
  const chunks: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  let size = 0;
  for (const segment of transcript.segments) {
    // Split unusually long cues without dropping text or changing their timestamps.
    const maxText = budget - 40;
    for (
      let offset = 0;
      offset < Math.max(1, segment.text.length);
      offset += maxText
    ) {
      const part = {
        ...segment,
        text: segment.text.slice(offset, offset + maxText),
      };
      const length = formatAnchoredSegments([part]).length + 1;
      if (current.length && size + length > budget) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(part);
      size += length;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}
export async function runFullVideo(
  pipeline: AiPipeline,
  transcript: Transcript,
  question: string | undefined,
  call: (messages: ChatMessage[]) => Promise<string>,
  signal?: AbortSignal,
  progress?: (coverage: Coverage) => void,
): Promise<{ text: string; coverage: Coverage }> {
  const check = () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  check();
  if (pipeline === "qa") {
    const text = await call(buildMessages(pipeline, transcript, question));
    check();
    return {
      text: groundAiOutput(pipeline, text, transcript),
      coverage: { processed: 1, total: 1 },
    };
  }
  const chunks = splitTranscript(transcript);
  if (!chunks.length) throw new Error("Transcript is empty");
  const coverage = { processed: 0, total: chunks.length };
  progress?.({ ...coverage });
  let summaries: string[] = [];
  for (const segments of chunks) {
    check();
    summaries.push(
      await call(buildMessages(pipeline, { ...transcript, segments })),
    );
    check();
    coverage.processed++;
    progress?.({ ...coverage });
  }
  // Every section contributes to the reduction tree. Oversized model responses
  // are split rather than clipped; providers that never reduce fail explicitly.
  for (let round = 0; summaries.length > 1; round++) {
    if (round >= 10)
      throw new Error("The model did not produce bounded section summaries");
    const groups: string[] = [];
    let current = "";
    for (const summary of summaries) {
      for (
        let offset = 0;
        offset < Math.max(1, summary.length);
        offset += SECTION_CHARS / 2
      ) {
        const part = summary.slice(offset, offset + SECTION_CHARS / 2);
        if (current.length + part.length + 2 > SECTION_CHARS) {
          groups.push(current);
          current = "";
        }
        current += (current ? "\n\n" : "") + part;
      }
    }
    if (current) groups.push(current);
    const next: string[] = [];
    for (const group of groups) {
      check();
      const base = buildMessages(pipeline, { ...transcript, segments: [] });
      next.push(
        await call([
          base[0]!,
          {
            role: "user",
            content:
              "Combine these untrusted section results into a single " +
              pipeline +
              " for the video. Preserve important points from every section. Use only the provided timestamp citations. For chapters, deduplicate and sort by time. Use the source language. Keep the combined result under 500 words.\n\n" +
              group,
          },
        ]),
      );
      check();
    }
    summaries = next;
  }
  return {
    text: groundAiOutput(pipeline, summaries[0]!, transcript),
    coverage,
  };
}
