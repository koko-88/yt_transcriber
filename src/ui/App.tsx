// Panel root: tab bar + active view.

import { useEffect } from "react";
import { usePanelStore } from "./store.js";
import { TranscriptView } from "./views/TranscriptView.js";
import { LibraryView } from "./views/LibraryView.js";
import { AiView } from "./views/AiView.js";
import { SettingsView } from "./views/SettingsView.js";

const TABS = ["transcript", "library", "ai", "settings"] as const;

export function App() {
  const ready = usePanelStore((s) => s.ready);
  const tab = usePanelStore((s) => s.tab);
  const setTab = usePanelStore((s) => s.setTab);
  const tr = usePanelStore((s) => s.tr);
  const theme = usePanelStore((s) => s.settings.theme);
  const init = usePanelStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  if (!ready) {
    return (
      <div className="app">
        <div className="view">
          <div className="banner">
            <span className="spinner" />
            {tr("general.loading")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="tabbar" role="tablist" aria-label={tr("app.name")}>
        {TABS.map((id) => (
          <button
            key={id}
            id={`tab-${id}`}
            role="tab"
            type="button"
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const idx = TABS.indexOf(tab);
              const next =
                e.key === "ArrowRight"
                  ? (idx + 1) % TABS.length
                  : (idx - 1 + TABS.length) % TABS.length;
              const nextId = TABS[next];
              if (!nextId) return;
              setTab(nextId);
              document.getElementById(`tab-${nextId}`)?.focus();
            }}
            onClick={() => setTab(id)}
          >
            {tr(`nav.${id}` as "nav.transcript")}
          </button>
        ))}
      </nav>
      <div
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className="panel"
      >
        {tab === "transcript" && <TranscriptView />}
        {tab === "library" && <LibraryView />}
        {tab === "ai" && <AiView />}
        {tab === "settings" && <SettingsView />}
      </div>
    </div>
  );
}
