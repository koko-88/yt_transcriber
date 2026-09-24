/** Shared by npm run tokens:build and tokens:watch. */
export default {
  source: [
    "tokens/core.json",
    "tokens/semantic.json",
    "tokens/components.json",
  ],
  platforms: {
    css: {
      transformGroup: "css",
      buildPath: "src/ui/tokens/generated/",
      files: [
        {
          destination: "tokens.css",
          format: "css/variables",
          options: { outputReferences: false, showFileHeader: false },
        },
      ],
    },
  },
};
