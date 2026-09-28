// Panel root: tab bar + active view.

import { useEffect, useState } from "react";
import { usePanelStore } from "./store.js";
import { TranscriptView } from "./views/TranscriptView.js";
import { ExportView } from "./views/ExportView.js";
import { LibraryView } from "./views/LibraryView.js";
import { AiView } from "./views/AiView.js";
import { NotesView } from "./views/NotesView.js";
import { SettingsView } from "./views/SettingsView.js";

const TABS = [
  "transcript",
  "export",
  "library",
  "notes",
  "ai",
  "settings",
] as const;
type AppTab = (typeof TABS)[number];

export function App() {
  const transcriptId = usePanelStore((s) => s.transcript?.id);
  const actionError = usePanelStore((s) => s.actionError);
  const ready = usePanelStore((s) => s.ready);
  const tab = usePanelStore((s) => s.tab);
  const setTab = usePanelStore((s) => s.setTab);
  const tr = usePanelStore((s) => s.tr);
  const theme = usePanelStore((s) => s.settings.theme);
  const init = usePanelStore((s) => s.init);
  const [utilityTab, setUtilityTab] = useState<"export" | null>(null);
  const activeTab: AppTab = utilityTab ?? tab;

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

  const activateTab = (id: AppTab) => {
    if (id === "export") {
      setUtilityTab("export");
      return;
    }
    setUtilityTab(null);
    setTab(id);
  };

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
      <header className="app-header">
        <span className="app-mark" aria-hidden="true">
          T
        </span>
        <div>
          <h1 className="app-title">{tr("app.name")}</h1>
          <div className="app-subtitle">YouTube</div>
        </div>
      </header>
      {actionError && (
        <p className="banner" role="alert">
          {actionError}
        </p>
      )}
      <nav className="tabbar" role="tablist" aria-label={tr("app.name")}>
        {TABS.map((id) => {
          const disabled = id === "export" && !transcriptId;
          return (
            <button
              key={id}
              id={`tab-${id}`}
              role="tab"
              type="button"
              aria-selected={activeTab === id}
              aria-controls={`panel-${id}`}
              aria-disabled={disabled || undefined}
              disabled={disabled}
              tabIndex={activeTab === id ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const idx = TABS.indexOf(id);
                const direction = document.documentElement.dir === "rtl" ? -1 : 1;
                let next = idx;
                for (let attempts = 0; attempts < TABS.length; attempts++) {
                  next =
                    e.key === "ArrowRight"
                      ? (next + direction + TABS.length) % TABS.length
                      : (next - direction + TABS.length) % TABS.length;
                  const nextId = TABS[next];
                  if (!nextId) return;
                  if (nextId === "export" && !transcriptId) continue;
                  activateTab(nextId);
                  document.getElementById(`tab-${nextId}`)?.focus();
                  return;
                }
              }}
              onClick={() => activateTab(id)}
            >
              {id === "export"
                ? tr("transcript.export")
                : tr(`nav.${id}` as "nav.transcript")}
            </button>
          );
        })}
      </nav>
      <div
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        tabIndex={0}
        className="panel"
      >
        {activeTab === "transcript" && <TranscriptView />}
        {activeTab === "export" && <ExportView />}
        {activeTab === "library" && <LibraryView />}
        <div className="workspace-pane" hidden={activeTab !== "ai"}>
          <AiView />
        </div>
        <div className="workspace-pane" hidden={activeTab !== "notes"}>
          <NotesView key={transcriptId} />
        </div>
        {activeTab === "settings" && <SettingsView />}
      </div>
    </div>
  );
}
