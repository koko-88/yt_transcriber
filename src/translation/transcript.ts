import { hashText, segmentsToText } from "../core/hash.js";
import {
  makeTranscriptId,
  type Transcript,
  type TranscriptSegment,
} from "../core/model.js";
import {
  generatedLocalTracks,
  LOCAL_ARABIC_TRACK_ID,
} from "../stt/model-profile.js";

/**
 * Build a timestamp-preserving Arabic transcript from the local English pivot.
 * Translation never changes cue timing; only segment text is replaced.
 */
export function buildArabicTranscript(
  english: Transcript,
  translatedTexts: readonly string[],
  acquiredAt = Date.now(),
): Transcript {
  if (translatedTexts.length !== english.segments.length) {
    throw new Error(
      "translated segment count does not match source transcript",
    );
  }
  const segments: TranscriptSegment[] = english.segments.map(
    (segment, index) => ({
      ...segment,
      text: translatedTexts[index]?.trim() || segment.text,
    }),
  );
  const arabicTrack = generatedLocalTracks().find(
    (track) => track.trackId === LOCAL_ARABIC_TRACK_ID,
  );
  if (!arabicTrack) throw new Error("Arabic local track profile missing");
  return {
    ...english,
    id: makeTranscriptId(english.video.videoId, LOCAL_ARABIC_TRACK_ID),
    track: arabicTrack,
    segments,
    source: {
      method: "local-translation",
      format: "stt",
      ...(english.source.completeness
        ? { completeness: english.source.completeness }
        : {}),
    },
    acquiredAt,
    textHash: hashText(segmentsToText(segments)),
  };
}
