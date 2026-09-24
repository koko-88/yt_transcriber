// Network egress gate: all remote fetches go through gatedFetch, which
// validates the scheme/host, refuses redirects (so credentials can never
// follow a provider-controlled redirect off the allow-listed origin), omits
// cookies, and enforces a timeout. Called from trusted extension contexts
// (side panel / background) — never from content scripts.

export interface GatedFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Caller abort (e.g. panel closed / user cancel). */
  signal?: AbortSignal;
  /** Injection point for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

export async function gatedFetch(
  url: string,
  opts: GatedFetchOptions = {},
): Promise<Response> {
  const u = new URL(url);
  if (
    u.protocol !== "https:" &&
    !(u.protocol === "http:" && isLoopback(u.hostname))
  ) {
    throw new Error(`Blocked non-HTTPS egress to ${u.hostname}`);
  }
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timer);
      throw new DOMException("Aborted", "AbortError");
    }
    opts.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    return await (opts.fetchImpl ?? fetch)(url, {
      method: opts.method ?? "GET",
      redirect: "error",
      credentials: "omit",
      ...(opts.headers ? { headers: opts.headers } : {}),
      ...(opts.body != null ? { body: opts.body } : {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Maximum size of a provider response body we are willing to buffer. */
export const MAX_PROVIDER_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Read a JSON response body with a hard size cap. Provider responses are
 * untrusted input: an oversized body must not be able to exhaust memory.
 */
export async function readJsonBounded<T = unknown>(res: Response): Promise<T> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_BODY_BYTES) {
    throw new Error("provider response exceeds size cap");
  }
  const text = await res.text();
  if (text.length > MAX_PROVIDER_BODY_BYTES) {
    throw new Error("provider response exceeds size cap");
  }
  return JSON.parse(text) as T;
}
