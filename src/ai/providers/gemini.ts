// Google Gemini generateContent client.

import { gatedFetch } from '../../platform/network.js';
import { AppError } from '../../core/errors.js';
import type { Secret } from '../../core/secret.js';
import type { ChatMessage } from '../types.js';
import { mapHttpError } from './openai-compat.js';
import { z } from 'zod';

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
}): Promise<string> {
  const system = opts.messages.find((m) => m.role === 'system')?.content;
  const user = opts.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n\n');

  const url = `${opts.baseUrl}/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.secret.expose())}`;
  const res = await gatedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: user }] }],
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { maxOutputTokens: opts.maxTokens ?? 2048, temperature: 0.3 },
    }),
    timeoutMs: 120_000,
  });

  if (!res.ok) {
    throw mapHttpError(res.status, await res.text().catch(() => ''));
  }
  const parsed = GeminiResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new AppError({ code: 'AI_MODEL', message: 'Malformed Gemini response' });
  }
  return parsed.data.candidates[0]!.content.parts.map((p) => p.text).join('');
}
