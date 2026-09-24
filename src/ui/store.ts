// Panel state store (zustand). The panel is a thin client: all acquisition
// and storage work happens via the message bus in the background/content
// script. State here is view-state plus the last known server-side results.

import { create } from 'zustand';
import { browser } from 'wxt/browser';
import { bus } from '../platform/messaging.js';
import { logger } from '../core/logger.js';
import type { Transcript, TranscriptTrack } from '../core/model.js';
import type { AcquisitionResult, Availability } from '../core/result.js';
import { AcquisitionResultSchema } from '../core/schemas.js';
import type { VideoPageState } from '../providers/youtube/session.js';
import type { AppSettings } from '../storage/settings.js';
import type { Locale, MessageKey } from '../core/i18n.js';
import { t as translate } from '../core/i18n.js';

export type PanelTab = 'transcript' | 'library' | 'ai' | 'settings';
export type ViewMode = 'paragraph' | 'raw';

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
  availability: Availability;
  tracks: TranscriptTrack[];
  metadata: VideoPageState['metadata'];

  // transcript view
  transcript: Transcript | null;
  loading: boolean;
  viewMode: ViewMode;
  follow: boolean;
  playbackMs: number;
  playing: boolean;
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
  acquire(trackId?: string): Promise<void>;
  seek(timeMs: number): Promise<void>;
  saveCurrentToLibrary(): Promise<void>;
  removeFromLibrary(transcriptId: string): Promise<void>;
  loadLibrary(): Promise<void>;
  openSaved(transcriptId: string): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  tr(key: MessageKey, params?: Record<string, string | number>): string;
}

function resolveLocale(setting: AppSettings['locale']): Locale {
  if (setting === 'ar' || setting === 'en') return setting;
  return navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

let followTimer: ReturnType<typeof setInterval> | null = null;

export function stopPanelTimers(): void {
  if (followTimer) clearInterval(followTimer);
}

const DEFAULT_SETTINGS: AppSettings = {
  settingsVersion: 1,
  theme: 'system',
  locale: 'system',
  strictMode: false,
  inPlayerButton: false,
  aiProvider: 'openai-compatible',
  aiModel: 'gpt-4o-mini',
  consents: {},
};

export const usePanelStore = create<PanelState>((set, get) => ({
  ready: false,
  tab: 'transcript',
  settings: DEFAULT_SETTINGS,
  locale: 'en',

  videoId: null,
  availability: 'not-a-video-page',
  tracks: [],
  metadata: null,

  transcript: null,
  loading: false,
  viewMode: 'paragraph',
  follow: false,
  playbackMs: 0,
  playing: false,
  searchQuery: '',

  recents: [],
  savedVideoIds: new Set(),

  async init() {
    const settings = await bus.request<AppSettings>('settings.get');
    const locale = resolveLocale(settings.locale);
    set({ settings, locale });
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';

    await get().refreshPageState();
    await get().loadLibrary();

    // Listen for navigation notifications relayed by the background.
    browser.runtime.onMessage.addListener((raw) => {
      const msg = raw as { type?: string; payload?: { videoId?: string | null } };
      if (msg?.type === 'panel.videoChanged') {
        set({ transcript: null });
        void get().refreshPageState();
      }
    });

    // Playback polling while panel is open (drives follow + active segment).
    followTimer = setInterval(async () => {
      if (!get().videoId) return;
      try {
        const pb = await bus.request<{ timeSeconds: number; playing: boolean }>('playback.getTime');
        set({ playbackMs: Math.round(pb.timeSeconds * 1000), playing: pb.playing });
      } catch {
        /* tab gone */
      }
    }, 1000);

    set({ ready: true });
  },

  setTab(tab) {
    set({ tab });
    if (tab === 'library') void get().loadLibrary();
  },
  setViewMode(viewMode) {
    set({ viewMode });
  },
  setFollow(follow) {
    set({ follow });
  },
  setSearchQuery(searchQuery) {
    set({ searchQuery });
  },

  async refreshPageState() {
    try {
      const state = await bus.request<VideoPageState>('acq.getState');
      set({
        videoId: state.videoId,
        availability: state.availability,
        tracks: state.tracks,
        metadata: state.metadata,
      });
      if (state.availability === 'available' && !get().transcript && !get().loading) {
        void get().acquire();
      }
    } catch (e) {
      logger.warn('panel', 'getState failed (no youtube tab?)', { error: String(e) });
      set({ videoId: null, availability: 'not-a-video-page', tracks: [], metadata: null });
    }
  },

  async acquire(trackId) {
    if (get().loading) return;
    set({ loading: true });
    try {
      const raw = await bus.request<unknown>('acq.acquire', trackId ? { trackId } : {});
      const parsed = AcquisitionResultSchema.safeParse(raw);
      if (!parsed.success) throw new Error('malformed acquisition result');
      const result: AcquisitionResult = parsed.data;
      if (result.ok) {
        set({ transcript: result.transcript, tracks: [...result.tracks], availability: 'available' });
      } else {
        set({ availability: result.reason, transcript: null });
      }
    } catch (e) {
      logger.error('panel', 'acquire failed', { error: String(e) });
      set({ availability: 'unknown', transcript: null });
    } finally {
      set({ loading: false });
    }
  },

  async seek(timeMs) {
    try {
      await bus.request('acq.seek', { timeMs });
    } catch (e) {
      logger.warn('panel', 'seek failed', { error: String(e) });
    }
  },

  async saveCurrentToLibrary() {
    const transcript = get().transcript;
    if (!transcript) return;
    await bus.request('library.save', { transcript });
    await get().loadLibrary();
  },

  async removeFromLibrary(transcriptId) {
    await bus.request('library.delete', { transcriptId });
    await get().loadLibrary();
  },

  async loadLibrary() {
    const recents = await bus.request<LibraryItem[]>('library.list');
    set({ recents, savedVideoIds: new Set(recents.map((r) => r.videoId)) });
  },

  async openSaved(transcriptId) {
    const t = await bus.request<Transcript | null>('transcript.get', { id: transcriptId });
    if (t) {
      set({ transcript: t, tab: 'transcript', availability: 'available' });
    }
  },

  async updateSettings(patch) {
    const updated = await bus.request<AppSettings>('settings.set', { patch });
    const locale = resolveLocale(updated.locale);
    set({ settings: updated, locale });
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  },

  tr(key, params) {
    return translate(get().locale, key, params);
  },
}));
