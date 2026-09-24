// Playwright smoke test: loads the *built* Chromium extension in a real
// browser, verifies the service worker starts and the side panel renders with
// no console errors. Requires `npm run build` first.
import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EXT_PATH = resolve(".output/chrome-mv3");

let context: BrowserContext | undefined;
let userDataDir: string | undefined;

test.beforeAll(async () => {
  if (!existsSync(join(EXT_PATH, "manifest.json"))) {
    test.skip(true, 'Chromium build missing — run "npm run build" first');
  }
  userDataDir = mkdtempSync(join(tmpdir(), "ytt-e2e-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
    ],
  });
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test("background service worker starts", async () => {
  const ctx = context!;
  const sw =
    ctx.serviceWorkers()[0] ??
    (await ctx.waitForEvent("serviceworker", { timeout: 30_000 }));
  expect(sw.url()).toContain("chrome-extension://");
});

test("side panel renders all four tabs without console errors", async () => {
  const ctx = context!;
  const sw =
    ctx.serviceWorkers()[0] ??
    (await ctx.waitForEvent("serviceworker", { timeout: 30_000 }));
  const extensionId = new URL(sw.url()).host;

  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const tablist = page.getByRole("tablist");
  await expect(tablist).toBeVisible({ timeout: 20_000 });

  for (const name of ["Transcript", "Library", "AI", "Settings"]) {
    await expect(page.getByRole("tab", { name })).toBeVisible();
  }

  // Every tab must render something and must not throw.
  for (const name of ["Library", "AI", "Settings", "Transcript"]) {
    await page.getByRole("tab", { name }).click();
  }
  await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute(
    "aria-selected",
    "false",
  );

  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Strict Local Mode").first()).toBeVisible();

  expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
  await page.close();
});
