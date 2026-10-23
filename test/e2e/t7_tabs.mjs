// 1.3: tabs. Each drawing is a tab in one window, with its own marking, its own name in the strip, its own
// unsaved-work question and its own recovery copy. Ctrl+N opens an empty tab; a second launch with a drawing
// opens it as a new tab; the strip, Ctrl+Tab and Ctrl+Shift+Tab switch tabs; Ctrl+W closes one tab and asks
// only about that tab's work; closing the window asks about each unsaved tab in turn.
import { launch, waitDoc, check, summary, clickSheet, waitMarkups, stubOpen, quit, drawingPages, planPt, DATA, RECOVERY_DIR } from './lib.mjs';
import fs from 'fs';

const R = [];
const recFiles = () => (fs.existsSync(RECOVERY_DIR) ? fs.readdirSync(RECOVERY_DIR).filter((n) => n.endsWith('.plantint')) : []);
const windowCount = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const shownTitle = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
const shownViews = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);
const strip = (app) => app.windows().find((w) => /\/tabs\.html$/.test(w.url()));
const stripTabs = (app) => strip(app).evaluate(() => [...document.querySelectorAll('.tab')].map((t) => ({
  name: t.querySelector('.name').textContent, active: t.classList.contains('active'), unsaved: !!t.querySelector('.dot'),
})));
const clickTab = (app, i) => strip(app).locator('.tab .name').nth(i).click();
const markups = (page) => page.evaluate(() => window.__plantint.S.markups.length);
const watch = (page, errors) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
};
const waitFor = async (fn, what, timeout = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('timed out: ' + what);
};

