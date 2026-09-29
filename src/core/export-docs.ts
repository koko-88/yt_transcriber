// Lazy DOCX / PDF / PPTX generators. Imported dynamically from the Actions UI
// so binary libraries stay out of the sidepanel startup path.

import type { Transcript } from "./model.js";
import {
  buildDocRenderModel,
  getDocTemplate,
  templateChrome,
  type DocFormat,
  type DocTemplateChrome,
  type DocTemplateId,
} from "./export-templates.js";

export interface GeneratedDocument {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

type RenderLine = { timestamp: string; text: string };

function safeBase(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 80);
}

function bodyText(line: RenderLine, chrome: DocTemplateChrome): string {
  return chrome.showTimestamps
    ? `[${line.timestamp}] ${line.text}`
    : line.text;
}

function looksRtl(text: string): boolean {
  const rtl = text.match(/[\u0590-\u08ff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return rtl > latin;
}

async function canvasPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Could not render PDF page"));
    }, "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Browser-rendered PDF pages use the browser's Unicode shaping/font stack.
 * This avoids pdf-lib StandardFonts' WinAnsi limitation for Arabic/mixed text
 * without adding a remote font dependency. The resulting PDF is visual-first;
 * text is rendered into page images so complex scripts display consistently.
 */
async function generateBrowserPdf(
  title: string,
  language: string,
  channel: string,
  url: string,
  lines: readonly RenderLine[],
  chrome: DocTemplateChrome,
): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  const scale = 2;

  let canvas!: HTMLCanvasElement;
  let ctx!: CanvasRenderingContext2D;
  let y = margin;
  let pageNumber = 0;

  const resetCanvas = () => {
    canvas = document.createElement("canvas");
    canvas.width = pageWidth * scale;
    canvas.height = pageHeight * scale;
    const next = canvas.getContext("2d");
    if (!next) throw new Error("Canvas rendering is unavailable");
    ctx = next;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageWidth, pageHeight);

    if (chrome.visualStyle === "report") {
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, pageWidth, 22);
      ctx.fillStyle = "#2563eb";
      ctx.fillRect(0, 22, pageWidth, 4);
      y = margin + 10;
    } else if (chrome.visualStyle === "study") {
      ctx.fillStyle = "#eff6ff";
      ctx.fillRect(0, 0, pageWidth, 34);
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(0, 32, pageWidth, 2);
      y = margin + 4;
    } else {
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(margin, 28, 52, 3);
      y = margin;
    }
    pageNumber++;
  };

  const commitPage = async () => {
    const pngBytes = await canvasPngBytes(canvas);
    const image = await pdf.embedPng(pngBytes);
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
  };

  const nextPage = async () => {
    await commitPage();
    resetCanvas();
  };

  const setTextStyle = (size: number, bold: boolean, color: string) => {
    ctx.font = `${bold ? 700 : 400} ${size}px Arial, "Noto Sans Arabic", sans-serif`;
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
  };

  const wrap = (text: string, size: number, bold: boolean): string[] => {
    setTextStyle(size, bold, "#111827");
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
    return out;
  };

  const drawWrapped = async (
    text: string,
    size: number,
    options: {
      bold?: boolean;
      color?: string;
      gapAfter?: number;
      indent?: number;
    } = {},
  ) => {
    const bold = options.bold ?? false;
    const color = options.color ?? "#111827";
    const lineHeight = size * 1.45;
    const wrapped = wrap(text, size, bold);
    for (const part of wrapped) {
      if (y + lineHeight > pageHeight - margin) await nextPage();
      setTextStyle(size, bold, color);
      const rtl = looksRtl(part);
      ctx.direction = rtl ? "rtl" : "ltr";
      ctx.textAlign = rtl ? "right" : "left";
      const indent = options.indent ?? 0;
      const x = rtl ? pageWidth - margin - indent : margin + indent;
      ctx.fillText(part, x, y + size, maxWidth - indent);
      y += lineHeight;
    }
    y += options.gapAfter ?? 0;
  };

  resetCanvas();
  await drawWrapped(title, chrome.visualStyle === "report" ? 22 : 20, {
    bold: true,
    gapAfter: 8,
  });
  await drawWrapped(`${chrome.heading} · ${language}`, 10, {
    color: "#4b5563",
    gapAfter: 6,
  });
  if (chrome.showChannel && channel) {
    await drawWrapped(channel, 10, { bold: true, gapAfter: 4 });
  }
  if (chrome.showUrl && url) {
    await drawWrapped(url, 8, { color: "#2563eb", gapAfter: 14 });
  } else {
    y += 8;
  }

  for (const row of lines) {
    const text = bodyText(row, chrome);
    if (!text.trim()) continue;
    if (chrome.visualStyle === "study") {
      await drawWrapped(`• ${text}`, 11, { gapAfter: 8, indent: 8 });
    } else if (chrome.visualStyle === "report") {
      if (y + 18 > pageHeight - margin) await nextPage();
      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(margin, y - 4, maxWidth, 1);
      await drawWrapped(text, 11, { gapAfter: 10 });
    } else {
      await drawWrapped(text, 11, { gapAfter: 8 });
    }
  }

  if (pageNumber > 0) await commitPage();
  return new Uint8Array(await pdf.save());
}

async function generateVectorPdf(
  title: string,
  language: string,
  channel: string,
  url: string,
  lines: readonly RenderLine[],
  chrome: DocTemplateChrome,
): Promise<Uint8Array> {
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

  drawWrapped(title, 18, true);
  y -= 6;
  drawWrapped(`${chrome.heading} · ${language}`, 10);
  if (chrome.showChannel && channel) drawWrapped(channel, 10);
  if (chrome.showUrl && url) drawWrapped(url, 9, false, rgb(0.02, 0.37, 0.83));
  y -= 12;
  for (const row of lines) {
    drawWrapped(bodyText(row, chrome), 11);
    y -= 4;
  }
  return new Uint8Array(await pdf.save());
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
    if (chrome.showUrl && model.url) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: model.url, color: "065FD4", size: 18 }),
          ],
        }),
      );
    }
    children.push(new Paragraph({ text: "" }));
    for (const line of lines) {
      children.push(
        new Paragraph({
          children: [
            ...(chrome.showTimestamps
              ? [new TextRun({ text: `[${line.timestamp}] `, bold: true })]
              : []),
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
    const bytes =
      typeof document !== "undefined"
        ? await generateBrowserPdf(
            model.title,
            model.language,
            model.channel,
            model.url,
            lines,
            chrome,
          )
        : await generateVectorPdf(
            model.title,
            model.language,
            model.channel,
            model.url,
            lines,
            chrome,
          );
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
    fontSize: chrome.visualStyle === "report" ? 30 : 28,
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
  if (chrome.showUrl && model.url) {
    titleSlide.addText(model.url, {
      x: 0.5,
      y: 4.25,
      w: 9,
      h: 0.3,
      fontSize: 9,
      color: "2563EB",
    });
  }

  const perSlide = chrome.visualStyle === "study" ? 5 : 6;
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
        text:
          (chrome.visualStyle === "study" ? "• " : "") + bodyText(c, chrome),
        options: { breakLine: true },
      })),
      {
        x: 0.5,
        y: 0.9,
        w: 9,
        h: 4.5,
        fontSize: 14,
        valign: "top",
      },
    );
  }

  const out = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return {
    filename: `${base}.pptx`,
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes: new Uint8Array(out),
  };
}
