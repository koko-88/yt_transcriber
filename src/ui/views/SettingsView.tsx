// Settings tab: theme, language, strict local mode, backup, diagnostics.

import { usePanelStore } from "../store.js";
import { logger } from "../../core/logger.js";
import { bus } from "../../platform/messaging.js";
import { useRef, useState } from "react";
import type { LibraryBackup } from "../../storage/backup.js";

export function SettingsView() {
  const s = usePanelStore();
  const [copied, setCopied] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportBackup = async () => {
    setBackupStatus(null);
    try {
      const data = await bus.request<LibraryBackup>("library.backup.export");
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transcript-workbench-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupStatus(s.tr("general.success"));
    } catch {
      setBackupStatus(s.tr("general.error"));
    }
  };

  const importBackup = async (file: File) => {
    setBackupStatus(null);
    try {
      const text = await file.text();
      if (text.length > 50 * 1024 * 1024) {
        setBackupStatus(s.tr("general.error"));
        return;
      }
      const raw = JSON.parse(text) as unknown;
      const result = await bus.request<{
        imported: number;
        notes: number;
        highlights: number;
      }>("library.backup.import", { data: raw });
      await s.loadLibrary();
      setBackupStatus(
        `${s.tr("general.success")} (${result.imported} transcripts)`,
      );
    } catch {
      setBackupStatus(s.tr("general.error"));
    }
  };

  return (
    <div className="view">
      <h2 style={{ margin: 0, fontSize: 15 }}>{s.tr("settings.title")}</h2>

      <div className="settings-row">
        <label htmlFor="set-theme">{s.tr("settings.theme")}</label>
        <select
          id="set-theme"
          value={s.settings.theme}
          onChange={(e) => {
            const theme = e.target.value as "light" | "dark" | "system";
            document.documentElement.dataset.theme =
              theme === "system" ? "" : theme;
            void s.updateSettings({ theme });
          }}
        >
          <option value="system">{s.tr("settings.theme.system")}</option>
          <option value="light">{s.tr("settings.theme.light")}</option>
          <option value="dark">{s.tr("settings.theme.dark")}</option>
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="set-locale">{s.tr("settings.language")}</label>
        <select
          id="set-locale"
          value={s.settings.locale}
          onChange={(e) =>
            void s.updateSettings({
              locale: e.target.value as "system" | "en" | "ar",
            })
          }
        >
          <option value="system">System</option>
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="set-strict">{s.tr("settings.strictMode")}</label>
        <div className="hint">{s.tr("settings.strictMode.description")}</div>
        <label style={{ fontWeight: 400 }}>
          <input
            id="set-strict"
            type="checkbox"
            checked={s.settings.strictMode}
            onChange={(e) =>
              void s.updateSettings({ strictMode: e.target.checked })
            }
          />{" "}
          {s.tr("settings.strictMode")}
        </label>
      </div>

      <div className="settings-row">
        <label>{s.tr("settings.backup")}</label>
        <div className="hint">
          Exports saved transcripts, notes and highlights. API keys are never
          included.
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            className="btn"
            type="button"
            onClick={() => void exportBackup()}
          >
            {s.tr("library.export")}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => fileRef.current?.click()}
          >
            {s.tr("library.import")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importBackup(f);
            }}
          />
        </div>
        {backupStatus && (
          <div className="hint" role="status">
            {backupStatus}
          </div>
        )}
      </div>

      <div className="settings-row">
        <label>{s.tr("settings.diagnostics")}</label>
        <div>
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard
                .writeText(logger.getDiagnostics())
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
            }}
          >
            {copied
              ? s.tr("settings.diagnostics.copied")
              : s.tr("settings.diagnostics")}
          </button>
        </div>
      </div>

      <div className="settings-row">
        <label>{s.tr("settings.about")}</label>
        <div className="hint">
          {s.tr("app.name")} · {s.tr("settings.version")} 1.0.0
        </div>
      </div>
    </div>
  );
}
