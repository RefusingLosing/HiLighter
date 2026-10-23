import { launch, waitDoc, shot, quit, DATA } from './lib.mjs';
const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
try {
  await waitDoc(page);
  await shot(page, 'smoke_open');
  const info = await page.evaluate(() => {
    const { S } = window.__plantint;
    return { W: S.doc.W, H: S.doc.H, dpi: S.doc.dpi, scale: S.doc.scale, name: S.doc.name, text: (S.doc.text || []).length };
  });
  console.log(JSON.stringify(info));
} catch (e) { console.log('ERR', e.message); await shot(page, 'smoke_err'); }
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await quit(app);
