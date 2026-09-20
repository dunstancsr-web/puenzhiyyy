/* ─────────────────────────────────────────────────────────────────────────────
 * ux-audit.js : a generic, dependency-free UI/UX glitch detector.
 *
 * Runs INSIDE a page. It reads the rendered result (geometry, computed style), so it
 * knows nothing about any framework or design system. Load it however you like:
 *   - the headless runner (run-audit.mjs) injects it for you;
 *   - or serve it as a static file and eval it in the page (see SKILL.md, "In-page mode").
 *
 *   window.__uxAudit(win, options)   audit one window at its CURRENT viewport
 *   window.__uxMatrix(routes, widths, options)   same-origin iframe matrix (no resizing needed)
 *   window.__uxFocusBaseline(win) / __uxFocusCheck(win, el)   keyboard focus visibility (real Tab needed)
 *
 * Every issue is { id, sev, msg, sel, box? }. Ids are stable and match checklist.md:
 *   L1 horizontal scroll        L2 fixed/sticky covers content   L3 fixed overlaps fixed
 *   L4 fixed box overflows      L5 clipped by overflow           L6 past the viewport edge
 *   T1 font size                T2 contrast                      T3 forbidden text pattern
 *   I1 touch/pointer target     I2 no accessible name            I3 broken image
 *   X1 duplicate id             X2 page basics (lang, title, viewport meta)
 * ─────────────────────────────────────────────────────────────────────────── */
