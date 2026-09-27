import { browser } from "wxt/browser";
import type { AudioSource } from "../../providers/youtube/audio-source.js";
import {
  readCheckpoint,
  saveCheckpoint,
  deleteCheckpoint,
  checkpointProfileKey,
  checkpointStatus,
} from "../../storage/stt-checkpoints.js";
import type { TranscriptSegment } from "../../core/model.js";
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
  type SttModelProfile,
} from "../../stt/model-profile.js";

type Phase =
  "idle" | "preparing" | "transcribing" | "ready" | "error" | "cancelled";
interface Status {
  videoId: string | null;
  phase: Phase;
  progress: number;
  error?: string;
  transcript?: Transcript;
  partialSegments?: TranscriptSegment[];
  checkpointAvailable?: boolean;
}
let status: Status = { videoId: null, phase: "idle", progress: 0 };
let controller: AbortController | null = null;
let worker: Worker | null = null;
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
  if (status.phase === "preparing" || status.phase === "transcribing")
    publish({
      ...status,
      videoId: status.videoId,
      phase: "cancelled",
      progress: status.progress,
    });
}

function waitWorker(
  message: unknown,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const current = worker;
  if (!current) return Promise.reject(new Error("STT worker closed"));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      current.removeEventListener("message", onMessage);
      current.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onMessage = (event: MessageEvent<Record<string, unknown>>) => {
      if (event.data.type === "model-progress") {
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
    const init = await waitWorker(
      {
        type: "init",
        wasmUrl: new URL("ort/", location.origin).toString(),
        profile,
      },
      signal,
    );
    if (init.type !== "ready") throw new Error("STT model did not initialize");
    const normalizer = new TranscriptNormalizer(checkpoint?.state);
    let decodedEndSeconds = checkpoint?.endSeconds ?? 0;
    let mediaDurationSeconds: number | null = null;
    for await (const window of readPcmWindows(source, signal)) {
      if (signal.aborted || generation !== jobGeneration) return;
      // Decode with the existing range pipeline; skip already recognized windows.
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
      const result = await waitWorker(
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
          ? Math.min(0.99, 0.1 + (0.9 * decodedEndSeconds) / total)
          : 0.1,
      });
    }
    if (signal.aborted || generation !== jobGeneration) return;
    const segments = normalizer.finish();
    if (!segments.length)
      throw new Error("Speech model returned no transcript");
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
    const transcript: Transcript = {
      id: makeTranscriptId(source.videoId, profile.trackId),
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      video: source.metadata,
      track: {
        trackId: profile.trackId,
        languageCode: "und",
        languageLabel: profile.trackLabel,
        kind: "asr",
        isDefaultForVideo: true,
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
    await saveTranscript(transcript);
    await deleteCheckpoint(source.videoId);
    if (!signal.aborted && generation === jobGeneration)
      publish({
        videoId: source.videoId,
        phase: "ready",
        progress: 1,
        transcript,
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
