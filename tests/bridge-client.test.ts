import { describe, expect, it, vi } from "vitest";
import { createBridgeClient } from "../src/providers/youtube/bridge-client";
import type { BridgeRequest } from "../src/providers/youtube/bridge-protocol";

describe("MAIN bridge void acknowledgements", () => {
  it("accepts successful operations with no response data", async () => {
    vi.stubGlobal("location", { origin: "https://www.youtube.com" });
    let listener: ((event: MessageEvent) => void) | undefined;
    const win = {
      addEventListener: (_kind: string, cb: (event: MessageEvent) => void) => { listener = cb; },
      removeEventListener: () => {},
      postMessage: (request: BridgeRequest) => {
        queueMicrotask(() => listener?.({
          source: win,
          data: {
            ns: request.ns,
            dir: "res",
            nonce: request.nonce,
            reqId: request.reqId,
            op: request.op,
            ok: true,
            ...(request.op === "hello" ? { data: { ready: true } } : {}),
          },
        } as MessageEvent));
      },
    };
    const bridge = createBridgeClient(win as unknown as Window);
    await bridge.hello();
    await expect(bridge.startCapture()).resolves.toBeUndefined();
    await expect(bridge.enableTrack({ languageCode: "en" })).resolves.toBeUndefined();
    await expect(bridge.restorePlayback()).resolves.toBeUndefined();
    await expect(bridge.stopCapture()).resolves.toBeUndefined();
    bridge.destroy();
    vi.unstubAllGlobals();
  });
});
