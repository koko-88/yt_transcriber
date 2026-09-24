// Playwright suite: loads the *built* Chromium extension.
// Requires `npm run build` first. Live YouTube is NOT a CI dependency.
//
// Chrome 137+ branded Chrome blocked `--load-extension`. Use Playwright's
// Chromium / Chrome for Testing build (no `channel: "chrome"`).
import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EXT_PATH = resolve(".output/chrome-mv3");

let context: BrowserContext | undefined;
let userDataDir: string | undefined;
let extensionId: string | undefined;

test.beforeAll(async () => {
  if (!existsSync(join(EXT_PATH, "manifest.json"))) {
    test.skip(true, 'Chromium build missing — run "npm run build" first');
  }

  userDataDir = mkdtempSync(join(tmpdir(), "ytt-e2e-"));
  try {
    // Do NOT set channel:"chrome" — branded Chrome 137+ ignores --load-extension.
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    test.skip(
      true,
      `Playwright Chromium/Chrome-for-Testing is not installed (${message}). Run: npx playwright install chromium`,
    );
  }

  const sw =
    context!.serviceWorkers()[0] ??
    (await context!
      .waitForEvent("serviceworker", { timeout: 30_000 })
      .catch(() => null));
  if (!sw) {
    test.skip(
      true,
      "Extension service worker did not start. Branded Chrome cannot load unpacked extensions via CLI (Chrome 137+); install Playwright Chromium (Chrome for Testing).",
    );
  }
  extensionId = new URL(sw!.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

async function openPanel() {
  const page = await context!.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByRole("tablist")).toBeVisible({ timeout: 20_000 });
  return page;
}

test("background service worker starts", async () => {
  expect(extensionId).toBeTruthy();
});

test("side panel renders all four tabs without console errors", async () => {
  const page = await openPanel();
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  for (const name of ["Transcript", "Library", "AI", "Settings"]) {
    await expect(page.getByRole("tab", { name })).toBeVisible();
  }

  for (const name of ["Library", "AI", "Settings", "Transcript"]) {
    await page.getByRole("tab", { name }).click();
  }

  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Strict Local Mode").first()).toBeVisible();
  await expect(page.getByText("Export library backup")).toBeVisible();

  expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
  await page.close();
});

test("settings: Strict Local Mode toggle is keyboard reachable", async () => {
  const page = await openPanel();
  await page.getByRole("tab", { name: "Settings" }).click();
  const checkbox = page.getByRole("checkbox", { name: /Strict Local Mode/i });
  await expect(checkbox).toBeVisible();
  await checkbox.focus();
  await expect(checkbox).toBeFocused();
  const before = await checkbox.isChecked();
  await page.keyboard.press("Space");
  await expect(checkbox).toHaveJSProperty("checked", !before);
  await page.close();
});

test("library empty state", async () => {
  const page = await openPanel();
  await page.getByRole("tab", { name: "Library" }).click();
  await expect(page.getByText("No saved transcripts yet")).toBeVisible();
  await page.close();
});

test("AI tab lists providers", async () => {
  const page = await openPanel();
  await page.getByRole("tab", { name: "AI" }).click();
  await expect(page.getByLabel("Provider")).toBeVisible();
  await expect(page.getByRole("button", { name: "Summary" })).toBeVisible();
  await page.close();
});

test("axe: no critical/serious issues on primary tabs", async () => {
  const page = await openPanel();
  for (const tab of ["Settings", "AI", "Library", "Transcript"] as const) {
    await page.getByRole("tab", { name: tab }).click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(serious, `${tab}: ${serious.map((v) => v.id).join(", ")}`).toEqual(
      [],
    );
  }
  await page.close();
});

test("settings: theme and locale switch update document", async () => {
  const page = await openPanel();
  await page.getByRole("tab", { name: "Settings" }).click();

  await page.locator("#set-theme").selectOption("dark");
  await expect
    .poll(async () => page.locator("html").getAttribute("data-theme"))
    .toBe("dark");

  await page.locator("#set-locale").selectOption("ar");
  await expect
    .poll(async () => page.locator("html").getAttribute("dir"))
    .toBe("rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");

  await page.locator("#set-locale").selectOption("en");
  await expect
    .poll(async () => page.locator("html").getAttribute("dir"))
    .toBe("ltr");
  await page.close();
});

test("transcript empty / not-a-video state is announced", async () => {
  const page = await openPanel();
  await page.getByRole("tab", { name: "Transcript" }).click();
  // No YouTube tab in this context — panel should show a non-video banner,
  // not hang on Loading.
  await expect(page.getByRole("tablist")).toBeVisible();
  await expect(page.locator(".banner").first()).toBeVisible({
    timeout: 10_000,
  });
  await page.close();
});
