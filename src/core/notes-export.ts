import type { Note } from "../storage/db.js";
import { formatTimestamp, makeYouTubeTimestampUrl } from "./export.js";
export function exportNotes(
  title: string,
  videoId: string,
  notes: readonly Note[],
): string {
  return (
    "# " +
    title.replace(/[\r\n]/g, " ") +
    "\n\n" +
    makeYouTubeTimestampUrl(videoId, 0) +
    "\n\n" +
    notes
      .map(
        (note) =>
          (note.startMs == null
            ? ""
            : "[" +
              formatTimestamp(note.startMs) +
              "](" +
              makeYouTubeTimestampUrl(videoId, note.startMs) +
              ")\n\n") + note.text,
      )
      .join("\n\n---\n\n")
  );
}
