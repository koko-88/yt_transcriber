// Track enumeration and selection for YouTube acquisition.
// Pure functions — unit-testable.

import type { TranscriptTrack, TrackKind } from "../../core/model.js";
import type { BridgeTrack } from "./bridge-protocol.js";

export interface TrackEntry {
  track: TranscriptTrack;
  /** baseUrl from the static player response, if present (session-only). */
  baseUrl?: string | undefined;
  vssId?: string | undefined;
  /** Source kind used when a synthetic translated track points at an ASR source. */
  sourceKind?: Exclude<TrackKind, "translated"> | undefined;
}

function toKind(kind: string | undefined): Exclude<TrackKind, "translated"> {
  if (kind === "asr") return "asr";
  return "manual";
}

function normalizeLang(code: string): string {
  return code.trim().toLowerCase().replace(/_/g, "-");
}

function languageMatches(code: string, target: string): boolean {
  const a = normalizeLang(code);
  const b = normalizeLang(target);
  return a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

function withTranslationTarget(baseUrl: string, target: string): string | null {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("tlang", target);
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Build deduplicated source tracks and verified YouTube translation requests.
 * Arabic and English are first-class targets: when YouTube marks a source track
 * translatable, synthesize the missing counterpart by adding `tlang=` to that
 * source track URL. No remote AI provider is involved.
 */
export function buildTrackEntries(
  bridgeTracks: readonly BridgeTrack[],
): TrackEntry[] {
  const seen = new Set<string>();
  const entries: TrackEntry[] = [];
  const sourceEntries: { entry: TrackEntry; raw: BridgeTrack }[] = [];

  for (const t of bridgeTracks) {
    // Do not trust ad-hoc translated rows from page state; translations below
    // are synthesized from a real source track that YouTube marks translatable.
    if (t.kind === "translated") continue;
    const kind = toKind(t.kind);
    let identity = t.vssId;
    if (!identity && t.baseUrl) {
      try {
        identity = new URL(t.baseUrl).searchParams.get("name") ?? undefined;
      } catch {
        /* the base URL will be rejected by acquisition */
      }
    }
    let trackId = `${t.languageCode}~${kind}${identity ? `~${identity}` : ""}`;
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
      sourceKind: kind,
    };
    if (t.baseUrl) entry.baseUrl = t.baseUrl;
    if (t.vssId) entry.vssId = t.vssId;
    entries.push(entry);
    sourceEntries.push({ entry, raw: t });
  }

  const targets = [
    { code: "en", label: "English" },
    { code: "ar", label: "العربية" },
  ] as const;

  for (const target of targets) {
    if (
      entries.some((e) => languageMatches(e.track.languageCode, target.code))
    ) {
      continue;
    }

    const candidates = sourceEntries.filter(
      ({ entry, raw }) => raw.isTranslatable === true && !!entry.baseUrl,
    );
    if (!candidates.length) continue;

    // Prefer the other first-class language as the translation source, then a
    // manual track, then ASR. This keeps AR<->EN deterministic when both are
    // involved while still supporting videos whose source language is neither.
    const preferredSource = target.code === "ar" ? "en" : "ar";
    const source =
      candidates.find(({ entry }) =>
        languageMatches(entry.track.languageCode, preferredSource),
      ) ??
      candidates.find(({ entry }) => entry.track.kind === "manual") ??
      candidates[0]!;

    const baseUrl = withTranslationTarget(source.entry.baseUrl!, target.code);
    if (!baseUrl) continue;
    let trackId = `translated~${source.entry.track.trackId}~${target.code}`;
    let n = 2;
    while (seen.has(trackId)) {
      trackId = `translated~${source.entry.track.trackId}~${target.code}~${n}`;
      n++;
    }
    seen.add(trackId);
    entries.push({
      track: {
        trackId,
        languageCode: target.code,
        languageLabel: target.label,
        kind: "translated",
        translatedFrom: source.entry.track.languageCode,
        isDefaultForVideo: false,
      },
      baseUrl,
      ...(source.entry.vssId ? { vssId: source.entry.vssId } : {}),
      sourceKind: source.entry.sourceKind,
    });
  }

  return entries;
}

/**
 * Select the preferred track: first preferred-language manual track, then
 * preferred-language ASR, then a translated preferred-language track, then
 * any manual, ASR, translated, or first track.
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
  const translated = entries.filter((e) => e.track.kind === "translated");

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
    byPreference(translated) ??
    byPreference(entries) ??
    manual[0] ??
    asr[0] ??
    translated[0] ??
    entries[0] ??
    null
  );
}
