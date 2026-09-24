# UI engineering

## Runtime and scope

The workbench is an extension page in Chrome's native side panel and Firefox's
sidebar. It appears beside YouTube, but React is not mounted into YouTube's DOM.
The YouTube content script supplies video and playback state over the existing
message bus. Keep this boundary intact.

The primary job of the panel is to read and navigate a video's captions. The
video title and search come first, then track and reading controls. Copy, save,
notes, and export sit in an action menu so a narrow panel leaves space for text.
The transcript alone scrolls; context and controls stay visible. At smaller
widths controls wrap, and CSS logical properties support Arabic RTL.

The visual system follows YouTube's neutral light and dark surfaces and blue
interaction color. Selection and active playback have distinct states.
Typography is compact and readable at side panel widths. Shadows are limited to
the action popover.

## Tokens

`tokens/core.json` holds primitive colors, type, spacing, and radii.
`tokens/semantic.json` assigns light and dark role names such as canvas,
surface, text, accent, and danger. `tokens/components.json` holds workbench
measurements. All three use DTCG `$type` and `$value`.

`style-dictionary.config.mjs` is the only Style Dictionary configuration.
`scripts/build-tokens.mjs` imports it, builds CSS variables to
`src/ui/tokens/generated/tokens.css`, and checks that the essential runtime
variables exist. The generated file is committed and must not be hand edited.
`src/ui/theme.css` imports it and maps semantic light and dark roles to
runtime `--ui-*` aliases. Components use those aliases and generated dimension
variables.

Token generation runs automatically before `dev`, `dev:firefox`, `build`,
`build:firefox`, `compile`, `storybook`, and `build-storybook`.
`npm run tokens:watch` is available while changing token source files.

## UI tooling

Storybook contains real transcript workbench states. Its a11y addon is a
component check, and `npm run build-storybook` is useful for validating the
catalog. There is no Shadow DOM React host in this product, so stories use the
same CSS as the native panel. Unused starter stories, Shadow DOM provider, and
uninstalled MUI/Chakra adapters were removed. Native controls and focused CSS
fit the current panel without a component framework.

The Playwright suite loads the built extension and checks the actual side
panel, keyboard and theme behavior, and axe results. Run `npm run build`
before `npm run test:e2e`. Live YouTube is an additional manual or scripted
acceptance check because it depends on YouTube availability.

## References

- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel):
  persistent companion UI beside the page.
- [WAI ARIA keyboard interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/):
  roving focus in tabs and visible keyboard focus.
- [Style Dictionary DTCG support](https://styledictionary.com/info/dtcg/):
  token source format and reference handling.
