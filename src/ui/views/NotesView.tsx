import { useEffect, useState } from "react";
import { usePanelStore } from "../store.js";
import { bus } from "../../platform/messaging.js";
import type { Note } from "../../storage/db.js";
import { exportNotes } from "../../core/notes-export.js";
import { formatTimestamp, makeExportFilename } from "../../core/export.js";

export function NotesView() {
  const s = usePanelStore();
  const { tr } = s;
  const transcript = s.transcript;
  const videoId = transcript?.video.videoId;
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState("");
  const [editing, setEditing] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    if (videoId)
      void bus
        .request<Note[]>("notes.list", { videoId })
        .then((items) => {
          if (current) setNotes(items);
        })
        .catch(() => {
          if (current) setError(tr("general.error"));
        });
    return () => {
      current = false;
    };
  }, [videoId, tr]);
  if (!transcript)
    return (
      <div className="view">
        <p>{tr("availability.not-a-video-page")}</p>
      </div>
    );
  const reset = () => {
    setText("");
    setSeconds("");
    setEditing(null);
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await bus.request("library.save", { transcript });
      await bus.request("notes.upsert", {
        id: editing?.id ?? crypto.randomUUID(),
        videoId: transcript.video.videoId,
        transcriptId: editing?.transcriptId ?? transcript.id,
        text: text.trim(),
        ...(seconds !== ""
          ? { startMs: Math.round(Number(seconds) * 1000) }
          : {}),
      });
      setNotes(
        await bus.request<Note[]>("notes.list", {
          videoId: transcript.video.videoId,
        }),
      );
      reset();
      await s.loadLibrary();
    } catch {
      setError(tr("general.error"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="view">
      <h2>{tr("nav.notes")}</h2>
      <p className="hint">{transcript.video.title}</p>
      {error && <p role="alert">{error}</p>}
      {!notes.length && <p>{tr("workspace.notesEmpty")}</p>}
      {notes.map((note) => (
        <article className="workspace-card" key={note.id}>
          {note.startMs != null && (
            <button
              className="text-action"
              onClick={() => void s.seek(note.startMs!)}
            >
              {formatTimestamp(note.startMs)}
            </button>
          )}
          <p className="preserve-text">{note.text}</p>
          <div className="toolbar">
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setEditing(note);
                setText(note.text);
                setSeconds(
                  note.startMs == null ? "" : String(note.startMs / 1000),
                );
              }}
            >
              {tr("workspace.edit")}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void bus
                  .request("notes.delete", { id: note.id })
                  .then(() => {
                    setNotes((items) => items.filter((n) => n.id !== note.id));
                    if (editing?.id === note.id) reset();
                  })
                  .catch(() => setError(tr("general.error")))
                  .finally(() => setBusy(false));
              }}
            >
              {tr("general.delete")}
            </button>
          </div>
        </article>
      ))}
      <form
        className="workspace-card"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          {tr("workspace.noteText")}
          <textarea
            required
            maxLength={50_000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
          />
        </label>
        <label>
          {tr("workspace.noteTime")}
          <input
            type="number"
            min="0"
            step="0.001"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </label>
        <div className="toolbar">
          <button
            className="btn primary"
            disabled={busy || !text.trim()}
            type="submit"
          >
            {tr(editing ? "general.save" : "workspace.noteAdd")}
          </button>
          {editing && (
            <button type="button" className="btn" onClick={reset}>
              {tr("general.cancel")}
            </button>
          )}
        </div>
      </form>
      <button
        className="btn"
        disabled={!notes.length}
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob(
              [
                exportNotes(
                  transcript.video.title,
                  transcript.video.videoId,
                  notes,
                ),
              ],
              { type: "text/markdown;charset=utf-8" },
            ),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = makeExportFilename(
            transcript.video.title + " notes",
            transcript.track.languageCode,
            "md",
          );
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        {tr("workspace.notesExport")}
      </button>
    </div>
  );
}
