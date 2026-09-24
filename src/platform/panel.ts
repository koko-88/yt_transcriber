// Native browser companion surfaces. Chrome/Brave own the action-to-side-panel
// gesture; Firefox toggles its sidebar directly from the toolbar click.

import { browser } from "wxt/browser";

interface ChromeSidePanel {
  setPanelBehavior: (behavior: {
    openPanelOnActionClick: boolean;
  }) => Promise<void>;
}

interface FirefoxSidebar {
  toggle: () => Promise<void>;
}

export function configurePanelAction(): Promise<void> {
  const panel = (browser as unknown as { sidePanel?: ChromeSidePanel })
    .sidePanel;
  if (!panel) return Promise.resolve();
  return panel.setPanelBehavior({ openPanelOnActionClick: true });
}

export function toggleFirefoxSidebar(): Promise<void> {
  const sidebar = (browser as unknown as { sidebarAction?: FirefoxSidebar })
    .sidebarAction;
  if (!sidebar) {
    return Promise.reject(new Error("Firefox sidebarAction API unavailable"));
  }
  // No awaited tab lookup here: sidebarAction.toggle requires the click gesture.
  return sidebar.toggle();
}
