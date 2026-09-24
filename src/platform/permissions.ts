// Optional host-permission manager. AI endpoints beyond the static list are
// granted at runtime per-domain via browser.permissions.request(), which must
// be called from a user gesture on an extension page.
//
// Firefox 140+ also exposes optional `data_collection` permissions for the
// built-in AMO consent UX. When the API is present we request websiteContent
// before sending transcript text to any AI provider (local or remote).

export interface PermissionManager {
  ensureHostPermission(url: string): Promise<boolean>;
  hasHostPermission(url: string): Promise<boolean>;
  listGrantedHosts(): Promise<string[]>;
  removeHostPermission(url: string): Promise<boolean>;
}

/** Compute the match pattern for a user-configured endpoint origin. */
export function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

/**
 * On Firefox builds that expose data-collection consent, ensure the user has
 * opted in to transmitting website content (transcript text) to an AI provider.
 * Returns true on Chromium and older Firefox where the API is absent.
 */
export async function ensureWebsiteContentConsent(): Promise<boolean> {
  const perms = browser.permissions;
  try {
    const all = (await perms.getAll()) as {
      origins?: string[];
      permissions?: string[];
      data_collection?: string[];
    };
    if (!("data_collection" in all)) return true;
    if (all.data_collection?.includes("websiteContent")) return true;
    const granted = await perms.request({
      // Firefox-only field; Chromium rejects unknown keys — callers should
      // only reach here after feature-detecting data_collection on getAll().
      data_collection: ["websiteContent"],
    } as Parameters<typeof perms.request>[0]);
    return granted;
  } catch {
    // Chromium or unsupported shape — do not block AI on host consent alone.
    return true;
  }
}

export function createPermissionManager(): PermissionManager {
  const perms = browser.permissions;

  async function ensureHostPermission(url: string): Promise<boolean> {
    const pattern = originPattern(url);
    if (!pattern) return false;
    const already = await perms.contains({ origins: [pattern] });
    if (already) return true;
    // Must be called within a user gesture on an extension page.
    return perms.request({ origins: [pattern] });
  }

  async function hasHostPermission(url: string): Promise<boolean> {
    const pattern = originPattern(url);
    if (!pattern) return false;
    return perms.contains({ origins: [pattern] });
  }

  async function listGrantedHosts(): Promise<string[]> {
    const all = await perms.getAll();
    return all.origins ?? [];
  }

  async function removeHostPermission(url: string): Promise<boolean> {
    const pattern = originPattern(url);
    if (!pattern) return false;
    return perms.remove({ origins: [pattern] });
  }

  return {
    ensureHostPermission,
    hasHostPermission,
    listGrantedHosts,
    removeHostPermission,
  };
}
