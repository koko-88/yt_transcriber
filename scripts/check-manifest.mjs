// Node.js verification script.

// Post-build manifest assertions. Fails the build if the generated manifests
// violate the permission/CSP policy documented in SECURITY.md.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok ${name}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

function load(rel) {
  try {
    return JSON.parse(readFileSync(join(root, rel), "utf8"));
  } catch {
    return null;
  }
}

const ALLOWED_PERMISSIONS = new Set([
  "storage",
  "unlimitedStorage",
  "sidePanel",
  "offscreen",
]);
const ALLOWED_HOSTS = [
  "https://www.youtube.com/*",
  "https://*.googlevideo.com/*",
  "https://huggingface.co/*",
  "https://*.hf.co/*",
  "https://*.xethub.hf.co/*",
];
const PROVIDER_ORIGINS = [
  "https://api.openai.com/*",
  "https://openrouter.ai/*",
  "https://api.groq.com/*",
  "https://api.mistral.ai/*",
  "https://generativelanguage.googleapis.com/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
];

const filter = new Set(
  process.argv.slice(2).filter((a) => a === "chrome" || a === "firefox"),
);

for (const [browserName, rel] of [
  ["chrome", ".output/chrome-mv3/manifest.json"],
  ["firefox", ".output/firefox-mv2/manifest.json"],
]) {
  if (filter.size > 0 && !filter.has(browserName)) continue;
  const m = load(rel);
  if (!m) {
    console.log(`  skip ${browserName} (not built: ${rel})`);
    continue;
  }
  console.log(`checking ${rel}`);
  check(`${browserName}: name`, m.name === "Transcript Workbench for YouTube");
  check(
    `${browserName}: permissions minimal`,
    (m.permissions ?? []).every(
      (p) => ALLOWED_PERMISSIONS.has(p) || ALLOWED_HOSTS.includes(p),
    ),
    JSON.stringify(m.permissions),
  );
  check(
    `${browserName}: only media and model host permissions`,
    (m.host_permissions ?? []).every((h) => ALLOWED_HOSTS.includes(h)),
  );
  check(
    `${browserName}: no web_accessible_resources`,
    !m.web_accessible_resources,
  );
  check(`${browserName}: no externally_connectable`, !m.externally_connectable);
  const optional = m.optional_host_permissions ?? [];
  const ffOptional = m.optional_permissions ?? [];
  const allOptional = [...optional, ...ffOptional];
  check(
    `${browserName}: AI provider origins only optional`,
    allOptional.every((o) => PROVIDER_ORIGINS.includes(o)),
    JSON.stringify(allOptional),
  );
  check(
    `${browserName}: AI provider origins requestable`,
    PROVIDER_ORIGINS.every((o) => allOptional.includes(o)),
    JSON.stringify(allOptional),
  );
  const csp =
    typeof m.content_security_policy === "string"
      ? m.content_security_policy
      : (m.content_security_policy?.extension_pages ?? "");
  check(
    `${browserName}: CSP script-src 'self'`,
    csp.includes("script-src 'self'"),
  );
  check(
    `${browserName}: CSP no remote script`,
    !/script-src[^;]*https?:/.test(csp),
  );

  if (browserName === "firefox") {
    check(
      `${browserName}: WXT sidebar entrypoint`,
      m.sidebar_action?.default_panel === "sidepanel.html",
      JSON.stringify(m.sidebar_action),
    );
    const dcp = m.browser_specific_settings?.gecko?.data_collection_permissions;
    check(
      `${browserName}: data_collection_permissions present`,
      !!dcp,
      JSON.stringify(dcp),
    );
    check(
      `${browserName}: required none (no required transmission)`,
      Array.isArray(dcp?.required) &&
        dcp.required.length === 1 &&
        dcp.required[0] === "none",
      JSON.stringify(dcp),
    );
    check(
      `${browserName}: optional websiteContent for AI`,
      Array.isArray(dcp?.optional) && dcp.optional.includes("websiteContent"),
      JSON.stringify(dcp),
    );
  }
  if (browserName === "chrome") {
    check(
      `${browserName}: WXT side-panel entrypoint`,
      m.side_panel?.default_path === "sidepanel.html",
      JSON.stringify(m.side_panel),
    );
    check(`${browserName}: no detached popup action`, !m.action?.default_popup);
  }
}

if (failures > 0) {
  console.error(`\n${failures} manifest check(s) failed`);
  process.exit(1);
}
console.log("\nmanifest checks passed");
