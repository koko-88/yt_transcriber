import { browser } from "wxt/browser";
import type { AudioSource } from "../../providers/youtube/audio-source.js";
import {
  readCheckpoint,
  saveCheckpoint,
  deleteCheckpoint,
  checkpointProfileKey,
  checkpointStatus,
} from "../../storage/stt-checkpoints.js";
import type { TranscriptSegment, TranscriptTrack } from "../../core/model.js";
import type { Transcript } from "../../core/model.js";
import {
  makeTranscriptId,
  TRANSCRIPT_SCHEMA_VERSION,
} from "../../core/model.js";
import { hashText, segmentsToText } from "../../core/hash.js";
import { saveTranscript } from "../../storage/transcripts.js";
import { readPcmWindows } from "../../stt/media-reader.js";
import {
  TranscriptNormalizer,
  type SttCue,
} from "../../stt/transcript-normalizer.js";
import {
  DEFAULT_STT_PROFILE,
  generatedLocalTracks,
  type SttModelProfile,
} from "../../stt/model-profile.js";
import { buildArabicTranscript } from "../../translation/transcript.js";

type Phase =
  | "idle"
  | "preparing"
  | "transcribing"
  | "ready"
  | "error"
  | "cancelled";
interface Status {
  videoId: string | null;
  phase: Phase;
  progress: number;
  error?: string;
  translationError?: string;
  transcript?: Transcript;
  tracks?: TranscriptTrack[];
  partialSegments?: TranscriptSegment[];
  checkpointAvailable?: boolean;
}
let status: Status = { videoId: null, phase: "idle", progress: 0 };
let controller: AbortController | null = null;
let worker: Worker | null = null;
let translationWorker: Worker | null = null;
let generation = 0;

function publish(next: Status): void {
  status = next;
  void browser.runtime
    .sendMessage({ type: "stt.update", payload: next })
    .catch(() => undefined);
}

function cancel(): void {
  generation++;
  controller?.abort();
  controller = null;
  worker?.terminate();
  worker = null;
  translationWorker?.terminate();
  translationWorker = null;
  if (status.phase === "preparing" || status.phase === "transcribing")
    publish({
      ...status,
      videoId: status.videoId,
      phase: "cancelled",
      progress: status.progress,
    });
}

function waitOnWorker(
  current: Worker | null,
  message: unknown,
  signal: AbortSignal,
  reportModelProgress = false,
): Promise<Record<string, unknown>> {
  if (!current) return Promise.reject(new Error("Worker closed"));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      current.removeEventListener("message", onMessage);
      current.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onMessage = (event: MessageEvent<Record<string, unknown>>) => {
      if (event.data.type === "model-progress" && reportModelProgress) {
        const p = Number(event.data.progress);
        if (Number.isFinite(p))
          publish({
            ...status,
            videoId: status.videoId,
            phase: status.phase,
            progress: Math.min(0.1, p / 1000),
          });
        return;
      }
      cleanup();
      if (event.data.type === "error")
        reject(new Error(String(event.data.error)));
      else resolve(event.data);
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    current.addEventListener("message", onMessage);
    current.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    current.postMessage(
      message,
      message && typeof message === "object" && "audio" in message
        ? [(message as { audio: Float32Array }).audio.buffer]
        : [],
    );
  });
}

