#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
 * run-audit.mjs : headless UI/UX audit over a matrix of route x width x theme x mode.
 *
 *   node .claude/skills/ui-ux-audit/scripts/run-audit.mjs --config ux-audit.config.json
 *
 * Needs `playwright-core` (npm i -D playwright-core) and a Chrome/Chromium on the machine
 * (it drives the installed Chrome; no browser is downloaded). See ../SKILL.md for the config
 * schema and ../examples/ux-audit.config.example.json for a starting point.
 *
 * Options:  --config <file>   required
 *           --out <dir>       report folder (default ux-audit-report)
 *           --only <a,b,=c>   run only states whose name or route contains a, b (or is exactly c)
 *           --mode <name,..> / --theme <name,..>   run only those modes / themes
 *           --shots failures|all|none   screenshots (default failures)
 *           --fail-on error|warn|none   exit code 1 if issues of this severity remain (default error)
 *           --no-keyboard     skip the real-keyboard focus audit
 *           --headed          show the browser
 * ─────────────────────────────────────────────────────────────────────────── */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };

const configPath = opt('config');
if (!configPath) { console.error('usage: run-audit.mjs --config <file> [--out dir] [--only text] [--shots failures|all|none] [--fail-on error|warn|none] [--no-keyboard] [--headed]'); process.exit(2); }

async function loadPlaywright() {
  const tries = [() => createRequire(path.resolve(process.cwd(), 'package.json'))('playwright-core'), () => createRequire(import.meta.url)('playwright-core')];
  for (const t of tries) { try { return t(); } catch { /* next */ } }
  console.error('playwright-core is not installed. Run:  npm i -D playwright-core   (it drives your installed Chrome and downloads no browser)');
  process.exit(2);
}

const cfg = JSON.parse(await readFile(configPath, 'utf8'));
const { chromium } = await loadPlaywright();
const outDir = path.resolve(opt('out', 'ux-audit-report'));
await mkdir(path.join(outDir, 'shots'), { recursive: true });
const shots = opt('shots', cfg.screenshots || 'failures');
const failOn = opt('fail-on', cfg.failOn || 'error');
const onlyList = opt('only', '').split(',').map((s) => s.trim()).filter(Boolean);   // text = contains; =name = exact
const onlyModes = opt('mode', '').split(',').filter(Boolean);
const onlyThemes = opt('theme', '').split(',').filter(Boolean);

const baseUrl = cfg.baseUrl.replace(/\/$/, '');
const widths = cfg.widths || [1440, 1024, 768, 390];
const height = cfg.height || 900;
const mobileMax = cfg.mobileMaxWidth ?? 768;
const themes = (cfg.themes || [{ name: 'light', colorScheme: 'light' }]).filter((t) => !onlyThemes.length || onlyThemes.includes(t.name));
const modes = (cfg.modes || [{ name: 'default' }]).filter((m) => !onlyModes.length || onlyModes.includes(m.name));
const settleMs = cfg.settleMs ?? 1200;
const auditOpts = cfg.audit || {};
const ignore = (cfg.ignore || []).map((r) => ({ ...r, re: new RegExp(r.match || '.', 'i') }));
const kbCfg = { enabled: !flag('no-keyboard') && (cfg.keyboard?.enabled ?? true), widths: cfg.keyboard?.widths || [1440, 390], maxTabs: cfg.keyboard?.maxTabs ?? 40 };

// states: plain routes, plus scripted ones (multi-step flows, opened panels, seeded data)
const states = [
  ...(cfg.routes || []).map((r) => ({ name: r, route: r })),
  ...(cfg.states || []),
].filter((s) => !onlyList.length || onlyList.some((o) => (o.startsWith('=') ? s.name === o.slice(1) : s.name.includes(o) || s.route.includes(o))));

