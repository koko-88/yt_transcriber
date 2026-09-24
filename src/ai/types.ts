// AI layer types.

import type { Transcript } from "../core/model.js";

export type AiPipeline = "summary" | "takeaways" | "chapters" | "qa";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface AiRunRequest {
  pipeline: AiPipeline;
  /** The transcript to analyse. Passed inline so the panel never has to persist it. */
  transcript: Transcript;
  providerId: string;
  model: string;
  /** Question text for the qa pipeline. */
  question?: string | undefined;
}

export interface AiRunResult {
  ok: boolean;
  text?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  /** Provider/model echo for display. */
  provider?: string;
  model?: string;
}
