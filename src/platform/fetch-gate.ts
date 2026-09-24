// Fetch gate: the ONLY choke point for outbound network calls from extension
// contexts (background, side panel, options page). Enforces Strict Local Mode,
// domain allow-lists, HTTPS-only, and the AbortSignal on every call.

import { z } from 'zod';
import { logger } from '../core/logger.js';

/** Minimal success/failure union for non-throwing control flow. */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export interface FetchPolicy {
  /** Allowed request origin host suffixes. Exact host or subdomain match. */
  allowDomains: string[];
  /** Optional per-domain required headers that callers must not override. */
  forcedHeaders?: Record<string, Record<string, string>>;
  /** Human-readable capability id for audit logging. */
  capability: string;
}

export interface FetchGateDeps {
  isStrictLocalMode: () => Promise<boolean> | boolean;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export type FetchDeniedReason = 'strict-local-mode' | 'domain-not-allowed' | 'https-required' | 'invalid-url';

export interface FetchDenied {
  kind: 'fetch-denied';
  reason: FetchDeniedReason;
  url: string;
  capability: string;
}

const localhostHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLocalhostUrl(url: URL): boolean {
  if (localhostHosts.has(url.hostname)) return true;
  // *.localhost subdomains resolve to loopback per RFC 6761.
  if (url.hostname.endsWith('.localhost')) return true;
  return false;
}

export function isDomainAllowed(url: URL, allowDomains: string[]): boolean {
  const host = url.hostname;
  for (const d of allowDomains) {
    if (isLocalhostUrl(url) && (d === 'localhost' || d.endsWith('.localhost'))) return true;
    if (host === d || host.endsWith(`.${d}`)) return true;
  }
  return false;
}

async function strictLocalActive(deps: FetchGateDeps): Promise<boolean> {
  try {
    return await deps.isStrictLocalMode();
  } catch {
    // Fail closed when settings cannot be read.
    return true;
  }
}

function deny(reason: FetchDeniedReason, url: string, capability: string): Result<Response, FetchDenied> {
  logger.info('network', 'fetch denied', { capability, url, reason });
  return err({ kind: 'fetch-denied', reason, url, capability });
}

/**
 * Performs a fetch under the gate. Returns a Result; network-level exceptions
 * are mapped to kind 'fetch-denied' with reason 'network-error' at the caller
 * level — here they are thrown so callers keep full control of mapping to
 * typed AppError values.
 */
export async function gatedFetch(
  deps: FetchGateDeps,
  policy: FetchPolicy,
  input: string | URL,
  init?: RequestInit & { signal: AbortSignal },
): Promise<Result<Response, FetchDenied>> {
  let url: URL;
  try {
    url = new URL(String(input));
  } catch {
    return deny('invalid-url', String(input).slice(0, 200), policy.capability);
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhostUrl(url))) {
    return deny('https-required', url.toString(), policy.capability);
  }

  if (await strictLocalActive(deps)) {
    if (!isLocalhostUrl(url)) {
      return deny('strict-local-mode', url.toString(), policy.capability);
    }
  }

  if (!isDomainAllowed(url, policy.allowDomains)) {
    return deny('domain-not-allowed', url.toString(), policy.capability);
  }

  const headers = new Headers(init?.headers);
  const forced = policy.forcedHeaders?.[url.hostname];
  if (forced) {
    for (const [k, v] of Object.entries(forced)) headers.set(k, v);
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url.toString(), { ...init, headers, credentials: 'omit' });
    return ok(res);
  } catch (e) {
    logger.error('network', 'fetch failed', { capability: policy.capability, url: url.toString(), error: String(e) });
    throw e;
  }
}

/** Guard against oversized response bodies. Returns text if within limit. */
export async function readBodyWithLimit(res: Response, maxBytes: number): Promise<string | null> {
  const len = res.headers.get('content-length');
  if (len && Number(len) > maxBytes) return null;
  const text = await res.text();
  return text.length > maxBytes ? null : text;
}

// ---- Message channel rate limiting (used on every bus handler) ----

export class RateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly hits = new Map<string, number[]>();

  constructor(windowMs: number, max: number) {
    this.windowMs = windowMs;
    this.max = max;
  }

  allow(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}

export const RateLimitConfigSchema = z.object({
  windowMs: z.number().positive(),
  max: z.number().positive(),
});
