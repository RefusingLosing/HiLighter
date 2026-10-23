"""Checks that dimensions and area tags are in PDFs saved by the app, in four PDF engines.

usage: check_annots.py <expect.json> <pdf> [<pdf> ...] [--expect-missing]
expect.json: { "sheetDpi": 400, "lines": [[x, y], ...], "lineRgb": [r, g, b],
               "texts": [[x0, y0, x1, y1], ...], "textRgb": [r, g, b], "boxes": [[x0, y0, x1, y1], ...] }
Points are sheet pixels. lines: points on dimension lines (the dimension colour must be there);
texts: boxes holding dimension text (several pixels of the colour); boxes: tag boxes (mostly
white with dark text). With --expect-missing every PDF must fail (a control: the checks can see
a PDF without the annotations).
"""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engines import render, ENGINES

DPI = 300
k = 1.0
args = [a for a in sys.argv[1:] if not a.startswith('--')]
expect_missing = '--expect-missing' in sys.argv
spec = json.load(open(args[0]))
pdfs = args[1:]
fails = 0


def near(img, rgb, x, y, r):
    x, y = int(round(x * k)), int(round(y * k))
    win = img[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1].astype(int)
    if not win.size:
        return 1e9
    return np.sqrt(((win - np.array(rgb)) ** 2).sum(axis=2)).min()


def count(img, rgb, box, tol):
    x0, y0, x1, y1 = [int(round(v * k)) for v in box]
    win = img[max(0, y0):y1 + 1, max(0, x0):x1 + 1].astype(int)
    return int((np.sqrt(((win - np.array(rgb)) ** 2).sum(axis=2)) < tol).sum())


from PIL import Image
Image.MAX_IMAGE_PIXELS = None
for pdf in pdfs:
    # a PNG export is checked as it is (at the sheet's resolution); a PDF in every engine
    is_png = pdf.lower().endswith('.png')
    for eng in (['png'] if is_png else ENGINES):
        k = 1.0 if is_png else DPI / spec['sheetDpi']
        img = np.asarray(Image.open(pdf).convert('RGB')) if is_png else np.asarray(render(pdf, DPI, eng).convert('RGB'))
        bad = []
        for (x, y) in spec.get('lines', []):
            d = near(img, spec['lineRgb'], x, y, 2)
            if d > 110:
                bad.append(f'line at {x:.0f},{y:.0f} (closest {d:.0f})')
        for b in spec.get('texts', []):
            n = count(img, spec['textRgb'], b, 90)
            if n < 12:
                bad.append(f'text {b[0]:.0f},{b[1]:.0f} ({n} px)')
        for b in spec.get('boxes', []):
            x0, y0, x1, y1 = [int(round(v * k)) for v in b]
            win = img[y0 + 2:y1 - 1, x0 + 2:x1 - 1].astype(int)
            light = (win.min(axis=2) > 225).mean() if win.size else 0
            dark = (win.max(axis=2) < 110).sum() if win.size else 0
            if light < 0.45 or dark < 8:
                bad.append(f'tag {b[0]:.0f},{b[1]:.0f} (light {light:.2f}, dark {dark})')
        ok = not bad
        if expect_missing:
            ok = not ok
        fails += not ok
        print(f'{os.path.basename(pdf):22s} {eng:12s} {"OK" if ok else "FAIL"}  {"; ".join(bad[:4]) if bad else "all present"}')
print('FAILS', fails)
sys.exit(1 if fails else 0)
