// 1.3: crash recovery with more than one copy. When the app dies with several windows open, each
// window's unsaved copy is offered in turn at the next start, newest first. Discarding one moves on
// to the next; restoring one stops the offers.
import { launch, waitDoc, check, summary, clickSheet, waitMarkups, quit, DATA, RECOVERY_DIR } from './lib.mjs';
import fs from 'fs';
import path from 'path';

const R = [];
let allErrors = [];
const px = (mm) => (mm * 400) / 25.4;
const P = (mx, my) => [px(45 + 20 * mx), px(297 - (70 + 20 * my))]; // plan metres -> sheet px (plan_A3_single.pdf, 1:50, 400 dpi)

// 1. a window with one markup writes its copy, then the app is killed without a clean close
{
  const { app, page, errors } = await launch(DATA + '/plan_A3_single.pdf');
  try {
    await waitDoc(page);
    await page.keyboard.press('f');
    await clickSheet(page, ...P(10.5, 7.6));
    await waitMarkups(page, 1);
    await page.evaluate(() => window.__plantint.writeRecovery());
    app.process().kill('SIGKILL');
  } catch (e) { check(false, 'set up: ' + e.stack, R); await quit(app); }
  allErrors = allErrors.concat(errors);
}

// two copies are left behind, as if two windows had been open: an older one and a newer one
const own = fs.readdirSync(RECOVERY_DIR).find((n) => n.endsWith('.plantint')).slice(0, -'.plantint'.length);
const meta = JSON.parse(fs.readFileSync(path.join(RECOVERY_DIR, own + '.json'), 'utf8'));
for (const [name, file, time] of [['old-window', 'plan_old.pdf', '2026-10-22T10:00:00.000Z'], ['new-window', 'plan_new.pdf', '2026-10-23T10:00:00.000Z']]) {
  fs.copyFileSync(path.join(RECOVERY_DIR, own + '.plantint'), path.join(RECOVERY_DIR, name + '.plantint'));
  fs.writeFileSync(path.join(RECOVERY_DIR, name + '.json'), JSON.stringify({ name: file, time }));
}
fs.rmSync(path.join(RECOVERY_DIR, own + '.plantint'), { force: true });
fs.rmSync(path.join(RECOVERY_DIR, own + '.json'), { force: true });

// 2. the next start offers the newer copy first; discarding it offers the older one; restoring that stops the offers
{
  const { app, page, errors } = await launch(null, { clearRecovery: false });
  try {
    const modal = (name) => page.locator('.modal').filter({ hasText: 'Restore unsaved marking?' }).filter({ hasText: name });
    await modal('plan_new.pdf').first().waitFor({ timeout: 60000 });
    check(true, 'the newer copy is offered first', R);
    await page.locator('.modal').filter({ hasText: 'plan_new.pdf' }).locator('.btn', { hasText: 'Discard it' }).click();
    await modal('plan_old.pdf').first().waitFor({ timeout: 30000 });
    check(true, 'after discarding it, the older copy is offered', R);
    await page.locator('.modal').filter({ hasText: 'plan_old.pdf' }).locator('.btn.primary').click();
    await waitDoc(page);
    const n = await page.evaluate(() => window.__plantint.S.markups.length);
    check(n === 1, `restored the older copy (${n} markup)`, R);
    await page.waitForTimeout(500);
    const left = fs.readdirSync(RECOVERY_DIR).filter((f) => f.endsWith('.plantint'));
    check(left.length === 1 && !left.includes('old-window.plantint') && !left.includes('new-window.plantint'), `only this window’s copy is kept (${left.join(', ')})`, R);
    check((await page.locator('.modal', { hasText: 'Restore unsaved marking?' }).count()) === 0, 'no more offers once one copy is restored', R);
  } catch (e) { check(false, 'two copies: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}

process.exit(summary(R, allErrors) ? 0 : 1);
