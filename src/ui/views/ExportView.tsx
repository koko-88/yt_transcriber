import { usePanelStore } from "../store.js";
import { ActionsMenu } from "../components/ActionsMenu.js";
import { DOC_TEMPLATES } from "../../core/export-templates.js";
import type { MessageKey } from "../../core/i18n.js";

export function ExportView({
  onNavigate,
}: {
  onNavigate: (tab: "notes") => void;
}) {
  const s = usePanelStore();
  const transcript = s.transcript;

  if (!transcript) {
    return (
      <div className="view empty-state export-view">
        <h2>
          {s.tr("transcript.export")} + {s.tr("transcript.actions")}
        </h2>
        <p>{s.tr("transcript.get")}</p>
      </div>
    );
  }

  return (
    <div className="view export-view">
      <div className="workspace-view-heading">
        <div>
          <h2>
            {s.tr("transcript.export")} + {s.tr("transcript.actions")}
          </h2>
          <p className="workspace-subtitle">{transcript.video.title}</p>
        </div>
      </div>

      <section className="workspace-card export-card">
        <ActionsMenu
          transcript={transcript}
          viewMode={s.viewMode}
          tr={s.tr}
          canSave={
            !s.recents.some((item) => item.transcriptId === transcript.id)
          }
          onSave={() => void s.saveCurrentToLibrary()}
          onAddNote={() => onNavigate("notes")}
        />
      </section>

      <section className="workspace-card export-templates">
        <h3>{s.tr("transcript.export.chooseTemplate")}</h3>
        <div className="export-template-grid">
          {DOC_TEMPLATES.map((template) => (
            <article className="export-template-card" key={template.id}>
              <strong>{s.tr(template.labelKey as MessageKey)}</strong>
              <span className="hint">
                {s.tr(template.descriptionKey as MessageKey)}
              </span>
              <span className="export-template-formats">
                {template.formats
                  .map((format) => format.toUpperCase())
                  .join(" · ")}
              </span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
