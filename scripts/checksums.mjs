// Node.js verification script.

// Compute SHA-256 checksums for the packaged extension archives.
// Writes .output/SHA256SUMS.txt in `sha256  filename` format.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = ".output";
let entries = [];
try {
  entries = readdirSync(outDir).filter((f) => f.endsWith(".zip"));
} catch {
  console.error(`cannot read ${outDir} — run "npm run zip:all" first`);
  process.exit(1);
}

if (entries.length === 0) {
  console.error(
    `no .zip artifacts found in ${outDir} — run "npm run zip:all" first`,
  );
  process.exit(1);
}

const lines = entries.sort().map((name) => {
  const hash = createHash("sha256")
    .update(readFileSync(join(outDir, name)))
    .digest("hex");
  console.log(`${hash}  ${name}`);
  return `${hash}  ${name}`;
});

writeFileSync(join(outDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
console.log(`\nwrote ${outDir}/SHA256SUMS.txt`);
