// AI pipelines: prompt construction from transcripts.
// Versioning matters: cache keys include the prompt version.

import type { Transcript } from '../core/model.js';
import { copyPlainText } from '../core/export.js';
import { bm25Retrieve } from '../core/search.js';
import type { AiPipeline, ChatMessage } from './types.js';

export const PROMPT_VERSION = 1;

/** Rough char budget for context (approx 4 chars/token, 16k tokens). */
const MAX_CONTEXT_CHARS = 60_000;
const QA_CONTEXT_CHARS = 16_000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n\n[...middle omitted for length...]\n\n${text.slice(-half)}`;
}

function transcriptText(transcript: Transcript, maxChars: number): string {
  return truncate(copyPlainText(transcript.segments), maxChars);
}

const SYSTEM = `You are a precise assistant embedded in a browser extension that analyses YouTube video transcripts. Answer only from the provided transcript. If the transcript does not support an answer, say so explicitly.`;

export function buildMessages(
  pipeline: AiPipeline,
  transcript: Transcript,
  question?: string,
): ChatMessage[] {
  const text = transcriptText(transcript, pipeline === 'qa' ? 0 : MAX_CONTEXT_CHARS);
  const title = transcript.video.title;
  const header = `Video: "${title}"\n\nTranscript:\n`;

  switch (pipeline) {
    case 'summary':
      return [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `${header}${text}\n\nWrite a concise summary (max 200 words) of this video. Use the transcript's language for your answer.`,
        },
      ];
    case 'takeaways':
      return [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `${header}${text}\n\nList the key takeaways as bullet points (5-10 items). Use the transcript's language for your answer.`,
        },
      ];
    case 'chapters':
      return [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `${header}${text}\n\nPropose chapter markers for this video. Format: one chapter per line as "MM:SS - Title". Use the transcript's language for chapter titles.`,
        },
      ];
    case 'qa': {
      const context = bm25Retrieve(transcript.segments, question ?? '', 12);
      const contextText = truncate(copyPlainText(context), QA_CONTEXT_CHARS);
      return [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Video: "${title}"\n\nRelevant transcript excerpts:\n${contextText}\n\nQuestion: ${question ?? ''}\n\nAnswer the question using only the excerpts above. Use the question's language for your answer.`,
        },
      ];
    }
  }
}
