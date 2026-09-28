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
      <div className="workspace-view-heading">
        <h2>{tr("nav.library")}</h2>
        <span className="count-pill" role="status">
          {busy
            ? tr("general.loading")
            : tr("workspace.savedCount", { count: items.length })}
        </span>
      </div>
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
            <span className="library-copy">
              <strong className="library-title">{item.title}</strong>
              <span className="library-meta">
                {item.channelName && <span>{item.channelName}</span>}
                <span className="language-pill">{item.languageCode}</span>
                <span>
                  {tr("transcript.segments", { count: item.segmentCount })}
                </span>
              </span>
            </span>
          </button>
          <button
            className="btn icon-button"
            aria-label={`${tr("library.unsave")}: ${item.title}`}
            title={`${tr("library.unsave")}: ${item.title}`}
            onClick={() => {
              if (window.confirm(tr("workspace.deleteSaved")))
                void s
                  .removeFromLibrary(item.transcriptId)
                  .catch(() => setError(tr("general.error")));
            }}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 7h16M10 4h4m-8 3 1 13h10l1-13M10 11v6m4-6v6" />
            </svg>
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
