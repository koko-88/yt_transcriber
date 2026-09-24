import type { TranscriptTrack, VideoMetadata } from '@/core/model';
import type { AcquisitionResult } from '@/core/result';

/**
 * Interface for acquiring transcripts from a provider (e.g. YouTube).
 * Abstracted so the rest of the application doesn't know about YouTube internals.
 */
export interface TranscriptProvider {
  /**
   * Check if the current page context is a valid video page.
   * Extracts initial metadata if possible.
   */
  detectVideo(): Promise<{ ok: boolean; metadata?: VideoMetadata; reason?: string }>;

  /**
   * List available transcript tracks for the current video.
   */
  listTracks(videoId: string): Promise<{ ok: boolean; tracks: TranscriptTrack[]; reason?: string }>;

  /**
   * Fetch a specific transcript track.
   */
  fetchTrack(videoId: string, track: TranscriptTrack): Promise<AcquisitionResult>;

  /**
   * Seek the active player to a specific timestamp.
   */
  seek(videoId: string, timeMs: number): Promise<boolean>;
  
  /**
   * Subscribe to playback time updates.
   * Returns a function to unsubscribe.
   */
  subscribePlayback(onTimeUpdate: (timeMs: number) => void): () => void;
}
