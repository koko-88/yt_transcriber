// Transcript tab: header, toolbar, and virtualized segment/paragraph list.

import { useMemo, useRef, useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePanelStore } from "../store.js";
import { bus } from "../../platform/messaging.js";
import { searchSegments, findHighlightRanges } from "../../core/search.js";
import { toParagraphs } from "../../core/paragraphs.js";
import {
  formatTimestamp,
  copyPlainText,
  copyWithTimestamps,
  exportTxt,
  exportMarkdown,
  exportSrt,
  exportVtt,
  exportJson,
  makeExportFilename,
} from "../../core/export.js";
import type { TranscriptSegment } from "../../core/model.js";
import type { Availability } from "../../core/result.js";
import type { MessageKey } from "../../core/i18n.js";

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Keep the object URL alive until the browser has claimed a large download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const AVAILABILITY_KEYS: Record<Availability, MessageKey> = {
  available: "availability.available",
  "available-partial": "availability.available-partial",
  "no-captions": "availability.no-captions",
  "login-required": "availability.login-required",
  "age-restricted": "availability.age-restricted",
  "members-only": "availability.members-only",
  "live-in-progress": "availability.live-in-progress",
  upcoming: "availability.upcoming",
  "not-a-video-page": "availability.not-a-video-page",
  "fetch-empty": "availability.fetch-empty",
  "needs-player-interaction": "availability.needs-player-interaction",
  "parse-failed": "availability.parse-failed",
  "unsupported-page-structure": "availability.unsupported-page-structure",
  "network-error": "availability.network-error",
  unknown: "availability.unknown",
};

