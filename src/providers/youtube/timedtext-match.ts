// Match an observed timedtext URL to the track we intentionally enabled.
// Rejects unrelated caption responses (wrong lang, wrong kind, translations).

export interface TimedTextMatchTarget {
  languageCode: string;
  videoId?: string;
  baseUrl?: string;
  /** Exact YouTube track id when present on the URL (`vss_id` / `vssId`). */
  vssId?: string | undefined;
  /** "asr" for auto-generated; omit / other for manual. */
  kind?: string | undefined;
  /**
   * When set, the capture must request this translation target
   * (`tlang=`). When unset, rejects URLs that carry any `tlang`.
   */
  translatedTo?: string | undefined;
}

function paramValue(url: string, name: string): string | null {
  try {
    const u = new URL(url, "https://www.youtube.com");
    return u.searchParams.get(name);
  } catch {
    // Fall back for relative / malformed fragments: scan query manually.
    const re = new RegExp(`[?&]${name}=([^&]*)`);
    const m = url.match(re);
    return m ? decodeURIComponent(m[1]!.replace(/\+/g, " ")) : null;
  }
}

function normalizeLang(code: string): string {
  return code.trim().toLowerCase().replace(/_/g, "-");
}

/**
 * Returns true only when the captured timedtext URL is for the intended track.
 * Never accepts "any URL that happens to include lang=".
 */
export function timedTextMatchesTrack(
  url: string,
  target: TimedTextMatchTarget,
): boolean {
  if (!url.includes("/api/timedtext") && !url.includes("/timedtext")) {
    return false;
  }

  if (target.videoId && paramValue(url, "v") !== target.videoId) return false;
  if (target.baseUrl) {
    const baseVideo = paramValue(target.baseUrl, "v");
    if (baseVideo && paramValue(url, "v") !== baseVideo) return false;
    const baseName = paramValue(target.baseUrl, "name");
    if (baseName !== paramValue(url, "name")) return false;
  }

  if (target.vssId) {
    const urlVss = paramValue(url, "vss_id") ?? paramValue(url, "vssId");
    // Only enforce when the observed URL carries a vss id; many timedtext
    // responses omit it and rely on lang/name/kind instead.
    if (urlVss != null && urlVss !== target.vssId) return false;
  }

  const lang = paramValue(url, "lang");
  if (!lang) return false;
  if (normalizeLang(lang) !== normalizeLang(target.languageCode)) return false;

  const tlang = paramValue(url, "tlang");
  if (target.translatedTo) {
    if (!tlang) return false;
    if (normalizeLang(tlang) !== normalizeLang(target.translatedTo))
      return false;
  } else if (tlang) {
    // We asked for a source track, not a translation of it.
    return false;
  }

  const kind = paramValue(url, "kind");
  const wantAsr = target.kind === "asr";
  if (wantAsr) {
    if (kind !== "asr") return false;
  } else if (kind === "asr") {
    return false;
  }

  return true;
}
