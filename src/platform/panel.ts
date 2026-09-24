// Side panel / popup-window abstraction. Chromium browsers expose the Side
// Panel API; Firefox (MV2 sidebar_action) and browsers without it fall back to
// a small popup window.

import { browser } from "wxt/browser";
import { logger } from "../core/logger.js";

const PANEL_URL = "/sidepanel.html";

interface SidePanelApi {
  setOptions: (o: {
    tabId?: number;
    path: string;
    enabled: boolean;
  }) => Promise<void>;
  open: (o: { tabId?: number; windowId?: number }) => Promise<void>;
}

function getSidePanelApi(): SidePanelApi | null {
  return (browser as unknown as { sidePanel?: SidePanelApi }).sidePanel ?? null;
}

/**
 * Open the transcript workbench panel for the given tab/window.
 * Safe to call from the background worker only.
 */
export async function openSidePanel(
  tabId?: number,
  windowId?: number,
): Promise<void> {
  const sp = getSidePanelApi();
  if (sp) {
    try {
      if (tabId != null) {
        await sp.setOptions({ tabId, path: PANEL_URL, enabled: true });
        await sp.open({ tabId });
      } else if (windowId != null) {
        await sp.open({ windowId });
      }
      return;
    } catch (e) {
      logger.warn("panel", "sidePanel API failed, falling back to window", {
        error: String(e),
      });
    }
  }

  // Firefox / fallback path: popup window
  const url = (browser.runtime.getURL as (p: string) => string)(PANEL_URL);
  await browser.windows.create({ url, type: "popup", width: 420, height: 720 });
}
