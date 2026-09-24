import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  entrypointsDir: "entrypoints",
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser }) => {
    const base = {
      name: "Transcript Workbench for YouTube",
      description:
        "Private transcript workspace for YouTube. Your data stays local, your AI is your choice.",
      version: "1.0.0",
      action: {
        default_title: "Transcript Workbench",
        default_icon: {
          16: "icon/16.png",
          32: "icon/32.png",
          48: "icon/48.png",
          128: "icon/128.png",
        },
      },
      icons: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
        128: "icon/128.png",
      },
      permissions: ["storage", "unlimitedStorage", "sidePanel"],
      host_permissions: ["https://www.youtube.com/*"],
      optional_host_permissions: [
        "https://api.openai.com/*",
        "https://openrouter.ai/*",
        "https://api.groq.com/*",
        "https://api.mistral.ai/*",
        "https://generativelanguage.googleapis.com/*",
        "http://localhost/*",
        "http://127.0.0.1/*",
      ],
      commands: {
        _execute_action: {
          suggested_key: {
            default: "Ctrl+Shift+Y",
            mac: "Command+Shift+Y",
          },
        },
      },
      content_security_policy: {
        extension_pages: [
          "script-src 'self'",
          "object-src 'self'",
          `connect-src 'self' https://api.openai.com https://openrouter.ai https://api.groq.com https://api.mistral.ai https://generativelanguage.googleapis.com http://localhost:* http://127.0.0.1:*`,
        ].join("; "),
      },
    };

    if (browser === "firefox") {
      return {
        ...base,
        permissions: base.permissions.filter((p) => p !== "sidePanel"),
        // MV2 has no optional_host_permissions key; optional host patterns
        // must be listed under optional_permissions instead.
        optional_permissions: base.optional_host_permissions,
        browser_specific_settings: {
          gecko: {
            id: "transcript-workbench@yt-transcriber",
            strict_min_version: "140.0",
            // This extension collects no user data; required by AMO for new submissions.
            data_collection_permissions: {},
          },
        },
        sidebar_action: {
          default_title: "Transcript Workbench",
          default_panel: "src/entrypoints/sidepanel/index.html",
          default_icon: {
            16: "icon/16.png",
            32: "icon/32.png",
          },
        },
      };
    }

    return {
      ...base,
      minimum_chrome_version: "128",
      side_panel: {
        default_path: "src/entrypoints/sidepanel/index.html",
      },
    };
  },
});