async function translateEnglishToArabic(
  english: Transcript,
  signal: AbortSignal,
  jobGeneration: number,
): Promise<Transcript> {
  translationWorker = new Worker(
    new URL("../../translation/worker.ts", import.meta.url),
    { type: "module" },
  );
  const init = await waitOnWorker(
    translationWorker,
    { type: "init" },
    signal,
  );
  if (init.type !== "ready") throw new Error("Arabic translation model did not initialize");

  const translatedTexts: string[] = new Array(english.segments.length);
  const batchSize = 8;
  for (let start = 0; start < english.segments.length; start += batchSize) {
    if (signal.aborted || generation !== jobGeneration) {
      throw new DOMException("Cancelled", "AbortError");
    }
    const batch = english.segments.slice(start, start + batchSize);
    const result = await waitOnWorker(
      translationWorker,
      { type: "translate", texts: batch.map((segment) => segment.text) },
      signal,
    );
    const texts = Array.isArray(result.texts)
      ? result.texts.map((text) => String(text))
      : [];
    if (texts.length !== batch.length) {
      throw new Error("Arabic translation returned an unexpected segment count");
    }
    for (let index = 0; index < texts.length; index++) {
      translatedTexts[start + index] = texts[index]!;
    }
    publish({
      ...status,
      videoId: english.video.videoId,
      phase: "transcribing",
      transcript: english,
      tracks: [english.track],
      progress: Math.min(
        0.995,
        0.95 + 0.045 * Math.min(1, (start + batch.length) / english.segments.length),
      ),
    });
  }
  return buildArabicTranscript(english, translatedTexts);
}

async function run(
  source: AudioSource,
  signal: AbortSignal,
  jobGeneration: number,
  profile: SttModelProfile,
): Promise<void> {
  try {
    const checkpoint = await readCheckpoint(
      source.videoId,
      profile,
      source.metadata.durationMs,
    );
    if (signal.aborted || generation !== jobGeneration) return;
    publish({
      videoId: source.videoId,
      phase: "preparing",
      progress: 0,
      partialSegments: checkpoint?.preview ?? [],
      checkpointAvailable: !!checkpoint,
    });
    worker = new Worker(new URL("../../stt/worker.ts", import.meta.url), {
      type: "module",
    });
    const init = await waitOnWorker(
      worker,
      {
        type: "init",
        wasmUrl: new URL("ort/", location.origin).toString(),
        profile,
      },
      signal,
      true,
    );
    if (init.type !== "ready") throw new Error("STT model did not initialize");
    const normalizer = new TranscriptNormalizer(checkpoint?.state);
    let decodedEndSeconds = checkpoint?.endSeconds ?? 0;
    let mediaDurationSeconds: number | null = null;
    for await (const window of readPcmWindows(source, signal)) {
      if (signal.aborted || generation !== jobGeneration) return;
      if (checkpoint && window.endSeconds <= checkpoint.endSeconds) continue;
      if (
        source.tabId == null ||
        !(await browser.runtime.sendMessage({
          target: "stt-guard",
          type: "current",
          tabId: source.tabId,
          videoId: source.videoId,
        }))
      ) {
        cancel();
        return;
      }
      const result = await waitOnWorker(
        worker,
        { type: "chunk", audio: window.audio },
        signal,
      );
      const output = result.result as { text?: string; chunks?: SttCue[] };
      const cues = output.chunks?.length
        ? output.chunks
        : [
            {
              text: output.text ?? "",
              timestamp: [0, window.endSeconds - window.startSeconds],
            } satisfies SttCue,
          ];
      if (signal.aborted || generation !== jobGeneration) return;
      normalizer.addWindow(window, cues);
      const preview = normalizer.preview();
      await saveCheckpoint({
        videoId: source.videoId,
        profileKey: checkpointProfileKey(profile),
        durationMs:
          source.metadata.durationMs ??
          (window.durationSeconds == null
            ? null
            : window.durationSeconds * 1000),
        endSeconds: window.endSeconds,
        state: normalizer.snapshot(),
        preview,
        updatedAt: Date.now(),
      });
      if (signal.aborted || generation !== jobGeneration) return;
      decodedEndSeconds = window.endSeconds;
      mediaDurationSeconds = window.durationSeconds;
      const total =
        mediaDurationSeconds ??
        (source.metadata.durationMs ? source.metadata.durationMs / 1000 : null);
      publish({
        videoId: source.videoId,
        phase: "transcribing",
        partialSegments: preview,
        checkpointAvailable: true,
        progress: total
          ? Math.min(0.94, 0.1 + (0.84 * decodedEndSeconds) / total)
          : 0.1,
      });
    }
    if (signal.aborted || generation !== jobGeneration) return;
    const segments = normalizer.finish();
    if (!segments.length) throw new Error("Speech model returned no transcript");
    if (
      source.tabId == null ||
      !(await browser.runtime.sendMessage({
        target: "stt-guard",
        type: "current",
        tabId: source.tabId,
        videoId: source.videoId,
      }))
    )
      return;

    const englishTrack = generatedLocalTracks()[0]!;
    const englishTranscript: Transcript = {
      id: makeTranscriptId(source.videoId, profile.trackId),
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      video: source.metadata,
      track: {
        ...englishTrack,
        trackId: profile.trackId,
        languageCode: profile.languageCode,
        languageLabel: profile.trackLabel,
      },
      segments,
      source: {
        method: "local-whisper",
        format: "stt",
        completeness: {
          status: "complete",
          firstCueMs: segments[0]!.startMs,
          lastCueEndMs: segments.at(-1)!.endMs,
          videoDurationMs: Math.round(decodedEndSeconds * 1000),
        },
      },
      acquiredAt: Date.now(),
      textHash: hashText(segmentsToText(segments)),
    };
    await saveTranscript(englishTranscript);

    let tracks: TranscriptTrack[] = [englishTranscript.track];
    let translationError: string | undefined;
    try {
      const arabicTranscript = await translateEnglishToArabic(
        englishTranscript,
        signal,
        jobGeneration,
      );
      if (signal.aborted || generation !== jobGeneration) return;
      await saveTranscript(arabicTranscript);
      tracks = [englishTranscript.track, arabicTranscript.track];
    } catch (error) {
      if (signal.aborted || generation !== jobGeneration) return;
      translationError =
        "Arabic transcript generation could not complete. English is still available.";
      console.warn("local Arabic translation failed", error);
    }

    await deleteCheckpoint(source.videoId);
    if (!signal.aborted && generation === jobGeneration)
      publish({
        videoId: source.videoId,
        phase: "ready",
        progress: 1,
        transcript: englishTranscript,
        tracks,
        ...(translationError ? { translationError } : {}),
      });
  } catch (error) {
    if (!signal.aborted)
      publish({
        ...status,
        videoId: source.videoId,
        phase: "error",
        progress: status.progress,
        error: error instanceof Error ? error.message : String(error),
      });
  } finally {
    if (generation === jobGeneration) {
      worker?.terminate();
      worker = null;
      translationWorker?.terminate();
      translationWorker = null;
      controller = null;
    }
  }
}

