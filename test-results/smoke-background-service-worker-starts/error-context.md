# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> background service worker starts
- Location: e2e\smoke.spec.ts:34:1

# Error details

```
Error: browserType.launchPersistentContext: Executable doesn't exist at C:\Users\kerol\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     npx playwright install                                 ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
```

# Test source

```ts
  1  | // Playwright smoke test: loads the *built* Chromium extension in a real
  2  | // browser, verifies the service worker starts and the side panel renders with
  3  | // no console errors. Requires `npm run build` first.
  4  | import { test, expect, chromium, type BrowserContext } from "@playwright/test";
  5  | import { existsSync, mkdtempSync, rmSync } from "node:fs";
  6  | import { tmpdir } from "node:os";
  7  | import { join, resolve } from "node:path";
  8  | 
  9  | const EXT_PATH = resolve(".output/chrome-mv3");
  10 | 
  11 | let context: BrowserContext | undefined;
  12 | let userDataDir: string | undefined;
  13 | 
  14 | test.beforeAll(async () => {
  15 |   if (!existsSync(join(EXT_PATH, "manifest.json"))) {
  16 |     test.skip(true, 'Chromium build missing — run "npm run build" first');
  17 |   }
  18 |   userDataDir = mkdtempSync(join(tmpdir(), "ytt-e2e-"));
> 19 |   context = await chromium.launchPersistentContext(userDataDir, {
     |             ^ Error: browserType.launchPersistentContext: Executable doesn't exist at C:\Users\kerol\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe
  20 |     channel: "chromium",
  21 |     headless: true,
  22 |     args: [
  23 |       `--disable-extensions-except=${EXT_PATH}`,
  24 |       `--load-extension=${EXT_PATH}`,
  25 |     ],
  26 |   });
  27 | });
  28 | 
  29 | test.afterAll(async () => {
  30 |   await context?.close();
  31 |   if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  32 | });
  33 | 
  34 | test("background service worker starts", async () => {
  35 |   const ctx = context!;
  36 |   const sw =
  37 |     ctx.serviceWorkers()[0] ??
  38 |     (await ctx.waitForEvent("serviceworker", { timeout: 30_000 }));
  39 |   expect(sw.url()).toContain("chrome-extension://");
  40 | });
  41 | 
  42 | test("side panel renders all four tabs without console errors", async () => {
  43 |   const ctx = context!;
  44 |   const sw =
  45 |     ctx.serviceWorkers()[0] ??
  46 |     (await ctx.waitForEvent("serviceworker", { timeout: 30_000 }));
  47 |   const extensionId = new URL(sw.url()).host;
  48 | 
  49 |   const page = await ctx.newPage();
  50 |   const errors: string[] = [];
  51 |   page.on("console", (msg) => {
  52 |     if (msg.type() === "error") errors.push(msg.text());
  53 |   });
  54 |   page.on("pageerror", (err) => errors.push(err.message));
  55 | 
  56 |   await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  57 | 
  58 |   const tablist = page.getByRole("tablist");
  59 |   await expect(tablist).toBeVisible({ timeout: 20_000 });
  60 | 
  61 |   for (const name of ["Transcript", "Library", "AI", "Settings"]) {
  62 |     await expect(page.getByRole("tab", { name })).toBeVisible();
  63 |   }
  64 | 
  65 |   // Every tab must render something and must not throw.
  66 |   for (const name of ["Library", "AI", "Settings", "Transcript"]) {
  67 |     await page.getByRole("tab", { name }).click();
  68 |   }
  69 |   await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute(
  70 |     "aria-selected",
  71 |     "false",
  72 |   );
  73 | 
  74 |   await page.getByRole("tab", { name: "Settings" }).click();
  75 |   await expect(page.getByText("Strict Local Mode").first()).toBeVisible();
  76 | 
  77 |   expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
  78 |   await page.close();
  79 | });
  80 | 
```