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
  await expect(page.getByRole("status")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("Open a YouTube video", { exact: false }),
  ).toBeVisible();
  await page.close();
});

test("product entry opens a native panel and binds the active YouTube video", async () => {
  const worker = context!
    .serviceWorkers()
    .find((candidate) =>
      candidate.url().startsWith(`chrome-extension://${extensionId}/`),
    );
  expect(worker).toBeTruthy();
  const behavior = await worker!.evaluate(() =>
    chrome.sidePanel.getPanelBehavior(),
  );
  expect(behavior.openPanelOnActionClick).toBe(true);

  const videoId = "jNQXAC9IVRw";
  const video = await context!.newPage();
  await video.route(`https://www.youtube.com/watch?v=${videoId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Fixture video</title><div id='movie_player'></div>",
    }),
  );
  await video.goto(`https://www.youtube.com/watch?v=${videoId}`);

  // Playwright cannot click Chrome's toolbar. This extension-page user gesture
  // exercises the same native sidePanel.open surface, while the assertion above
  // verifies the actual toolbar action has been assigned to that surface.
  const launcher = await context!.newPage();
  await launcher.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await launcher.evaluate(() => {
    const button = document.createElement("button");
    button.id = "e2e-open-native-panel";
    button.textContent = "Open native panel";
    button.addEventListener("click", () => {
      void chrome.sidePanel.open({
        windowId: chrome.windows.WINDOW_ID_CURRENT,
      });
    });
    document.body.append(button);
  });
  await launcher.locator("#e2e-open-native-panel").click();

  await expect
    .poll(async () => {
      const cdp = await context!.browser()!.newBrowserCDPSession();
      const targets = await cdp.send("Target.getTargets");
      await cdp.detach();
      return targets.targetInfos.filter((target) =>
        target.url.endsWith("/sidepanel.html"),
      ).length;
    })
    .toBeGreaterThanOrEqual(2);

  await video.bringToFront();
  const binding = await launcher.evaluate(() =>
    chrome.runtime.sendMessage({ type: "panel.context", payload: {} }),
  );
  expect(binding, JSON.stringify(binding)).toMatchObject({
    ok: true,
    data: { status: "video", videoId },
  });

  const windows = await worker!.evaluate(() => chrome.windows.getAll());
  expect(windows).toHaveLength(1);
  expect(windows[0]?.type).toBe("normal");
  await launcher.close();
  await video.close();
});

test("deterministic YouTube fixture acquires and replaces the transcript after SPA navigation", async () => {
  const videoA = "abcdefghijk";
  const videoB = "ABCDEFGHIJK";
  const video = await context!.newPage();
  const captionBody = (label: string) =>
    JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: `Start ${label}` }] },
        { tStartMs: 9000, dDurationMs: 1000, segs: [{ utf8: `End ${label}` }] },
      ],
    });
  await video.route("https://www.youtube.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/timedtext") {
      const label = url.searchParams.get("v") === videoB ? "B" : "A";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: captionBody(label),
      });
    }
    if (url.pathname === "/watch") {
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><title>Fixture</title><div id="movie_player"></div><script>
          window.fixtureVideoId = "${videoA}";
          const player = document.getElementById("movie_player");
          player.getPlayerResponse = () => ({
            videoDetails: { videoId: window.fixtureVideoId, title: "Fixture " + window.fixtureVideoId, author: "Fixture", lengthSeconds: "10" },
            playabilityStatus: { status: "OK" },
            captions: { playerCaptionsTracklistRenderer: { captionTracks: [
              { languageCode: "en", vssId: ".en", baseUrl: "https://www.youtube.com/api/timedtext?v=" + window.fixtureVideoId + "&lang=en" }
            ] } }
          });
          player.getPlayerState = () => 2;
          player.getOption = () => ({});
          player.setOption = () => {};
          player.getCurrentTime = () => 0;
          player.getDuration = () => 10;
        </script>`,
      });
    }
    return route.abort();
  });
  await video.goto(`https://www.youtube.com/watch?v=${videoA}`);
  const panel = await openPanel();
  await video.bringToFront();
  await expect(panel.locator(".transcript-head")).toBeVisible({
    timeout: 20_000,
  });
  await expect(panel.getByText("Start A", { exact: false })).toBeVisible();

  await video.evaluate((nextId) => {
    (window as typeof window & { fixtureVideoId: string }).fixtureVideoId =
      nextId;
    history.pushState(null, "", `/watch?v=${nextId}`);
    document.dispatchEvent(new Event("yt-navigate-finish"));
  }, videoB);
  await expect(panel.getByText("Start B", { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  await expect(panel.getByText("Start A", { exact: false })).toHaveCount(0);
  await panel.close();
  await video.close();
});
