import { videoIdFromUrl } from "../providers/youtube/session.js";

export type PanelContext =
  | { status: "video"; videoId: string; tabStatus?: string }
  | { status: "no-video-tab" | "unsupported-page"; videoId: null };

export function panelContextForTab(
  tab:
    | {
        id?: number | undefined;
        url?: string | undefined;
        status?: string | undefined;
      }
    | undefined,
): PanelContext {
  const url = tab?.url ?? "";
  const videoId = videoIdFromUrl(url);
  if (videoId && tab?.id != null) {
    return {
      status: "video",
      videoId,
      ...(tab.status ? { tabStatus: tab.status } : {}),
    };
  }
  return {
    status: url.startsWith("https://www.youtube.com/")
      ? "unsupported-page"
      : "no-video-tab",
    videoId: null,
  };
}
