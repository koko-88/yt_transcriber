import type { Transcript, TranscriptSegment } from "../core/model.js";
import type { AiPipeline } from "../ai/types.js";
import type { NormalizerState } from "../stt/transcript-normalizer.js";

export interface TranscriptEdit {
  transcriptId: string;
  original: Transcript;
  corrected: Transcript;
  undo: { index: number; text: string }[];
  updatedAt: number;
}
export interface AiHistoryEntry {
  id: string;
  videoId: string;
  transcriptId: string;
  transcriptHash: string;
  pipeline: AiPipeline;
  question?: string;
  provider: string;
  model: string;
  text: string;
  createdAt: number;
  coverage: { processed: number; total: number };
  citations: number[];
}
export interface SttCheckpoint {
  videoId: string;
  profileKey: string;
  durationMs: number | null;
  endSeconds: number;
  state: NormalizerState;
  preview: TranscriptSegment[];
  updatedAt: number;
}
