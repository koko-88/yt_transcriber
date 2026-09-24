import { readFile, writeFile } from "node:fs/promises";
import prettier from "prettier";
import StyleDictionary from "style-dictionary";
import config from "../style-dictionary.config.mjs";

await new StyleDictionary(config).buildAllPlatforms();

// Catch a syntactically successful build that emitted no usable runtime tokens.
const output = "src/ui/tokens/generated/tokens.css";
const css = await readFile(output, "utf8");
for (const name of [
  "--semantic-color-light-canvas",
  "--semantic-color-dark-canvas",
  "--component-control-height",
]) {
  if (!css.includes(name)) throw new Error(`Missing generated token: ${name}`);
}
await writeFile(output, await prettier.format(css, { parser: "css" }));
