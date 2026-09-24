// Background service worker entrypoint.
// Responsibilities: open the side panel (action click / Ctrl+Shift+Y),
// route panel requests to the YouTube content script of the relevant tab,
// and relay content-script notifications to open panel pages.

import { browser } from 'wxt/browser';
import { defineBackground } from '#imports';
import { z } from 'zod';
import { bus } from '../platform/messaging.js';
import { openSidePanel } from '../platform/panel.js';
import { logger } from '../core/logger.js';
import { AppError } from '../core/errors.js';

/** Resolve the tab a panel request should act on: the sender's tab, else the active tab. */
async function resolveTargetTabId(senderTabId: number | undefined): Promise<number> {
  if (senderTabId != null) return senderTabId;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new AppError({ code: 'ACQ_NO_PLAYER', message: 'no active tab' });
  }
  return tab.id;
}

async function forwardToContent<T>(type: string, payload: unknown, senderTabId: number | undefined): Promise<T> {
  const tabId = await resolveTargetTabId(senderTabId);
  return bus.request<T>(type, payload, tabId);
}

export default defineBackground(() => {
  // Open the panel on toolbar click and on the keyboard shortcut.
  browser.action.onClicked.addListener((tab) => {
    openSidePanel(tab.id, tab.windowId).catch((e) => logger.error('background', 'openSidePanel failed', { error: String(e) }));
  });

  browser.commands?.onCommand.addListener((command) => {
    if (command === '_execute_action') {
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => openSidePanel(tab?.id, tab?.windowId));
    }
  });

  // ---- routing: panel -> content script ----

  bus.on('panel.open', z.object({}), ['extension-page'], async (_p, sender) => {
    await openSidePanel(sender.tab?.id, sender.tab?.windowId);
    return { ok: true };
  });

  bus.on('acq.getState', z.object({}), ['extension-page'], (_p, sender) =>
    forwardToContent('acq.getState', {}, sender.tab?.id),
  );

  bus.on('acq.acquire', z.object({ trackId: z.string().optional() }), ['extension-page'], (p, sender) =>
    forwardToContent('acq.acquire', p, sender.tab?.id),
  );

  bus.on('acq.seek', z.object({ timeMs: z.number().int().nonnegative() }), ['extension-page'], (p, sender) =>
    forwardToContent('acq.seek', p, sender.tab?.id),
  );

  bus.on('playback.getTime', z.object({}), ['extension-page'], (_p, sender) =>
    forwardToContent('playback.getTime', {}, sender.tab?.id),
  );

  // ---- relay: content script -> all panel pages ----

  bus.on('page.videoChanged', z.object({ videoId: z.string().nullable() }), ['content-script'], async (p) => {
    browser.runtime.sendMessage({ type: 'panel.videoChanged', payload: p }).catch(() => undefined);
    return { ok: true };
  });

  logger.info('background', 'background worker started');
});
