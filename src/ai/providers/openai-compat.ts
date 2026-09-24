// OpenAI-compatible chat completions client (OpenAI, OpenRouter, Groq,
// Mistral, Ollama, LM Studio). Called from trusted extension pages (side panel).

import { gatedFetch, readJsonBounded } from "../../platform/network.js";
import { AppError } from "../../core/errors.js";
import type { Secret } from "../../core/secret.js";
import type { ChatMessage } from "../types.js";
import { z } from "zod";

const ChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }).passthrough(),
      }),
    )
    .min(1),
});

export async function chatCompletion(opts: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  secret: Secret | null;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.secret) headers["Authorization"] = `Bearer ${opts.secret.expose()}`;

  const res = await gatedFetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: 0.3,
    }),
    timeoutMs: 180_000,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  if (!res.ok) {
    throw mapHttpError(res.status, await safeBody(res));
  }
  const parsed = ChatResponseSchema.safeParse(await readJsonBounded(res));
  if (!parsed.success) {
    throw new AppError({
      code: "AI_MODEL",
      message: "Malformed provider response",
    });
  }
  const content = parsed.data.choices[0]!.message.content;
  if (!content)
    throw new AppError({
      code: "AI_MODEL",
      message: "Empty provider response",
    });
  return content;
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** Map provider HTTP failures to the AI_* error taxonomy. */
export function mapHttpError(status: number, body: string): AppError {
  switch (status) {
    case 401:
    case 403:
      return new AppError({
        code: "AI_AUTH",
        message: "Provider rejected the API key",
        retryable: false,
      });
    case 429:
      return new AppError({
        code: "AI_RATE_LIMIT",
        message: "Provider rate limit reached — try again later",
        retryable: true,
        userMessageKey: "errors.AI_RATE_LIMIT",
      });
    case 400:
      if (/context|token|length/i.test(body)) {
        return new AppError({
          code: "AI_CONTEXT_TOO_LARGE",
          message: "Transcript too large for this model",
          retryable: false,
        });
      }
      return new AppError({
        code: "AI_MODEL",
        message: `Bad request: ${body}`,
      });
    case 404:
      return new AppError({
        code: "AI_MODEL",
        message: "Model not found — check the model name",
        retryable: false,
      });
    default:
      return new AppError({
        code: "AI_NETWORK",
        message: `Provider error (HTTP ${status})`,
        retryable: status >= 500,
      });
  }
}
