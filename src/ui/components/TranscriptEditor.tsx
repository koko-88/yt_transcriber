import { useEffect, useState } from "react";
import { usePanelStore } from "../store.js";
import { bus } from "../../platform/messaging.js";
import type { TranscriptEdit } from "../../storage/workspace-types.js";
import { formatTimestamp } from "../../core/export.js";

export function TranscriptEditor() {
  const s = usePanelStore();
  const transcript = s.transcript!;
  const [versions, setVersions] = useState<TranscriptEdit | null>(null);
  const [position, setPosition] = useState(0);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void bus
      .request<TranscriptEdit>("transcript.versions", { transcript })
      .then((record) => {
        if (current) {
          setVersions(record);
          const isOriginal =
            transcript.textHash === record.original.textHash &&
            transcript.textHash !== record.corrected.textHash;
          setOriginal(isOriginal);
          setText(
            (isOriginal ? record.original : record.corrected).segments[0]
              ?.text ?? "",
          );
        }
      })
      .catch(() => {
        if (current) setError(s.tr("general.error"));
      });
    return () => {
      current = false;
    };
    // The editor is keyed by transcript identity; edits must not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript.id]);
  const segment = (original ? versions?.original : versions?.corrected)
    ?.segments[position];
  const accept = (record: TranscriptEdit) => {
    if (usePanelStore.getState().transcript?.id !== record.transcriptId) return;
    setVersions(record);
    setOriginal(false);
    setText(record.corrected.segments[position]?.text ?? "");
    usePanelStore.setState({ transcript: record.corrected });
    void s.loadLibrary();
  };
  const update = async (undo: boolean) => {
    if (!versions || !segment) return;
    setBusy(true);
    setError("");
    try {
      accept(
        await bus.request<TranscriptEdit>(
          undo ? "transcript.undo" : "transcript.edit",
          undo
            ? {
                transcriptId: transcript.id,
                expectedHash: versions.corrected.textHash,
              }
            : {
                transcript: versions.corrected,
                index: segment.index,
                text,
                expectedHash: versions.corrected.textHash,
              },
        ),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : s.tr("general.error"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="workspace-card transcript-editor">
      <summary>{s.tr("workspace.corrections")}</summary>
      <p className="hint">{s.tr("workspace.editHint")}</p>
      {error && <p role="alert">{error}</p>}
      <label>
        {s.tr("workspace.corrections")}
        <select
          disabled={!versions || busy}
          value={original ? "original" : "corrected"}
          onChange={(e) => {
            const isOriginal = e.target.value === "original";
            setOriginal(isOriginal);
            if (versions) {
              const next = isOriginal ? versions.original : versions.corrected;
              setText(next.segments[position]?.text ?? "");
              usePanelStore.setState({ transcript: next });
            }
          }}
        >
          <option value="corrected">{s.tr("workspace.corrected")}</option>
          <option value="original">{s.tr("workspace.original")}</option>
        </select>
      </label>
      <label>
        {s.tr("workspace.segmentNumber")}
        <input
          type="number"
          min={1}
          max={transcript.segments.length}
          value={position + 1}
          disabled={busy}
          onChange={(e) => {
            const n = Math.min(
              transcript.segments.length - 1,
              Math.max(0, Number(e.target.value) - 1),
            );
            setPosition(n);
            setText(
              (original ? versions?.original : versions?.corrected)?.segments[n]
                ?.text ?? "",
            );
          }}
        />
      </label>
      {segment && (
        <button
          className="text-action"
          onClick={() => void s.seek(segment.startMs)}
        >
          {formatTimestamp(segment.startMs)}
        </button>
      )}
      <label>
        {s.tr("workspace.segmentText")}
        <textarea
          rows={3}
          maxLength={50_000}
          value={text}
          readOnly={original}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="toolbar">
        <button
          className="btn"
          disabled={busy || original || !text.trim() || text === segment?.text}
          onClick={() => void update(false)}
        >
          {s.tr("general.save")}
        </button>
        <button
          className="btn"
          disabled={busy || original || !versions?.undo.length}
          onClick={() => void update(true)}
        >
          {s.tr("workspace.undo")}
        </button>
      </div>
    </details>
  );
}
