# Root causes, in the order they were found

Most UI glitches are one of these. Fix at the source (a token, a class, a layout rule) so every page benefits. Each entry: the symptom, why it happens, the fix.

## Overlap and layout

**A fixed bar sits under a banner.** Body padding moves in-flow content only; a `position:fixed; top:0` element ignores it. Offset every fixed-at-top element by the banner's height, kept in one CSS variable (`top: var(--banner-h)`), and full-height layouts subtract it (`min-height: calc(100vh - var(--banner-h))`).

**A banner overflows its own box.** A fixed pixel height plus a long sentence: once the text wraps, it spills onto the content below. Never hard-code the height. Measure it (`ResizeObserver` writing the variable), and shorten the copy on small screens with classes (not inline `display`).

**A floating control covers page buttons.** A permanent fixed button ("Enter demo mode", a chat bubble, a feedback tab) will cover something at some width. Move it into a menu or into the flow of a page. If it must float, it needs reserved space and an audit exemption with a reason.

**An overlay hides the last line.** Reserve bottom padding on the page while the overlay is showing.

**A flex row squeezes text into a narrow column.** Icon + text + link + button in one row leaves the text ~100px on a phone. Let the row wrap and give the text a flex-basis (`flex: 1 1 220px`), so the actions drop to their own line.

**A container clips what grew.** Growing children (a bigger tap target) inside a fixed-height `overflow:hidden` parent get cut off. Grow the parent with the same class or media query.

## CSS mechanics

**Inline styles beat media queries and stylesheet classes.** An inline `display`, `grid-template-columns`, `min-height` or `all: unset` cannot be changed by a breakpoint. Anything a breakpoint must change belongs in a class. For a stubborn inline style, a utility class with `!important` is the deliberate escape.

**A later rule of equal specificity silently cancels an earlier one.** A "28px minimum on every screen" appended after a "44px on phones" rule undid the phone rule. Scope rules with media queries so they cannot both apply, and put overrides after what they override.

**`:not()` chains raise specificity** even inside `:where()`. Expect a "zero-specificity" reset to win more often than you planned.

**`all: unset` inline removes `min-height`, focus outlines and everything.** Give such controls their own size and focus style.

**An inline `outline: none`** (often set to draw a custom "selected" outline) removes the keyboard focus ring for every state. Set the outline only when selected and leave it undefined otherwise.

## Contrast

**Accent colours are for fills, not words.** A brand blue, green or amber that looks right as a button or chart bar is often 2 to 4:1 as small text. Split the tokens: keep the accent for fills, add darker `*-text` variants for words and a deeper fill for white-text buttons. Do not darken the accent globally if that turns charts muddy.

**One shade cannot serve both directions in dark mode.** A colour used as a fill behind white text needs to be dark; the same colour as text on a dark surface needs to be light. Two tokens.

**White text on a saturated bar** (yellow, green, orange) fails. Use dark text on light fills; choose per segment.

**Muted grey on a tinted surface** (a heat-map cell, a hover state) is lower contrast than the same grey on white. Check it on the tint.

## Touch and keyboard

**Small visible control, big hit area.** A 12px help icon can have a 44px hit area with an absolutely positioned pseudo-element; the audit should trust a class that does this. Do not enlarge the icon.

**Dense navigation strips** (many icon tabs on a phone) cannot all be 44px wide. Make them 44 tall and as wide as the space allows (24px minimum), and free width elsewhere (drop a text label to an icon).

**Focus that lands under a sticky header** is unusable: add `scroll-padding-top` equal to the header height.

## Testing traps

**A hidden tab freezes CSS transitions**, so inherited colours look wrong. Disable transitions before measuring.

**A window that will not resize** (embedded browsers): audit inside same-origin iframes of exact width instead.

**A phone page with no viewport meta cannot overflow.** It lays out at ~980px and shrinks to fit, so a sideways-scroll bug is invisible until the tag is added. The audit reports the missing tag (X2) for this reason.

**HTML entities hide from a text search.** `&mdash;` is invisible to a grep for the dash character; audit the rendered text (`innerText`) instead.
