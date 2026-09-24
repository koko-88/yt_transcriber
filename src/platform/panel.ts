// Side panel / popup-window abstraction. Chrome uses the Side Panel API;
// Firefox (MV3, no chrome.sidePanel) falls back to a small popup window.

import { browser } from 'wxt/browser';
import { logger } from '../core/logger.js';

const PANEL_URL = '/sidepanel.html';

const isFirefox =
  typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

/**
 * Open the transcript workbench panel for the given tab/window.
 * Safe to call from the background worker only.
 */
export async function openSidePanel(tabId?: number, windowId?: number): Promise<void> {
  if (!isFirefox) {
    try {
      const sp = (browser as unknown as { sidePanel?: {
        setOptions: (o: { tabId?: number; path: string; enabled: boolean }) => Promise<void>;
        open: (o: { tabId?: number; windowId?: number }) => Promise<void>;
      } }).sidePanel;
      if (!sp) throw new Error('sidePanel API unavailable');
      if (tabId != null) {
        await sp.setOptions({ tabId, path: PANEL_URL, enabled: true });
        await sp.open({ tabId });
      } else if (windowId != null) {
        await sp.open({ windowId });
      }
      return;
    } catch (e) {
      logger.warn('panel', 'sidePanel API failed, falling back to window', { error: String(e) });
    }
  }

  // Firefox / fallback path: popup window
  const url = (browser.runtime.getURL as (p: string) => string)(PANEL_URL);
  await browser.windows.create({ url, type: 'popup', width: 420, height: 720 });
}
