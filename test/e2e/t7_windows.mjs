// 1.3: more than one window. Each window is its own drawing (its own marking, scale and recovery
// copy). Ctrl+N opens an empty window; a second launch with a drawing opens it in a window of its
// own; closing a window asks only about its own work; a new window does not offer a copy that
// belongs to a window still open.
import { launch, waitDoc, check, summary, clickSheet, waitMarkups, stubOpen, quit, OUT, DATA, RECOVERY_DIR } from './lib.mjs';
import fs from 'fs';

const R = [];
let allErrors = [];
const px = (mm) => (mm * 400) / 25.4;
const P = (mx, my) => [px(45 + 20 * mx), px(297 - (70 + 20 * my))]; // plan metres -> sheet px (plan_A3_single.pdf, 1:50, 400 dpi)
const recFiles = () => (fs.existsSync(RECOVERY_DIR) ? fs.readdirSync(RECOVERY_DIR).filter((n) => n.endsWith('.plantint')) : []);
const titles = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()));
const windowCount = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

{
  const { app, page, errors } = await launch(DATA + '/plan_A3_single.pdf');
  try {
    await waitDoc(page);
    await page.keyboard.press('f');
    await clickSheet(page, ...P(10.5, 7.6));
    await waitMarkups(page, 1);

    // 1. Ctrl+N opens a second, empty window and leaves the first one alone
    const [w2] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('Control+n')]);
    await w2.waitForFunction(() => window.__plantint && window.__plantint.S, null, { timeout: 60000 });
    check(await w2.evaluate(() => !window.__plantint.S.doc), 'Ctrl+N opens an empty window', R);
    check(await page.evaluate(() => window.__plantint.S.markups.length) === 1, 'the first window keeps its marking', R);

    // 2. a drawing opened in the second window is its own
    await stubOpen(app, DATA + '/plan_layers.pdf');
    await w2.keyboard.press('Control+o');
    await waitDoc(w2);
    check(await w2.evaluate(() => window.__plantint.S.doc.name) === 'plan_layers.pdf', 'the second window opens its own drawing', R);
    check(await page.evaluate(() => window.__plantint.S.doc.name) === 'plan_A3_single.pdf', 'the first window still shows its drawing', R);

    // 3. each window marks on its own
    await w2.keyboard.press('r');
    await clickSheet(w2, 1000, 1000);
    await clickSheet(w2, 2000, 1800);
    await waitMarkups(w2, 1);
    check(await page.evaluate(() => window.__plantint.S.markups.length) === 1, 'a marking in the second window does not appear in the first', R);
    const t = await titles(app);
    check(t.some((x) => x.includes('plan_A3_single')) && t.some((x) => x.includes('plan_layers')), `each window has its own title (${t.join(' | ')})`, R);

    // 4. both windows keep a recovery copy
    await page.evaluate(() => window.__plantint.writeRecovery());
    await w2.evaluate(() => window.__plantint.writeRecovery());
    check(recFiles().length === 2, `each window keeps its own recovery copy (${recFiles().length})`, R);

    // 5. a new window does not offer the copies of windows that are still open
    const [w3] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('Control+n')]);
    await w3.waitForFunction(() => window.__plantint || document.querySelector('.modal-title'), null, { timeout: 60000 });
    await w3.waitForFunction(() => window.__plantint && window.__plantint.S, null, { timeout: 60000 });
    check((await w3.locator('.modal-title', { hasText: 'Restore unsaved marking?' }).count()) === 0, 'a new window does not offer open windows’ copies', R);
    // the empty window has no work, so it closes without a question
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'PlanTint').close());
    await page.waitForTimeout(800);
    check((await windowCount(app)) === 2, 'closing an empty window leaves the others open', R);

    // 6. closing a window asks only about its own drawing; the other window keeps its work
    const closed2 = w2.waitForEvent('close', { timeout: 15000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('plan_layers')).close());
    await w2.waitForSelector('.modal-title', { timeout: 10000 });
    const mt = await w2.textContent('.modal-title');
    check(/plan_layers/.test(mt) && /closing/.test(mt), `closing asks about that window’s drawing only (“${mt}”)`, R);
    await w2.click('.modal .btn:text("Don’t save")');
    await closed2;
    check((await windowCount(app)) === 1, 'the other window stays open', R);
    check(await page.evaluate(() => window.__plantint.S.markups.length) === 1, 'the first window’s marking is unchanged', R);
    check(recFiles().length === 1, 'the closed window’s recovery copy is removed and the other kept', R);

    // 7. a second launch with a drawing opens it in a window of its own
    const [w4] = await Promise.all([
      app.waitForEvent('window'),
      app.evaluate(({ app }, f) => app.emit('second-instance', {}, ['PlanTint', f]), DATA + '/plan_A1_single.pdf'),
    ]);
    await w4.waitForFunction(() => window.__plantint && (window.__plantint.S.doc || document.querySelector('.modal-title')), null, { timeout: 60000 });
    await waitDoc(w4);
    check(await w4.evaluate(() => window.__plantint.S.doc.name) === 'plan_A1_single.pdf', 'a drawing from a second launch opens in a window of its own', R);
    check(await page.evaluate(() => window.__plantint.S.doc.name) === 'plan_A3_single.pdf', 'the first window is still on its own drawing', R);
    await page.screenshot({ path: OUT + '/t7_windows.png' });
  } catch (e) { check(false, 'windows: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}

process.exit(summary(R, allErrors) ? 0 : 1);
