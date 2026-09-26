import { AudioBufferSink, Input, MP4, UrlSource, WEBM } from "mediabunny";
import type { AudioSource } from "../providers/youtube/audio-source.js";
import { safeMediaUrl } from "../providers/youtube/audio-source.js";

// Whisper accepts at most 30 seconds. Each window carries four seconds of
// context from the preceding one; only 21 seconds of new media is retained.
export const WINDOW_SECONDS = 25;
export const OVERLAP_SECONDS = 4;
export const HOP_SECONDS = WINDOW_SECONDS - OVERLAP_SECONDS;
export const STT_SAMPLE_RATE = 16_000;

export interface PcmWindow {
  audio: Float32Array;
  startSeconds: number;
  endSeconds: number;
  isLast: boolean;
  durationSeconds: number | null;
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}

async function resampleMono(pcm: Float32Array, sampleRate: number): Promise<Float32Array> {
  if (sampleRate === STT_SAMPLE_RATE) return pcm;
  const frames = Math.max(1, Math.round(pcm.length * STT_SAMPLE_RATE / sampleRate));
  const context = new OfflineAudioContext(1, frames, STT_SAMPLE_RATE);
  const buffer = context.createBuffer(1, pcm.length, sampleRate);
  buffer.getChannelData(0).set(pcm);
  const node = context.createBufferSource();
  node.buffer = buffer;
  node.connect(context.destination);
  node.start();
  const rendered = await context.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

/** Decode in presentation order, retaining only one bounded PCM window. */
export async function* readPcmWindows(
  source: AudioSource,
  signal: AbortSignal,
): AsyncGenerator<PcmWindow> {
  const url = safeMediaUrl(source.url);
  if (!url) throw new Error("Audio source is outside the allowed YouTube media host");
  const input = new Input({
    formats: [MP4, WEBM],
    source: new UrlSource(url, {
      maxCacheSize: 8 * 1024 * 1024,
      parallelism: 2,
      requestInit: { credentials: "omit" },
      getRetryDelay: (attempt) => attempt < 3 ? Math.min(2 ** attempt, 4) : null,
    }),
  });
  const dispose = () => input.dispose();
  signal.addEventListener("abort", dispose, { once: true });
  try {
    checkAbort(signal);
    const track = await input.getPrimaryAudioTrack();
    if (!track || !await track.canDecode()) throw new Error("No decodable audio track in the media source");
    const sampleRate = await track.getSampleRate();
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Invalid audio sample rate");
    const durationSeconds = await track.getDurationFromMetadata();
    const windowFrames = Math.round(WINDOW_SECONDS * sampleRate);
    const overlapFrames = Math.round(OVERLAP_SECONDS * sampleRate);
    const hopFrames = windowFrames - overlapFrames;
    let windowStart = 0;
    let writtenEnd = 0;
    let previousEnd = 0;
    const pcm = new Float32Array(windowFrames);
    const sink = new AudioBufferSink(track);

    for await (const { buffer, timestamp } of sink.buffers()) {
      checkAbort(signal);
      if (buffer.sampleRate !== sampleRate) throw new Error("Audio sample rate changed during decode");
      const sampleStart = Math.round(timestamp * sampleRate);
      const sampleEnd = sampleStart + buffer.length;
      const planes = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
        buffer.getChannelData(channel));
      let cursor = Math.max(sampleStart, previousEnd, windowStart, 0);
      while (cursor < sampleEnd) {
        checkAbort(signal);
        if (cursor >= windowStart + windowFrames) {
          const audio = await resampleMono(pcm, sampleRate);
          checkAbort(signal);
          yield { audio, startSeconds: windowStart / sampleRate,
            endSeconds: (windowStart + windowFrames) / sampleRate,
            isLast: false, durationSeconds };
          pcm.copyWithin(0, hopFrames, windowFrames);
          pcm.fill(0, overlapFrames);
          windowStart += hopFrames;
          continue;
        }
        const until = Math.min(sampleEnd, windowStart + windowFrames);
        const offset = cursor - windowStart;
        const sourceOffset = cursor - sampleStart;
        for (let i = 0; i < until - cursor; i++) {
          let value = 0;
          for (const plane of planes) value += plane[sourceOffset + i]!;
          pcm[offset + i] = value / planes.length;
        }
        writtenEnd = Math.max(writtenEnd, until);
        cursor = until;
      }
      previousEnd = Math.max(previousEnd, sampleEnd);
    }
    checkAbort(signal);
    const end = Math.min(writtenEnd, windowStart + windowFrames);
    if (end > windowStart + (windowStart === 0 ? 0 : overlapFrames)) {
      const audio = await resampleMono(pcm.slice(0, end - windowStart), sampleRate);
      checkAbort(signal);
      yield { audio, startSeconds: windowStart / sampleRate, endSeconds: end / sampleRate,
        isLast: true, durationSeconds };
    }
  } finally {
    signal.removeEventListener("abort", dispose);
    input.dispose();
  }
}
