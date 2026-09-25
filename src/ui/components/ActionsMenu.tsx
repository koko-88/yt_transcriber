// Actions popover: copy modes + export formats/templates.
// Uses a button trigger (not native <details>/<select>) for pointer, focus,
// and keyboard behavior consistent with the rest of the panel.

import { useEffect, useId, useRef, useState } from "react";
import type { Transcript } from "../../core/model.js";
import {
  copyTranscript,
  exportCsv,
  exportJson,
  exportMarkdown,
  exportSrt,
  exportTxt,
  exportVtt,
  makeExportFilename,
  type CopyMode,
  type ExportTextOptions,
} from "../../core/export.js";
import {
  DOC_TEMPLATES,
  type DocFormat,
  type DocTemplateId,
} from "../../core/export-templates.js";
import type { MessageKey } from "../../core/i18n.js";
import type { ViewMode } from "../store.js";

function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadBytes(
  filename: string,
  bytes: Uint8Array,
  mime: string,
): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const COPY_ACTIONS: { mode: CopyMode; key: MessageKey }[] = [
  { mode: "plain", key: "transcript.copy.plain" },
  { mode: "paragraph", key: "transcript.copy.paragraph" },
  { mode: "segment", key: "transcript.copy.segment" },
  { mode: "paragraph-timestamps", key: "transcript.copy.paragraphTs" },
  { mode: "segment-timestamps", key: "transcript.copy.segmentTs" },
  { mode: "markdown", key: "transcript.copy.markdown" },
];

const TEXT_EXPORTS: {
  id: string;
  key: MessageKey;
  run: (t: Transcript, opts: ExportTextOptions) => void;
}[] = [
  {
    id: "txt",
    key: "transcript.export.txt",
    run: (t, opts) =>
      downloadText(
        makeExportFilename(t.video.title, t.track.languageCode, "txt"),
        exportTxt(t, opts),
        "text/plain",
      ),
  },
  {
    id: "md",
    key: "transcript.export.md",
    run: (t, opts) =>
      downloadText(
        makeExportFilename(t.video.title, t.track.languageCode, "md"),
        exportMarkdown(t, opts),
        "text/markdown",
      ),
  },
  {
    id: "srt",
    key: "transcript.export.srt",
    run: (t) =>
      downloadText(
        makeExportFilename(t.video.title, t.track.languageCode, "srt"),
        exportSrt(t.segments),
        "application/x-subrip",
      ),
  },
  {
    id: "vtt",
    key: "transcript.export.vtt",
    run: (t) =>
      downloadText(
        makeExportFilename(t.video.title, t.track.languageCode, "vtt"),
        exportVtt(t.segments),
        "text/vtt",
      ),
  },
  {
    id: "json",
    key: "transcript.export.json",
    run: (t) =>
      downloadText(
        makeExportFilename(t.video.title, t.track.languageCode, "json"),
        exportJson(t),
        "application/json",
      ),
  },
  {
    id: "csv",
    key: "transcript.export.csv",
    run: (t) =>
      downloadText(
        makeExportFilename(t.video.title, t.track.languageCode, "csv"),
        exportCsv(t),
        "text/csv",
      ),
  },
];

interface Props {
  transcript: Transcript;
  viewMode: ViewMode;
  tr: (key: MessageKey, params?: Record<string, string | number>) => string;
  onSave?: () => void;
  onAddNote?: () => void;
  canSave: boolean;
}