const launchOpts = { headless: !flag('headed') };
let browser;
try {
  browser = await chromium.launch({ ...launchOpts, channel: process.env.UX_AUDIT_CHANNEL || 'chrome' });
} catch (e) {
  if (process.env.UX_AUDIT_BROWSER_PATH) browser = await chromium.launch({ ...launchOpts, executablePath: process.env.UX_AUDIT_BROWSER_PATH });
  else { console.error(`Could not launch Chrome (${e.message.split('\n')[0]}). Install Google Chrome, or set UX_AUDIT_BROWSER_PATH to a Chrome/Chromium binary.`); process.exit(2); }
}

const auditScript = await readFile(path.join(here, 'ux-audit.js'), 'utf8');
const results = [];      // { state, mode, theme, width, issues[], ignored[], shot }
const keyboard = [];     // { state, mode, theme, width, tabs, issues[] }

async function runSteps(page, steps) {
  for (const st of steps || []) {
    const [k] = Object.keys(st);
    const v = st[k];
    if (k === 'click') await page.locator(v).first().click({ timeout: 8000 });
    else if (k === 'clickEach') for (const s of v) { await page.locator(s).first().click({ timeout: 8000 }); await page.waitForTimeout(120); }
    else if (k === 'fill') await page.locator(v.selector).first().fill(v.value);
    else if (k === 'press') await page.keyboard.press(v);
    else if (k === 'wait') await page.waitForTimeout(v);
    else if (k === 'waitFor') await page.locator(v).first().waitFor({ timeout: 30000 });
    else if (k === 'scroll') await page.locator(v).first().scrollIntoViewIfNeeded();
    else if (k === 'scrollY') await page.evaluate((y) => window.scrollTo(0, y), v);
    else if (k === 'eval') await page.evaluate(v);
    else if (k === 'request') await apiCall(page.context(), v);
    else throw new Error(`unknown step "${k}"`);
  }
}

// An API call the audit depends on (login, seeding, a data change). If it fails the state is
// meaningless, so say so plainly instead of leaving a mystery timeout further on.
async function apiCall(context, r) {
  const res = await context.request.fetch(baseUrl + r.url, { method: r.method || 'POST', data: r.data });
  if (!res.ok()) throw new Error(`request ${r.method || 'POST'} ${r.url} failed: HTTP ${res.status()} ${(await res.text()).slice(0, 120)}`);
}

const isIgnored = (issue) => ignore.find((r) => (!r.check || r.check === issue.id) && r.re.test(issue.msg) && (!r.state || new RegExp(r.state).test(issue.__state || '')));

async function drawAndShoot(page, file, issues) {
  await page.evaluate((iss) => {
    document.querySelectorAll('.__ux-mark').forEach((n) => n.remove());
    for (const i of iss) for (const b of [i.box, i.other].filter(Boolean)) {
      const d = document.createElement('div'); d.className = '__ux-mark';
      d.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #ff0033;background:rgba(255,0,51,.12);left:${b[0]}px;top:${b[1]}px;width:${b[2] - b[0]}px;height:${b[3] - b[1]}px`;
      document.body.appendChild(d);
    }
  }, issues);
  await page.screenshot({ path: file });
}

