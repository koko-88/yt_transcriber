// Node.js verification script.

// Bundle budget check: fails if any shipped JS chunk exceeds its budget.
// Budgets are generous V1 ceilings to catch accidental dependency bloat.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const KB = 1024;
const BUDGETS = [
  // [path fragment, budget in KB]
  ["background.js", 150],
  ["content-scripts/youtube-bridge.js", 120],
  ["content-scripts/youtube.js", 150],
  ["sidepanel", 450],
  // Lazy document exporters (loaded only on Actions → Export)
  ["docx", 800],
  ["pdf-lib", 600],
  ["pptxgenjs", 900],
];

const targets = process.argv[2]
  ? [process.argv[2]]
  : [".output/chrome-mv3", ".output/firefox-mv2"];
let failures = 0;
let checked = 0;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith(".js")) yield p;
  }
}

for (const target of targets) {
  let files;
  try {
    files = [...walk(target)];
  } catch {
    console.log(`skip ${target} (not built)`);
    continue;
  }
  for (const f of files) {
    const rel = f.replaceAll("\\", "/");
    const budget = BUDGETS.find(([frag]) => rel.includes(frag));
    if (!budget) continue;
    const sizeKb = statSync(f).size / KB;
    checked++;
    if (sizeKb > budget[1]) {
      console.error(
        `FAIL ${rel}: ${sizeKb.toFixed(1)} kB > ${budget[1]} kB budget`,
      );
      failures++;
    } else {
      console.log(`  ok ${rel}: ${sizeKb.toFixed(1)} kB <= ${budget[1]} kB`);
    }
  }
}

if (checked === 0) {
  console.error("no bundles found to check — run a build first");
  process.exit(1);
}
if (failures > 0) process.exit(1);
console.log("bundle budgets passed");
