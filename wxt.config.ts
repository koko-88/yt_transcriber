import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  entrypointsDir: "entrypoints",
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser }) => {
    const base = {
      name: "Transcript Workbench for YouTube",
      description:
        "Private local-first transcript workspace for YouTube with bilingual Arabic/English transcript support.",
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
      permissions: ["storage", "unlimitedStorage", "sidePanel", "offscreen"],
      host_permissions: [
        "https://www.youtube.com/*",
        "https://*.googlevideo.com/*",
        "https://huggingface.co/*",
        "https://*.hf.co/*",
        "https://*.xethub.hf.co/*",
      ],
      optional_host_permissions: [] as string[],
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
          "script-src 'self' 'wasm-unsafe-eval'",
          "object-src 'self'",
          `connect-src 'self' https://*.googlevideo.com https://huggingface.co https://*.hf.co https://*.xethub.hf.co`,
        ].join("; "),
      },
    };

    if (browser === "firefox") {
      return {
        ...base,
        permissions: base.permissions.filter(
          (p) => p !== "sidePanel" && p !== "offscreen",
        ),
        // MV2 has no optional_host_permissions key; no optional network origins
        // are required now that remote AI providers are not part of the product.
        optional_permissions: [] as string[],
        browser_specific_settings: {
          gecko: {
            id: "transcript-workbench@yt-transcriber",
            strict_min_version: "142.0",
            data_collection_permissions: {
              required: ["none"],
            },
          },
        },
      };
    }

    return {
      ...base,
      permissions: [...base.permissions, "webRequest"],
      minimum_chrome_version: "128",
    };
  },
});
