// Vitest setup: a minimal, mutable stand-in for the WebExtension `browser`
// API so node-environment unit tests can import modules that touch extension
// APIs. Only the surface used by the code under test is implemented.

import { vi } from "vitest";

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse?: unknown,
) => unknown;

const noopEvent = () => ({
  addListener: (_l: Listener) => undefined,
  removeListener: () => undefined,
});

const storageArea = () => {
  const data = new Map<string, unknown>();
  return {
    get: async (key?: string | string[]) => {
      if (key === undefined) return Object.fromEntries(data);
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(
        keys.filter((k) => data.has(k)).map((k) => [k, data.get(k)]),
      );
    },
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    remove: async (key: string | string[]) => {
      for (const k of Array.isArray(key) ? key : [key]) data.delete(k);
    },
  };
};

export const browserStub = {
  runtime: {
    id: "test-extension-id",
    getURL: (path: string) => `chrome-extension://test-extension-id${path}`,
    onMessage: noopEvent(),
    sendMessage: vi.fn(async () => undefined),
  },
  storage: {
    local: storageArea(),
    session: storageArea(),
  },
  tabs: {
    query: vi.fn(async () => []),
    sendMessage: vi.fn(async () => undefined),
  },
  permissions: {
    contains: vi.fn(async () => false),
    request: vi.fn(async () => false),
    remove: vi.fn(async () => false),
    getAll: vi.fn(async () => ({ origins: [] as string[] })),
  },
  action: { onClicked: noopEvent() },
  commands: { onCommand: noopEvent() },
  windows: { create: vi.fn(async () => undefined) },
};

(globalThis as unknown as { browser: typeof browserStub }).browser =
  browserStub;
