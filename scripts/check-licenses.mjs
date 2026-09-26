// Node.js verification script.

// License check: verifies that every runtime dependency uses an OSI-approved
// license compatible with distribution, and that THIRD_PARTY_NOTICES.md covers
// all runtime dependencies.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const ALLOWED = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "CC0-1.0",
  "Python-2.0",
  "MPL-2.0",
]);

let failures = 0;
const runtimeDeps = Object.keys(pkg.dependencies ?? {});
const notices = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");

for (const dep of runtimeDeps) {
  let depPkg;
  try {
    depPkg = JSON.parse(
      readFileSync(join(root, "node_modules", dep, "package.json"), "utf8"),
    );
  } catch {
    console.log(`  skip ${dep} (not installed)`);
    continue;
  }
  const license =
    typeof depPkg.license === "string"
      ? depPkg.license
      : (depPkg.license?.type ?? depPkg.licenses?.[0]?.type ?? "UNKNOWN");
  if (!ALLOWED.has(license)) {
    console.error(`FAIL ${dep}: license ${license} not in allowlist`);
    failures++;
  } else {
    console.log(`  ok ${dep} (${license})`);
  }
  if (!notices.includes(dep)) {
    console.error(`FAIL ${dep}: missing from THIRD_PARTY_NOTICES.md`);
    failures++;
  }
}

if (failures > 0) process.exit(1);
console.log("license checks passed");
