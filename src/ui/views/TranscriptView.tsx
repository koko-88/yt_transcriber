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
import type { ShellStatus } from "../store.js";

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

const SHELL_KEYS: Record<Exclude<ShellStatus, "ready">, MessageKey> = {
  "no-video-tab": "shell.no-video-tab",
  "unsupported-page": "shell.unsupported-page",
  "content-unavailable": "shell.content-unavailable",
  "player-initializing": "shell.player-initializing",
  "routing-failed": "shell.routing-failed",
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

  if (
    s.shellStatus !== "ready" ||
    s.availability !== "available" ||
    !transcript
  ) {
    const key =
      s.shellStatus === "ready"
        ? AVAILABILITY_KEYS[s.availability]
        : SHELL_KEYS[s.shellStatus];
    return (
      <div className="view empty-state">
        {s.loading && <span className="spinner" aria-hidden="true" />}
        <h2>{s.tr("nav.transcript")}</h2>
        <p role="status">
          {s.loading ? s.tr("transcript.loading") : s.tr(key)}
        </p>
        {s.shellStatus !== "ready" &&
          s.shellStatus !== "no-video-tab" &&
          s.shellStatus !== "unsupported-page" && (
            <button
              className="btn primary"
              onClick={() => void s.refreshPageState()}
            >
              {s.tr("shell.reconnect")}
            </button>
          )}
        {s.shellStatus === "ready" &&
          s.videoId &&
          !s.loading &&
          (s.availability === "available" ||
            s.availability === "available-partial" ||
            s.availability === "fetch-empty" ||
            s.availability === "needs-player-interaction" ||
            s.availability === "network-error" ||
            s.availability === "parse-failed" ||
            s.availability === "unknown" ||
            s.availability === "unsupported-page-structure") && (
            <button className="btn primary" onClick={() => void s.acquire()}>
              {s.tr(
                s.availability === "available"
                  ? "transcript.get"
                  : "general.retry",
              )}
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
    <div className="view transcript-view">
      <div className="transcript-head">
        <div className="meta">
          <h2>{transcript.video.title}</h2>
          {transcript.video.channelName && (
            <div className="channel">{transcript.video.channelName}</div>
          )}
        </div>

        <div className="toolbar transcript-search">
          <input
            type="search"
            placeholder={s.tr("transcript.search.placeholder")}
            value={s.searchQuery}
            onChange={(e) => s.setSearchQuery(e.target.value)}
            aria-label={s.tr("transcript.search.placeholder")}
          />
        </div>

        <div className="transcript-controls">
          <select
            value={transcript.track.trackId}
            onChange={(e) => void s.acquire(e.target.value)}
            aria-label={s.tr("transcript.tracks")}
            disabled={s.loading || s.tracks.length === 0}
          >
            {!s.tracks.some(
              (track) => track.trackId === transcript.track.trackId,
            ) && (
              <option value={transcript.track.trackId}>
                {transcript.track.languageLabel}
              </option>
            )}
            {s.tracks.map((track) => (
              <option key={track.trackId} value={track.trackId}>
                {track.languageLabel} (
                {track.kind === "manual"
                  ? s.tr("transcript.tracks.manual")
                  : track.kind === "asr"
                    ? s.tr("transcript.tracks.asr")
                    : s.tr("transcript.tracks.translated")}
                )
              </option>
            ))}
          </select>

          <div
            className="view-toggle"
            role="group"
            aria-label={s.tr("transcript.segments", {
              count: transcript.segments.length,
            })}
          >
            <button
              type="button"
              className="btn"
              aria-pressed={s.viewMode === "paragraph"}
              onClick={() => s.setViewMode("paragraph")}
            >
              {s.tr("transcript.view.paragraph")}
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={s.viewMode === "raw"}
              onClick={() => s.setViewMode("raw")}
            >
              {s.tr("transcript.view.raw")}
            </button>
          </div>
          <button
            type="button"
            className="btn"
            aria-pressed={s.follow}
            onClick={() => s.setFollow(!s.follow)}
          >
            {s.tr("transcript.follow")}
          </button>
          <details className="action-menu">
            <summary className="btn">{s.tr("transcript.actions")}</summary>
            <div className="action-popover">
              <button
                type="button"
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
                type="button"
                className="btn"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    copyWithTimestamps(transcript.segments),
                  )
                }
              >
                {s.tr("transcript.copy.timestamps")}
              </button>
              {s.videoId && !s.savedVideoIds.has(s.videoId) && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void s.saveCurrentToLibrary()}
                >
                  {s.tr("library.save")}
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const text = window.prompt(s.tr("notes.placeholder"));
                  if (!text?.trim()) return;
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
              <label htmlFor="transcript-export">
                {s.tr("transcript.export")}
              </label>
              <select
                id="transcript-export"
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
            </div>
          </details>
        </div>
      </div>

      <div className="transcript-summary" role="status" aria-live="polite">
        <span>
          {s.searchQuery.trim()
            ? s.tr("transcript.search.results", { count: filtered.length })
            : s.tr("transcript.segments", {
                count: transcript.segments.length,
              })}
        </span>
        {!s.follow && s.playbackMs > 0 && (
          <button
            type="button"
            className="text-action"
            onClick={() => {
              const idx = filtered.findIndex(
                (seg) =>
                  s.playbackMs >= seg.startMs && s.playbackMs < seg.endMs,
              );
              if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "center" });
            }}
          >
            {s.tr("transcript.jumpToNow")}
          </button>
        )}
      </div>

      <div
        ref={parentRef}
        className="transcript-scroll"
        role="region"
        aria-label={s.tr("nav.transcript")}
      >
        {itemCount === 0 && (
          <div className="no-results">{s.tr("transcript.search.empty")}</div>
        )}
        <div
          className="transcript-list"
          style={{ height: virtualizer.getTotalSize() }}
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
                  <button
                    className="ts"
                    aria-current={active ? "true" : undefined}
                    onClick={() => void s.seek(p.startMs)}
                  >
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
                aria-current={active ? "true" : undefined}
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
                        color: "var(--ui-accent)",
                        createdAt: Date.now(),
                      })
                      .then(() =>
                        setHighlightIds((prev) => new Set(prev).add(seg.index)),
                      );
                    return;
                  }
                  void s.seek(seg.startMs);
                }}
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
