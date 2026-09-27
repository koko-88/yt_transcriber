import { getDb } from "./db.js";
import type { AiHistoryEntry } from "./workspace-types.js";
export async function listAiHistory(
  videoId: string,
): Promise<AiHistoryEntry[]> {
  return (
    await (await getDb()).getAllFromIndex("aiHistory", "by-video", videoId)
  ).sort((a, b) => b.createdAt - a.createdAt);
}
export async function saveAiHistory(entry: AiHistoryEntry): Promise<void> {
  await (await getDb()).put("aiHistory", entry);
}
export async function deleteAiHistory(id: string): Promise<void> {
  await (await getDb()).delete("aiHistory", id);
}
