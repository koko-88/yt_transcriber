// Track enumeration and selection for YouTube acquisition.
// Pure functions — unit-testable.

import type { TranscriptTrack, TrackKind } from "../../core/model.js";
import type { BridgeTrack } from "./bridge-protocol.js";

export interface TrackEntry {
  track: TranscriptTrack;
  /** baseUrl from the static player response, if present (session-only). */
  baseUrl?: string | undefined;
}

function toKind(kind: string | undefined): TrackKind {
  if (kind === "asr") return "asr";
  if (kind === "translated") return "translated";
  return "manual";
}

/** Build deduplicated TranscriptTrack list with deterministic ids. */
export function buildTrackEntries(
  bridgeTracks: readonly BridgeTrack[],
): TrackEntry[] {
  const seen = new Set<string>();
  const entries: TrackEntry[] = [];
  for (const t of bridgeTracks) {
    const kind = toKind(t.kind);
    let trackId = `${t.languageCode}~${kind}`;
    let n = 2;
    while (seen.has(trackId)) {
      trackId = `${t.languageCode}~${kind}~${n}`;
      n++;
    }
    seen.add(trackId);
    const entry: TrackEntry = {
      track: {
        trackId,
        languageCode: t.languageCode,
        languageLabel: t.label ?? t.languageCode,
        kind,
        isDefaultForVideo: entries.length === 0,
      },
    };
    if (t.baseUrl) entry.baseUrl = t.baseUrl;
    entries.push(entry);
  }
  return entries;
}

/**
 * Select the preferred track: first preferred-language manual track, then
 * preferred-language ASR, then any manual, then first track.
 */
export function selectTrack(
  entries: readonly TrackEntry[],
  preferredLangs: readonly string[],
): TrackEntry | null {
  if (entries.length === 0) return null;
  const norm = (l: string) => l.toLowerCase();
  const prefs = preferredLangs.map(norm);

  const matches = (e: TrackEntry): number => {
    const lang = norm(e.track.languageCode);
    const idx = prefs.findIndex(
      (p) => lang === p || lang.startsWith(`${p}-`) || p.startsWith(`${lang}-`),
    );
    return idx === -1 ? Infinity : idx;
  };

  const manual = entries.filter((e) => e.track.kind === "manual");
  const asr = entries.filter((e) => e.track.kind === "asr");

  const byPreference = (list: readonly TrackEntry[]): TrackEntry | null => {
    let best: TrackEntry | null = null;
    let bestScore = Infinity;
    for (const e of list) {
      const s = matches(e);
      if (s < bestScore) {
        best = e;
        bestScore = s;
      }
    }
    return bestScore === Infinity ? null : best;
  };

  return (
    byPreference(manual) ??
    byPreference(asr) ??
    byPreference(entries) ??
    manual[0] ??
    asr[0] ??
    entries[0] ??
    null
  );
}
