// AI run orchestration (background only):
// strict-mode check → consent check → permission ensure → secret → cache → rate limit → call.

import { getSettings, saveSettings } from '../storage/settings.js';
import { getSecret } from '../storage/secrets.js';
import { getTranscript } from '../storage/transcripts.js';
import { getDb } from '../storage/db.js';
import { createPermissionManager } from '../platform/permissions.js';
import { getRateLimiter } from '../platform/rate-limit.js';
import { AppError } from '../core/errors.js';
import { hashText, segmentsToText } from '../core/hash.js';
import { logger } from '../core/logger.js';
import { getProviderDef } from './registry.js';

const perms = createPermissionManager();
const encoder = new TextEncoder();
import { buildMessages, PROMPT_VERSION } from './pipelines.js';
import { chatCompletion } from './providers/openai-compat.js';
import { geminiGenerate } from './providers/gemini.js';
import type { AiRunRequest, AiRunResult } from './types.js';

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
  const entry = await db.get('aiCache', key);
  return typeof entry?.result === 'string' ? entry.result : null;
}

async function cachePut(key: string, transcriptId: string, pipeline: string, text: string): Promise<void> {
  const db = await getDb();
  await db.put('aiCache', { key, result: text, timestamp: Date.now(), sizeBytes: encoder.encode(text).length });
}

export async function runAi(req: AiRunRequest, consentGiven = false): Promise<AiRunResult> {
  try {
    const def = getProviderDef(req.providerId);
    if (!def) throw new AppError({ code: 'AI_MODEL', message: `Unknown provider: ${req.providerId}` });

    const settings = await getSettings();
    if (settings.strictMode && !def.isLocal) {
      throw new AppError({
        code: 'AI_BLOCKED_STRICT',
        message: 'Strict Local Mode blocks remote AI providers',
        retryable: false,
        userMessageKey: 'errors.AI_BLOCKED_STRICT',
      });
    }

    if (!consentGiven && !settings.consents[def.id]) {
      return { ok: false, errorCode: 'AI_CONSENT_REQUIRED', errorMessage: 'consent-required', retryable: false };
    }
    if (consentGiven) await recordConsent(def.id);

    const granted = await perms.hasHostPermission(def.baseUrl);
    if (!granted) {
      return { ok: false, errorCode: 'AI_PERMISSION_DENIED', errorMessage: 'permission-denied', retryable: false };
    }

    const secret = await getSecret(def.id);
    if (def.requiresKey && !secret) {
      return { ok: false, errorCode: 'AI_NO_KEY', errorMessage: 'no-api-key', retryable: false };
    }

    const transcript = await getTranscript(req.transcriptId);
    if (!transcript) {
      return { ok: false, errorCode: 'AI_NO_TRANSCRIPT', errorMessage: 'transcript-not-found' };
    }

    const messages = buildMessages(req.pipeline, transcript, req.question);
    const tHash = hashText(segmentsToText(transcript.segments));
    const cacheKey = `${tHash}:${req.pipeline}:${req.model}:${PROMPT_VERSION}:${req.question ?? ''}`;

    const cached = await cacheGet(cacheKey);
    if (cached) return { ok: true, text: cached, provider: def.label, model: req.model };

    await getRateLimiter(def.id).acquire();

    const fn = def.kind === 'gemini' ? geminiGenerate : chatCompletion;
    const text = await fn({ baseUrl: def.baseUrl, model: req.model, messages, secret: secret! });

    await cachePut(cacheKey, transcript.id, req.pipeline, text);
    logger.info('ai', 'pipeline completed', {
      pipeline: req.pipeline,
      provider: def.id,
      model: req.model,
      chars: text.length,
    });
    return { ok: true, text, provider: def.label, model: req.model };
  } catch (err) {
    const e =
      err instanceof AppError
        ? err
        : new AppError({ code: 'AI_NETWORK', message: String(err), retryable: true });
    logger.warn('ai', 'pipeline failed', { code: e.code, message: e.message });
    return { ok: false, errorCode: e.code, errorMessage: e.message, retryable: e.retryable };
  }
}

/** Quick connection test: tiny completion. */
export async function testAi(providerId: string, model: string): Promise<AiRunResult> {
  const def = getProviderDef(providerId);
  if (!def) return { ok: false, errorCode: 'AI_MODEL', errorMessage: 'unknown-provider' };
  try {
    const granted = await perms.hasHostPermission(def.baseUrl);
    if (!granted) return { ok: false, errorCode: 'AI_PERMISSION_DENIED', errorMessage: 'permission-denied' };
    const secret = await getSecret(def.id);
    if (def.requiresKey && !secret) return { ok: false, errorCode: 'AI_NO_KEY', errorMessage: 'no-api-key' };
    const fn = def.kind === 'gemini' ? geminiGenerate : chatCompletion;
    await fn({
      baseUrl: def.baseUrl,
      model,
      messages: [{ role: 'user', content: 'Reply with the word: ok' }],
      secret: secret!,
      maxTokens: 8,
    });
    return { ok: true, provider: def.label, model };
  } catch (err) {
    const e =
      err instanceof AppError
        ? err
        : new AppError({ code: 'AI_NETWORK', message: String(err), retryable: true });
    return { ok: false, errorCode: e.code, errorMessage: e.message, retryable: e.retryable };
  }
}
