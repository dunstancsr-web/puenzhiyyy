#!/usr/bin/env node
/* Proves the audit can FAIL. Loads a deliberately broken page and its clean twin, and checks that
 * every planted defect is reported and the clean page raises no error. Run it after editing
 * ux-audit.js or run-audit.mjs:   node .claude/skills/ui-ux-audit/scripts/selftest.mjs
 * A check that only ever reports "clean" is worthless; this is the case each check must catch. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium;
for (const t of [() => createRequire(path.resolve(process.cwd(), 'package.json'))('playwright-core'), () => createRequire(import.meta.url)('playwright-core')]) { try { ({ chromium } = t()); break; } catch { /* next */ } }
if (!chromium) { console.error('playwright-core is not installed (npm i -D playwright-core)'); process.exit(2); }

const script = await readFile(path.join(here, 'ux-audit.js'), 'utf8');
const browser = await chromium.launch({ channel: process.env.UX_AUDIT_CHANNEL || 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
// A desktop-style 390px window: a mobile page with no viewport tag widens its layout instead of overflowing,
// so horizontal overflow (L1, L6) can only be planted and seen here.
const narrow = await browser.newContext({ viewport: { width: 390, height: 800 } });
const opts = { forbidText: ['[\\u2013\\u2014]'] };

async function run(file, context = ctx) {
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(here, '..', 'examples', 'selftest', file)).href);
  await page.addScriptTag({ content: script });
  await page.evaluate((o) => window.__uxAudit(window, o), opts);
  await page.waitForTimeout(400);
  const res = await page.evaluate((o) => window.__uxAudit(window, o), opts);
  // keyboard: press Tab through every control, checking the focus ring
  await page.evaluate(() => window.__uxFocusBaseline(window));
  const kb = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => (document.activeElement && document.activeElement !== document.body ? window.__uxFocusCheck(window, document.activeElement) : null));
    if (!f) break;
    if (!f.indicator) kb.push({ id: 'K1', sev: 'error', msg: f.label });
  }
  await page.close();
  return [...res.issues, ...kb];
}

const bad = [...(await run('bad.html')), ...(await run('bad.html', narrow))];
const good = [...(await run('good.html')), ...(await run('good.html', narrow))];
const got = new Set(bad.map((i) => i.id));
const expected = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'T1', 'T2', 'T3', 'I1', 'I2', 'I3', 'X1', 'X2', 'K1'];
let failed = 0;
for (const id of expected) { const ok = got.has(id); if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} broken page: ${id} ${ok ? 'reported' : 'NOT reported (the check cannot fail)'}`); }
const goodErrors = good.filter((i) => i.sev === 'error');
if (goodErrors.length) { failed++; console.log(`FAIL clean page raised ${goodErrors.length} error(s): ${goodErrors.map((i) => `${i.id} ${i.msg}`).join(' | ')}`); }
else console.log('ok   clean page: no errors');
await browser.close();
console.log(failed ? `\n${failed} self-test failure(s)` : '\nself-test passed: every check catches its planted defect');
process.exit(failed ? 1 : 0);
