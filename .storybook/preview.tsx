import type { Preview } from "@storybook/react-vite";
import "../src/ui/theme.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    a11y: { test: "error" },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          width: 360,
          height: 620,
          border: "1px solid var(--ui-border)",
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export default preview;
