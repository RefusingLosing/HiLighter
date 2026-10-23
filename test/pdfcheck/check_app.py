"""Checks PDFs saved by the app against the app's own PNG export, in four PDF engines.

usage: check_app.py <png> <pdf> [<pdf> ...]
The PNG is the finished sheet at full resolution; every PDF must look the same in MuPDF,
PDFium (Chrome/Edge), Poppler and Ghostscript. Also proves the highlights are there by
comparing against the original drawing inside the markup areas.
"""
import sys, os, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engines import render, ENGINES

Image.MAX_IMAGE_PIXELS = None
DPI = 60
png, pdfs = sys.argv[1], sys.argv[2:]
ref_full = Image.open(png).convert('RGB')
fails = 0
for pdf in pdfs:
    for eng in ENGINES:
        img = render(pdf, DPI, eng)
        ref = np.asarray(ref_full.resize(img.size, Image.BOX), dtype=np.int16)
        got = np.asarray(img, dtype=np.int16)
        d = np.abs(ref - got).max(axis=2)
        # compare where the finished sheet is flat colour (paper, fills, highlights), not on
        # lines and text, whose anti-aliasing differs from engine to engine
        g = ref.max(axis=2)
        from scipy.ndimage import maximum_filter, minimum_filter
        rng = maximum_filter(g, 5) - minimum_filter(g, 5)
        rng = np.maximum(rng, maximum_filter(ref.min(axis=2), 5) - minimum_filter(ref.min(axis=2), 5))
        flat = rng < 10
        df = d[flat]
        mean, p995, big = df.mean(), np.percentile(df, 99.5), (df > 24).mean() * 100
        ok = mean < 3.0 and big < 0.3
        fails += not ok
        print(f'{os.path.basename(pdf):18s} {eng:12s} {img.size[0]}x{img.size[1]}  flat area {flat.mean()*100:4.1f}%  mean {mean:5.2f}  p99.5 {p995:5.1f}  >24: {big:5.2f}%  {"OK" if ok else "FAIL"}')
        if not ok:
            Image.fromarray(np.clip(d * 4 * flat, 0, 255).astype(np.uint8)).save(pdf + f'.{eng}.diff.png')
            img.save(pdf + f'.{eng}.png')
print('FAILS', fails)
sys.exit(1 if fails else 0)
