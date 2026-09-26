// npm audit can omit non-vulnerable parents from its effects graph. In that
// case audit-ci reports GHSA-...|image-size rather than pptxgenjs>image-size.
// Fail closed unless the runtime lockfile proves the exception's exact scope.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const parentPath = "node_modules/pptxgenjs";
const exceptionPath = `${parentPath}/node_modules/image-size`;
assert.equal(
  lock.lockfileVersion,
  3,
  "Review audit exceptions for this lockfile format",
);
assert.equal(
  lock.packages[parentPath]?.version,
  "3.12.0",
  "Review PptxGenJS reachability after a version change",
);
assert.equal(
  lock.packages[exceptionPath]?.version,
  "1.2.1",
  "Review image-size exceptions after a version or path change",
);

for (const [path, pkg] of Object.entries(lock.packages)) {
  if (pkg.dev === true) continue; // Matches audit-ci's runtime-only scope.
  if (path.endsWith("/image-size") || pkg.name === "image-size") {
    assert.equal(
      path,
      exceptionPath,
      `Unapproved runtime image-size path: ${path}`,
    );
  }
  const dependencies = {
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  };
  for (const [name, range] of Object.entries(dependencies)) {
    if (name === "image-size" || range.startsWith("npm:image-size@")) {
      assert.equal(
        path,
        parentPath,
        `Unapproved image-size consumer: ${path || "project root"}`,
      );
      assert.equal(
        name,
        "image-size",
        "Aliased image-size requires a new security review",
      );
    }
  }
}
console.log(
  `Audit exceptions restricted to ${exceptionPath} (PptxGenJS 3.12.0, image-size 1.2.1).`,
);
