// AI run orchestration (background only):
// strict-mode check → consent check → permission ensure → secret → cache → rate limit → call.

import { getSettings, saveSettings } from "../storage/settings.js";
import { getSecret } from "../storage/secrets.js";
import { getDb } from "../storage/db.js";
import { createPermissionManager } from "../platform/permissions.js";
import { getRateLimiter } from "../platform/rate-limit.js";
import { AppError } from "../core/errors.js";
import { hashText, segmentsToText } from "../core/hash.js";
import { logger } from "../core/logger.js";
import { getProviderDef } from "./registry.js";

const perms = createPermissionManager();
const encoder = new TextEncoder();
import { PROMPT_VERSION, validateCitations } from "./pipelines.js";
import { runFullVideo, splitTranscript, type Coverage } from "./full-video.js";
import { saveTranscript } from "../storage/transcripts.js";
import { saveAiHistory } from "../storage/ai-history.js";
import { chatCompletion } from "./providers/openai-compat.js";
import { geminiGenerate } from "./providers/gemini.js";
import type { AiRunRequest, AiRunResult } from "./types.js";

export async function recordConsent(providerId: string): Promise<void> {
  const s = await getSettings();
  await saveSettings({ consents: { ...s.consents, [providerId]: Date.now() } });
}

export async function hasConsent(providerId: string): Promise<boolean> {
  const s = await getSettings();
  return s.consents[providerId] != null;
}

async function cacheGet(key: string): Promise<string | null> {
  const db = await getDb();
  const entry = await db.get("aiCache", key);
  return typeof entry?.result === "string" ? entry.result : null;
}

/** Hard cap on cached AI results so the cache cannot grow without bound. */
const MAX_AI_CACHE_ENTRIES = 200;

async function cachePut(key: string, text: string): Promise<void> {
  const db = await getDb();
  await db.put("aiCache", {
    key,
    result: text,
    timestamp: Date.now(),
    sizeBytes: encoder.encode(text).length,
  });
  await pruneAiCache(db);
}

/** Drop the oldest entries once the cap is exceeded. Oldest = lowest key order in 'by-time'. */
async function pruneAiCache(
  db: Awaited<ReturnType<typeof getDb>>,
): Promise<void> {
  const tx = db.transaction("aiCache", "readwrite");
  const total = await tx.store.count();
  if (total <= MAX_AI_CACHE_ENTRIES) {
    await tx.done;
    return;
  }
  let toDelete = total - MAX_AI_CACHE_ENTRIES;
  let cursor = await tx.store.index("by-time").openCursor();
  while (cursor && toDelete > 0) {
    await cursor.delete();
    toDelete--;
    cursor = await cursor.continue();
  }
  await tx.done;
}

/**
 * Run an AI pipeline. Designed to execute in an extension *page* (side panel)
 * rather than the background service worker: Chrome may terminate a SW when a
 * fetch takes >30s to first byte, which is common for local models and long
 * summaries. Secrets stay in extension-origin storage; the panel is a trusted
 * extension context.
 */
