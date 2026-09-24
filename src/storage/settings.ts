import { browser } from "wxt/browser";
import { z } from "zod";
import { logger } from "@/core/logger";
import type { Locale } from "@/core/i18n";

export interface AppSettings {
  settingsVersion: number;
  theme: "light" | "dark" | "system";
  locale: Locale | "system";
  strictMode: boolean;
  inPlayerButton: boolean;
  aiProvider: string;
  aiModel: string;
  consents: Record<string, number>;
}

// D19b is a product-owner decision. V1 currently defaults to open, while the
// setting remains available so users can enforce local-only AI immediately.
export const DEFAULT_SETTINGS: AppSettings = {
  settingsVersion: 1,
  theme: "system",
  locale: "system",
  strictMode: false,
  inPlayerButton: false,
  aiProvider: "openai",
  aiModel: "gpt-4o-mini",
  consents: {},
};

const SETTINGS_KEY = "yt_workbench_settings";

const SettingsSchema = z
  .object({
    settingsVersion: z.number().int().positive(),
    theme: z.enum(["light", "dark", "system"]),
    locale: z.enum(["system", "en", "ar"]),
    strictMode: z.boolean(),
    inPlayerButton: z.boolean(),
    aiProvider: z.string().max(64),
    aiModel: z.string().max(200),
    consents: z.record(z.string().max(64), z.number()),
  })
  .strict();

/** Runtime validation for settings patches crossing the message boundary. */
export const SettingsPatchSchema = SettingsSchema.partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export async function getSettings(): Promise<AppSettings> {
  try {
    const data = await browser.storage.local.get(SETTINGS_KEY);
    if (data[SETTINGS_KEY]) {
      const parsed = SettingsSchema.safeParse(data[SETTINGS_KEY]);
      if (!parsed.success) {
        logger.warn(
          "storage",
          "stored settings failed validation, using defaults",
        );
        return DEFAULT_SETTINGS;
      }
      return parsed.data;
    }
    return DEFAULT_SETTINGS;
  } catch (err: unknown) {
    logger.error("storage", "Failed to read settings", {
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(
  settings: SettingsPatch,
): Promise<AppSettings> {
  try {
    const current = await getSettings();
    const merged = { ...current, ...settings };
    const updated = SettingsSchema.parse(merged);
    await browser.storage.local.set({ [SETTINGS_KEY]: updated });
    return updated;
  } catch (err: unknown) {
    logger.error("storage", "Failed to save settings", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
