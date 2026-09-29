// Document template registry — extensible contract for PDF / PPTX / DOCX layouts.
// Templates are code-defined masters; more can be registered without rewriting
// the export pipeline.

import type { Transcript } from "./model.js";
import { toParagraphs } from "./paragraphs.js";
import { formatTimestamp } from "./export.js";

export type DocTemplateId = "clean-transcript" | "study-notes" | "report";

export type DocFormat = "pdf" | "pptx" | "docx";

export interface DocTemplateMeta {
  id: DocTemplateId;
  /** i18n message key for the label. */
  labelKey: string;
  descriptionKey: string;
  formats: readonly DocFormat[];
}

export interface DocRenderModel {
  title: string;
  subtitle: string;
  channel: string;
  url: string;
  language: string;
  paragraphs: readonly { timestamp: string; text: string }[];
  segments: readonly { timestamp: string; text: string }[];
}

export interface DocTemplateChrome {
  heading: string;
  bodyMode: "paragraph" | "segment";
  showChannel: boolean;
  showUrl: boolean;
  showTimestamps: boolean;
  visualStyle: "clean" | "study" | "report";
}

export const DOC_TEMPLATES: readonly DocTemplateMeta[] = [
  {
    id: "clean-transcript",
    labelKey: "transcript.template.clean",
    descriptionKey: "transcript.template.clean.hint",
    formats: ["pdf", "pptx", "docx"],
  },
  {
    id: "study-notes",
    labelKey: "transcript.template.study",
    descriptionKey: "transcript.template.study.hint",
    formats: ["pdf", "pptx", "docx"],
  },
  {
    id: "report",
    labelKey: "transcript.template.report",
    descriptionKey: "transcript.template.report.hint",
    formats: ["pdf", "pptx", "docx"],
  },
] as const;

export function getDocTemplate(id: DocTemplateId): DocTemplateMeta {
  const t = DOC_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown document template: ${id}`);
  return t;
}

export function buildDocRenderModel(transcript: Transcript): DocRenderModel {
  return {
    title: transcript.video.title,
    subtitle: "Transcript Workbench",
    channel: transcript.video.channelName ?? "",
    url: transcript.video.canonicalUrl,
    language: `${transcript.track.languageLabel} (${transcript.track.kind})`,
    paragraphs: toParagraphs(transcript.segments).map((p) => ({
      timestamp: formatTimestamp(p.startMs),
      text: p.text,
    })),
    segments: transcript.segments.map((s) => ({
      timestamp: formatTimestamp(s.startMs),
      text: s.text,
    })),
  };
}

/** Layout behavior that varies by template. */
export function templateChrome(id: DocTemplateId): DocTemplateChrome {
  switch (id) {
    case "study-notes":
      return {
        heading: "Study notes",
        bodyMode: "paragraph",
        showChannel: true,
        showUrl: false,
        showTimestamps: false,
        visualStyle: "study",
      };
    case "report":
      return {
        heading: "Professional report",
        bodyMode: "paragraph",
        showChannel: true,
        showUrl: true,
        showTimestamps: false,
        visualStyle: "report",
      };
    case "clean-transcript":
    default:
      return {
        heading: "Transcript",
        bodyMode: "paragraph",
        showChannel: false,
        showUrl: true,
        showTimestamps: false,
        visualStyle: "clean",
      };
  }
}
