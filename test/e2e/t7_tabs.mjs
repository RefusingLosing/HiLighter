// 1.4: tabs. Each drawing is a tab in one window, with its own marking, its own name in the strip, its own
// unsaved-work question and its own recovery copy. Ctrl+N and the + open an empty tab; opening a drawing from a
// tab that already has one puts it in a new tab; a second launch with a drawing opens it as a new tab; the
// strip, Ctrl+Tab and Ctrl+Shift+Tab switch tabs; Ctrl+W closes one tab (also from a text box) and asks only
// about that tab's work; closing the window asks about each unsaved tab in turn.
// Where xdotool is installed, the + and a tab's × are also clicked with the real mouse: unlike a test click,
// a real click cannot reach a button that is left inside the strip's window-drag area.
import { launch, waitDoc, check, summary, clickSheet, waitMarkups, stubOpen, quit, drawingPages, planPt, DATA, RECOVERY_DIR } from './lib.mjs';
import { execFileSync } from 'child_process';
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
const docName = (page) => page.evaluate(() => (window.__plantint.S.doc ? window.__plantint.S.doc.name : null));
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
/** Presses keys that close the page: the tab can be gone before the test has let go of the key, which is fine. */
const pressToClose = (page, keys) => page.keyboard.press(keys).catch((e) => { if (!/closed/i.test(e.message)) throw e; });
const hasXdotool = (() => { try { execFileSync('xdotool', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
/** Presses keys on the real keyboard (X11), as a person would. Unlike test keys, these pass through the main process. */
function realKeys(combo) {
  const wid = execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'PlanTint'], { env: process.env }).toString().trim().split('\n')[0];
  execFileSync('xdotool', ['windowfocus', '--sync', wid, 'key', '--clearmodifiers', combo], { env: process.env });
}
/** Clicks an element of the strip with the real mouse pointer (X11), as a person would. */
async function realClick(app, locator) {
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  const r = await locator.boundingBox();
  execFileSync('xdotool', ['mousemove', String(Math.round(cb.x + r.x + r.width / 2)), String(Math.round(cb.y + r.y + r.height / 2)), 'click', '1'], { env: process.env });
}

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
  check(!(await docName(page2)), 'the new tab is empty', R);
  check((await shownViews(app)) === 1, 'one drawing is shown at a time', R);
  let tabsNow = await stripTabs(app);
  check(tabsNow.length === 2 && tabsNow[1].active && !tabsNow[0].active, `the strip lists both tabs, the new one active (${tabsNow.map((t) => t.name).join(' | ')})`, R);
  check(tabsNow[0].unsaved && !tabsNow[1].unsaved, 'only the drawing with unsaved marking has a dot in the strip', R);
  check((await markups(page1)) === 1, 'the first tab keeps its marking', R);

  // 2. with the real mouse: the + opens a tab, and the × on a tab closes it
  if (hasXdotool) {
    await realClick(app, strip(app).locator('#new'));
    await waitFor(() => drawingPages(app).length === 3, 'a tab from a real click on the +');
    tabsNow = await stripTabs(app);
    check(tabsNow.length === 3 && tabsNow[2].active, 'a real mouse click on the + opens a tab', R);
    await realClick(app, strip(app).locator('.tab.active .close'));
    await waitFor(() => drawingPages(app).length === 2, 'the tab closed by a real click on its ×');
    check((await stripTabs(app)).length === 2, 'a real mouse click on a tab’s × closes it', R);
    // the same from the real keyboard
    realKeys('ctrl+n');
    await waitFor(() => drawingPages(app).length === 3, 'a tab from Ctrl+N on the keyboard');
    realKeys('ctrl+Tab');
    await waitFor(async () => (await stripTabs(app))[0].active, 'Ctrl+Tab on the keyboard');
    realKeys('ctrl+shift+Tab');
    await waitFor(async () => (await stripTabs(app))[2].active, 'Ctrl+Shift+Tab on the keyboard');
    realKeys('ctrl+w');
    await waitFor(() => drawingPages(app).length === 2, 'Ctrl+W on the keyboard');
    check(true, 'Ctrl+N, Ctrl+Tab, Ctrl+Shift+Tab and Ctrl+W work from the real keyboard', R);
  } else console.log('SKIP real mouse clicks and keys: xdotool is not installed');

  // 3. a drawing opened in the empty tab goes into that tab, with its own marking
  await stubOpen(app, DATA + '/plan_layers.pdf');
  await page2.keyboard.press('Control+o');
  await waitDoc(page2);
  check((await docName(page2)) === 'plan_layers.pdf' && drawingPages(app).length === 2, 'Ctrl+O in an empty tab opens the drawing in that tab', R);
  await page2.keyboard.press('r');
  await clickSheet(page2, ...(await planPt(page2, 3, 3)));
  await clickSheet(page2, ...(await planPt(page2, 9, 7)));
  await waitMarkups(page2, 1);
  check((await markups(page1)) === 1 && (await markups(page2)) === 1, 'each tab has its own marking', R);
  tabsNow = await stripTabs(app);
  check(tabsNow[0].name === 'plan_A3_single.pdf' && tabsNow[1].name === 'plan_layers.pdf' && tabsNow[0].unsaved && tabsNow[1].unsaved, `the strip names each drawing (${tabsNow.map((t) => t.name).join(' | ')})`, R);
  check((await shownTitle(app)).includes('plan_layers'), `the window title follows the shown tab (${await shownTitle(app)})`, R);

  // 4. Ctrl+O in a tab that already has a drawing opens the chosen one in a new tab beside it
  await clickTab(app, 0);
  await waitFor(async () => (await shownTitle(app)).includes('plan_A3_single'), 'show the first tab');
  await stubOpen(app, DATA + '/plan_A1_single.pdf');
  await page1.keyboard.press('Control+o');
  await waitFor(() => drawingPages(app).length === 3, 'a new tab for the opened drawing');
  const pageB = drawingPages(app).find((p) => p !== page1 && p !== page2);
  watch(pageB, errors);
  await waitDoc(pageB);
  check((await docName(pageB)) === 'plan_A1_single.pdf', 'Ctrl+O in a tab that has a drawing opens the chosen one in a new tab', R);
  check((await docName(page1)) === 'plan_A3_single.pdf' && (await markups(page1)) === 1, 'the first tab keeps its drawing and marking', R);
  tabsNow = await stripTabs(app);
  check(tabsNow.length === 3 && tabsNow[2].active && (await shownTitle(app)).includes('plan_A1_single'), 'the new tab is added at the end and shown', R);

  // 5. the tab keys work while typing in a box: Ctrl+W on the keyboard in a text box closes the tab (it has
  //    nothing to save). Test keys skip the main process's key handling, so this needs the real keyboard.
  if (hasXdotool) {
    const typing = await pageB.evaluate(() => {
      const box = [...document.querySelectorAll('input')].find((i) => i.offsetParent && (i.type === 'text' || i.type === ''));
      if (box) box.focus();
      return !!box && document.activeElement === box;
    });
    realKeys('ctrl+w');
    await waitFor(() => drawingPages(app).length === 2, 'Ctrl+W from a text box closes the tab');
    check(typing, 'Ctrl+W on the keyboard closes the tab while a text box has the focus', R);
  } else {
    await pressToClose(pageB, 'Control+w');
    await waitFor(() => drawingPages(app).length === 2, 'Ctrl+W closes the tab');
  }

  // 6. Ctrl+Tab goes to the next tab (and wraps round), Ctrl+Shift+Tab goes back
  await page2.keyboard.press('Control+Tab');
  await waitFor(async () => (await shownTitle(app)).includes('plan_A3_single'), 'Ctrl+Tab shows the first tab');
  check((await shownViews(app)) === 1 && (await stripTabs(app))[0].active, 'Ctrl+Tab shows the first tab (wrapping round)', R);
  await page1.keyboard.press('Control+Shift+Tab');
  await waitFor(async () => (await shownTitle(app)).includes('plan_layers'), 'Ctrl+Shift+Tab shows the second tab');
  check(true, 'Ctrl+Shift+Tab goes back to the second tab', R);

  // 7. clicking a tab in the strip shows it, and each tab keeps its marking
  await clickTab(app, 0);
  await waitFor(async () => (await shownTitle(app)).includes('plan_A3_single'), 'click the first tab');
  check((await markups(page1)) === 1, 'clicking the first tab in the strip shows it, with its marking', R);
  await clickTab(app, 1);
  await waitFor(async () => (await shownTitle(app)).includes('plan_layers'), 'click the second tab');
  check((await markups(page2)) === 1, 'clicking the second tab shows it, with its marking', R);

  // 8. each tab keeps its own recovery copy
  await page1.evaluate(() => window.__plantint.writeRecovery());
  await page2.evaluate(() => window.__plantint.writeRecovery());
  check(recFiles().length === 2, `each tab has its own recovery copy (${recFiles().length} copies)`, R);

  // 9. a second launch with a drawing opens it as a new tab of the open window
  await app.evaluate(({ app }, f) => app.emit('second-instance', {}, ['PlanTint', f]), DATA + '/plan_A1_single.pdf');
  await waitFor(() => drawingPages(app).length === 3, 'the drawing from the second launch');
  const page3 = drawingPages(app).find((p) => p !== page1 && p !== page2);
  watch(page3, errors);
  await waitDoc(page3);
  check((await docName(page3)) === 'plan_A1_single.pdf', 'a drawing from a second launch opens as a new tab', R);
  check((await windowCount(app)) === 1 && (await stripTabs(app)).length === 3, 'still one window, now with three tabs', R);

  // 10. Ctrl+W closes a tab with nothing unsaved straight away; the other tabs and the window stay
  await pressToClose(page3, 'Control+w');
  await waitFor(() => drawingPages(app).length === 2, 'the drawing without changes closes');
  check((await stripTabs(app)).length === 2 && (await windowCount(app)) === 1, 'Ctrl+W closes just that tab; the window stays open', R);

  // 11. Ctrl+W on a tab with unsaved work asks about that drawing alone; Cancel keeps it open, and the next Ctrl+W asks again
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

  // 12. closing the window asks about each unsaved tab in turn, then the app closes
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
