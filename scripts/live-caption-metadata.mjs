import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const page = await browser.newPage();
  for (const videoId of process.argv.slice(2)) {
    const start = Date.now();
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => !!document.querySelector("#movie_player")?.getPlayerResponse?.(),
      { timeout: 10_000 },
    ).catch(() => null);
    const data = await page.evaluate(() => {
      const response = document.querySelector("#movie_player")?.getPlayerResponse?.();
      const captions = response?.captions?.playerCaptionsTracklistRenderer;
      return {
        videoId: response?.videoDetails?.videoId ?? null,
        durationSeconds: Number(response?.videoDetails?.lengthSeconds ?? 0),
        status: response?.playabilityStatus?.status ?? null,
        tracks: captions?.captionTracks?.map((track) => ({
          language: track.languageCode,
          kind: track.kind ?? "manual",
          vssId: track.vssId ?? null,
          named: !!new URL(track.baseUrl).searchParams.get("name"),
        })) ?? [],
        translationLanguageCount: captions?.translationLanguages?.length ?? 0,
      };
    });
    console.log(JSON.stringify({ requestedVideoId: videoId, elapsedMs: Date.now() - start, ...data }));
  }
} finally {
  await browser.close();
}
