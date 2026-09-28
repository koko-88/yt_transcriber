import { usePanelStore } from "../store.js";
import { ActionsMenu } from "../components/ActionsMenu.js";

export function ExportView() {
  const s = usePanelStore();
  const transcript = s.transcript;

  if (!transcript) {
    return (
      <div className="view empty-state export-view">
        <h2>{s.tr("transcript.export")}</h2>
        <p>{s.tr("transcript.get")}</p>
      </div>
    );
  }

  return (
    <div className="view export-view">
      <div className="workspace-view-heading">
        <div>
          <h2>{s.tr("transcript.export")}</h2>
          <p className="workspace-subtitle">{transcript.video.title}</p>
        </div>
      </div>

      <section className="workspace-card export-card">
        <ActionsMenu
          transcript={transcript}
          viewMode={s.viewMode}
          tr={s.tr}
          canSave={false}
        />
      </section>
    </div>
  );
}