(function () {
  const DEFAULTS = {
    typeScale: null,          // e.g. [13,15,17,22,30,40]; null = only enforce minFontPx
    minFontPx: 12,            // text smaller than this is flagged (SVG text is ignored: chart ticks)
    contrastMin: 4.5,         // WCAG AA body text
    contrastLargeMin: 3,      // 24px+, or 18.66px+ bold
    touchBreakpointPx: 768,   // at or below this width, targets need touchMinPx
    touchMinPx: 44,           // Apple HIG / WCAG 2.5.5
    pointerMinPx: 24,         // WCAG 2.5.8 AA minimum with a mouse
    relaxedTargetSelector: 'nav', // dense strips: width may drop to pointerMinPx, height still touchMinPx
    hitAreaSelector: '[class*="hit-"]', // controls that grow their tap area with a pseudo-element
    forbidText: [],           // regexes over visible text, e.g. [/[–—]/] for "no dashes"
    baseBg: null,             // "#rrggbb" for the page background if it cannot be detected
    disableTransitions: true, // a hidden or background tab freezes transitions mid-way: measure the settled state
    settleMs: 350,
    ignoreSelector: '[data-ux-ignore]',
  };

  const px = (v) => parseFloat(v) || 0;
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

  function selectorOf(el) {
    if (!el || !el.tagName) return '';
    if (el.id) return `${el.tagName.toLowerCase()}#${el.id}`;
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '')
      .trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  }
  const labelOf = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || el.placeholder || el.title || el.alt || '')
      .trim().replace(/\s+/g, ' ');
    return (t || selectorOf(el)).slice(0, 50);
  };

  function auditWindow(win, userOpts) {
    const o = Object.assign({}, DEFAULTS, userOpts || {});
    const d = win.document;
    const W = win.innerWidth;
    const issues = [];
    const add = (id, sev, msg, el, extra) => issues.push(Object.assign({ id, sev, msg, sel: el ? selectorOf(el) : '' }, extra || {}));

    if (o.disableTransitions && !d.getElementById('__ux-no-transition')) {
      const st = d.createElement('style');
      st.id = '__ux-no-transition';
      st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
      d.head.appendChild(st);
    }

    const ignored = (e) => !!e.closest(o.ignoreSelector);
    const rectOf = (e) => e.getBoundingClientRect();
    const visible = (e) => {
      const r = rectOf(e); const cs = win.getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0' && !ignored(e);
    };
    const all = [...d.querySelectorAll('body *')].filter(visible);
    const box = (e) => { const r = rectOf(e); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
    const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const hasOwnText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    const isControl = (e) => /^(BUTTON|INPUT|SELECT|TEXTAREA|A|SUMMARY)$/.test(e.tagName) || e.getAttribute('role') === 'button' || e.getAttribute('tabindex') === '0';
    const nonDecorativeControl = (e) => !(e.tagName === 'A' && !e.getAttribute('href')) && e.type !== 'hidden';

    // L1: the page scrolls sideways
    if (d.documentElement.scrollWidth > W + 1) add('L1', 'error', `page is ${d.documentElement.scrollWidth}px wide in a ${W}px viewport`, d.documentElement);

    // L2 L3 L4: fixed elements are the classic overlap bug. Sticky elements are checked
    // for L2 too, because a sticky bar stuck under a fixed banner is the same defect.
    const pos = (e) => win.getComputedStyle(e).position;
    const fixedAll = all.filter((e) => pos(e) === 'fixed');
    const fixedTop = fixedAll.filter((e) => !fixedAll.some((x) => x !== e && x.contains(e)));
    const stickyTop = all.filter((e) => pos(e) === 'sticky' && !fixedAll.some((x) => x.contains(e)));
    const layered = [...fixedTop, ...stickyTop];
    const content = all.filter((e) => (hasOwnText(e) || isControl(e)) && !layered.some((f) => f.contains(e)));
    const scrollClipped = (e, b) => {
      for (let p = e.parentElement; p && p !== d.body; p = p.parentElement) {
        const cs = win.getComputedStyle(p);
        if (/(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflowY) && inter(box(p), b) < 1) return true;
      }
      return false;
    };
    for (const f of layered) {
      const fb = box(f);
      if (fixedTop.includes(f) && (f.scrollHeight > f.clientHeight + 1 || f.scrollWidth > f.clientWidth + 1)) {
        add('L4', 'error', `"${labelOf(f)}" content is larger than its own box (${f.scrollWidth}x${f.scrollHeight} in ${f.clientWidth}x${f.clientHeight}): text wrapped or overflowed`, f, { box: fb });
      }
      for (const c of content) {
        const cb = box(c);
        if (c === f || f.contains(c) || c.contains(f)) continue;
        // a sticky element only "covers" content that is not scrolled away from it
        if (inter(fb, cb) > 6 && !scrollClipped(c, cb)) {
          if (stickyTop.includes(f) && rectOf(f).top > 0) continue;
          add('L2', 'error', `"${labelOf(f)}" (${pos(f)}) covers "${labelOf(c)}"`, f, { box: fb, other: cb });
        }
      }
      for (const g of fixedTop) if (g !== f && f.compareDocumentPosition(g) & 4 && inter(fb, box(g)) > 6) {
        add('L3', 'error', `fixed "${labelOf(f)}" overlaps fixed "${labelOf(g)}"`, f, { box: fb, other: box(g) });
      }
    }

    // L5: a container clips something that has grown past it
    for (const e of all) {
      const cs = win.getComputedStyle(e);
      if (/(hidden|clip)/.test(cs.overflow) && e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 2 && e.children.length && !hasOwnText(e) && cs.textOverflow !== 'ellipsis') {
        add('L5', 'warn', `"${labelOf(e)}" clips its content (${e.scrollWidth}x${e.scrollHeight} inside ${e.clientWidth}x${e.clientHeight})`, e);
      }
    }
    // L6: past the viewport edge and not inside a scroll container
    for (const e of all) {
      if (fixedAll.includes(e)) continue;
      const r = rectOf(e);
      if (r.right > W + 2 || r.left < -2) {
        let inScroller = false;
        for (let p = e.parentElement; p; p = p.parentElement) { if (/(auto|scroll|hidden|clip)/.test(win.getComputedStyle(p).overflowX)) { inScroller = true; break; } }
        if (!inScroller) add('L6', 'error', `"${labelOf(e)}" extends past the viewport edge`, e, { box: box(e) });
      }
    }

    // T1: type sizes
    const sizes = {};
    for (const e of all) {
      if (!hasOwnText(e) || e.closest('svg')) continue;
      const s = Math.round(px(win.getComputedStyle(e).fontSize) * 10) / 10;
      const off = s < o.minFontPx || (o.typeScale && !o.typeScale.includes(s));
      if (off) (sizes[s] = sizes[s] || { n: 0, e, t: labelOf(e) }).n++;
    }
    for (const [s, v] of Object.entries(sizes)) add('T1', 'warn', `${s}px text x${v.n}${o.typeScale ? ` (not on the type scale ${o.typeScale.join('/')})` : ` (below ${o.minFontPx}px)`}, e.g. "${v.t}"`, v.e);

    // T2: contrast (skips text over images or gradients, where the background is unknown)
    const pageBg = (() => {
      if (o.baseBg) { const h = /^#([0-9a-f]{6})$/i.exec(o.baseBg); if (h) return { r: parseInt(h[1].slice(0, 2), 16), g: parseInt(h[1].slice(2, 4), 16), b: parseInt(h[1].slice(4, 6), 16) }; }
      for (const el of [d.body, d.documentElement]) { const c = parse(win.getComputedStyle(el).backgroundColor); if (c && c.a > 0) return c; }
      return { r: 255, g: 255, b: 255 };
    })();
    const bgOf = (e) => {
      const stack = [];
      for (let p = e; p; p = p.parentElement) {
        const cs = win.getComputedStyle(p);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
      }
      let base = pageBg;
      for (const c of stack.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
      return base;
    };
    const seenPairs = new Set();
    for (const e of all) {
      if (!hasOwnText(e) || e.disabled || e.closest('[disabled],[aria-disabled="true"]')) continue;
      const cs = win.getComputedStyle(e);
      const fg = parse(cs.color); const bg = bgOf(e);
      if (!fg || !bg) continue;
      const fgb = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
      const size = px(cs.fontSize); const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      const need = large ? o.contrastLargeMin : o.contrastMin;
      const r = ratio(fgb, bg);
      if (r < need) {
        const key = cs.color + '|' + [bg.r, bg.g, bg.b].map(Math.round);
        if (seenPairs.has(key)) continue; seenPairs.add(key);
        add('T2', 'error', `contrast ${r.toFixed(2)}:1 (needs ${need}) for "${labelOf(e)}" ${cs.color} on rgb(${[bg.r, bg.g, bg.b].map(Math.round)})`, e);
      }
    }

    // T3: forbidden text
    const text = d.body.innerText || '';
    for (const re of o.forbidText || []) {
      const m = text.match(new RegExp(re.source || re, (re.flags || '').replace('g', '') + 'g'));
      if (m) add('T3', 'warn', `text matches ${re}: ${m.length} place(s), e.g. "${(text.match(new RegExp('.{0,30}' + (re.source || re) + '.{0,30}')) || [''])[0].replace(/\s+/g, ' ')}"`, d.body);
    }

    // I1: target size
    const touch = W <= o.touchBreakpointPx;
    const small = [];
    for (const e of all) {
      if (!isControl(e) || !nonDecorativeControl(e) || e.closest(o.hitAreaSelector)) continue;
      if (e.tagName === 'INPUT' && /^(checkbox|radio|range|hidden)$/.test(e.type)) continue;
      const r = rectOf(e);
      // an inline link inside running text is exempt (WCAG 2.5.8 inline exception)
      if (e.tagName === 'A' && e.parentElement && hasOwnText(e.parentElement) && !/^(LI|NAV|TD|TH)$/.test(e.parentElement.tagName) && r.height < o.pointerMinPx + 8) continue;
      const relaxed = o.relaxedTargetSelector && e.closest(o.relaxedTargetSelector);
      const minH = touch ? o.touchMinPx : o.pointerMinPx;
      const minW = touch ? (relaxed ? o.pointerMinPx : o.touchMinPx) : o.pointerMinPx;
      if (r.height + 0.5 < minH || r.width + 0.5 < minW) small.push(`${labelOf(e)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    if (small.length) add('I1', 'warn', `${small.length} target(s) under ${touch ? o.touchMinPx : o.pointerMinPx}px: ${small.slice(0, 5).join('; ')}`, null);

    // I2: accessible names
    const named = (e) => {
      if (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.title) return true;
      if ((e.textContent || '').trim()) return true;
      if (e.tagName === 'INPUT' || e.tagName === 'SELECT' || e.tagName === 'TEXTAREA') {
        if (e.placeholder && e.tagName !== 'SELECT') return true;
        if (e.id && d.querySelector(`label[for="${CSS.escape(e.id)}"]`)) return true;
        if (e.closest('label')) return true;
        return false;
      }
      if (e.querySelector('img[alt]:not([alt=""]), svg[aria-label], svg title')) return true;
      return false;
    };
    const unnamed = all.filter((e) => isControl(e) && nonDecorativeControl(e) && !(e.tagName === 'INPUT' && e.type === 'hidden') && !named(e));
    if (unnamed.length) add('I2', 'error', `${unnamed.length} control(s) with no accessible name: ${unnamed.slice(0, 5).map(selectorOf).join(', ')}`, unnamed[0]);
    const noAlt = all.filter((e) => e.tagName === 'IMG' && !e.hasAttribute('alt'));
    if (noAlt.length) add('I2', 'error', `${noAlt.length} image(s) with no alt attribute`, noAlt[0]);

    // I3: broken images
    const broken = all.filter((e) => e.tagName === 'IMG' && e.complete && e.naturalWidth === 0);
    if (broken.length) add('I3', 'error', `${broken.length} broken image(s): ${broken.slice(0, 3).map((i) => i.currentSrc || i.src).join(', ')}`, broken[0]);

    // X1 / X2: basics
    const ids = {}; d.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
    const dup = Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k);
    if (dup.length) add('X1', 'warn', `duplicate id(s): ${dup.slice(0, 5).join(', ')}`, null);
    const basics = [];
    if (!d.documentElement.lang) basics.push('no <html lang>');
    if (!d.title.trim()) basics.push('empty <title>');
    if (!d.querySelector('meta[name="viewport"]')) basics.push('no viewport meta (phones lay the page out at ~980px and shrink it, so narrow-screen bugs stay hidden)');
    if (basics.length) add('X2', 'warn', basics.join(', '), null);

    return { width: W, height: win.innerHeight, url: win.location.pathname + win.location.search, issues };
  }

  // Keyboard focus. Needs a REAL Tab (element.focus() does not trigger :focus-visible), so the
  // runner presses Tab and calls __uxFocusCheck after each press.
  function focusBaseline(win) {
    const d = win.document; const snap = new WeakMap();
    const props = ['outlineStyle', 'outlineWidth', 'boxShadow', 'backgroundColor', 'borderColor', 'color', 'textDecorationLine'];
    d.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]').forEach((e) => {
      const cs = win.getComputedStyle(e); const s = {}; props.forEach((p) => { s[p] = cs[p]; }); snap.set(e, s);
    });
    win.__uxFocusSnap = snap;
  }
  function focusCheck(win, el) {
    const d = win.document; const snap = win.__uxFocusSnap && win.__uxFocusSnap.get(el);
    const cs = win.getComputedStyle(el);
    const outlined = cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0;
    let changed = false;
    if (snap) ['boxShadow', 'backgroundColor', 'borderColor', 'color', 'textDecorationLine'].forEach((p) => { if (snap[p] !== cs[p]) changed = true; });
    const r = el.getBoundingClientRect();
    const cx = Math.min(win.innerWidth - 1, Math.max(0, r.left + r.width / 2)); const cy = Math.min(win.innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const top = d.elementFromPoint(cx, cy);
    return {
      sel: selectorOf(el), label: labelOf(el),
      at: `${Math.round(r.left)},${Math.round(r.top + win.scrollY)}`,
      indicator: outlined || changed,
      onScreen: r.bottom > 0 && r.top < win.innerHeight && r.right > 0 && r.left < win.innerWidth,
      covered: !!top && top !== el && !el.contains(top) && !top.contains(el),
      coveredBy: top && top !== el ? selectorOf(top) : '',
    };
  }

  // Same-origin iframe matrix: audits routes at exact widths WITHOUT resizing the window. Use this
  // when the browser you drive cannot resize (embedded or extension-driven browsers).
  async function matrix(routes, widths, options, settleMs) {
    const out = [];
    for (const route of routes) {
      const res = await Promise.all((widths || [1440, 1024, 768, 390]).map(async (w) => {
        const f = document.createElement('iframe');
        f.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:900px;border:0;opacity:0;pointer-events:none`;
        document.body.appendChild(f);
        await new Promise((r) => { f.onload = r; f.src = route; });
        await new Promise((r) => setTimeout(r, settleMs || 1800));
        const first = auditWindow(f.contentWindow, options);
        await new Promise((r) => setTimeout(r, (options && options.settleMs) || DEFAULTS.settleMs));
        const res2 = auditWindow(f.contentWindow, options);
        f.remove(); return res2 || first;
      }));
      out.push({ route, results: res });
    }
    return out;
  }
  const brief = (m) => m.map((x) => `${x.route} :: ` + x.results.map((r) => `${r.width}px ` + (r.issues.length ? r.issues.map((i) => i.id).join(',') : 'clean')).join(' | ')).join('\n');

  window.__uxAudit = auditWindow;
  window.__uxMatrix = matrix;
  window.__uxBrief = brief;
  window.__uxFocusBaseline = focusBaseline;
  window.__uxFocusCheck = focusCheck;
  window.__uxDefaults = DEFAULTS;
})();
