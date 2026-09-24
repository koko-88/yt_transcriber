import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
  Transcript,
  TranscriptSegment,
  TranscriptTrack,
} from "../../core/model.js";
import { usePanelStore } from "../store.js";
import { TranscriptView } from "./TranscriptView.js";

const track: TranscriptTrack = {
  trackId: "en",
  languageCode: "en",
  languageLabel: "English",
  kind: "manual",
  isDefaultForVideo: true,
};

const lines = [
  "The best way to understand a complex idea is to start with a simple example.",
  "Today we will look at how captions become a useful, searchable transcript.",
  "Each line stays connected to the moment it was spoken in the video.",
  "You can jump to any line, search for a phrase, or follow playback.",
  "A clear reading view keeps the words in focus while the video continues.",
  "When you are done, copy the text or export a file for later.",
];
const segments: TranscriptSegment[] = lines.map((text, index) => ({
  index,
  startMs: index * 5300,
  endMs: (index + 1) * 5300,
  text,
}));

const transcript: Transcript = {
  id: "youtube:jNQXAC9IVRw:en",
  schemaVersion: 1,
  video: {
    provider: "youtube",
    videoId: "jNQXAC9IVRw",
    canonicalUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    title: "How to make sense of a long video transcript",
    channelName: "Example channel",
    liveState: "none",
    capturedAt: 0,
  },
  track,
  segments,
  source: { method: "yt-player-url", format: "json3" },
  acquiredAt: 0,
  textHash: "storybook",
};

const meta = {
  title: "Workbench/Transcript",
  component: TranscriptView,
  decorators: [
    (Story) => (
      <div className="app">
        <div className="panel">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof TranscriptView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reading: Story = {
  render: () => {
    usePanelStore.setState({
      ready: true,
      shellStatus: "ready",
      availability: "available",
      videoId: transcript.video.videoId,
      tracks: [track],
      transcript,
      loading: false,
      viewMode: "raw",
      searchQuery: "",
      playbackMs: 11000,
      follow: false,
      savedVideoIds: new Set(),
    });
    return <TranscriptView />;
  },
};

export const WaitingForVideo: Story = {
  render: () => {
    usePanelStore.setState({
      ready: true,
      shellStatus: "no-video-tab",
      availability: "not-a-video-page",
      videoId: null,
      transcript: null,
      loading: false,
    });
    return <TranscriptView />;
  },
};
