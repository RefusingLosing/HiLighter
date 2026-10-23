# Extra test inputs: a heavy A1 vector sheet, scanned-style raster versions (JPEG, 2-page TIFF, 1-bit G4 TIFF).
import os, subprocess, sys, random, math
from PIL import Image, ImageFilter
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import black, HexColor

OUT = sys.argv[1] if len(sys.argv) > 1 else 'testdata/out'
random.seed(7)

# heavy A1: a dense grid of apartments with hatching, ~150k path segments
W, H = 841 * mm, 594 * mm
c = canvas.Canvas(os.path.join(OUT, 'heavy_A1.pdf'), pagesize=(W, H))
c.setLineWidth(0.6); c.rect(10 * mm, 10 * mm, W - 20 * mm, H - 20 * mm)
for gy in range(6):
    for gx in range(10):
        x0, y0 = 30 * mm + gx * 78 * mm, 40 * mm + gy * 88 * mm
        c.setLineWidth(1.4); c.rect(x0, y0, 70 * mm, 80 * mm)
        c.setLineWidth(0.7); c.line(x0 + 35 * mm, y0, x0 + 35 * mm, y0 + 50 * mm); c.line(x0, y0 + 50 * mm, x0 + 70 * mm, y0 + 50 * mm)
        if (gx + gy) % 3 == 0:
            c.setFillColor(HexColor('#FFE9A8')); c.rect(x0 + 1, y0 + 50 * mm + 1, 70 * mm - 2, 30 * mm - 2, stroke=0, fill=1); c.setFillColor(black)
        c.setLineWidth(0.12)
        for k in range(0, 260):
            t = k * 0.27 * mm
            c.line(x0 + t, y0, x0 + t + 6 * mm, y0 + 6 * mm) if t < 64 * mm else None
        for k in range(40):
            px, py = x0 + random.random() * 66 * mm + 2 * mm, y0 + random.random() * 46 * mm + 2 * mm
            c.circle(px, py, 0.8 * mm)
        c.setFont('Helvetica', 6); c.drawString(x0 + 3 * mm, y0 + 74 * mm, f'UNIT {gy}{gx:02d}')
c.setFont('Helvetica', 8); c.drawString(W - 200 * mm, 20 * mm, 'SITE PLAN   Scale 1:200 @ A1')
c.showPage(); c.save()

# raster versions of the painted plan, as a scanner would make them
tmp = os.path.join(OUT, '_r')
subprocess.run(['pdftoppm', '-r', '200', '-png', os.path.join(OUT, 'plan_zones.pdf'), tmp], check=True)
img = Image.open(tmp + '-1.png').convert('RGB')
os.remove(tmp + '-1.png')
scan = img.rotate(0.35, resample=Image.BICUBIC, fillcolor=(250, 249, 244)).filter(ImageFilter.GaussianBlur(0.5))
scan.save(os.path.join(OUT, 'scan_plan.jpg'), quality=88, dpi=(200, 200))
second = Image.open(os.path.join(OUT, 'scan_plan.jpg')).convert('L').convert('RGB')
scan.save(os.path.join(OUT, 'scan_2pages.tif'), save_all=True, append_images=[second], compression='tiff_lzw', dpi=(200, 200))
bw = img.convert('L').point(lambda v: 0 if v < 140 else 255).convert('1')
bw.save(os.path.join(OUT, 'bilevel_g4.tif'), compression='group4', dpi=(200, 200))
print('ok')
