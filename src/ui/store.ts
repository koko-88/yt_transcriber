// Panel state store (zustand). The panel is a thin client: all acquisition
// and storage work happens via the message bus in the background/content
// script. State here is view-state plus the last known server-side results.

import { create } from "zustand";
import { browser } from "wxt/browser";
import { bus } from "../platform/messaging.js";
import { logger } from "../core/logger.js";
import { AppError } from "../core/errors.js";
import type { Transcript, TranscriptTrack } from "../core/model.js";
import type { AcquisitionResult, Availability } from "../core/result.js";
import { AcquisitionResultSchema, TranscriptSchema } from "../core/schemas.js";
import type { VideoPageState } from "../providers/youtube/session.js";
import type { AppSettings } from "../storage/settings.js";
import { DEFAULT_SETTINGS } from "../storage/settings.js";
import type { Locale, MessageKey } from "../core/i18n.js";
import { t as translate } from "../core/i18n.js";
import type { PanelContext } from "../platform/tab-context.js";

export type PanelTab = "transcript" | "library" | "ai" | "settings";
export type ViewMode = "paragraph" | "raw";
export type ShellStatus =
  | "ready"
  | "no-video-tab"
  | "unsupported-page"
  | "content-unavailable"
  | "player-initializing"
  | "routing-failed";

export interface LibraryItem {
  videoId: string;
  transcriptId: string;
  title: string;
  channelName?: string | undefined;
  thumbnailUrl?: string | undefined;
  viewedAt: number;
  languageCode: string;
  segmentCount: number;
}

interface PanelState {
  ready: boolean;
  tab: PanelTab;
  settings: AppSettings;
  locale: Locale;

  // current YouTube page
  videoId: string | null;
  shellStatus: ShellStatus;
  availability: Availability;
  tracks: TranscriptTrack[];
  metadata: VideoPageState["metadata"];

  // transcript view
  transcript: Transcript | null;
  loading: boolean;
  viewMode: ViewMode;
  follow: boolean;
  playbackMs: number;
  playing: boolean;
  sttPhase:
    "idle" | "preparing" | "transcribing" | "ready" | "error" | "cancelled";
  sttProgress: number;
  sttError: string | null;
  searchQuery: string;

  // library
  recents: LibraryItem[];
  savedVideoIds: Set<string>;

  // actions
  init(): Promise<void>;
  setTab(tab: PanelTab): void;
  setViewMode(mode: ViewMode): void;
  setFollow(follow: boolean): void;
  setSearchQuery(q: string): void;
  refreshPageState(): Promise<void>;
  acquire(
    trackId?: string,
    opts?: { allowPlaybackMutation?: boolean },
  ): Promise<void>;
  seek(timeMs: number): Promise<void>;
  startTranscription(): Promise<void>;
  cancelTranscription(): Promise<void>;
  saveCurrentToLibrary(): Promise<void>;
  removeFromLibrary(transcriptId: string): Promise<void>;
  loadLibrary(): Promise<void>;
  openSaved(transcriptId: string): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  tr(key: MessageKey, params?: Record<string, string | number>): string;
}

function resolveLocale(setting: AppSettings["locale"]): Locale {
  if (setting === "ar" || setting === "en") return setting;
  return navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
}

let playbackPort: ReturnType<typeof browser.tabs.connect> | null = null;
let pageEpoch = 0;
let acquireEpoch = 0;
let refreshRetryCount = 0;

const PLAYBACK_POLL_FOLLOW_MS = 100;
const PLAYBACK_POLL_IDLE_MS = 1000;

/** Follow-mode poll interval (ms). Exported for regression tests. */
export const FOLLOW_PLAYBACK_POLL_MS = PLAYBACK_POLL_FOLLOW_MS;
/** Idle / paused poll interval (ms). */
export const IDLE_PLAYBACK_POLL_MS = PLAYBACK_POLL_IDLE_MS;

