// Lazy DOCX / PDF / PPTX generators. Imported dynamically from the Actions UI
// so binary libraries stay out of the sidepanel startup path.

import type { Transcript } from "./model.js";
import {
  buildDocRenderModel,
  getDocTemplate,
  templateChrome,
  type DocFormat,
  type DocTemplateId,
} from "./export-templates.js";

export interface GeneratedDocument {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

function safeBase(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 80);
}

export async function generateDocument(
  transcript: Transcript,
  format: DocFormat,
  templateId: DocTemplateId,
): Promise<GeneratedDocument> {
  getDocTemplate(templateId); // validate
  const model = buildDocRenderModel(transcript);
  const chrome = templateChrome(templateId);
  const base = `${safeBase(model.title)}_${transcript.track.languageCode}`;
  const lines =
    chrome.bodyMode === "paragraph" ? model.paragraphs : model.segments;

  if (format === "docx") {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } =
      await import("docx");
    const children = [
      new Paragraph({
        text: model.title,
        heading: HeadingLevel.TITLE,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `${chrome.heading} · ${model.language}`,
            italics: true,
          }),
        ],
      }),
    ];
    if (chrome.showChannel && model.channel) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: model.channel, size: 20 })],
        }),
      );
    }
    children.push(
      new Paragraph({
        children: [new TextRun({ text: model.url, color: "065FD4", size: 18 })],
      }),
      new Paragraph({ text: "" }),
    );
    for (const line of lines) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${line.timestamp}] `, bold: true }),
            new TextRun({ text: line.text }),
          ],
          spacing: { after: 200 },
        }),
      );
    }
    const doc = new Document({
      sections: [{ children }],
    });
    const blob = await Packer.toBlob(doc);
    const buf = new Uint8Array(await blob.arrayBuffer());
    return {
      filename: `${base}.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: buf,
    };
  }

  if (format === "pdf") {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 48;
    const maxWidth = pageWidth - margin * 2;
    let page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    const drawWrapped = (
      text: string,
      size: number,
      useBold = false,
      color = rgb(0.06, 0.06, 0.06),
    ) => {
      const f = useBold ? bold : font;
      const words = text.split(/\s+/);
      let line = "";
      const flush = () => {
        if (!line) return;
        if (y < margin + size) {
          page = pdf.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(line, { x: margin, y, size, font: f, color });
        y -= size + 4;
        line = "";
      };
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(next, size) > maxWidth) {
          flush();
          line = w;
        } else {
          line = next;
        }
      }
      flush();
    };

    drawWrapped(model.title, 18, true);
    y -= 6;
    drawWrapped(`${chrome.heading} · ${model.language}`, 10);
    if (chrome.showChannel && model.channel) drawWrapped(model.channel, 10);
    drawWrapped(model.url, 9, false, rgb(0.02, 0.37, 0.83));
    y -= 12;
    for (const row of lines) {
      drawWrapped(`[${row.timestamp}] ${row.text}`, 11);
      y -= 4;
    }
    const bytes = await pdf.save();
    return {
      filename: `${base}.pdf`,
      mime: "application/pdf",
      bytes,
    };
  }

  // pptx
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.author = "Transcript Workbench";
  pptx.title = model.title;
  const titleSlide = pptx.addSlide();
  titleSlide.addText(model.title, {
    x: 0.5,
    y: 2.2,
    w: 9,
    h: 1,
    fontSize: 28,
    bold: true,
  });
  titleSlide.addText(`${chrome.heading} · ${model.language}`, {
    x: 0.5,
    y: 3.3,
    w: 9,
    h: 0.4,
    fontSize: 14,
    color: "606060",
  });
  if (chrome.showChannel && model.channel) {
    titleSlide.addText(model.channel, {
      x: 0.5,
      y: 3.8,
      w: 9,
      h: 0.3,
      fontSize: 12,
    });
  }

  const perSlide = 6;
  for (let i = 0; i < lines.length; i += perSlide) {
    const chunk = lines.slice(i, i + perSlide);
    const slide = pptx.addSlide();
    slide.addText(chrome.heading, {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.4,
      fontSize: 14,
      bold: true,
    });
    slide.addText(
      chunk.map((c) => ({
        text: `[${c.timestamp}] ${c.text}`,
        options: { breakLine: true },
      })),
      { x: 0.5, y: 0.9, w: 9, h: 4.5, fontSize: 14, valign: "top" },
    );
  }

  const out = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return {
    filename: `${base}.pptx`,
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes: new Uint8Array(out),
  };
}
