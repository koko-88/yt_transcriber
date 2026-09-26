/** Speech model choices live outside the decoder and worker lifecycle. */
export interface SttModelProfile {
  readonly id: string;
  readonly modelId: string;
  readonly trackId: string;
  readonly trackLabel: string;
  readonly inferenceOptions: Readonly<Record<string, unknown>>;
}

// Runtime default until model selection is exposed to the user.
export const DEFAULT_STT_PROFILE: SttModelProfile = {
  id: "whisper-tiny",
  modelId: "onnx-community/whisper-tiny",
  trackId: "local-whisper",
  trackLabel: "Generated transcription",
  inferenceOptions: { return_timestamps: true, task: "transcribe" },
};
