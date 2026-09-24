// Optional host-permission manager. AI endpoints beyond the static list are
// granted at runtime per-domain via browser.permissions.request(), which must
// be called from a user gesture on an extension page.

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
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
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

  return { ensureHostPermission, hasHostPermission, listGrantedHosts, removeHostPermission };
}
