// Typed window.postMessage protocol between the ISOLATED content script
// (trusted) and the MAIN-world bridge (treated as UNTRUSTED). All payloads
// flowing MAIN -> ISOLATED are validated structurally before use.

import { z } from 'zod';

export const BRIDGE_NS = 'ytt-acq-v1';

export const BridgeOpSchema = z.enum([
  'hello',
  'getPlayerSnapshot',
  'enableTrack',
  'disableTrack',
  'ensurePlaying',
  'restorePlayback',
  'startCapture',
  'stopCapture',
  'seek',
  'getPlaybackTime',
]);
export type BridgeOp = z.infer<typeof BridgeOpSchema>;

export interface BridgeRequest {
  ns: typeof BRIDGE_NS;
  dir: 'req';
  nonce: string;
  reqId: string;
  op: BridgeOp;
  payload?: unknown;
}

export interface BridgeResponse {
  ns: typeof BRIDGE_NS;
  dir: 'res';
  nonce: string;
  reqId: string;
  op: BridgeOp;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export const BridgeEventKindSchema = z.enum(['timedtext-response', 'navigate']);
export type BridgeEventKind = z.infer<typeof BridgeEventKindSchema>;

export interface BridgeEvent {
  ns: typeof BRIDGE_NS;
  dir: 'evt';
  nonce: string;
  kind: BridgeEventKind;
  payload: unknown;
}

// ---- Payload schemas (MAIN -> ISOLATED is untrusted; validate everything) ----

export const BridgeTrackSchema = z.object({
  languageCode: z.string().min(1).max(20),
  label: z.string().max(200).optional(),
  kind: z.string().max(20).optional(),
  vssId: z.string().max(100).optional(),
  baseUrl: z.string().max(4096).optional(),
  isTranslatable: z.boolean().optional(),
});
export type BridgeTrack = z.infer<typeof BridgeTrackSchema>;

export const PlayerSnapshotSchema = z.object({
  videoId: z.string().max(20).nullable(),
  title: z.string().max(1000).nullable(),
  channelName: z.string().max(300).nullable(),
  channelId: z.string().max(100).nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  isLive: z.boolean(),
  isUpcoming: z.boolean(),
  playabilityStatus: z.string().max(100).nullable(),
  playabilityReason: z.string().max(300).nullable(),
  tracks: z.array(BridgeTrackSchema).max(500),
  captionsApiAvailable: z.boolean(),
});
export type PlayerSnapshot = z.infer<typeof PlayerSnapshotSchema>;

export const TimedTextCaptureSchema = z.object({
  url: z.string().max(4096),
  status: z.number().int(),
  body: z.string().max(30_000_000),
  contentType: z.string().max(200).optional(),
});
export type TimedTextCapture = z.infer<typeof TimedTextCaptureSchema>;

export const EnableTrackPayloadSchema = z.object({
  languageCode: z.string().min(1).max(20),
  kind: z.string().max(20).optional(),
  vssId: z.string().max(100).optional(),
});

export function isBridgeMessage(v: unknown): v is BridgeRequest | BridgeResponse | BridgeEvent {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return m['ns'] === BRIDGE_NS && (m['dir'] === 'req' || m['dir'] === 'res' || m['dir'] === 'evt');
}

/** Detect which timedtext wire format a captured body uses. */
export function detectWireFormat(url: string, body: string): 'json3' | 'srv3' | 'vtt' | null {
  if (/[?&]fmt=vtt/.test(url) || body.startsWith('WEBVTT')) return 'vtt';
  const head = body.slice(0, 64).trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return 'json3';
  if (head.startsWith('<')) return 'srv3';
  return null;
}
