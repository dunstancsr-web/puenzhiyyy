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

## brand.html

Not a tuner: the naming research and logo sheet for **四海米行 / Four Seas Rice Trading**, the
fictional SME this tool is pitched at. Published at
https://claude.ai/code/artifact/55f682c6-a10b-4219-a8cc-8def83a31fd6

`brand.html` is GENERATED. Edit `src/logo-template.html` and run `python3 src/build-logo.py`
from `src/`, which does two things the hand-written file cannot:

- inlines `mz-sub.woff2` as a data URI, so the brush face ships with the page
- escapes every non-ASCII character as an HTML numeric entity

The second is not optional here. These pages carry no charset meta of their own, and served
locally every Chinese character rendered as mojibake. Entities are charset-independent, so the
built file is correct both from disk and published.

The font is Ma Shan Zheng (SIL OFL), subset to nine glyphs: 5.86 MB down to 3.7 KB. Regenerate
with `pyftsubset mz.ttf --text="四海米行友合业粮" --flavor=woff2 --output-file=mz-sub.woff2`.

## home-layouts.html

Four Home layouts answering a design critique, drawn at full size in a fixed 560px viewport so
vertical placement can be judged rather than described. Published at
https://claude.ai/code/artifact/91f9d7dd-3e2b-47c8-ae4a-9cd122799013

Also generated: edit `src/home-template.html`, then from `src/` run
`python3 build-page.py home-template.html ../home-layouts.html`. `build-page.py` is the generic
version of `build-logo.py` and does the same two jobs, inlining the font and escaping every
non-ASCII character.

## home-editor.html

Option C, editable by drag and drop. Move the blocks of Home between three zones, reorder within a
zone, adjust the geometry, then Copy layout and paste the result back. Published at
https://claude.ai/code/artifact/249620f0-343a-46e3-8da4-d3280d20fad4

It snaps to **zones and order**, never to pixels. A layout positioned at absolute coordinates looks
right in an editor and cannot be built responsively; everything this editor can express maps onto a
CSS grid with flex columns, so anything arranged in it can actually ship. That constraint is the
point, not a limitation of the tool.

It also argues back: a live critique panel under the canvas objects as you arrange, so the
conversation happens while you are deciding rather than afterwards.

Generated: edit `src/editor-template.html`, then from `src/` run
`python3 build-page.py editor-template.html ../home-editor.html`.