const { app, page: page1, errors } = await launch(DATA + '/plan_A3_single.pdf');
try {
  await waitDoc(page1);
  await page1.keyboard.press('f');
  await clickSheet(page1, ...(await planPt(page1, 10.5, 7.6)));
  await waitMarkups(page1, 1);

  // 1. Ctrl+N opens an empty tab in the same window; the first drawing keeps its marking
  await page1.keyboard.press('Control+n');
  await waitFor(() => drawingPages(app).length === 2, 'a second drawing page');
  const page2 = drawingPages(app).find((p) => p !== page1);
  watch(page2, errors);
  await page2.waitForFunction(() => window.__plantint && window.__plantint.S, null, { timeout: 60000 });
  check((await windowCount(app)) === 1, 'Ctrl+N opens a tab in the same window, not a new window', R);
  check(await page2.evaluate(() => !window.__plantint.S.doc), 'the new tab is empty', R);
  check((await shownViews(app)) === 1, 'one drawing is shown at a time', R);
  let tabsNow = await stripTabs(app);
  check(tabsNow.length === 2 && tabsNow[1].active && !tabsNow[0].active, `the strip lists both tabs, the new one active (${tabsNow.map((t) => t.name).join(' | ')})`, R);
  check(tabsNow[0].unsaved && !tabsNow[1].unsaved, 'only the drawing with unsaved marking has a dot in the strip', R);
  check((await markups(page1)) === 1, 'the first tab keeps its marking', R);

  // 2. a drawing opened in the new tab is its own, with its own marking
  await stubOpen(app, DATA + '/plan_layers.pdf');
  await page2.keyboard.press('Control+o');
  await waitDoc(page2);
  check((await page2.evaluate(() => window.__plantint.S.doc.name)) === 'plan_layers.pdf', 'the new tab opens its own drawing', R);
  await page2.keyboard.press('r');
  await clickSheet(page2, ...(await planPt(page2, 3, 3)));
  await clickSheet(page2, ...(await planPt(page2, 9, 7)));
  await waitMarkups(page2, 1);
  check((await markups(page1)) === 1 && (await markups(page2)) === 1, 'each tab has its own marking', R);
  tabsNow = await stripTabs(app);
  check(tabsNow[0].name === 'plan_A3_single.pdf' && tabsNow[1].name === 'plan_layers.pdf' && tabsNow[0].unsaved && tabsNow[1].unsaved, `the strip names each drawing (${tabsNow.map((t) => t.name).join(' | ')})`, R);
  check((await shownTitle(app)).includes('plan_layers'), `the window title follows the shown tab (${await shownTitle(app)})`, R);

  // 3. Ctrl+Tab goes to the next tab (and wraps round), Ctrl+Shift+Tab goes back
  await page2.keyboard.press('Control+Tab');
  await waitFor(async () => (await shownTitle(app)).includes('plan_A3_single'), 'Ctrl+Tab shows the first tab');
  check((await shownViews(app)) === 1 && (await stripTabs(app))[0].active, 'Ctrl+Tab shows the first tab (wrapping round)', R);
  await page1.keyboard.press('Control+Shift+Tab');
  await waitFor(async () => (await shownTitle(app)).includes('plan_layers'), 'Ctrl+Shift+Tab shows the second tab');
  check(true, 'Ctrl+Shift+Tab goes back to the second tab', R);

  // 4. clicking a tab in the strip shows it, and each tab keeps its marking
  await clickTab(app, 0);
  await waitFor(async () => (await shownTitle(app)).includes('plan_A3_single'), 'click the first tab');
  check((await markups(page1)) === 1, 'clicking the first tab in the strip shows it, with its marking', R);
  await clickTab(app, 1);
  await waitFor(async () => (await shownTitle(app)).includes('plan_layers'), 'click the second tab');
  check((await markups(page2)) === 1, 'clicking the second tab shows it, with its marking', R);

  // 5. each tab keeps its own recovery copy
  await page1.evaluate(() => window.__plantint.writeRecovery());
  await page2.evaluate(() => window.__plantint.writeRecovery());
  check(recFiles().length === 2, `each tab has its own recovery copy (${recFiles().length} copies)`, R);

  // 6. a second launch with a drawing opens it as a new tab of the open window
  await app.evaluate(({ app }, f) => app.emit('second-instance', {}, ['PlanTint', f]), DATA + '/plan_A1_single.pdf');
  await waitFor(() => drawingPages(app).length === 3, 'the drawing from the second launch');
  const page3 = drawingPages(app).find((p) => p !== page1 && p !== page2);
  watch(page3, errors);
  await waitDoc(page3);
  check((await page3.evaluate(() => window.__plantint.S.doc.name)) === 'plan_A1_single.pdf', 'a drawing from a second launch opens as a new tab', R);
  check((await windowCount(app)) === 1 && (await stripTabs(app)).length === 3, 'still one window, now with three tabs', R);

  // 7. Ctrl+W closes a tab with nothing unsaved straight away; the other tabs and the window stay
  await page3.keyboard.press('Control+w');
  await waitFor(() => drawingPages(app).length === 2, 'the drawing without changes closes');
  check((await stripTabs(app)).length === 2 && (await windowCount(app)) === 1, 'Ctrl+W closes just that tab; the window stays open', R);

  // 8. Ctrl+W on a tab with unsaved work asks about that drawing alone; Cancel keeps it open, and the next Ctrl+W asks again
  await clickTab(app, 1);
  await waitFor(async () => (await shownTitle(app)).includes('plan_layers'), 'show the second tab');
  await page2.keyboard.press('Control+w');
  await page2.waitForSelector('.modal-title', { timeout: 10000 });
  const q = await page2.textContent('.modal-title');
  check(/plan_layers/.test(q) && /closing/.test(q), `asks about that drawing alone (“${q}”)`, R);
  await page2.click('.modal .btn:text("Cancel")');
  await page2.waitForSelector('.modal-title', { state: 'detached', timeout: 10000 });
  check(drawingPages(app).length === 2 && (await stripTabs(app)).length === 2, 'Cancel keeps the tab open', R);
  await page2.keyboard.press('Control+w');
  await page2.waitForSelector('.modal-title', { timeout: 10000 });
  check(true, 'the next Ctrl+W asks again', R);
  await page2.click('.modal .btn:text("Don’t save")');
  await waitFor(() => drawingPages(app).length === 1, 'the closed tab goes');
  check((await markups(page1)) === 1, 'the other tab is unchanged', R);
  check(recFiles().length === 1, 'the closed tab’s recovery copy is removed, the other is kept', R);
  const left = await stripTabs(app);
  check(left.length === 1 && left[0].active && (await shownTitle(app)).includes('plan_A3_single'), 'the remaining tab is shown', R);

  // 9. closing the window asks about each unsaved tab in turn, then the app closes
  await page1.keyboard.press('Control+n');
  await waitFor(() => drawingPages(app).length === 2, 'a new tab');
  const page4 = drawingPages(app).find((p) => p !== page1);
  watch(page4, errors);
  await page4.waitForFunction(() => window.__plantint && window.__plantint.S, null, { timeout: 60000 });
  await stubOpen(app, DATA + '/plan_zones.pdf');
  await page4.keyboard.press('Control+o');
  await waitDoc(page4);
  await page4.keyboard.press('r');
  await clickSheet(page4, 800, 700);
  await clickSheet(page4, 2400, 1900);
  await waitMarkups(page4, 1);
  const exited = new Promise((res) => app.process().once('exit', () => res(true)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page1.waitForSelector('.modal-title', { timeout: 10000 });
  const q1 = await page1.textContent('.modal-title');
  check(/plan_A3_single/.test(q1) && /closing/.test(q1), `closing the window asks about the first unsaved tab (“${q1}”)`, R);
  await page1.click('.modal .btn:text("Don’t save")');
  await page4.waitForSelector('.modal-title', { timeout: 10000 });
  const q2 = await page4.textContent('.modal-title');
  check(/plan_zones/.test(q2), `then about the next one (“${q2}”)`, R);
  await page4.click('.modal .btn:text("Don’t save")');
  const gone = await Promise.race([exited, new Promise((r) => setTimeout(() => r(false), 15000))]);
  check(gone, 'the app closes after the last tab', R);
  check(recFiles().length === 0, 'no recovery copy is left after closing without saving', R);
} catch (e) {
  check(false, 'tabs: ' + e.stack, R);
} finally {
  await quit(app);
}

process.exit(summary(R, errors) ? 0 : 1);
