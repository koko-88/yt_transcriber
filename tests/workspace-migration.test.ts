import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { openDB } from "idb";
import { getDb } from "../src/storage/db";
import { fixture } from "./helpers/transcript";

it("upgrades a populated version-1 workspace without losing saved work", async () => {
  const old = await openDB("yt-transcript-workbench", 1, {
    upgrade(db) {
      const transcripts = db.createObjectStore("transcripts", {
        keyPath: "id",
      });
      transcripts.createIndex("by-video", "video.videoId");
      db.createObjectStore("videos", { keyPath: "videoId" });
      for (const name of ["notes", "highlights"]) {
        const store = db.createObjectStore(name, { keyPath: "id" });
        store.createIndex("by-video", "videoId");
      }
      db.createObjectStore("tags", { keyPath: "id" });
      const tags = db.createObjectStore("video_tags", {
        keyPath: ["videoId", "tagId"],
      });
      tags.createIndex("by-video", "videoId");
      tags.createIndex("by-tag", "tagId");
      const recents = db.createObjectStore("recents", { keyPath: "videoId" });
      recents.createIndex("by-viewed", "viewedAt");
      const cache = db.createObjectStore("aiCache", { keyPath: "key" });
      cache.createIndex("by-time", "timestamp");
      db.createObjectStore("secrets", { keyPath: "providerId" });
      db.createObjectStore("meta", { keyPath: "key" });
    },
  });
  const transcript = fixture();
  await old.put("transcripts", transcript);
  await old.put("notes", {
    id: "note",
    videoId: transcript.video.videoId,
    text: "Keep this",
  });
  old.close();
  const upgraded = await getDb();
  expect(upgraded.version).toBe(2);
  expect(await upgraded.get("transcripts", transcript.id)).toEqual(transcript);
  expect((await upgraded.get("notes", "note"))?.text).toBe("Keep this");
  expect([...upgraded.objectStoreNames]).toEqual(
    expect.arrayContaining(["edits", "aiHistory", "sttCheckpoints"]),
  );
});
