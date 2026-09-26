import { browser } from "wxt/browser";
import type { AudioSource } from "../../providers/youtube/audio-source.js";
import type { Transcript } from "../../core/model.js";
import { makeTranscriptId, TRANSCRIPT_SCHEMA_VERSION } from "../../core/model.js";
import { hashText, segmentsToText } from "../../core/hash.js";
import { saveTranscript } from "../../storage/transcripts.js";
import { readPcmWindows } from "../../stt/media-reader.js";
import { TranscriptNormalizer, type SttCue } from "../../stt/transcript-normalizer.js";

type Phase = "idle" | "preparing" | "transcribing" | "ready" | "error" | "cancelled";
interface Status { videoId: string | null; phase: Phase; progress: number; error?: string; transcript?: Transcript }
let status: Status = { videoId: null, phase: "idle", progress: 0 };
let controller: AbortController | null = null;
let worker: Worker | null = null;
let generation = 0;

function publish(next: Status): void {
  status = next;
  void browser.runtime.sendMessage({ type: "stt.update", payload: next }).catch(() => undefined);
}

function cancel(): void {
  generation++;
  controller?.abort();
  controller = null;
  worker?.terminate();
  worker = null;
  if (status.phase === "preparing" || status.phase === "transcribing")
    publish({ videoId: status.videoId, phase: "cancelled", progress: status.progress });
}

function waitWorker(message: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
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
        if (Number.isFinite(p)) publish({ videoId: status.videoId, phase: status.phase, progress: Math.min(0.1, p / 1000) });
        return;
      }
      cleanup();
      if (event.data.type === "error") reject(new Error(String(event.data.error)));
      else resolve(event.data);
    };
    const onError = (event: ErrorEvent) => { cleanup(); reject(new Error(event.message)); };
    const onAbort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    current.addEventListener("message", onMessage);
    current.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    current.postMessage(message, message && typeof message === "object" && "audio" in message
      ? [(message as { audio: Float32Array }).audio.buffer] : []);
  });
}

async function run(source: AudioSource, signal: AbortSignal, jobGeneration: number): Promise<void> {
  try {
    publish({ videoId: source.videoId, phase: "preparing", progress: 0 });
    worker = new Worker(new URL("../../stt/worker.ts", import.meta.url), { type: "module" });
    const init = await waitWorker({ type: "init", wasmUrl: new URL("ort/", location.origin).toString() }, signal);
    if (init.type !== "ready") throw new Error("STT model did not initialize");
    const normalizer = new TranscriptNormalizer();
    let decodedEndSeconds = 0;
    let mediaDurationSeconds: number | null = null;
    for await (const window of readPcmWindows(source, signal)) {
      if (signal.aborted || generation !== jobGeneration) return;
      const result = await waitWorker({ type: "chunk", audio: window.audio }, signal);
      const output = result.result as { text?: string; chunks?: SttCue[] };
      const cues = output.chunks?.length ? output.chunks : [{
        text: output.text ?? "", timestamp: [0, window.endSeconds - window.startSeconds],
      } satisfies SttCue];
      normalizer.addWindow(window, cues);
      decodedEndSeconds = window.endSeconds;
      mediaDurationSeconds = window.durationSeconds;
      const total = mediaDurationSeconds ??
        (source.metadata.durationMs ? source.metadata.durationMs / 1000 : null);
      publish({ videoId: source.videoId, phase: "transcribing",
        progress: total ? Math.min(0.99, 0.1 + 0.9 * decodedEndSeconds / total) : 0.1 });
    }
    if (signal.aborted || generation !== jobGeneration) return;
    const segments = normalizer.finish();
    if (!segments.length) throw new Error("Speech model returned no transcript");
    if (source.tabId == null || !await browser.runtime.sendMessage({
      target: "stt-guard", type: "current", tabId: source.tabId, videoId: source.videoId,
    })) return;
    const transcript: Transcript = {
      id: makeTranscriptId(source.videoId, "local-whisper"),
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      video: source.metadata,
      track: { trackId: "local-whisper", languageCode: "und", languageLabel: "Generated transcription", kind: "asr", isDefaultForVideo: true },
      segments,
      source: { method: "local-whisper", format: "stt", completeness: {
        status: "complete", firstCueMs: segments[0]!.startMs, lastCueEndMs: segments.at(-1)!.endMs,
        videoDurationMs: Math.round(decodedEndSeconds * 1000),
      } },
      acquiredAt: Date.now(),
      textHash: hashText(segmentsToText(segments)),
    };
    await saveTranscript(transcript);
    if (!signal.aborted && generation === jobGeneration)
      publish({ videoId: source.videoId, phase: "ready", progress: 1, transcript });
  } catch (error) {
    if (!signal.aborted) publish({ videoId: source.videoId, phase: "error", progress: status.progress, error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (generation === jobGeneration) {
      worker?.terminate(); worker = null;
      controller = null;
    }
  }
}

browser.runtime.onMessage.addListener((raw, sender) => {
  const message = raw as { target?: string; type?: string; source?: AudioSource };
  if (message.target !== "stt-offscreen" || sender.id !== browser.runtime.id) return undefined;
  if (message.type === "status") return Promise.resolve(status);
  if (message.type === "cancel") { cancel(); return Promise.resolve(status); }
  if (message.type === "start" && message.source) {
    if (status.videoId === message.source.videoId &&
        (status.phase === "preparing" || status.phase === "transcribing" || status.phase === "ready"))
      return Promise.resolve(status);
    cancel();
    controller = new AbortController();
    void run(message.source, controller.signal, generation);
    return Promise.resolve({ videoId: message.source.videoId, phase: "preparing", progress: 0 });
  }
  return undefined;
});
