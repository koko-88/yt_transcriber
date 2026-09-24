/**
 * M0-A acquisition spike v2 (throwaway validation code, NOT shipped).
 * v2 changes vs v1: media NOT blocked (captions only load during playback),
 * C3b captures the player OWN fetch/XHR RESPONSE bodies instead of refetching
 * (v1 showed static baseUrls and refetched pot URLs both return empty 200s),
 * waits for actual playback state, observes rendered caption cues as ground truth.
 */
import { chromium } from "@playwright/test";

const VIDEOS = [
  { id: "dQw4w9WgXcQ", note: "manual+asr, many languages" },
  { id: "jNQXAC9IVRw", note: "manual en+de" },
  { id: "9bZkp7q19f0", note: "ASR ko" },
  { id: "eKFTSSKCzWA", note: "no captions (8h music)" },
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const PAGE_FN = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = {
    url: location.href,
    hasPlayer: !!document.getElementById("movie_player"),
    botCheck: (document.body && document.body.innerText || "").includes("Sign in to confirm"),
  };
  const player = document.getElementById("movie_player");
  if (!player) return Object.assign(result, { error: "no movie_player" });

  let pr = null;
  try { pr = (player.getPlayerResponse && player.getPlayerResponse()) || window.ytInitialPlayerResponse || null; }
  catch (e) { pr = window.ytInitialPlayerResponse || null; }
  const staticTracks = (pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
  result.static = {
    playabilityStatus: pr && pr.playabilityStatus ? pr.playabilityStatus.status : null,
    trackCount: staticTracks.length,
    tracks: staticTracks.map((t) => ({ lang: t.languageCode, kind: t.kind || "manual" })),
  };

  // --- C1 reference check on first track (expect empty per v1) ---
  result.c1 = [];
  if (staticTracks.length > 0) {
    try {
      const u = new URL(staticTracks[0].baseUrl);
      u.searchParams.set("fmt", "json3");
      const res = await fetch(u.toString(), { credentials: "include" });
      const t = await res.text();
      result.c1.push({ status: res.status, bytes: t.length });
    } catch (e) { result.c1.push({ error: String(e) }); }
  }

  // --- C3b v2: capture player own timedtext RESPONSES ---
  const captured = [];
  const origFetch = window.fetch;
  window.fetch = function () {
    const u = typeof arguments[0] === "string" ? arguments[0] : (arguments[0] && arguments[0].url);
    const isTt = u && String(u).includes("/api/timedtext");
    const p = origFetch.apply(this, arguments);
    if (isTt) {
      p.then((res) => {
        try {
          res.clone().text().then((body) => {
            captured.push({ via: "fetch", url: String(u), status: res.status, bytes: body.length, sample: body.slice(0, 100) });
          }).catch(() => { });
        } catch (e) { }
      }).catch(() => { });
    }
    return p;
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__tt = String(url).includes("/api/timedtext") ? String(url) : null;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__tt) {
      const xhr = this;
      xhr.addEventListener("load", () => {
        try {
          captured.push({ via: "xhr", url: xhr.__tt, status: xhr.status, bytes: (xhr.responseText || "").length, sample: (xhr.responseText || "").slice(0, 100) });
        } catch (e) { }
      });
    }
    return origSend.apply(this, arguments);
  };
  result.c3b = [];
  if (staticTracks.length > 0) {
    // Ensure playback actually starts (captions only load during playback).
    try {
      if (player.mute) player.mute();
      if (player.seekTo) player.seekTo(2, true);
      if (player.playVideo) player.playVideo();
    } catch (e) { }
    let waited = 0;
    while (waited < 10000) {
      const s = player.getPlayerState ? player.getPlayerState() : -1;
      if (s === 1) break;
      await sleep(250); waited += 250;
    }
    result.playerStateAfterPlay = player.getPlayerState ? player.getPlayerState() : null;

    for (const t of staticTracks.slice(0, 2)) {
      const record = { lang: t.languageCode, kind: t.kind || "manual" };
      try {
        const before = captured.length;
        if (player.loadModule) player.loadModule("captions");
        if (player.setOption) player.setOption("captions", "track", Object.assign({ languageCode: t.languageCode }, t.kind ? { kind: t.kind } : {}));
        let w = 0;
        let cuesSeen = false;
        while (w < 12000) {
          await sleep(300); w += 300;
          const cues = document.querySelectorAll(".ytp-caption-segment");
          if (cues.length > 0 && (cues[0].textContent || "").trim().length > 0) { cuesSeen = true; }
          if (captured.length > before) { await sleep(500); break; }
        }
        record.cuesVisible = cuesSeen;
        record.captures = captured.slice(before).map((c) => ({
          via: c.via, status: c.status, bytes: c.bytes, hasPot: /[?&]pot=/.test(c.url), sample: c.sample,
        }));
      } catch (e) {
        record.error = String(e);
      }
      result.c3b.push(record);
    }

    // restore: captions off, paused
    try {
      if (player.setOption) player.setOption("captions", "track", {});
      if (player.unloadModule) player.unloadModule("captions");
      if (player.pauseVideo) player.pauseVideo();
    } catch (e) { }
  }

  window.fetch = origFetch;
  XMLHttpRequest.prototype.open = origOpen;
  XMLHttpRequest.prototype.send = origSend;
  return result;
};

async function main() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required", "--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({ userAgent: UA, locale: "en-US" });
  const report = [];
  for (const v of VIDEOS.slice(1, 2)) {
    const page = await context.newPage();
    const entry = Object.assign({}, v);
    try {
      await page.goto("https://www.youtube.com/watch?v=" + v.id, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector("#movie_player", { timeout: 20000 }).catch(() => { });
      await page.waitForTimeout(1500);
      // Pause video element + toggle hidden visibility so PagehideManager
      // takes over playback (in-page playVideo is autoplay-blocked).
      await page.evaluate(() => { const v = document.querySelector("video"); if (v) v.pause(); });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.setWebLifecycleState", { state: "frozen" }).catch(() => { });
      await cdp.send("Page.setWebLifecycleState", { state: "active" }).catch(() => { });
      await page.waitForTimeout(1500);
      entry.result = await page.evaluate(PAGE_FN);
    } catch (e) {
      entry.error = String(e);
    }
    report.push(entry);
    console.error("done " + v.id);
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
