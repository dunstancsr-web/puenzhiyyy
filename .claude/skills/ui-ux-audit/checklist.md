# UI/UX checklist template

Copy this per project or per pass. Tick an item only with evidence (a passing run, a screenshot). Add items for the product's own riskiest features. "Tested at" means the widths, themes and modes in the config.

## A. Layout integrity
- [ ] A1 No horizontal page scroll at any width (L1)
- [ ] A2 No fixed or sticky element covers page content at scroll top (L2)
- [ ] A3 No two fixed elements overlap each other (L3)
- [ ] A4 Every fixed element's text fits its box: no wrapping into content (L4)
- [ ] A5 Content and sticky headers sit BELOW any banner, including on secondary layouts (L2, eyeball)
- [ ] A6 Nothing is clipped by an `overflow:hidden` container (L5)
- [ ] A7 Nothing extends past the viewport edge outside an intentional scroller (L6)
- [ ] A8 A bottom overlay never hides the last line of a page (scroll to the bottom and look)

## B. Type and colour
- [ ] B1 Text sizes follow the project's scale, nothing below the minimum (T1)
- [ ] B2 Contrast meets AA in the primary theme (T2)
- [ ] B3 Every other theme (dark, high contrast): nothing unreadable, no wrong-coloured boxes (T2, eyeball)
- [ ] B4 Writing rules the project has (for example no dashes) (T3)

## C. Interaction
- [ ] C1 Touch targets 44px on phones, 24px with a mouse (I1)
- [ ] C2 Every control and image has an accessible name (I2)
- [ ] C3 One primary action per surface; the rest are quiet (eyeball)
- [ ] C4 Disabled controls look disabled and, where it matters, say why (eyeball)
- [ ] C5 Loading, empty and error states exist and are readable (scripted states)
- [ ] C6 Keyboard: every control shows a focus ring, none is covered, focus is not trapped (K1 K2 K3)
- [ ] C7 Multi-step flows: each step tested, including the confirmation and the error path (scripted states)

## D. Robustness
- [ ] D1 Long text, long names, large numbers do not break a layout (seed one extreme record)
- [ ] D2 Window resized live (not just loaded at each width): no layout that only works when loaded narrow
- [ ] D3 Zoom to 200%: still usable
- [ ] D4 No broken images, duplicate ids, or missing page basics (I3 X1 X2)

## E. This product (add your own)
- [ ] E1 ...

## Result
Matrix: routes x widths x themes x modes passed / total. Exceptions with reasons. **Not covered:** (state it).
