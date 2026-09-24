// Google Gemini generateContent client.

import { gatedFetch, readJsonBounded } from "../../platform/network.js";
import { AppError } from "../../core/errors.js";
import type { Secret } from "../../core/secret.js";
import type { ChatMessage } from "../types.js";
import { mapHttpError } from "./openai-compat.js";
import { z } from "zod";

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ text: z.string() })).min(1),
        }),
      }),
    )
    .min(1),
});

export async function geminiGenerate(opts: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  secret: Secret;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const system = opts.messages.find((m) => m.role === "system")?.content;
  const user = opts.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n\n");

  // API key travels in a header, never the URL: URLs leak into logs, error
  // messages and any thrown fetch error text.
  const url = `${opts.baseUrl}/models/${encodeURIComponent(opts.model)}:generateContent`;
  const res = await gatedFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": opts.secret.expose(),
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: user }] }],
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: {
        maxOutputTokens: opts.maxTokens ?? 2048,
        temperature: 0.3,
      },
    }),
    timeoutMs: 180_000,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  if (!res.ok) {
    throw mapHttpError(res.status, await res.text().catch(() => ""));
  }
  const parsed = GeminiResponseSchema.safeParse(await readJsonBounded(res));
  if (!parsed.success) {
    throw new AppError({
      code: "AI_MODEL",
      message: "Malformed Gemini response",
    });
  }
  return parsed.data.candidates[0]!.content.parts.map((p) => p.text).join("");
}