export function ActionsMenu({
  transcript,
  viewMode,
  tr,
  onSave,
  onAddNote,
  canSave,
}: Props) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"root" | "export" | "doc">("root");
  const [docFormat, setDocFormat] = useState<DocFormat | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [includeTimestamps, setIncludeTimestamps] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setPanel("root");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPanel("root");
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const textOpts: ExportTextOptions = {
    view: viewMode === "paragraph" ? "paragraph" : "segment",
    timestamps: includeTimestamps,
    metadata: includeMetadata,
  };

  const copy = async (mode: CopyMode) => {
    await navigator.clipboard.writeText(copyTranscript(transcript, mode));
    setStatus(tr("transcript.copy.done"));
    setTimeout(() => setStatus(null), 1500);
  };

  const runDoc = async (format: DocFormat, templateId: DocTemplateId) => {
    setBusy(true);
    setStatus(null);
    try {
      const { generateDocument } = await import("../../core/export-docs.js");
      const doc = await generateDocument(transcript, format, templateId);
      downloadBytes(doc.filename, doc.bytes, doc.mime);
      setStatus(tr("general.success"));
      setOpen(false);
      setPanel("root");
    } catch {
      setStatus(tr("general.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="action-menu" ref={rootRef}>
      <button
        type="button"
        className="btn action-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setOpen((v) => !v);
          setPanel("root");
        }}
      >
        {tr("transcript.actions")}
      </button>
      {open && (
        <div
          id={menuId}
          className="action-popover"
          role="menu"
          aria-label={tr("transcript.actions")}
        >
          {panel === "root" && (
            <>
              <div className="action-section-label">
                {tr("transcript.copy")}
              </div>
              {COPY_ACTIONS.map((a) => (
                <button
                  key={a.mode}
                  type="button"
                  className="btn"
                  role="menuitem"
                  onClick={() => void copy(a.mode)}
                >
                  {tr(a.key)}
                </button>
              ))}
              {canSave && onSave && (
                <button
                  type="button"
                  className="btn"
                  role="menuitem"
                  onClick={() => {
                    onSave();
                    setOpen(false);
                  }}
                >
                  {tr("library.save")}
                </button>
              )}
              {onAddNote && (
                <button
                  type="button"
                  className="btn"
                  role="menuitem"
                  onClick={() => {
                    onAddNote();
                    setOpen(false);
                  }}
                >
                  {tr("notes.add")}
                </button>
              )}
              <button
                type="button"
                className="btn"
                role="menuitem"
                onClick={() => setPanel("export")}
              >
                {tr("transcript.export")}…
              </button>
            </>
          )}

          {panel === "export" && (
            <>
              <button
                type="button"
                className="btn action-back"
                onClick={() => setPanel("root")}
              >
                ← {tr("transcript.actions")}
              </button>
              <label className="action-check">
                <input
                  type="checkbox"
                  checked={includeTimestamps}
                  onChange={(e) => setIncludeTimestamps(e.target.checked)}
                />{" "}
                {tr("transcript.export.timestamps")}
              </label>
              <label className="action-check">
                <input
                  type="checkbox"
                  checked={includeMetadata}
                  onChange={(e) => setIncludeMetadata(e.target.checked)}
                />{" "}
                {tr("transcript.export.metadata")}
              </label>
              <div className="action-hint">
                {tr("transcript.export.viewHint", {
                  view:
                    viewMode === "paragraph"
                      ? tr("transcript.view.paragraph")
                      : tr("transcript.view.raw"),
                })}
              </div>
              {TEXT_EXPORTS.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  className="btn"
                  role="menuitem"
                  onClick={() => {
                    ex.run(transcript, textOpts);
                    setOpen(false);
                    setPanel("root");
                  }}
                >
                  {tr(ex.key)}
                </button>
              ))}
              <button
                type="button"
                className="btn"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setDocFormat("docx");
                  setPanel("doc");
                }}
              >
                {tr("transcript.export.docx")}…
              </button>
              <button
                type="button"
                className="btn"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setDocFormat("pdf");
                  setPanel("doc");
                }}
              >
                {tr("transcript.export.pdf")}…
              </button>
              <button
                type="button"
                className="btn"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setDocFormat("pptx");
                  setPanel("doc");
                }}
              >
                {tr("transcript.export.pptx")}…
              </button>
            </>
          )}

          {panel === "doc" && docFormat && (
            <>
              <button
                type="button"
                className="btn action-back"
                onClick={() => setPanel("export")}
              >
                ← {tr("transcript.export")}
              </button>
              <div className="action-section-label">
                {tr("transcript.export.chooseTemplate")}
              </div>
              {DOC_TEMPLATES.filter((t) => t.formats.includes(docFormat)).map(
                (t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="btn"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => void runDoc(docFormat, t.id)}
                  >
                    {tr(t.labelKey as MessageKey)}
                  </button>
                ),
              )}
            </>
          )}

          {status && (
            <div className="action-status" role="status">
              {status}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