export async function runAi(
  req: AiRunRequest,
  consentGiven = false,
  signal?: AbortSignal,
  progress?: (coverage: Coverage) => void,
): Promise<AiRunResult> {
  try {
    const def = getProviderDef(req.providerId);
    if (!def)
      throw new AppError({
        code: "AI_MODEL",
        message: `Unknown provider: ${req.providerId}`,
      });

    const settings = await getSettings();
    if (settings.strictMode && !def.isLocal) {
      throw new AppError({
        code: "AI_BLOCKED_STRICT",
        message: "Strict Local Mode blocks remote AI providers",
        retryable: false,
        userMessageKey: "errors.AI_BLOCKED_STRICT",
      });
    }

    if (!consentGiven && !settings.consents[def.id]) {
      return {
        ok: false,
        errorCode: "AI_CONSENT_REQUIRED",
        errorMessage: "consent-required",
        retryable: false,
      };
    }
    if (consentGiven) await recordConsent(def.id);

    const granted = await perms.hasHostPermission(def.baseUrl);
    if (!granted) {
      return {
        ok: false,
        errorCode: "AI_PERMISSION_DENIED",
        errorMessage: "permission-denied",
        retryable: false,
      };
    }

    const secret = await getSecret(def.id);
    if (def.requiresKey && !secret) {
      return {
        ok: false,
        errorCode: "AI_NO_KEY",
        errorMessage: "no-api-key",
        retryable: false,
      };
    }

    const transcript = req.transcript;
    if (!transcript) {
      return {
        ok: false,
        errorCode: "AI_NO_TRANSCRIPT",
        errorMessage: "transcript-not-found",
      };
    }

    const tHash = hashText(segmentsToText(transcript.segments));
    const cacheKey = `${tHash}:${req.pipeline}:${def.id}:${req.model}:${PROMPT_VERSION}:${req.question ?? ""}`;

    const cached = await cacheGet(cacheKey);
    const fn = def.kind === "gemini" ? geminiGenerate : chatCompletion;
    const call = async (messages: import("./types.js").ChatMessage[]) => {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const latest = await getSettings();
      if ((latest.strictMode && !def.isLocal) || !latest.consents[def.id])
        throw new AppError({
          code: "AI_BLOCKED_STRICT",
          message: "AI permission changed",
        });
      await getRateLimiter(def.id).acquire();
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      return fn({
        baseUrl: def.baseUrl,
        model: req.model,
        messages,
        secret: secret!,
        maxTokens: 1600,
        ...(signal ? { signal } : {}),
      });
    };
    const count =
      req.pipeline === "qa" ? 1 : splitTranscript(transcript).length;
    const completed = cached
      ? { text: cached, coverage: { processed: count, total: count } }
      : await runFullVideo(
          req.pipeline,
          transcript,
          req.question,
          call,
          signal,
          progress,
        );
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const grounded = validateCitations(completed.text, transcript.segments, 0);
    const text = grounded.text;
    if (!cached) await cachePut(cacheKey, text);
    await saveTranscript(transcript);
    const historyId = crypto.randomUUID();
    await saveAiHistory({
      id: historyId,
      videoId: transcript.video.videoId,
      transcriptId: transcript.id,
      transcriptHash: tHash,
      pipeline: req.pipeline,
      ...(req.question ? { question: req.question } : {}),
      provider: def.label,
      model: req.model,
      text,
      createdAt: Date.now(),
      coverage: completed.coverage,
      citations: grounded.valid,
    });
    logger.info("ai", "pipeline completed", {
      pipeline: req.pipeline,
      provider: def.id,
      model: req.model,
      chars: text.length,
    });
    return {
      ok: true,
      text,
      provider: def.label,
      model: req.model,
      coverage: completed.coverage,
      historyId,
    };
  } catch (err) {
    if (signal?.aborted) {
      return {
        ok: false,
        errorCode: "AI_CANCELLED",
        errorMessage: "cancelled",
        retryable: false,
      };
    }
    const e =
      err instanceof AppError
        ? err
        : new AppError({
            code: "AI_NETWORK",
            message: String(err),
            retryable: true,
          });
    logger.warn("ai", "pipeline failed", { code: e.code, message: e.message });
    return {
      ok: false,
      errorCode: e.code,
      errorMessage: e.message,
      retryable: e.retryable,
    };
  }
}

/** Quick connection test: tiny completion. */
export async function testAi(
  providerId: string,
  model: string,
): Promise<AiRunResult> {
  const def = getProviderDef(providerId);
  if (!def)
    return {
      ok: false,
      errorCode: "AI_MODEL",
      errorMessage: "unknown-provider",
    };
  try {
    const granted = await perms.hasHostPermission(def.baseUrl);
    if (!granted)
      return {
        ok: false,
        errorCode: "AI_PERMISSION_DENIED",
        errorMessage: "permission-denied",
      };
    const secret = await getSecret(def.id);
    if (def.requiresKey && !secret)
      return { ok: false, errorCode: "AI_NO_KEY", errorMessage: "no-api-key" };
    const fn = def.kind === "gemini" ? geminiGenerate : chatCompletion;
    await fn({
      baseUrl: def.baseUrl,
      model,
      messages: [{ role: "user", content: "Reply with the word: ok" }],
      secret: secret!,
      maxTokens: 8,
    });
    return { ok: true, provider: def.label, model };
  } catch (err) {
    const e =
      err instanceof AppError
        ? err
        : new AppError({
            code: "AI_NETWORK",
            message: String(err),
            retryable: true,
          });
    return {
      ok: false,
      errorCode: e.code,
      errorMessage: e.message,
      retryable: e.retryable,
    };
  }
}