let combos = 0;
for (const mode of modes) {
  for (const theme of themes) {
    for (const width of widths) {
      const touch = width <= mobileMax;
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: touch ? 2 : 1,
        isMobile: touch, hasTouch: touch,
        colorScheme: theme.colorScheme || 'light',
      });
      const init = { ...(theme.localStorage || {}), ...(mode.localStorage || {}) };
      if (Object.keys(init).length) await context.addInitScript((kv) => { try { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); } catch { /* private mode */ } }, init);
      for (const r of mode.requests || []) await apiCall(context, r);

      for (const st of states) {
        if (st.modes && !st.modes.includes(mode.name)) continue;
        if (st.themes && !st.themes.includes(theme.name)) continue;
        if (st.widths && !st.widths.includes(width)) continue;
        const page = await context.newPage();
        const label = `${st.name} | ${mode.name} | ${theme.name} | ${width}px`;
        try {
          for (const r of st.setupRequests || []) await apiCall(context, r);
          await page.goto(baseUrl + st.route, { waitUntil: 'load' });
          await page.waitForTimeout(settleMs);
          await runSteps(page, st.steps);
          await page.waitForTimeout(300);
          await page.addScriptTag({ content: auditScript });
          await page.evaluate((o) => window.__uxAudit(window, o), auditOpts);      // first pass injects the "no transitions" style
          await page.waitForTimeout(400);
          const res = await page.evaluate((o) => window.__uxAudit(window, o), auditOpts);
          const kept = [], allowed = [];
          for (const i of res.issues) { i.__state = st.name; const rule = isIgnored(i); (rule ? allowed : kept).push(rule ? { ...i, reason: rule.reason } : i); }
          let shot = null;
          if (shots === 'all' || (shots === 'failures' && kept.length)) {
            shot = `shots/${st.name.replace(/[^\w.-]+/g, '_')}__${mode.name}_${theme.name}_${width}.png`;
            await drawAndShoot(page, path.join(outDir, shot), kept);
          }
          results.push({ state: st.name, route: st.route, mode: mode.name, theme: theme.name, width, issues: kept, ignored: allowed, shot });
          process.stdout.write(`${kept.length ? '✗' : '✓'} ${label}${kept.length ? '  ' + kept.map((i) => i.id).join(',') : ''}\n`);

          // real keyboard: only for the widths and the first mode/theme, on plain routes and flagged states
          if (kbCfg.enabled && kbCfg.widths.includes(width) && mode === modes[0] && theme === themes[0] && (st.keyboard ?? !st.steps)) {
            await page.evaluate(() => window.__uxFocusBaseline(window));
            const seen = new Set(); const kIssues = []; let tabs = 0, prev = '';
            await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
            for (let n = 0; n < kbCfg.maxTabs; n++) {
              await page.keyboard.press('Tab'); tabs++;
              const f = await page.evaluate(() => (document.activeElement && document.activeElement !== document.body ? window.__uxFocusCheck(window, document.activeElement) : null));
              if (!f) break;
              const key = f.sel + f.label + '@' + f.at;   // position too: a list of identical "Show record" buttons is not one stuck control
              if (key === prev) { kIssues.push({ id: 'K3', sev: 'error', msg: `keyboard focus is stuck on "${f.label}" (possible trap)`, sel: f.sel }); break; }
              prev = key;
              if (seen.has(key)) break;   // completed the cycle
              seen.add(key);
              if (!f.indicator) kIssues.push({ id: 'K1', sev: 'error', msg: `no visible focus indicator on "${f.label}"`, sel: f.sel });
              if (f.covered) kIssues.push({ id: 'K2', sev: 'error', msg: `focused "${f.label}" is covered by ${f.coveredBy}`, sel: f.sel });
              else if (!f.onScreen) kIssues.push({ id: 'K2', sev: 'warn', msg: `focused "${f.label}" is off screen`, sel: f.sel });
            }
            const kKept = []; const kAllowed = [];
            for (const i of kIssues) { i.__state = st.name; const rule = isIgnored(i); (rule ? kAllowed : kKept).push(rule ? { ...i, reason: rule.reason } : i); }
            keyboard.push({ state: st.name, mode: mode.name, theme: theme.name, width, tabs, issues: kKept, ignored: kAllowed });
            if (kKept.length) process.stdout.write(`   ⌨ ${kKept.length} keyboard issue(s) after ${tabs} Tab presses: ${[...new Set(kKept.map((i) => i.id))].join(',')}\n`);
          }
        } catch (e) {
          results.push({ state: st.name, route: st.route, mode: mode.name, theme: theme.name, width, issues: [{ id: 'RUN', sev: 'error', msg: `could not audit: ${e.message.split('\n')[0]}`, sel: '' }], ignored: [], shot: null });
          process.stdout.write(`! ${label}  ${e.message.split('\n')[0]}\n`);
        } finally { await page.close(); }
        combos++;
      }
      await context.close();
    }
  }
}
await browser.close();