browser.runtime.onMessage.addListener((raw, sender) => {
  const message = raw as {
    target?: string;
    type?: string;
    source?: AudioSource;
    videoId?: string;
    restart?: boolean;
  };
  if (message.target !== "stt-offscreen" || sender.id !== browser.runtime.id)
    return undefined;
  if (message.type === "status") {
    if (status.videoId === message.videoId && status.phase !== "idle")
      return Promise.resolve(status);
    return message.videoId
      ? checkpointStatus(message.videoId, DEFAULT_STT_PROFILE)
      : Promise.resolve(status);
  }
  if (message.type === "cancel") {
    cancel();
    return Promise.resolve(status);
  }
  if (message.type === "start" && message.source) {
    if (
      !message.restart &&
      status.videoId === message.source.videoId &&
      (status.phase === "preparing" ||
        status.phase === "transcribing" ||
        status.phase === "ready")
    )
      return Promise.resolve(status);
    cancel();
    controller = new AbortController();
    const source = message.source;
    publish({ videoId: source.videoId, phase: "preparing", progress: 0 });
    const signal = controller.signal;
    const jobGeneration = generation;
    void (async () => {
      if (message.restart) await deleteCheckpoint(source.videoId);
      if (signal.aborted || jobGeneration !== generation) return;
      await run(source, signal, jobGeneration, DEFAULT_STT_PROFILE);
    })().catch((error) => {
      if (jobGeneration === generation)
        publish({
          videoId: source.videoId,
          phase: "error",
          progress: 0,
          error: String(error),
        });
    });
    return Promise.resolve({
      videoId: message.source.videoId,
      phase: "preparing",
      progress: 0,
    });
  }
  return undefined;
});
