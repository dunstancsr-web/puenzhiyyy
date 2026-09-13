# Design tuners

Small single-file tools for settling a design question by moving a slider instead of
describing it in words. Each one previews real StockSense components, and each one ends
with a block of CSS to paste back into the chat so the result is applied exactly as tuned
rather than approximated.

| Tuner | Decides | Owns |
| --- | --- | --- |
| [`type-scale.html`](type-scale.html) | How big every piece of text is | `--text-*` in `frontend/src/index.css` |
| [`glass-tooltip.html`](glass-tooltip.html) | How the frosted panels look | `--hint-*` and `.hint-panel` in `frontend/src/index.css` |
| [`table-density.html`](table-density.html) | Every gap in the Needs Attention card | the density constants in `frontend/src/pages/Dashboard.jsx` |

Published copies, for looking at on a phone or sending to someone:

- Type Scale Tuner: https://claude.ai/code/artifact/ff3d2b3a-8764-47a5-bc58-84914ecb4407
- Glass Tooltip Tuner: https://claude.ai/code/artifact/62c1d4c6-4a9b-44cb-961d-11b13c727058
- Needs Attention Density: https://claude.ai/code/artifact/79d635a7-4f9c-4ad7-89a6-62a8a7a052d3

## How to use one

1. Open the file (double click it, or drag it into a browser). No build step, no server.
2. Move things until it looks right. Both tuners save your work in the browser, so
   closing the tab does not lose it.
3. Press **Copy CSS** and paste the block into the chat.

That last step is the point of these. A pasted token block is unambiguous, while "make
the tooltip a bit less see through" is three round trips and a guess.

## Notes for whoever edits these next

- **These files have no `<!doctype>`, `<html>` or `<body>` tag, and that is deliberate.**
  It is the format the Artifact publisher expects, and browsers infer the missing
  structure anyway, so one file works both as a local file and as a published page. Keeping
  one copy is what stops the local and published versions drifting apart.
- **The tool's own chrome must never use the tokens it is editing.** The type tuner sets
  its controls in fixed px for this reason: bind them to `--text-xs` and dragging that
  slider to 8px leaves you unable to read the control you need to drag it back.
- **Escape every non-ASCII character in JS strings** (`"·"`, not `"·"`). These files
  carry no charset meta of their own: published, the Artifact wrapper supplies one, but
  opened locally there is nothing, and the character renders as mojibake. This has now
  bitten two of the three tuners.
- **Preview with real content.** The density tuner uses the actual Needs Attention rows,
  because filler text of a uniform length wraps predictably and makes every spacing
  decision look better than it is.
- **Preview in the font the app actually ships.** Type judged in the wrong typeface is
  judged wrong, because metrics differ enough between faces that 15px in one reads like
  16px in another.
- Republish after editing by passing the file path to the Artifact tool along with the
  URL above, so the existing link keeps working instead of sprouting a second copy.
