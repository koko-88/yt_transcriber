// Node.js verification script.

/* eslint-env node */

// Post-build manifest assertions. Fails the build if the generated manifests
// violate the permission/CSP policy documented in SECURITY.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

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
]);
const ALLOWED_HOSTS = ["https://www.youtube.com/*"];
const PROVIDER_ORIGINS = [
  "https://api.openai.com/*",
  "https://openrouter.ai/*",
  "https://api.groq.com/*",
  "https://api.mistral.ai/*",
  "https://generativelanguage.googleapis.com/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
];

for (const [browserName, rel] of [
  ["chrome", ".output/chrome-mv3/manifest.json"],
  ["firefox", ".output/firefox-mv2/manifest.json"],
]) {
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
    `${browserName}: only youtube host permission`,
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
}

if (failures > 0) {
  console.error(`\n${failures} manifest check(s) failed`);
  process.exit(1);
}
console.log("\nmanifest checks passed");
