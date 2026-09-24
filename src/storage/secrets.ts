import { getDb } from "./db";
import { Secret } from "@/core/secret";
import { AppError } from "@/core/errors";
import { logger } from "@/core/logger";
import { browser } from "wxt/browser";

/**
 * Ensures we are not running in a content script.
 * Secrets should only be accessed from the extension background page or side panel.
 */
function assertTrustedContext() {
  // WXT provides browser.runtime.id. Content scripts run in the web page.
  // We can check if we have access to extension-only APIs that content scripts lack,
  // or rely on the messaging boundary. For this function, we just do a basic sanity check.
  if (
    typeof window !== "undefined" &&
    window.location &&
    window.location.hostname === "www.youtube.com"
  ) {
    throw new AppError({
      code: "INTERNAL",
      message:
        "Security Violation: Attempted to access secrets from untrusted content script context",
    });
  }
}

/** Get a secret key for a provider */
export async function getSecret(providerId: string): Promise<Secret | null> {
  assertTrustedContext();

  try {
    // 1. Check session storage first (for session-only keys)
    const sessionData = (await browser.storage.session.get(
      `secret_${providerId}`,
    )) as Record<string, unknown>;
    if (sessionData && sessionData[`secret_${providerId}`]) {
      return Secret.from(sessionData[`secret_${providerId}`] as string);
    }

    // 2. Fallback to IDB
    const db = await getDb();
    const entry = await db.get("secrets", providerId);
    if (entry && entry.key) {
      return Secret.from(entry.key);
    }

    return null;
  } catch (err: unknown) {
    logger.error("storage", "Failed to get secret", {
      providerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Save a secret key.
 * @param sessionOnly If true, stores only in in-memory session storage.
 */
export async function setSecret(
  providerId: string,
  key: string,
  sessionOnly: boolean = false,
): Promise<void> {
  assertTrustedContext();

  try {
    if (!key.trim()) {
      await deleteSecret(providerId);
      return;
    }

    if (sessionOnly) {
      await browser.storage.session.set({ [`secret_${providerId}`]: key });
      // Clear from IDB if it was there
      const db = await getDb();
      await db.delete("secrets", providerId);
    } else {
      // Clear from session if it was there
      await browser.storage.session.remove(`secret_${providerId}`);
      // Save to IDB
      const db = await getDb();
      await db.put("secrets", {
        providerId,
        key,
        updatedAt: Date.now(),
      });
    }
    logger.info("storage", `Secret updated`, { providerId, sessionOnly });
  } catch (err: unknown) {
    logger.error("storage", "Failed to save secret", {
      providerId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AppError({
      code: "STORE_WRITE_FAILED",
      message: "Failed to securely save API key",
      cause: err,
    });
  }
}

/** Delete a secret key */
export async function deleteSecret(providerId: string): Promise<void> {
  assertTrustedContext();

  try {
    await browser.storage.session.remove(`secret_${providerId}`);
    const db = await getDb();
    await db.delete("secrets", providerId);
    logger.info("storage", `Secret deleted`, { providerId });
  } catch (err: unknown) {
    logger.error("storage", "Failed to delete secret", {
      providerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
