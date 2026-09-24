import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { browserStub } from "./setup.js";

describe("runtime message ownership", () => {
  it("does not let an extension page answer a background-only request", async () => {
    const listeners: Array<
      (message: unknown, sender: unknown, sendResponse?: unknown) => unknown
    > = [];
    const original = browserStub.runtime.onMessage.addListener;
    browserStub.runtime.onMessage.addListener = (listener) => {
      listeners.push(listener);
    };
    try {
      vi.resetModules();
      const { MessageBus } = await import("../src/platform/messaging.js");
      const panelBus = new MessageBus();
      panelBus.on("settings.get", z.object({}), ["extension-page"], () => ({
        theme: "light",
      }));
      const listener = listeners.at(-1);
      expect(listener).toBeTruthy();
      const respond = vi.fn();
      const sender = {
        id: browserStub.runtime.id,
        url: "chrome-extension://test-extension-id/sidepanel.html",
      };

      expect(
        listener!({ type: "panel.context", payload: {} }, sender, respond),
      ).toBe(false);
      expect(respond).not.toHaveBeenCalled();

      expect(
        listener!({ type: "settings.get", payload: {} }, sender, respond),
      ).toBe(true);
      await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
      expect(respond).toHaveBeenCalledWith({
        ok: true,
        data: { theme: "light" },
      });
    } finally {
      browserStub.runtime.onMessage.addListener = original;
    }
  });
});
