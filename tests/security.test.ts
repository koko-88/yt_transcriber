// Security regression tests: network gate, settings validation, secret
// handling and untrusted-input boundaries. These encode the guarantees that
// SECURITY.md promises, so a regression fails here rather than shipping.

import { describe, it, expect, vi } from "vitest";
import {
  gatedFetch,
  readJsonBounded,
  MAX_PROVIDER_BODY_BYTES,
} from "../src/platform/network.js";
import { SettingsPatchSchema } from "../src/storage/settings.js";
import { classifySender, MessageSchema } from "../src/platform/messaging.js";
import { Secret } from "../src/core/secret.js";
import { logger } from "../src/core/logger.js";
import { detectWireFormat } from "../src/providers/youtube/bridge-protocol.js";
import { makeExportFilename } from "../src/core/export.js";
import { AppError } from "../src/core/errors.js";

function fakeFetch(): {
  impl: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe("network gate", () => {
  it("refuses non-HTTPS remote egress", async () => {
    const { impl } = fakeFetch();
    await expect(
      gatedFetch("http://api.openai.com/v1/chat/completions", {
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/Blocked non-HTTPS egress/);
  });

  it("allows loopback over http", async () => {
    const { impl, calls } = fakeFetch();
    await gatedFetch("http://localhost:11434/v1/models", { fetchImpl: impl });
    await gatedFetch("http://127.0.0.1:1234/v1/models", { fetchImpl: impl });
    expect(calls[0]?.url).toBe("http://localhost:11434/v1/models");
    expect(calls[1]?.url).toBe("http://127.0.0.1:1234/v1/models");
  });

  it("never follows redirects and never sends credentials", async () => {
    const { impl, calls } = fakeFetch();
    await gatedFetch("https://api.openai.com/v1/models", { fetchImpl: impl });
    expect(calls[0]?.init.redirect).toBe("error");
    expect(calls[0]?.init.credentials).toBe("omit");
  });

  it("caps response bodies so a provider cannot exhaust memory", async () => {
    const big = new Response("x".repeat(1024), {
      headers: { "content-length": String(MAX_PROVIDER_BODY_BYTES + 1) },
    });
    await expect(readJsonBounded(big)).rejects.toThrow(/size cap/);
  });

  it("parses a normal provider body", async () => {
    const res = new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
    await expect(readJsonBounded<{ ok: boolean }>(res)).resolves.toEqual({
      ok: true,
    });
  });
});

describe("settings patch validation", () => {
  it("accepts a well-formed patch", () => {
    expect(
      SettingsPatchSchema.safeParse({ theme: "dark", strictMode: true })
        .success,
    ).toBe(true);
  });

  it("rejects unknown keys, wrong types and oversize values", () => {
    expect(SettingsPatchSchema.safeParse({ surprise: "x" }).success).toBe(
      false,
    );
    expect(SettingsPatchSchema.safeParse({ theme: "neon" }).success).toBe(
      false,
    );
    expect(SettingsPatchSchema.safeParse({ strictMode: "yes" }).success).toBe(
      false,
    );
    expect(
      SettingsPatchSchema.safeParse({ aiModel: "m".repeat(500) }).success,
    ).toBe(false);
  });
});
describe("message boundary", () => {
  it("rejects messages without a string type", () => {
    expect(MessageSchema.safeParse({ payload: {} }).success).toBe(false);
    expect(MessageSchema.safeParse({ type: 5 }).success).toBe(false);
    expect(MessageSchema.safeParse({ type: "ai.run" }).success).toBe(true);
  });

  it("classifies non-YouTube page senders as untrusted", () => {
    expect(
      classifySender({
        url: "https://evil.example.com/",
        origin: "https://evil.example.com",
      } as never),
    ).toBe("untrusted");
  });

  it("classifies an extension page as trusted and a page with no url as untrusted", () => {
    const extId = "abcdefghijklmnopabcdefghijklmnop";
    const originalId = browser.runtime.id;
    Object.defineProperty(browser.runtime, "id", {
      value: extId,
      configurable: true,
    });
    try {
      expect(
        classifySender({
          url: `chrome-extension://${extId}/sidepanel.html`,
          origin: `chrome-extension://${extId}`,
          id: extId,
        } as never),
      ).toBe("extension-page");
      expect(classifySender({ id: extId } as never)).toBe("untrusted");
    } finally {
      Object.defineProperty(browser.runtime, "id", {
        value: originalId,
        configurable: true,
      });
    }
  });
});

describe("secret handling", () => {
  it("never serializes its value", () => {
    const s = Secret.from("sk-live-should-never-appear")!;
    expect(JSON.stringify({ key: s })).toBe('{"key":"[redacted]"}');
    expect(String(s)).toBe("[redacted]");
    expect(s.expose()).toBe("sk-live-should-never-appear");
  });

  it("returns null for empty input", () => {
    expect(Secret.from("")).toBeNull();
    expect(Secret.from("   ")).toBeNull();
  });

  it("redacts secret-shaped fields in log context", () => {
    logger.clear();
    logger.info("test", "context redaction", {
      apiKey: "sk-should-not-be-stored",
      nested: { authorization: "Bearer sk-should-not-be-stored" },
      safe: "visible",
    });
    const diagnostics = logger.getDiagnostics();
    expect(diagnostics).not.toContain("sk-should-not-be-stored");
    expect(diagnostics).toContain("[redacted]");
    expect(diagnostics).toContain("visible");
  });
});

describe("untrusted payload handling", () => {
  it("sniffs wire format from body content, not just URL", () => {
    expect(
      detectWireFormat(
        "https://x/api/timedtext",
        "WEBVTT\n\n00:00.000 --> 00:02.000\nhi",
      ),
    ).toBe("vtt");
    expect(detectWireFormat("https://x/api/timedtext", '{"events":[]}')).toBe(
      "json3",
    );
    expect(
      detectWireFormat(
        "https://x/api/timedtext",
        "<transcript><text/></transcript>",
      ),
    ).toBe("srv3");
    expect(detectWireFormat("https://x/api/timedtext", "garbage")).toBeNull();
  });

  it("sanitizes exported filenames", () => {
    const name = makeExportFilename('../../evil:<script>|"?.mp4', "en", "txt");
    expect(name).not.toMatch(/[/\\<>:"|?*]/);
    expect(name.endsWith("_en.txt")).toBe(true);
  });
});

describe("error taxonomy", () => {
  it("serializes AppError without leaking cause or context", () => {
    const err = new AppError({
      code: "AI_AUTH",
      message: "Provider rejected the API key",
      context: { apiKey: "sk-secret" },
      cause: new Error("raw provider text with key"),
    });
    const json = JSON.stringify(err);
    expect(json).not.toContain("sk-secret");
    expect(json).not.toContain("raw provider text");
    expect(err.code).toBe("AI_AUTH");
  });

  it("marks retryable flags explicitly", () => {
    expect(
      new AppError({ code: "ACQ_TIMEOUT", message: "x", retryable: true })
        .retryable,
    ).toBe(true);
    expect(new AppError({ code: "AI_AUTH", message: "x" }).retryable).toBe(
      false,
    );
  });
});

describe("gemini provider", () => {
  it("sends the API key in a header, never in the URL", async () => {
    const { geminiGenerate } = await import("../src/ai/providers/gemini.js");
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;
    vi.stubGlobal("fetch", impl);

    const out = await geminiGenerate({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
      secret: Secret.from("goog-secret-key")!,
    });

    expect(out).toBe("ok");
    expect(calls[0]?.url).not.toContain("goog-secret-key");
    expect(calls[0]?.url).not.toContain("key=");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("goog-secret-key");
    vi.unstubAllGlobals();
  });
});