async function startPlaybackStream(
  get: () => PanelState,
  set: (partial: Partial<PanelState>) => void,
) {
  playbackPort?.disconnect();
  playbackPort = null;
  if (document.hidden || !get().videoId) return;
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id || document.hidden || !get().videoId) return;
    const port = browser.tabs.connect(tab.id, { name: "ytt-playback" });
    playbackPort = port;
    port.postMessage({ follow: get().follow });
    port.onMessage.addListener((raw: unknown) => {
      const sample = raw as {
        videoId?: string;
        timeSeconds?: number;
        playing?: boolean;
      };
      if (
        document.hidden ||
        sample.videoId !== get().videoId ||
        !Number.isFinite(sample.timeSeconds) ||
        typeof sample.playing !== "boolean"
      )
        return;
      set({
        playbackMs: Math.round(sample.timeSeconds! * 1000),
        playing: sample.playing,
      });
    });
    port.onDisconnect.addListener(() => {
      if (playbackPort === port) playbackPort = null;
    });
  } catch {
    /* content script may still be initializing */
  }
}

export const usePanelStore = create<PanelState>((set, get) => ({
  ready: false,
  tab: "transcript",
  settings: DEFAULT_SETTINGS,
  locale: "en",

  videoId: null,
  shellStatus: "no-video-tab",
  availability: "not-a-video-page",
  tracks: [],
  metadata: null,

  transcript: null,
  loading: false,
  viewMode: "paragraph",
  follow: false,
  playbackMs: 0,
  playing: false,
  sttPhase: "idle",
  sttProgress: 0,
  sttError: null,
  searchQuery: "",

  recents: [],
  savedVideoIds: new Set(),

  async init() {
    try {
      const settings = await bus.request<AppSettings>("settings.get");
      const locale = resolveLocale(settings.locale);
      set({ settings, locale });
      document.documentElement.lang = locale;
      document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    } catch (e) {
      logger.warn("panel", "settings.get failed; using defaults", {
        error: String(e),
      });
      const locale = resolveLocale(DEFAULT_SETTINGS.locale);
      set({ settings: DEFAULT_SETTINGS, locale });
      document.documentElement.lang = locale;
      document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    }

    await get().refreshPageState();
    await get().loadLibrary();

    // Listen for navigation notifications relayed by the background.
    browser.runtime.onMessage.addListener((raw) => {
      const msg = raw as {
        type?: string;
        payload?: { videoId?: string | null };
      };
      if (msg?.type === "panel.videoChanged") {
        if (get().sttPhase === "preparing" || get().sttPhase === "transcribing")
          void bus.request("stt.cancel").catch(() => undefined);
        pageEpoch++;
        acquireEpoch++;
        refreshRetryCount = 0;
        set({
          videoId: msg.payload?.videoId ?? null,
          shellStatus: msg.payload?.videoId
            ? "player-initializing"
            : "no-video-tab",
          transcript: null,
          tracks: [],
          metadata: null,
          availability: "unsupported-page-structure",
          loading: false,
          sttPhase: "idle",
          sttProgress: 0,
          sttError: null,
        });
        void get().refreshPageState();
      }
      if (msg?.type === "stt.update") {
        const update = msg.payload as unknown as {
          videoId?: string;
          phase?: PanelState["sttPhase"];
          progress?: number;
          error?: string;
          transcript?: unknown;
        };
        if (update.videoId !== get().videoId) return;
        const parsed = update.transcript
          ? TranscriptSchema.safeParse(update.transcript)
          : null;
        set({
          sttPhase: update.phase ?? "idle",
          sttProgress: Number.isFinite(update.progress) ? update.progress! : 0,
          sttError: update.error ?? null,
          ...(parsed?.success
            ? { transcript: parsed.data, availability: "available" as const }
            : {}),
        });
      }
    });

    void startPlaybackStream(get, set);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        playbackPort?.disconnect();
        playbackPort = null;
      } else void startPlaybackStream(get, set);
    });

    // Stop polling when the panel is hidden or closed; the panel page can be
    // kept alive by the browser for a long time and must not poll forever.
    window.addEventListener("pagehide", () => {
      playbackPort?.disconnect();
      playbackPort = null;
    });

    // Always surface the shell UI even if background messaging failed — otherwise
    // the panel stays on "Loading…" forever with no recovery path.
    set({ ready: true });
  },

  setTab(tab) {
    set({ tab });
    if (tab === "library") void get().loadLibrary();
  },
  setViewMode(viewMode) {
    set({ viewMode });
  },
  setFollow(follow) {
    set({ follow });
    playbackPort?.postMessage({ follow });
  },
  setSearchQuery(searchQuery) {
    set({ searchQuery });
  },

  async refreshPageState() {
    const epoch = pageEpoch;
    const retryTransientFailure = () => {
      if (epoch !== pageEpoch || refreshRetryCount >= 8) return;
      const delay = 400 * ++refreshRetryCount;
      setTimeout(() => {
        if (epoch === pageEpoch) void get().refreshPageState();
      }, delay);
    };
    try {
      const context = await bus.request<PanelContext>("panel.context");
      if (epoch !== pageEpoch) return;
      if (context.status !== "video" || !context.videoId) {
        acquireEpoch++;
        refreshRetryCount = 0;
        set({
          videoId: null,
          shellStatus:
            context.status === "video" ? "routing-failed" : context.status,
          availability: "not-a-video-page",
          tracks: [],
          metadata: null,
          transcript: null,
          loading: false,
        });
        return;
      }
      if (get().videoId !== context.videoId) {
        acquireEpoch++;
        set({
          videoId: context.videoId,
          shellStatus: "player-initializing",
          availability: "unsupported-page-structure",
          transcript: null,
          tracks: [],
          metadata: null,
          loading: false,
        });
      }
      if (!playbackPort) void startPlaybackStream(get, set);
      const state = await bus.request<VideoPageState>("acq.getState", {
        videoId: context.videoId,
      });
      if (epoch !== pageEpoch) return;
      if (state.videoId !== context.videoId) {
        retryTransientFailure();
        return;
      }
      if (
        state.availability === "unsupported-page-structure" ||
        state.availability === "player-initializing"
      ) {
        retryTransientFailure();
      } else {
        refreshRetryCount = 0;
      }
      set({
        videoId: state.videoId,
        shellStatus:
          (state.availability === "unsupported-page-structure" ||
            state.availability === "player-initializing") &&
          refreshRetryCount < 8
            ? "player-initializing"
            : "ready",
        availability: state.availability,
        tracks: state.tracks,
        metadata: state.metadata,
      });
      if (
        state.availability === "available" &&
        !get().transcript &&
        !get().loading
      ) {
        // Auto-acquire never mutates playback (ads / paused / unmuted stay intact).
        void get().acquire(undefined, { allowPlaybackMutation: false });
      } else if (
        state.availability === "no-captions" &&
        !get().transcript &&
        get().sttPhase === "idle"
      ) {
        void get().startTranscription();
      }
    } catch (e) {
      logger.warn("panel", "video context or content routing failed", {
        error: String(e),
      });
      if (epoch !== pageEpoch) return;
      const message = String(e);
      const contentUnavailable =
        /receiving end does not exist|could not establish connection|no response received/i.test(
          message,
        );
      set({
        shellStatus: contentUnavailable
          ? "content-unavailable"
          : "routing-failed",
      });
      retryTransientFailure();
    }
  },

  async acquire(trackId, opts) {
    const expectedVideoId = get().videoId;
    if (!expectedVideoId) return;
    const epoch = ++acquireEpoch;
    set({ loading: true, transcript: null });
    try {
      const raw = await bus.request<unknown>("acq.acquire", {
        videoId: expectedVideoId,
        ...(trackId ? { trackId } : {}),
        allowPlaybackMutation: opts?.allowPlaybackMutation === true,
      });
      const parsed = AcquisitionResultSchema.safeParse(raw);
      if (!parsed.success) throw new Error("malformed acquisition result");
      const result: AcquisitionResult = parsed.data;
      if (epoch !== acquireEpoch || get().videoId !== expectedVideoId) return;
      if (result.ok) {
        if (result.transcript.video.videoId !== expectedVideoId) return;
        set({
          transcript: result.transcript,
          tracks: [...result.tracks],
          availability: "available",
        });
      } else if (result.reason === "player-initializing") {
        set({ availability: result.reason, transcript: null });
        // Bound ad/startup waits via the shared refresh retry budget (max 8).
        if (epoch === acquireEpoch && refreshRetryCount < 8) {
          const delay = 400 * ++refreshRetryCount;
          setTimeout(() => {
            if (epoch === acquireEpoch && get().videoId === expectedVideoId) {
              void get().refreshPageState();
            }
          }, delay);
        }
      } else {
        set({ availability: result.reason, transcript: null });
        if (result.reason === "no-captions") void get().startTranscription();
      }
    } catch (e) {
      if (epoch !== acquireEpoch || get().videoId !== expectedVideoId) return;
      if (e instanceof AppError && e.code === "ACQ_STALE_VIDEO") {
        void get().refreshPageState();
        return;
      }
      logger.error("panel", "acquire failed", { error: String(e) });
      set({ availability: "unknown", transcript: null });
    } finally {
      if (epoch === acquireEpoch) set({ loading: false });
    }
  },

  async seek(timeMs) {
    try {
      const result = await bus.request<{ ok: boolean }>("acq.seek", { timeMs });
      if (result.ok) set({ playbackMs: timeMs });
    } catch (e) {
      logger.warn("panel", "seek failed", { error: String(e) });
    }
  },

  async startTranscription() {
    const videoId = get().videoId;
    if (!videoId) return;
    set({ sttPhase: "preparing", sttProgress: 0, sttError: null });
    try {
      const existing = await bus.request<{
        videoId: string | null;
        phase: PanelState["sttPhase"];
        progress: number;
        transcript?: unknown;
      }>("stt.status", { videoId });
      if (get().videoId !== videoId) return;
      const result =
        existing.videoId === videoId &&
        existing.phase !== "cancelled" &&
        existing.phase !== "error"
          ? existing
          : await bus.request<typeof existing>("stt.start", { videoId });
      if (get().videoId !== videoId) return;
      const parsed = result.transcript
        ? TranscriptSchema.safeParse(result.transcript)
        : null;
      set({
        sttPhase: result.phase,
        sttProgress: result.progress,
        ...(parsed?.success
          ? { transcript: parsed.data, availability: "available" as const }
          : {}),
      });
    } catch (error) {
      if (get().videoId === videoId)
        set({
          sttPhase: "error",
          sttError: error instanceof Error ? error.message : String(error),
        });
    }
  },
  async cancelTranscription() {
    await bus.request("stt.cancel").catch(() => undefined);
    set({ sttPhase: "cancelled" });
  },

  async saveCurrentToLibrary() {
    const transcript = get().transcript;
    if (!transcript) return;
    await bus.request("library.save", { transcript });
    await get().loadLibrary();
  },

  async removeFromLibrary(transcriptId) {
    await bus.request("library.delete", { transcriptId });
    await get().loadLibrary();
  },

  async loadLibrary() {
    try {
      const recents = await bus.request<LibraryItem[]>("library.list");
      set({ recents, savedVideoIds: new Set(recents.map((r) => r.videoId)) });
    } catch (e) {
      logger.warn("panel", "library.list failed", { error: String(e) });
      set({ recents: [], savedVideoIds: new Set() });
    }
  },

  async openSaved(transcriptId) {
    const t = await bus.request<Transcript | null>("transcript.get", {
      id: transcriptId,
    });
    if (t) {
      set({ transcript: t, tab: "transcript", availability: "available" });
    }
  },

  async updateSettings(patch) {
    const updated = await bus.request<AppSettings>("settings.set", { patch });
    const locale = resolveLocale(updated.locale);
    set({ settings: updated, locale });
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  },

  tr(key, params) {
    return translate(get().locale, key, params);
  },
}));
