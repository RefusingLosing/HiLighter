// Issue 2: the rectangle shows guides, its edges and its size before it is finished.
import { launch, waitDoc, shot, check, summary, moveSheet, clickSheet, toClient, waitMarkups, quit, DATA } from './lib.mjs';

const R = [];
const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
const T = () => page.evaluate(() => { const T = window.__plantint.T; return { guide: T.guide, rect: T.rect, snap: T.snap }; });
const px = (mm) => mm * 400 / 25.4;
try {
  await waitDoc(page);
  // zoom in on the living room so snapping works at a realistic scale
  await page.evaluate(() => { const { V, S } = window.__plantint; });
  await page.keyboard.press('r');
  // living room inner faces: left x = 135.4 mm, top y = 63 mm (from the sheet's top edge)
  const faceX = px(135.4), faceY = px(63);
  await moveSheet(page, faceX + 9, faceY + 8, 4);
  await page.waitForTimeout(250);
  await moveSheet(page, faceX + 8, faceY + 9);
  await page.waitForTimeout(250);
  let t = await T();
  check(t.guide && t.guide.cross, 'crosshair guide follows the pointer before the first corner', R);
  check(t.guide && t.guide.sx && t.guide.sy, `guide snaps to both wall faces (${t.guide && t.guide.x.toFixed(1)}, ${t.guide && t.guide.y.toFixed(1)}; faces at ${faceX.toFixed(1)}, ${faceY.toFixed(1)})`, R);
  check(t.guide && Math.abs(t.guide.x - faceX) < 3.5 && Math.abs(t.guide.y - faceY) < 3.5, 'snapped point is on the wall faces (±3 px at 400 dpi)', R);
  await shot(page, 't2_before_first');
  await clickSheet(page, faceX + 8, faceY + 9);
  await page.waitForTimeout(150);
  t = await T();
  check(t.rect && t.rect.waiting, 'first click starts the rectangle and waits for the opposite corner', R);
  const c0 = [t.rect.x0, t.rect.y0];
  // move to the opposite corner: the rectangle, its edges and its size show before the second click
  await moveSheet(page, faceX + 1300, faceY + 900, 6);
  await page.waitForTimeout(250);
  t = await T();
  check(Math.abs(t.rect.x1 - c0[0]) > 1000 && Math.abs(t.rect.y1 - c0[1]) > 700, 'rectangle follows the pointer while waiting', R);
  const hint = await page.textContent('#hint');
  check(/type the width/i.test(hint), 'status bar explains typing a size', R);
  await shot(page, 't2_waiting');
  // pixel check: the dimension labels are drawn on the UI canvas (dark pill near the top edge)
  const ink = await page.evaluate(([x0, y0, x1, y1]) => {
    const { V } = window.__plantint;
    const cv = document.getElementById('ui');
    const ctx = cv.getContext('2d');
    // above the top edge, centred: where the width label sits
    const cx = ((x0 + x1) / 2) * V.scale + V.tx, cy = Math.min(y0, y1) * V.scale + V.ty;
    const d = ctx.getImageData(Math.round(cx - 40), Math.round(cy - 60), 80, 60).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++;
    return n;
  }, [t.rect.x0, t.rect.y0, t.rect.x1, t.rect.y1]);
  check(ink > 200, `width label drawn above the top edge (${ink} opaque px)`, R);
  // typed size: 5.25 x 3.10 m at 1:50
  await page.keyboard.type('5.25');
  await page.waitForSelector('.dim-box:not([hidden])', { timeout: 3000 });
  const unit = await page.textContent('.dim-unit');
  check(unit.trim() === 'm', `typed sizes are in metres at the drawing scale (unit "${unit.trim()}")`, R);
  await page.keyboard.press('Tab');
  await page.keyboard.type('3.1');
  await page.waitForTimeout(150);
  await shot(page, 't2_typed');
  await page.keyboard.press('Enter');
  await waitMarkups(page, 1);
  const m = await page.evaluate(() => window.__plantint.S.markups[0]);
  const xs = m.rings[0].filter((_, i) => i % 2 === 0), ys = m.rings[0].filter((_, i) => i % 2 === 1);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  check(Math.abs(w - px(105)) < 0.6 && Math.abs(h - px(62)) < 0.6, `typed 5.25 × 3.10 m gives ${(w * 25.4 / 400 * 50 / 1000).toFixed(3)} × ${(h * 25.4 / 400 * 50 / 1000).toFixed(3)} m`, R);
  check(Math.abs(Math.min(...xs) - c0[0]) < 0.01 && Math.abs(Math.min(...ys) - c0[1]) < 0.01, 'typed rectangle keeps the snapped first corner', R);
  check(m.name === 'LIVING ROOM', `named from the room label (${m.name})`, R);
  // drag from corner to corner
  const a = await toClient(page, px(60), px(120)), b = await toClient(page, px(80), px(140));
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.waitForTimeout(100);
  t = await T();
  check(t.rect && !t.rect.waiting && Math.abs(t.rect.x1 - t.rect.x0) > 200, 'dragging shows the rectangle while the button is held', R);
  await page.mouse.up();
  await waitMarkups(page, 2);
  // Shift keeps it square
  const c = await toClient(page, px(300), px(40));
  await page.mouse.click(c.x, c.y, { modifiers: ['Control'] });
  await page.keyboard.down('Shift');
  const d2 = await toClient(page, px(340), px(52));
  await page.mouse.move(d2.x, d2.y, { steps: 4 });
  await page.waitForTimeout(100);
  t = await T();
  check(t.rect && Math.abs(Math.abs(t.rect.x1 - t.rect.x0) - Math.abs(t.rect.y1 - t.rect.y0)) < 0.01, 'Shift keeps the rectangle square', R);
  await page.mouse.click(d2.x, d2.y, { modifiers: ['Shift'] });
  await page.keyboard.up('Shift');
  await waitMarkups(page, 3);
  // Ctrl places a corner freely (no snapping)
  await moveSheet(page, faceX + 8, faceY + 9); await page.waitForTimeout(200);
  await page.keyboard.down('Control');
  await moveSheet(page, faceX + 8.5, faceY + 9.5); await page.waitForTimeout(150);
  t = await T();
  check(t.guide && !t.guide.sx && !t.guide.sy && Math.abs(t.guide.x - faceX - 8.5) < 1.5, 'holding Ctrl stops snapping', R);
  await page.keyboard.up('Control');
  await page.keyboard.press('Escape');
} catch (e) {
  check(false, 'exception: ' + e.stack, R);
  await shot(page, 't2_err');
}
const ok = summary(R, errors);
await quit(app);
process.exit(ok ? 0 : 1);
