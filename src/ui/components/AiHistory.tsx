import { useEffect, useState } from "react";
import { usePanelStore } from "../store.js";
import { listAiHistory, deleteAiHistory } from "../../storage/ai-history.js";
import type { AiHistoryEntry } from "../../storage/workspace-types.js";
import { parseTimestampToken, validateCitations } from "../../ai/pipelines.js";
import { hashText, segmentsToText } from "../../core/hash.js";

export function AiHistory({ revision }: { revision: number }) {
  const s = usePanelStore();
  const { tr } = s;
  const videoId = s.transcript?.video.videoId;
  const [entries, setEntries] = useState<AiHistoryEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setEntries([]);
    setSelected("");
    setError("");
    if (videoId)
      void listAiHistory(videoId)
        .then((rows) => {
          if (current) {
            setEntries(rows);
            setSelected(rows[0]?.id ?? "");
          }
        })
        .catch(() => {
          if (current) setError(tr("general.error"));
        });
    return () => {
      current = false;
    };
  }, [videoId, revision, tr]);
  const entry = entries.find((item) => item.id === selected);
  return (
    <section className="workspace-card">
      <h3>{tr("workspace.history")}</h3>
      {error && <p role="alert">{error}</p>}
      {!entries.length ? (
        <p>{tr("workspace.historyEmpty")}</p>
      ) : (
        <>
          <select
            aria-label={tr("workspace.history")}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {entries.map((item) => (
              <option value={item.id} key={item.id}>
                {new Date(item.createdAt).toLocaleString(s.locale)} ·{" "}
                {tr(("ai." + item.pipeline) as "ai.summary")} · {item.provider}{" "}
                · {item.question ?? item.model}
              </option>
            ))}
          </select>
          {entry && (
            <>
              <p className="hint">
                {entry.provider} · {entry.model} ·{" "}
                {tr(
                  entry.pipeline === "qa"
                    ? "workspace.excerpts"
                    : "workspace.coverage",
                  entry.coverage,
                )}
              </p>
              {entry.transcriptHash !==
                hashText(segmentsToText(s.transcript?.segments ?? [])) && (
                <p className="hint">{tr("workspace.previousVersion")}</p>
              )}
              <div className="preserve-text">
                {entry.text
                  .split(/(\[\d{1,2}:\d{2}(?::\d{2})?\])/g)
                  .map((part, index) => {
                    const ms = /^\[/.test(part)
                      ? parseTimestampToken(part)
                      : null;
                    return ms != null &&
                      entry.citations.includes(ms) &&
                      validateCitations(
                        part,
                        s.transcript?.segments ?? [],
                        0,
                      ).valid.includes(ms) ? (
                      <button
                        key={index}
                        className="text-action"
                        onClick={() => void s.seek(ms)}
                      >
                        {part}
                      </button>
                    ) : (
                      part
                    );
                  })}
              </div>
              <div className="toolbar">
                <button
                  className="btn"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(entry.text)
                      .catch(() => setError(tr("general.error")))
                  }
                >
                  {tr("transcript.copy.text")}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    void deleteAiHistory(entry.id)
                      .then(() => {
                        const next = entries.filter(
                          (item) => item.id !== entry.id,
                        );
                        setEntries(next);
                        setSelected(next[0]?.id ?? "");
                      })
                      .catch(() => setError(tr("general.error")))
                  }
                >
                  {tr("general.delete")}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
