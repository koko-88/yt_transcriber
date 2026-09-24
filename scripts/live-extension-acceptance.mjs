/* global document, chrome */
import { chromium } from "@playwright/test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const extensionPath = resolve(".output/chrome-mv3");
// Acquisition/export diagnostic only. The real toolbar/native-panel journey is
// covered separately; this page is opened as a tab so Playwright can inspect it.
const profile = mkdtempSync(join(tmpdir(), "ytt-live-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    acceptDownloads: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
  const extensionId = new URL(worker.url()).host;
  const video = context.pages()[0] ?? (await context.newPage());

  for (const videoId of process.argv.slice(2)) {
    let panel;
    try {
      await video.goto(`https://www.youtube.com/watch?v=${videoId}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await video.waitForFunction(
        () => !!document.querySelector("#movie_player")?.getPlayerResponse?.(),
        { timeout: 15_000 },
      );
      const before = await video.evaluate(() => {
        const player = document.querySelector("#movie_player");
        player.pauseVideo();
        player.setOption("captions", "track", {});
        return {
          paused: player.getPlayerState() !== 1,
          muted: player.isMuted(),
          position: player.getCurrentTime(),
          captionTrack: player.getOption("captions", "track"),
          captionsPressed: document
            .querySelector(".ytp-subtitles-button")
            ?.getAttribute("aria-pressed"),
          durationSeconds: player.getDuration(),
        };
      });
      const start = Date.now();
      panel = await context.newPage();
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await video.bringToFront();
      const transcriptHead = panel.locator(".transcript-head");
      const noCaptions = panel.getByText("No YouTube captions are available", {
        exact: false,
      });
      await Promise.race([
        transcriptHead.waitFor({ timeout: 45_000 }),
        noCaptions.waitFor({ timeout: 45_000 }),
      ]);
      const elapsedMs = Date.now() - start;
      await video.waitForTimeout(1500);
      const after = await video.evaluate(() => {
        const player = document.querySelector("#movie_player");
        return {
          paused: player.getPlayerState() !== 1,
          muted: player.isMuted(),
          position: player.getCurrentTime(),
          captionTrack: player.getOption("captions", "track"),
          captionsPressed: document
            .querySelector(".ytp-subtitles-button")
            ?.getAttribute("aria-pressed"),
        };
      });
      if (await noCaptions.isVisible()) {
        console.log(
          JSON.stringify({
            videoId,
            state: "NO_CAPTIONS",
            elapsedMs,
            before,
            after,
          }),
        );
        continue;
      }
      if (process.env.WORKBENCH_SCREENSHOT) {
        await panel.setViewportSize({ width: 360, height: 720 });
        await panel.screenshot({ path: process.env.WORKBENCH_SCREENSHOT });
      }
      await panel.getByText("Actions", { exact: true }).click();
      const downloadPromise = panel.waitForEvent("download");
      await panel.getByLabel("Export").selectOption("json");
      const download = await downloadPromise;
      const transcript = JSON.parse(
        readFileSync(await download.path(), "utf8"),
      );
      const last = transcript.segments.at(-1);
      console.log(
        JSON.stringify({
          videoId,
          state: "AVAILABLE",
          elapsedMs,
          before,
          after,
          selectedTrack: transcript.track.trackId,
          kind: transcript.track.kind,
          segmentCount: transcript.segments.length,
          lastCueEndMs: last?.endMs,
          durationMs: transcript.video.durationMs,
          method: transcript.source.method,
          completeness: transcript.source.completeness,
        }),
      );
    } catch (error) {
      const raw = await panel
        ?.evaluate(async () => {
          const state = await chrome.runtime.sendMessage({
            type: "acq.getState",
            payload: {},
          });
          const acquisition = await chrome.runtime.sendMessage({
            type: "acq.acquire",
            payload: {},
          });
          return {
            state: state.ok ? state.data : state.error,
            acquisition: acquisition.ok
              ? acquisition.data.ok
                ? {
                    ok: true,
                    segmentCount: acquisition.data.transcript.segments.length,
                  }
                : acquisition.data
              : acquisition.error,
          };
        })
        .catch((e) => ({ error: String(e) }));
      console.log(
        JSON.stringify({
          videoId,
          error: String(error),
          banner: await panel
            ?.locator(".banner")
            .allTextContents()
            .catch(() => []),
          panelText: (
            await panel
              ?.locator("body")
              .innerText()
              .catch(() => "")
          )?.slice(0, 800),
          player: await video
            .evaluate(() => {
              const p = document.querySelector("#movie_player");
              return {
                state: p?.getPlayerState?.(),
                track: p?.getOption?.("captions", "track"),
              };
            })
            .catch(() => null),
          raw,
        }),
      );
    } finally {
      await panel?.close();
    }
  }
} finally {
  await context?.close();
  rmSync(profile, { recursive: true, force: true });
}
