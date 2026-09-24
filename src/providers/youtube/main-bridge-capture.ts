// MAIN-world timedtext capture hooks. Observes the player's OWN fetch/XHR
// responses for /api/timedtext and forwards them to the ISOLATED world.
// Never constructs requests itself.

import type { BridgeEvent } from './bridge-protocol.js';
import { BRIDGE_NS } from './bridge-protocol.js';

export type CapturePost = (msg: BridgeEvent) => void;

let captureInstalled = false;
let origFetch: typeof window.fetch | null = null;
let origXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
let origXhrSend: typeof XMLHttpRequest.prototype.send | null = null;

export function installCapture(post: CapturePost, getNonce: () => string | null): void {
  if (captureInstalled) return;
  captureInstalled = true;

  origFetch = window.fetch;
  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    const raw = args[0];
    const url = typeof raw === 'string' ? raw : raw instanceof Request ? raw.url : '';
    const promise = (origFetch as typeof fetch).apply(this as never, args);
    const nonce = getNonce();
    if (url.includes('/api/timedtext') && nonce) {
      promise
        .then((res) => {
          try {
            const contentType = res.headers.get('content-type') ?? undefined;
            void res
              .clone()
              .text()
              .then((body) => {
                const payload: { url: string; status: number; body: string; contentType?: string } = {
                  url: url.slice(0, 4096),
                  status: res.status,
                  body: body.length > 30_000_000 ? '' : body,
                };
                if (contentType) payload.contentType = contentType.slice(0, 200);
                post({ ns: BRIDGE_NS, dir: 'evt', nonce, kind: 'timedtext-response', payload });
              })
              .catch(() => undefined);
          } catch {
            /* clone unsupported; skip */
          }
        })
        .catch(() => undefined);
    }
    return promise;
  };

  type TtXhr = XMLHttpRequest & { __yttTt?: string };
  origXhrOpen = XMLHttpRequest.prototype.open;
  origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: TtXhr, method: string, url: string | URL, ...rest: unknown[]) {
    const u = String(url);
    if (u.includes('/api/timedtext')) this.__yttTt = u.slice(0, 4096);
    else delete this.__yttTt;
    return (origXhrOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: TtXhr, ...args: unknown[]) {
    const tt = this.__yttTt;
    const nonce = getNonce();
    if (tt && nonce) {
      this.addEventListener('load', () => {
        try {
          post({
            ns: BRIDGE_NS,
            dir: 'evt',
            nonce,
            kind: 'timedtext-response',
            payload: { url: tt, status: this.status, body: (this.responseText ?? '').slice(0, 30_000_000) },
          });
        } catch {
          /* ignore */
        }
      });
    }
    return (origXhrSend as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.send;
}

export function uninstallCapture(): void {
  if (!captureInstalled) return;
  captureInstalled = false;
  if (origFetch) window.fetch = origFetch;
  if (origXhrOpen) XMLHttpRequest.prototype.open = origXhrOpen;
  if (origXhrSend) XMLHttpRequest.prototype.send = origXhrSend;
  origFetch = null;
  origXhrOpen = null;
  origXhrSend = null;
}
