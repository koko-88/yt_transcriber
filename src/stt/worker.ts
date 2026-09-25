import { env, pipeline } from "@huggingface/transformers";

type SpeechPipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<{
  text?: string;
  chunks?: { text: string; timestamp: [number, number | null] }[];
}>;

let transcribe: SpeechPipeline | null = null;

self.onmessage = async (event: MessageEvent<{
  type: "init" | "chunk";
  wasmUrl?: string;
  audio?: Float32Array;
  offsetSeconds?: number;
}>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.backends.onnx.wasm!.numThreads = 1;
      env.backends.onnx.wasm!.wasmPaths = message.wasmUrl!;
      const device = "gpu" in navigator ? "webgpu" : "wasm";
      try {
        transcribe = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny", {
          device,
          progress_callback: (progress: unknown) => {
            const item = progress as { status?: string; progress?: number };
            self.postMessage({ type: "model-progress", status: item.status, progress: item.progress });
          },
        }) as unknown as SpeechPipeline;
      } catch (error) {
        if (device === "wasm") throw error;
        transcribe = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny", {
          device: "wasm",
        }) as unknown as SpeechPipeline;
      }
      self.postMessage({ type: "ready" });
    } else if (message.type === "chunk") {
      if (!transcribe || !message.audio) throw new Error("STT worker is not ready");
      const result = await transcribe(message.audio, { return_timestamps: true, task: "transcribe" });
      self.postMessage({ type: "chunk", offsetSeconds: message.offsetSeconds, result });
    }
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};