function HighlightedText({
  text,
  ranges,
}: {
  text: string;
  ranges: readonly { start: number; end: number }[];
}) {
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let k = 0;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (const r of sorted) {
    const start = Math.max(0, Math.min(text.length, r.start));
    const end = Math.max(start, Math.min(text.length, r.end));
    if (start > cursor) parts.push(text.slice(cursor, start));
    if (end > start) {
      parts.push(
        <mark className="mark" key={k++}>
          {text.slice(start, end)}
        </mark>,
      );
    }
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function TranscriptView() {
  const s = usePanelStore();
  const parentRef = useRef<HTMLDivElement>(null);
  const transcript = s.transcript;
  const [highlightIds, setHighlightIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!transcript) {
      setHighlightIds(new Set());
      return;
    }
    void bus
      .request<{ startMs: number; endMs: number }[]>("highlights.list", {
        videoId: transcript.video.videoId,
      })
      .then((items) => {
        const ids = new Set<number>();
        for (const h of items) {
          for (const seg of transcript.segments) {
            if (seg.startMs === h.startMs && seg.endMs === h.endMs) {
              ids.add(seg.index);
            }
          }
        }
        setHighlightIds(ids);
      })
      .catch(() => undefined);
  }, [transcript]);

  const searchResults = useMemo(() => {
    if (!transcript || !s.searchQuery.trim()) return null;
    return searchSegments(transcript.segments, s.searchQuery);
  }, [transcript, s.searchQuery]);

  const filtered: readonly TranscriptSegment[] = useMemo(() => {
    if (!transcript) return [];
    if (!searchResults) return transcript.segments;
    return searchResults.map((r) => r.segment);
  }, [transcript, searchResults]);

  const rangeByIndex = useMemo(() => {
    const map = new Map<number, readonly { start: number; end: number }[]>();
    if (!searchResults) return map;
    for (const r of searchResults) map.set(r.segment.index, r.matchRanges);
    return map;
  }, [searchResults]);

  const paragraphs = useMemo(
    () => (s.viewMode === "paragraph" ? toParagraphs(filtered) : []),
    [filtered, s.viewMode],
  );

  const itemCount =
    s.viewMode === "paragraph" ? paragraphs.length : filtered.length;

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (s.viewMode === "paragraph" ? 90 : 32),
    overscan: 20,
  });

  // Follow playback: scroll to the active segment OR paragraph row.
  useEffect(() => {
    if (!s.follow || !transcript || itemCount === 0) return;
    if (s.viewMode === "paragraph") {
      const idx = paragraphs.findIndex(
        (p) => s.playbackMs >= p.startMs && s.playbackMs < p.endMs,
      );
      if (idx >= 0)
        virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
      return;
    }
    const idx = filtered.findIndex(
      (seg) => s.playbackMs >= seg.startMs && s.playbackMs < seg.endMs,
    );
    if (idx >= 0)
      virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.playbackMs, s.follow, s.viewMode, paragraphs, filtered]);

  if (s.availability !== "available" || !transcript) {
    const key = AVAILABILITY_KEYS[s.availability];
    return (
      <div className="view">
        <div
          className="banner"
          data-tone={s.availability === "unknown" ? "error" : undefined}
        >
          {s.loading ? (
            <span>
              <span className="spinner" />
              {s.tr("transcript.loading")}
            </span>
          ) : (
            s.tr(key)
          )}
        </div>
        {(s.availability === "available-partial" ||
          s.availability === "fetch-empty" ||
          s.availability === "needs-player-interaction" ||
          s.availability === "network-error" ||
          s.availability === "parse-failed" ||
          s.availability === "unknown" ||
          s.availability === "unsupported-page-structure") && (
          <button className="btn primary" onClick={() => void s.acquire()}>
            {s.tr("general.retry")}
          </button>
        )}
      </div>
    );
  }

  const doExport = (format: string) => {
    const title = transcript.video.title;
    const lang = transcript.track.languageCode;
    switch (format) {
      case "txt":
        download(
          makeExportFilename(title, lang, "txt"),
          exportTxt(transcript),
          "text/plain",
        );
        break;
      case "md":
        download(
          makeExportFilename(title, lang, "md"),
          exportMarkdown(transcript),
          "text/markdown",
        );
        break;
      case "srt":
        download(
          makeExportFilename(title, lang, "srt"),
          exportSrt(transcript.segments),
          "application/x-subrip",
        );
        break;
      case "vtt":
        download(
          makeExportFilename(title, lang, "vtt"),
          exportVtt(transcript.segments),
          "text/vtt",
        );
        break;
      case "json":
        download(
          makeExportFilename(title, lang, "json"),
          exportJson(transcript),
          "application/json",
        );
        break;
    }
  };

  return (
    <div className="view" style={{ padding: 0 }}>
      <div
        style={{
          padding: "12px 12px 0",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div className="meta">
          <h1>{transcript.video.title}</h1>
          {transcript.video.channelName && (
            <div className="channel">{transcript.video.channelName}</div>
          )}
        </div>

        <div className="toolbar">
          <input
            type="search"
            placeholder={s.tr("transcript.search.placeholder")}
            value={s.searchQuery}
            onChange={(e) => s.setSearchQuery(e.target.value)}
            aria-label={s.tr("transcript.search.placeholder")}
          />
          <select
            value={transcript.track.trackId}
            onChange={(e) => void s.acquire(e.target.value)}
            aria-label={s.tr("transcript.tracks")}
          >
            {s.tracks.map((tr) => (
              <option key={tr.trackId} value={tr.trackId}>
                {tr.languageLabel} (
                {tr.kind === "manual"
                  ? s.tr("transcript.tracks.manual")
                  : tr.kind === "asr"
                    ? s.tr("transcript.tracks.asr")
                    : s.tr("transcript.tracks.translated")}
                )
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar">
          <button
            className="btn"
            aria-pressed={s.viewMode === "paragraph"}
            onClick={() =>
              s.setViewMode(s.viewMode === "paragraph" ? "raw" : "paragraph")
            }
          >
            {s.viewMode === "paragraph"
              ? s.tr("transcript.view.paragraph")
              : s.tr("transcript.view.raw")}
          </button>
          <button
            className="btn"
            aria-pressed={s.follow}
            onClick={() => s.setFollow(!s.follow)}
          >
            {s.tr("transcript.follow")}
          </button>
          <button
            className="btn"
            onClick={() =>
              void navigator.clipboard.writeText(
                copyPlainText(transcript.segments),
              )
            }
          >
            {s.tr("transcript.copy.text")}
          </button>
          <button
            className="btn"
            onClick={() =>
              void navigator.clipboard.writeText(
                copyWithTimestamps(transcript.segments),
              )
            }
          >
            {s.tr("transcript.copy.timestamps")}
          </button>
          <select
            aria-label={s.tr("transcript.export")}
            value=""
            onChange={(e) => {
              if (e.target.value) doExport(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">{s.tr("transcript.export")}</option>
            <option value="txt">{s.tr("transcript.export.txt")}</option>
            <option value="md">{s.tr("transcript.export.md")}</option>
            <option value="srt">{s.tr("transcript.export.srt")}</option>
            <option value="vtt">{s.tr("transcript.export.vtt")}</option>
            <option value="json">{s.tr("transcript.export.json")}</option>
          </select>
          {s.videoId && !s.savedVideoIds.has(s.videoId) && (
            <button
              className="btn"
              onClick={() => void s.saveCurrentToLibrary()}
            >
              {s.tr("library.save")}
            </button>
          )}
          <button
            className="btn"
            type="button"
            onClick={() => {
              const text = window.prompt(s.tr("notes.placeholder"));
              if (!text?.trim() || !transcript) return;
              void bus.request("notes.upsert", {
                id: crypto.randomUUID(),
                videoId: transcript.video.videoId,
                transcriptId: transcript.id,
                text: text.trim(),
                startMs: s.playbackMs,
              });
            }}
          >
            {s.tr("notes.add")}
          </button>
        </div>
      </div>

      <div ref={parentRef} style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const style: React.CSSProperties = {
              position: "absolute",
              top: 0,
              insetInlineStart: 0,
              width: "100%",
              transform: `translateY(${vi.start}px)`,
            };
            if (s.viewMode === "paragraph") {
              const p = paragraphs[vi.index];
              if (!p) return null;
              const paraRanges = s.searchQuery.trim()
                ? findHighlightRanges(p.text, s.searchQuery)
                : [];
              const active =
                s.playbackMs >= p.startMs && s.playbackMs < p.endMs;
              return (
                <p
                  key={vi.key}
                  className={`paragraph${active ? " active" : ""}`}
                  style={style}
                  ref={virtualizer.measureElement}
                  data-index={vi.index}
                >
                  <button className="ts" onClick={() => void s.seek(p.startMs)}>
                    {formatTimestamp(p.startMs)}
                  </button>
                  <HighlightedText text={p.text} ranges={paraRanges} />
                </p>
              );
            }
            const seg = filtered[vi.index];
            if (!seg) return null;
            const active =
              s.playbackMs >= seg.startMs && s.playbackMs < seg.endMs;
            const highlighted = highlightIds.has(seg.index);
            return (
              <button
                key={vi.key}
                className={`segment${active ? " active" : ""}${highlighted ? " highlighted" : ""}`}
                style={style}
                ref={virtualizer.measureElement}
                data-index={vi.index}
                onClick={(e) => {
                  if (e.altKey && transcript) {
                    const id = crypto.randomUUID();
                    void bus
                      .request("highlights.upsert", {
                        id,
                        videoId: transcript.video.videoId,
                        transcriptId: transcript.id,
                        startMs: seg.startMs,
                        endMs: seg.endMs,
                        color: "var(--accent)",
                        createdAt: Date.now(),
                      })
                      .then(() =>
                        setHighlightIds((prev) => new Set(prev).add(seg.index)),
                      );
                    return;
                  }
                  void s.seek(seg.startMs);
                }}
                title={s.tr("highlights.add")}
              >
                <span className="ts">{formatTimestamp(seg.startMs)}</span>
                <span>
                  <HighlightedText
                    text={seg.text}
                    ranges={rangeByIndex.get(seg.index) ?? []}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
