import { useEffect, useState } from "react";
import { usePanelStore, type LibraryItem } from "../store.js";
import { bus } from "../../platform/messaging.js";

export function LibraryView() {
  const s = usePanelStore();
  const { tr } = s;
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setBusy(true);
    const timer = setTimeout(() => {
      void bus
        .request<LibraryItem[]>("library.list", { query, language })
        .then((rows) => {
          if (current) {
            setItems(rows);
            setLimit(50);
            setError("");
          }
        })
        .catch(() => {
          if (current) setError(tr("general.error"));
        })
        .finally(() => {
          if (current) setBusy(false);
        });
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, language, s.recents, tr]);
  const languages = [
    ...new Set(s.recents.map((item) => item.languageCode)),
  ].sort();
  return (
    <div className="view">
      <h2>{tr("nav.library")}</h2>
      <input
        type="search"
        maxLength={1000}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tr("workspace.librarySearch")}
        aria-label={tr("workspace.librarySearch")}
      />
      <label>
        {tr("settings.language")}
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">{tr("workspace.allLanguages")}</option>
          {languages.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <p role="status">
        {busy
          ? tr("general.loading")
          : tr("workspace.savedCount", { count: items.length })}
      </p>
      {error && <p role="alert">{error}</p>}
      {!busy && !items.length && !query && !language && (
        <div className="banner">
          <strong>{tr("library.empty")}</strong>
          <div>{tr("library.empty.hint")}</div>
        </div>
      )}
      {!busy && !items.length && (query || language) ? (
        <p>{tr("transcript.search.empty")}</p>
      ) : null}
      {items.slice(0, limit).map((item) => (
        <div className="workspace-row" key={item.transcriptId}>
          <button
            className="library-item"
            onClick={() =>
              void s
                .openSaved(item.transcriptId)
                .catch(() => setError(tr("general.error")))
            }
          >
            <span>
              <strong>{item.title}</strong>
              <span className="hint">
                {item.channelName} · {item.languageCode} ·{" "}
                {tr("transcript.segments", { count: item.segmentCount })}
              </span>
            </span>
          </button>
          <button
            className="btn"
            aria-label={tr("library.unsave")}
            onClick={() => {
              if (window.confirm(tr("workspace.deleteSaved")))
                void s
                  .removeFromLibrary(item.transcriptId)
                  .catch(() => setError(tr("general.error")));
            }}
          >
            ×
          </button>
        </div>
      ))}
      {limit < items.length && (
        <button className="btn" onClick={() => setLimit((n) => n + 50)}>
          {tr("workspace.more")}
        </button>
      )}
    </div>
  );
}
