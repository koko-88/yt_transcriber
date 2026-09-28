import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/opus-mt-en-ar";

type TranslationResult =
  | { translation_text?: string; generated_text?: string }
  | { translation_text?: string; generated_text?: string }[];
type TranslationPipeline = (
  input: string | string[],
) => Promise<TranslationResult | TranslationResult[]>;

let translate: TranslationPipeline | null = null;

function outputText(value: unknown): string {
  if (Array.isArray(value)) return outputText(value[0]);
  if (!value || typeof value !== "object") return "";
  const item = value as {
    translation_text?: unknown;
    generated_text?: unknown;
  };
  if (typeof item.translation_text === "string") return item.translation_text;
  if (typeof item.generated_text === "string") return item.generated_text;
  return "";
}

self.onmessage = async (
  event: MessageEvent<{
    type: "init" | "translate";
    texts?: string[];
  }>,
) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      const device = "gpu" in navigator ? "webgpu" : "wasm";
      try {
        translate = (await pipeline("translation", MODEL_ID, {
          device,
        })) as unknown as TranslationPipeline;
      } catch (error) {
        if (device === "wasm") throw error;
        translate = (await pipeline("translation", MODEL_ID, {
          device: "wasm",
        })) as unknown as TranslationPipeline;
      }
      self.postMessage({ type: "ready" });
      return;
    }

    if (!translate || !message.texts) {
      throw new Error("Translation worker is not ready");
    }
    const inputs = message.texts.map((text) => text.trim());
    const raw = await translate(inputs);
    const rows = Array.isArray(raw) ? raw : [raw];
    const texts = inputs.map((source, index) => outputText(rows[index]) || source);
    self.postMessage({ type: "translated", texts });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
