// Shared helpers for the end-to-end tests: start the built app under Playwright and drive it.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA = process.env.PLANTINT_TESTDATA || path.join(ROOT, 'testdata/out');
export const OUT = path.join(process.env.PLANTINT_TEST_OUT || path.join(os.tmpdir(), 'plantint-test'), 'e2e');
fs.mkdirSync(OUT, { recursive: true });

// where Electron keeps PlanTint's crash-recovery copy on Linux
export const RECOVERY_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'PlanTint', 'recovery');

export async function launch(file, { clearRecovery = true } = {}) {
  if (clearRecovery) fs.rmSync(RECOVERY_DIR, { recursive: true, force: true });
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['--no-sandbox', path.join(ROOT, 'dist/app'), ...(file ? [file] : [])],
    env: { ...process.env },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1600, height: 960 }).catch(() => {});
  return { app, page, errors };
}

/** Waits until a document is open and its first render has settled. */
export async function waitDoc(page, timeout = 60000) {
  await page.waitForFunction(() => window.__plantint && window.__plantint.S.doc && !document.querySelector('.busy:not([hidden])'), null, { timeout });
  await page.waitForTimeout(600);
}

/** Replaces the native save dialog with one that answers `filePath` (or cancels when null). */
export async function stubSave(app, filePath) {
  await app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = async () => (fp ? { canceled: false, filePath: fp } : { canceled: true });
  }, filePath);
}

export async function stubOpen(app, filePath) {
  await app.evaluate(({ dialog }, fp) => {
    dialog.showOpenDialog = async () => (fp ? { canceled: false, filePaths: [fp] } : { canceled: true, filePaths: [] });
  }, filePath);
}

/** Sheet pixel -> client coordinates, using the app's own view transform. */
export async function toClient(page, x, y) {
  return page.evaluate(([x, y]) => {
    const { V } = window.__plantint;
    const r = document.getElementById('ui').getBoundingClientRect();
    return { x: r.left + (x * V.scale + V.tx) / V.dpr, y: r.top + (y * V.scale + V.ty) / V.dpr };
  }, [x, y]);
}

export async function shot(page, name) {
  const p = path.join(OUT, name + '.png');
  await page.screenshot({ path: p });
  return p;
}

export function check(cond, msg, results) {
  results.push({ ok: !!cond, msg });
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
}

/** Sheet pixel position of a point given in the test plans' own metres (see testdata/make_plans.py). */
export async function planPt(page, mx, my, sheetHmm = 297) {
  const dpi = await page.evaluate(() => window.__plantint.S.doc.dpi);
  const ox = 45, oy = 70, m = 20;
  return [((ox + mx * m) * dpi) / 25.4, ((sheetHmm - (oy + my * m)) * dpi) / 25.4];
}

export async function clickSheet(page, x, y, opts = {}) {
  const c = await toClient(page, x, y);
  await page.mouse.click(c.x, c.y, opts);
  return c;
}

export async function moveSheet(page, x, y, steps = 1) {
  const c = await toClient(page, x, y);
  await page.mouse.move(c.x, c.y, { steps });
  return c;
}

export const markupCount = (page) => page.evaluate(() => window.__plantint.S.markups.length);

export async function waitMarkups(page, n, timeout = 30000) {
  await page.waitForFunction((n) => window.__plantint.S.markups.length === n, n, { timeout });
}

/** Picks a save menu entry from the top bar's Save dropdown and waits for the file. */
export async function saveVia(app, page, label, filePath, timeout = 120000) {
  fs.rmSync(filePath, { force: true });
  await stubSave(app, filePath);
  await page.click('#btn-save-more');
  await page.getByText(label, { exact: true }).click();
  const t0 = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - t0 > timeout) throw new Error('save timed out: ' + filePath);
    await page.waitForTimeout(200);
  }
  await page.waitForFunction(() => !document.querySelector('.busy:not([hidden])'), null, { timeout });
  return fs.statSync(filePath).size;
}

export async function setRange(page, sel, v) {
  await page.evaluate(([sel, v]) => {
    const el = document.querySelector(sel);
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [sel, v]);
}

export function summary(results, errors) {
  const bad = results.filter((r) => !r.ok);
  const errs = errors.filter((e) => !/Autofill|DevTools/.test(e));
  console.log(`\n${results.length - bad.length}/${results.length} passed` + (errs.length ? `; console errors:\n  ${errs.join('\n  ')}` : '; no console errors'));
  return bad.length === 0 && errs.length === 0;
}

/** Ends the app without the save question (tests that check the exit flow use the window's close instead). */
export async function quit(app) {
  try { await app.evaluate(({ app }) => setTimeout(() => app.exit(0), 50)); } catch { /* already gone */ }
  try { await app.close(); } catch { /* ignore */ }
}
