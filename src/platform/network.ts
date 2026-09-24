// Network egress gate: all remote fetches go through gatedFetch, which
// validates the URL scheme and enforces a timeout. Called from background only.

export interface GatedFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export async function gatedFetch(url: string, opts: GatedFetchOptions = {}): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    throw new Error(`Blocked non-HTTPS egress to ${u.hostname}`);
  }
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: opts.method ?? 'GET',
      ...(opts.headers ? { headers: opts.headers } : {}),
      ...(opts.body != null ? { body: opts.body } : {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
