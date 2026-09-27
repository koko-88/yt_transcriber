import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { browserStub } from "./setup";
import { getDb } from "../src/storage/db";
import { saveSettings, DEFAULT_SETTINGS } from "../src/storage/settings";
import { listAiHistory } from "../src/storage/ai-history";
import { runAi } from "../src/ai/runner";
import { chatCompletion } from "../src/ai/providers/openai-compat";
import { fixture } from "./helpers/transcript";
vi.mock("../src/ai/providers/openai-compat", () => ({
  chatCompletion: vi.fn(async () => "Supported [0:05], unsupported [8:00]"),
}));
vi.mock("../src/platform/rate-limit", () => ({
  getRateLimiter: () => ({ acquire: async () => undefined }),
}));
beforeEach(async () => {
  vi.clearAllMocks();
  const db = await getDb();
  for (const name of db.objectStoreNames) await db.clear(name);
  browserStub.permissions.contains.mockResolvedValue(true);
  await saveSettings({
    ...DEFAULT_SETTINGS,
    strictMode: false,
    consents: { ollama: Date.now(), lmstudio: Date.now() },
  });
});
it("persists answers, source and coverage, and isolates provider caches", async () => {
  const transcript = fixture();
  const request = {
    pipeline: "summary" as const,
    transcript,
    providerId: "ollama",
    model: "shared-name",
  };
  const first = await runAi(request);
  expect(first.ok).toBe(true);
  const saved = await listAiHistory(transcript.video.videoId);
  expect(saved).toHaveLength(1);
  expect(saved[0]?.citations).toEqual([5000]);
  expect(saved[0]?.text).toContain("[?]");
  expect(saved[0]?.coverage).toEqual({ processed: 1, total: 1 });
  expect(await (await getDb()).get("transcripts", transcript.id)).toBeTruthy();
  await runAi(request);
  expect(chatCompletion).toHaveBeenCalledTimes(1);
  await runAi({ ...request, providerId: "lmstudio" });
  expect(chatCompletion).toHaveBeenCalledTimes(2);
});
it("retains consent and strict-local gates without provider calls", async () => {
  await saveSettings({ consents: {}, strictMode: false });
  const req = {
    pipeline: "summary" as const,
    transcript: fixture(),
    providerId: "ollama",
    model: "test",
  };
  expect((await runAi(req)).errorCode).toBe("AI_CONSENT_REQUIRED");
  await saveSettings({ strictMode: true });
  expect((await runAi({ ...req, providerId: "openai" })).errorCode).toBe(
    "AI_BLOCKED_STRICT",
  );
  expect(chatCompletion).not.toHaveBeenCalled();
});
