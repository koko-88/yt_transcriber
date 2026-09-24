// Library tab: searchable recents list with open/remove.

import { useMemo, useState } from "react";
import { usePanelStore } from "../store.js";
import { normalizeForSearch } from "../../core/search.js";

export function LibraryView() {
  const s = usePanelStore();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query);
    if (!q) return s.recents;
    return s.recents.filter((item) => {
      const hay = normalizeForSearch(
        `${item.title} ${item.channelName ?? ""} ${item.videoId}`,
      );
      return hay.includes(q);
    });
  }, [s.recents, query]);

  if (s.recents.length === 0) {
    return (
      <div className="view">
        <div className="banner">
          <strong>{s.tr("library.empty")}</strong>
          <div>{s.tr("library.empty.hint")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <h2 style={{ margin: 0, fontSize: 15 }}>{s.tr("library.recents")}</h2>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={s.tr("library.search.placeholder")}
        aria-label={s.tr("library.search.placeholder")}
      />
      {filtered.length === 0 ? (
        <div className="banner">
          {s.tr("transcript.search.results", { count: 0 })}
        </div>
      ) : (
        filtered.map((item) => (
          <div key={item.transcriptId} style={{ display: "flex", gap: 6 }}>
            <button
              className="library-item"
              onClick={() => void s.openSaved(item.transcriptId)}
            >
              {item.thumbnailUrl && (
                <img src={item.thumbnailUrl} alt="" loading="lazy" />
              )}
              <span style={{ minWidth: 0 }}>
                <span className="title">{item.title}</span>
                <span className="sub" style={{ display: "block" }}>
                  {item.channelName ?? item.videoId} · {item.languageCode} ·{" "}
                  {s.tr("transcript.segments", { count: item.segmentCount })}
                </span>
              </span>
            </button>
            <button
              className="btn"
              aria-label={s.tr("library.unsave")}
              title={s.tr("library.unsave")}
              onClick={() => void s.removeFromLibrary(item.transcriptId)}
            >
              ✕
            </button>
          </div>
        ))
      )}
    </div>
  );
}
