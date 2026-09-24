// ISOLATED-world bridge client. Talks to the untrusted MAIN-world bridge over
// window.postMessage with a per-session nonce, per-request ids, strict schema
// validation of every inbound payload, and AbortSignal-based timeouts.

import { z } from 'zod';
import {
  BRIDGE_NS,
  BridgeOpSchema,
  PlayerSnapshotSchema,
  TimedTextCaptureSchema,
  type BridgeOp,
  type BridgeRequest,
  type PlayerSnapshot,
  type TimedTextCapture,
} from './bridge-protocol.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

const HelloAckSchema = z.object({ ready: z.literal(true) });

export interface BridgeClient {
  hello(): Promise<void>;
  getPlayerSnapshot(): Promise<PlayerSnapshot>;
  enableTrack(payload: { languageCode: string; kind?: string; vssId?: string }): Promise<void>;
  restorePlayback(): Promise<void>;
  ensurePlaying(): Promise<void>;
  startCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  seek(seconds: number): Promise<void>;
  getPlaybackTime(): Promise<{ timeSeconds: number; playing: boolean }>;
  onTimedText(cb: (capture: TimedTextCapture) => void): () => void;
  destroy(): void;
}

interface PendingReq {
  resolve: (data: unknown) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

function makeNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

const OP_TIMEOUT_MS: Record<BridgeOp, number> = {
  hello: 3000,
  getPlayerSnapshot: 5000,
  enableTrack: 5000,
  disableTrack: 5000,
  restorePlayback: 5000,
  ensurePlaying: 12000,
  startCapture: 3000,
  stopCapture: 3000,
  seek: 3000,
  getPlaybackTime: 3000,
};

export function createBridgeClient(win: Window = window): BridgeClient {
  const nonce = makeNonce();
  let reqCounter = 0;
  const pending = new Map<string, PendingReq>();
  const ttCallbacks = new Set<(c: TimedTextCapture) => void>();
  let destroyed = false;

  function onMessage(ev: MessageEvent): void {
    if (destroyed) return;
    if (ev.source !== win) return;
    const data = ev.data as unknown;
    if (typeof data !== 'object' || data === null) return;
    const m = data as Record<string, unknown>;
    if (m['ns'] !== BRIDGE_NS) return;
    if (m['nonce'] !== nonce) return;

    if (m['dir'] === 'res') {
      const key = `${String(m['op'])}#${String(m['reqId'])}`;
      const p = pending.get(key);
      if (!p) return;
      pending.delete(key);
      clearTimeout(p.timer);
      if (m['ok'] === true) p.resolve(m['data']);
      else p.reject(new AppError({ code: 'ACQ_NO_RESPONSE', message: String(m['error'] ?? 'bridge-error'), retryable: true }));
      return;
    }

    if (m['dir'] === 'evt' && m['kind'] === 'timedtext-response') {
      const parsed = TimedTextCaptureSchema.safeParse(m['payload']);
      if (!parsed.success) {
        logger.warn('bridge', 'dropped malformed timedtext event from MAIN world');
        return;
      }
      for (const cb of ttCallbacks) cb(parsed.data);
    }
  }

  win.addEventListener('message', onMessage);

  function request(op: BridgeOp, payload?: unknown): Promise<unknown> {
    if (destroyed) return Promise.reject(new AppError({ code: 'ACQ_NO_PLAYER', message: 'bridge destroyed' }));
    const reqId = String(++reqCounter);
    const msg: BridgeRequest & { reqId: string } = { ns: BRIDGE_NS, dir: 'req', nonce, op, reqId };
    if (payload !== undefined) msg.payload = payload;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(`${op}#${reqId}`);
        reject(new AppError({ code: 'ACQ_TIMEOUT', message: `bridge op ${op} timed out`, retryable: true }));
      }, OP_TIMEOUT_MS[op]);
      pending.set(`${op}#${reqId}`, { resolve, reject, timer });
      win.postMessage(msg, location.origin);
    });
  }

  async function expect<T>(op: BridgeOp, schema: z.ZodType<T>, payload?: unknown): Promise<T> {
    const raw = await request(op, payload);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      logger.warn('bridge', `schema mismatch on ${op} response — MAIN world untrusted data rejected`);
      throw new AppError({ code: 'ACQ_NO_RESPONSE', message: `bridge ${op} returned malformed data`, retryable: true });
    }
    return parsed.data;
  }

  const emptyOk = z.object({}).passthrough().nullable();

  return {
    async hello() {
      await expect('hello', HelloAckSchema);
    },
    async getPlayerSnapshot() {
      return expect('getPlayerSnapshot', PlayerSnapshotSchema);
    },
    async enableTrack(payload) {
      await expect('enableTrack', emptyOk, payload);
    },
    async restorePlayback() {
      await expect('restorePlayback', emptyOk);
    },
    async ensurePlaying() {
      await expect('ensurePlaying', emptyOk);
    },
    async startCapture() {
      await expect('startCapture', emptyOk);
    },
    async stopCapture() {
      await expect('stopCapture', emptyOk);
    },
    async seek(seconds) {
      await expect('seek', emptyOk, { seconds });
    },
    async getPlaybackTime() {
      return expect('getPlaybackTime', z.object({ timeSeconds: z.number(), playing: z.boolean() }));
    },
    onTimedText(cb) {
      ttCallbacks.add(cb);
      return () => ttCallbacks.delete(cb);
    },
    destroy() {
      destroyed = true;
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new AppError({ code: 'ACQ_NO_PLAYER', message: 'bridge destroyed' }));
      }
      pending.clear();
      ttCallbacks.clear();
      win.removeEventListener('message', onMessage);
    },
  };
}

// BridgeOpSchema re-exported for message validation in tests.
export { BridgeOpSchema };