// ── report ──────────────────────────────────────────────────────────────────
const all = [...results.flatMap((r) => r.issues.map((i) => ({ ...i, where: r }))), ...keyboard.flatMap((k) => k.issues.map((i) => ({ ...i, where: { ...k, shot: null } })))];
const groups = new Map();
for (const i of all) {
  const key = `${i.id}|${i.where.state}|${i.msg.replace(/\d+(\.\d+)?/g, '#')}`;
  const g = groups.get(key) || { ...i, hits: [], example: i.where.shot };
  g.hits.push(`${i.where.mode}/${i.where.theme}/${i.where.width}px`); if (!g.example && i.where.shot) g.example = i.where.shot;
  groups.set(key, g);
}
const list = [...groups.values()].sort((a, b) => (a.sev === b.sev ? a.id.localeCompare(b.id) : a.sev === 'error' ? -1 : 1));
const counts = { error: list.filter((g) => g.sev === 'error').length, warn: list.filter((g) => g.sev === 'warn').length };
const allowedAll = [...results.flatMap((r) => r.ignored.map((i) => ({ ...i, where: r }))), ...keyboard.flatMap((k) => k.ignored.map((i) => ({ ...i, where: k })))];
const allowedGroups = new Map();
for (const i of allowedAll) { const k = `${i.id}|${i.reason}`; const g = allowedGroups.get(k) || { id: i.id, reason: i.reason, n: 0, sample: i.msg }; g.n++; allowedGroups.set(k, g); }

const widthsSeen = [...new Set(results.map((r) => r.width))];
const rows = [...new Set(results.map((r) => `${r.state} | ${r.mode} | ${r.theme}`))];
let md = `# UI/UX audit\n\n${states.length} states x ${modes.length} mode(s) x ${themes.length} theme(s) x ${widthsSeen.length} width(s) = ${results.length} audits. **${counts.error} error(s), ${counts.warn} warning(s)** (unique issues; ${allowedAll.length} allowed exception hit(s)).\n\n`;
md += `| state | mode | theme | ${widthsSeen.map((w) => w + 'px').join(' | ')} |\n|---|---|---|${widthsSeen.map(() => '---').join('|')}|\n`;
for (const row of rows) {
  const [s, m, t] = row.split(' | ');
  md += `| ${s} | ${m} | ${t} | ${widthsSeen.map((w) => { const r = results.find((x) => x.state === s && x.mode === m && x.theme === t && x.width === w); return r ? (r.issues.length ? r.issues.map((i) => i.id).filter((v, i2, a) => a.indexOf(v) === i2).join(' ') : 'ok') : '-'; }).join(' | ')} |\n`;
}
md += `\n## Issues (${list.length})\n\n`;
if (!list.length) md += 'None.\n';
for (const g of list) md += `- **${g.id}** ${g.sev} - ${g.where.state}: ${g.msg}${g.sel ? ` (\`${g.sel}\`)` : ''}\n  - seen at: ${[...new Set(g.hits)].slice(0, 8).join(', ')}${g.example ? `\n  - screenshot: ${g.example}` : ''}\n`;
md += `\n## Allowed exceptions (${allowedGroups.size})\n\nThese matched an \`ignore\` rule in the config. They stay listed on purpose: an exception nobody can see is a bug nobody can find.\n\n`;
if (!allowedGroups.size) md += 'None.\n';
for (const g of allowedGroups.values()) md += `- **${g.id}** x${g.n}: ${g.reason} (e.g. ${g.sample.slice(0, 100)})\n`;
const kbT = keyboard.length ? `\n## Keyboard\n\n${keyboard.map((k) => `- ${k.state} @ ${k.width}px: ${k.tabs} Tab presses, ${k.issues.length} issue(s)`).join('\n')}\n` : '';
await writeFile(path.join(outDir, 'report.md'), md + kbT);
await writeFile(path.join(outDir, 'report.json'), JSON.stringify({ summary: counts, results, keyboard }, null, 2));

console.log(`\n${counts.error} error(s), ${counts.warn} warning(s), ${allowedAll.length} allowed. Report: ${path.join(outDir, 'report.md')}`);
const fail = failOn === 'warn' ? counts.error + counts.warn : failOn === 'error' ? counts.error : 0;
process.exit(fail ? 1 : 0);
