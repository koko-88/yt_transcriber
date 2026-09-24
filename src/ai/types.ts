// AI layer types.

export type AiPipeline = 'summary' | 'takeaways' | 'chapters' | 'qa';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AiRunRequest {
  pipeline: AiPipeline;
  /** Transcript ID to run against (background loads from IDB). */
  transcriptId: string;
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
