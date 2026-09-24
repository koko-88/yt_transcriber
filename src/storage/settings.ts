import { browser } from 'wxt/browser';
import { logger } from '@/core/logger';
import type { Locale } from '@/core/i18n';

export interface AppSettings {
  settingsVersion: number;
  theme: 'light' | 'dark' | 'system';
  locale: Locale | 'system';
  strictMode: boolean; // Controls whether non-local AI providers are allowed
  inPlayerButton: boolean; // Show button in YouTube player DOM
  aiProvider: string; // The selected AI provider ID
  aiModel: string; // The selected model string
}

// Product Owner decision D19b fallback placeholder: Defaulting to true (Strict Local Mode ON) 
// for safety until PO explicitly decides, but the architecture implies it should be configurable.
export const DEFAULT_SETTINGS: AppSettings = {
  settingsVersion: 1,
  theme: 'system',
  locale: 'system',
  strictMode: false, // Defaulting to false (Normal mode) as usually extensions want to show features, but can be flipped
  inPlayerButton: false, // Off by default to avoid DOM detection
  aiProvider: 'openai-compatible', // Default generic provider
  aiModel: 'gpt-3.5-turbo',
};

const SETTINGS_KEY = 'yt_workbench_settings';

export async function getSettings(): Promise<AppSettings> {
  try {
    const data = await browser.storage.local.get(SETTINGS_KEY);
    if (data && data[SETTINGS_KEY]) {
      return { ...DEFAULT_SETTINGS, ...data[SETTINGS_KEY] };
    }
    return DEFAULT_SETTINGS;
  } catch (err: any) {
    logger.error('storage', 'Failed to read settings', { error: err.message });
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  try {
    const current = await getSettings();
    const updated = { ...current, ...settings };
    await browser.storage.local.set({ [SETTINGS_KEY]: updated });
    return updated;
  } catch (err: any) {
    logger.error('storage', 'Failed to save settings', { error: err.message });
    throw err;
  }
}
