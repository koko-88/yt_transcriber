import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { logger } from "@/core/logger";
import { AppError } from "@/core/errors";
import type { Transcript, VideoMetadata } from "@/core/model";

const DB_NAME = "yt-transcript-workbench";
const DB_VERSION = 1;

export interface Note {
  id: string; // crypto.randomUUID()
  videoId: string;
  transcriptId: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface Highlight {
  id: string;
  videoId: string;
  transcriptId: string;
  startMs: number;
  endMs: number;
  color: string;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  createdAt: number;
}

export interface VideoTag {
  videoId: string;
  tagId: string;
}

export interface Recent {
  videoId: string;
  transcriptId: string;
  viewedAt: number;
  // Metadata cached for quick rendering without loading full transcript
  title: string;
  channelName?: string;
  thumbnailUrl?: string;
}

export interface AiCacheEntry {
  key: string; // hash(transcriptHash + pipeline + providerModel + promptVersion)
  result: unknown;
  timestamp: number;
  sizeBytes: number;
}

export interface SecretStore {
  providerId: string;
  key: string; // Plaintext (stored in extension-origin IDB per threat model D15a)
  updatedAt: number;
}

export interface MetaStore {
  key: string;
  value: unknown;
}

export interface WorkbenchDB extends DBSchema {
  transcripts: {
    key: string; // transcript.id
    value: Transcript;
    indexes: {
      "by-video": string;
    };
  };
  videos: {
    key: string; // videoId
    value: VideoMetadata;
  };
  notes: {
    key: string;
    value: Note;
    indexes: {
      "by-video": string;
    };
  };
  highlights: {
    key: string;
    value: Highlight;
    indexes: {
      "by-video": string;
    };
  };
  tags: {
    key: string; // tagId
    value: Tag;
  };
  video_tags: {
    key: [string, string]; // [videoId, tagId]
    value: VideoTag;
    indexes: {
      "by-video": string;
      "by-tag": string;
    };
  };
  recents: {
    key: string; // videoId
    value: Recent;
    indexes: {
      "by-viewed": number;
    };
  };
  aiCache: {
    key: string;
    value: AiCacheEntry;
    indexes: {
      "by-time": number;
    };
  };
  secrets: {
    key: string; // providerId
    value: SecretStore;
  };
  meta: {
    key: string;
    value: MetaStore;
  };
}

let dbPromise: Promise<IDBPDatabase<WorkbenchDB>> | null = null;

/** Initialize the IndexedDB database */
export function getDb(): Promise<IDBPDatabase<WorkbenchDB>> {
  if (!dbPromise) {
    dbPromise = openDB<WorkbenchDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion) {
        logger.info(
          "storage",
          `Upgrading database from ${oldVersion} to ${newVersion}`,
        );

        if (oldVersion < 1) {
          const transcripts = db.createObjectStore("transcripts", {
            keyPath: "id",
          });
          transcripts.createIndex("by-video", "video.videoId");

          db.createObjectStore("videos", { keyPath: "videoId" });

          const notes = db.createObjectStore("notes", { keyPath: "id" });
          notes.createIndex("by-video", "videoId");

          const highlights = db.createObjectStore("highlights", {
            keyPath: "id",
          });
          highlights.createIndex("by-video", "videoId");

          db.createObjectStore("tags", { keyPath: "id" });

          const videoTags = db.createObjectStore("video_tags", {
            keyPath: ["videoId", "tagId"],
          });
          videoTags.createIndex("by-video", "videoId");
          videoTags.createIndex("by-tag", "tagId");

          const recents = db.createObjectStore("recents", {
            keyPath: "videoId",
          });
          recents.createIndex("by-viewed", "viewedAt");

          const aiCache = db.createObjectStore("aiCache", { keyPath: "key" });
          aiCache.createIndex("by-time", "timestamp");

          db.createObjectStore("secrets", { keyPath: "providerId" });
          db.createObjectStore("meta", { keyPath: "key" });
        }
      },
      blocked() {
        logger.warn("storage", "Database upgrade blocked by another tab");
      },
      blocking() {
        logger.warn("storage", "Database is blocking an upgrade, closing");
        if (dbPromise) {
          dbPromise.then((db) => db.close());
          dbPromise = null;
        }
      },
      terminated() {
        logger.error("storage", "Database terminated unexpectedly");
        dbPromise = null;
      },
    }).catch((err) => {
      logger.error("storage", "Failed to open database", {
        error: err.message,
      });
      dbPromise = null;
      throw new AppError({
        code: "STORE_READ_FAILED",
        message: "Failed to open local database",
        cause: err,
      });
    });
  }
  return dbPromise;
}
