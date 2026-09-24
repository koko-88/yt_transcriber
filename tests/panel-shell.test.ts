import { afterEach, describe, expect, it, vi } from "vitest";
import { browserStub } from "./setup.js";
import {
  configurePanelAction,
  toggleFirefoxSidebar,
} from "../src/platform/panel.js";
import { panelContextForTab } from "../src/platform/tab-context.js";

afterEach(() => {
  Reflect.deleteProperty(browserStub, "sidePanel");
  Reflect.deleteProperty(browserStub, "sidebarAction");
  vi.clearAllMocks();
});

describe("native product surface", () => {
  it("assigns the Chromium toolbar gesture to the native side panel", async () => {
    const setPanelBehavior = vi.fn(async () => undefined);
    Object.assign(browserStub, { sidePanel: { setPanelBehavior } });

    await configurePanelAction();

    expect(setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    expect(browserStub.windows.create).not.toHaveBeenCalled();
  });

  it("toggles the native Firefox sidebar without a detached window", async () => {
    const toggle = vi.fn(async () => undefined);
    Object.assign(browserStub, { sidebarAction: { toggle } });

    await toggleFirefoxSidebar();

    expect(toggle).toHaveBeenCalledOnce();
    expect(browserStub.windows.create).not.toHaveBeenCalled();
  });

  it("surfaces an unavailable sidebar API instead of opening a popup", async () => {
    await expect(toggleFirefoxSidebar()).rejects.toThrow(/sidebarAction/);
    expect(browserStub.windows.create).not.toHaveBeenCalled();
  });
});

describe("active-tab context", () => {
  it("binds to the active watch video", () => {
    expect(
      panelContextForTab({
        id: 7,
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw&t=32",
        status: "complete",
      }),
    ).toEqual({
      status: "video",
      videoId: "jNQXAC9IVRw",
      tabStatus: "complete",
    });
  });

  it("binds to Shorts without borrowing a different watch tab", () => {
    expect(
      panelContextForTab({
        id: 8,
        url: "https://www.youtube.com/shorts/jNQXAC9IVRw",
      }),
    ).toEqual({ status: "video", videoId: "jNQXAC9IVRw" });
  });

  it("distinguishes no video tab from an unsupported YouTube page", () => {
    expect(panelContextForTab(undefined)).toEqual({
      status: "no-video-tab",
      videoId: null,
    });
    expect(
      panelContextForTab({ id: 9, url: "https://www.youtube.com/" }),
    ).toEqual({ status: "unsupported-page", videoId: null });
  });
});
