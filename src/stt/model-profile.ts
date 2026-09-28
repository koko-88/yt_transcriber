import type { TranscriptTrack } from "../core/model.js";

/** Speech model choices live outside the decoder and worker lifecycle. */
export interface SttModelProfile {
  readonly id: string;
  readonly modelId: string;
  readonly trackId: string;
  readonly trackLabel: string;
  readonly languageCode: string;
  readonly inferenceOptions: Readonly<Record<string, unknown>>;
}

export const LOCAL_ENGLISH_TRACK_ID = "local-whisper-en";
export const LOCAL_ARABIC_TRACK_ID = "local-translate-ar";

export function generatedLocalTracks(): TranscriptTrack[] {
  return [
    {
      trackId: LOCAL_ENGLISH_TRACK_ID,
      languageCode: "en",
      languageLabel: "English (generated locally)",
      kind: "asr",
      isDefaultForVideo: true,
    },
    {
      trackId: LOCAL_ARABIC_TRACK_ID,
      languageCode: "ar",
      languageLabel: "العربية (ترجمة محلية)",
      kind: "translated",
      translatedFrom: "en",
      isDefaultForVideo: false,
    },
  ];
}

// Multilingual Whisper uses its translate task as the stable English pivot.
// Arabic is then produced locally from the English timed segments so both
// first-class languages keep the same timestamps without any remote AI API.
export const DEFAULT_STT_PROFILE: SttModelProfile = {
  id: "whisper-tiny-en-pivot",
  modelId: "onnx-community/whisper-tiny",
  trackId: LOCAL_ENGLISH_TRACK_ID,
  trackLabel: "English (generated locally)",
  languageCode: "en",
  inferenceOptions: {
    return_timestamps: true,
    task: "translate",
  },
};
