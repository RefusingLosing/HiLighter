# Generates realistic-ish architectural test drawings for PlanTint.
import math, sys
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import black, white, HexColor

OUT = sys.argv[1] if len(sys.argv) > 1 else 'testdata/out'

def wall_rect(c, x, y, w, h, t, fill=True):
    c.setFillColor(HexColor('#3a3a3a')); c.setStrokeColor(black); c.setLineWidth(0.35)
    for (bx, by, bw, bh) in [(x, y, w, t), (x, y + h - t, w, t), (x, y, t, h), (x + w - t, y, t, h)]:
        c.rect(bx, by, bw, bh, stroke=1, fill=1 if fill else 0)

def bar(c, x, y, w, h):
    c.setFillColor(HexColor('#3a3a3a')); c.setStrokeColor(black); c.setLineWidth(0.35)
    c.rect(x, y, w, h, stroke=1, fill=1)

def door(c, hx, hy, r, start, sweep, leaf_angle):
    c.setStrokeColor(black); c.setLineWidth(0.25)
    a = math.radians(leaf_angle)
    c.line(hx, hy, hx + r * math.cos(a), hy + r * math.sin(a))
    c.setDash(2, 1.5); c.setLineWidth(0.18)
    p = c.beginPath(); p.arc(hx - r, hy - r, hx + r, hy + r, startAng=start, extent=sweep)
    c.drawPath(p, stroke=1, fill=0); c.setDash()

def label(c, x, y, name, area, size=9):
    c.setFillColor(black); c.setFont('Helvetica-Bold', size); c.drawCentredString(x, y, name)
    c.setFont('Helvetica', size * 0.72); c.drawCentredString(x, y - size * 1.15, area)

def dim_h(c, x1, x2, y, txt):
    c.setStrokeColor(black); c.setLineWidth(0.18); c.line(x1, y, x2, y)
    for x in (x1, x2):
        c.line(x, y - 4, x, y + 4); c.line(x - 2, y - 2, x + 2, y + 2)
    c.setFont('Helvetica', 6); c.setFillColor(black); c.drawCentredString((x1 + x2) / 2, y + 2, txt)

def dim_v(c, y1, y2, x, txt):
    c.setStrokeColor(black); c.setLineWidth(0.18); c.line(x, y1, x, y2)
    for y in (y1, y2):
        c.line(x - 4, y, x + 4, y); c.line(x - 2, y - 2, x + 2, y + 2)
    c.saveState(); c.translate(x - 2, (y1 + y2) / 2); c.rotate(90); c.setFont('Helvetica', 6); c.drawCentredString(0, 0, txt); c.restoreState()

def title_block(c, W, H, scale='1:50'):
    x0 = W - 180 * mm; y0 = 10 * mm
    c.setStrokeColor(black); c.setLineWidth(0.6); c.rect(10 * mm, 10 * mm, W - 20 * mm, H - 20 * mm)
    c.setLineWidth(0.4); c.rect(x0, y0, 170 * mm, 38 * mm)
    c.line(x0, y0 + 19 * mm, x0 + 170 * mm, y0 + 19 * mm); c.line(x0 + 110 * mm, y0, x0 + 110 * mm, y0 + 38 * mm)
    c.setFillColor(black)
    c.setFont('Helvetica-Bold', 11); c.drawString(x0 + 4 * mm, y0 + 27 * mm, 'GROUND FLOOR PLAN')
    c.setFont('Helvetica', 7); c.drawString(x0 + 4 * mm, y0 + 22 * mm, 'Residential unit type B - Zone 3')
    c.drawString(x0 + 4 * mm, y0 + 12 * mm, 'Scale ' + scale + '   Drawn: AB   Checked: MK')
    c.drawString(x0 + 4 * mm, y0 + 5 * mm, 'Drawing no. A-101   Rev C')
    c.setFillColor(HexColor('#E4572E')); c.circle(x0 + 140 * mm, y0 + 28 * mm, 5 * mm, stroke=0, fill=1)
    c.setFillColor(HexColor('#2E86AB')); c.rect(x0 + 147 * mm, y0 + 23 * mm, 10 * mm, 10 * mm, stroke=0, fill=1)
    c.setFillColor(black); c.setFont('Helvetica-Bold', 8); c.drawString(x0 + 133 * mm, y0 + 8 * mm, 'ARKAN CONSULT')

def plan_page(c, W, H, prepaint=True, extra_paint=False):
    ox, oy = 45 * mm, 70 * mm
    m = 20 * mm                    # 1 metre at 1:50
    t_ext, t_int = 0.30 * m, 0.12 * m
    BW, BH = 12 * m, 8.5 * m
    if prepaint:
        c.setFillColor(HexColor('#FFF0A8')); c.rect(ox + t_ext, oy + 4.6 * m, 4.4 * m - t_ext, 3.9 * m - t_ext, stroke=0, fill=1)   # kitchen yellow
        c.setFillColor(HexColor('#BFE3F5')); c.rect(ox + 9.0 * m, oy + t_ext, 3.0 * m - t_ext, 3.0 * m - t_ext, stroke=0, fill=1)    # bath blue
    if extra_paint:
        # a pale tint and a second, close shade of green: harder cases for the colour finder
        c.setFillColor(HexColor('#EAF2FB')); c.rect(ox + t_ext, oy + t_ext, 4.4 * m - t_ext, 4.6 * m - t_ext, stroke=0, fill=1)     # bedroom 1, very pale blue
        c.setFillColor(HexColor('#CDEBC5')); c.rect(ox + 4.4 * m, oy + 3.0 * m, 4.6 * m, 2.2 * m, stroke=0, fill=1)                 # corridor, light green
        c.setFillColor(HexColor('#A9DB9C')); c.rect(ox + 6.6 * m, oy + t_ext, 2.4 * m, 3.0 * m - t_ext, stroke=0, fill=1)          # bedroom 2, medium green
    wall_rect(c, ox, oy, BW, BH, t_ext)
    bar(c, ox + 4.4 * m, oy + t_ext, t_int, BH - 2 * t_ext)
    bar(c, ox + t_ext, oy + 4.6 * m, 4.4 * m - t_ext, t_int)
    bar(c, ox + 9.0 * m, oy + t_ext, t_int, 3.0 * m)
    bar(c, ox + 9.0 * m, oy + 3.0 * m, BW - 9.0 * m - t_ext, t_int)
    bar(c, ox + 4.4 * m, oy + 5.2 * m, 3.2 * m, t_int)
    bar(c, ox + 8.6 * m, oy + 5.2 * m, BW - 8.6 * m - t_ext, t_int)
    bar(c, ox + 6.6 * m, oy + t_ext, t_int, 3.0 * m)
    bar(c, ox + 4.4 * m, oy + 3.0 * m, 2.2 * m, t_int)
    bar(c, ox + 6.6 * m, oy + 3.0 * m, 2.4 * m, t_int)
    def opening(x, y, w, h):
        c.setFillColor(white); c.setStrokeColor(white); c.rect(x, y, w, h, stroke=0, fill=1)
        c.setStrokeColor(black); c.setLineWidth(0.25)
        if w > h: c.line(x, y, x, y + h); c.line(x + w, y, x + w, y + h)
        else: c.line(x, y, x + w, y); c.line(x, y + h, x + w, y + h)
    opening(ox + 4.4 * m - 0.5, oy + 6.0 * m, t_int + 1, 0.9 * m); door(c, ox + 4.4 * m + t_int, oy + 6.0 * m, 0.9 * m, 0, 90, 90)
    opening(ox + 4.4 * m - 0.5, oy + 3.3 * m, t_int + 1, 0.9 * m); door(c, ox + 4.4 * m, oy + 3.3 * m, 0.9 * m, 90, 90, 180)
    opening(ox + 9.0 * m - 0.5, oy + 1.0 * m, t_int + 1, 0.8 * m); door(c, ox + 9.0 * m + t_int, oy + 1.0 * m, 0.8 * m, 0, 90, 90)
    opening(ox + 6.6 * m - 0.5, oy + 1.8 * m, t_int + 1, 0.9 * m); door(c, ox + 6.6 * m, oy + 1.8 * m, 0.9 * m, 90, 90, 180)
    opening(ox + 7.4 * m, oy - 0.5, 1.0 * m, t_ext + 1); door(c, ox + 7.4 * m, oy + t_ext, 1.0 * m, 0, 90, 90)
    def window_h(x, y, w):
        c.setFillColor(white); c.rect(x, y, w, t_ext, stroke=0, fill=1); c.setStrokeColor(black); c.setLineWidth(0.2)
        for k in (0, 0.5, 1): c.line(x, y + k * t_ext, x + w, y + k * t_ext)
        c.line(x, y, x, y + t_ext); c.line(x + w, y, x + w, y + t_ext)
    window_h(ox + 1.2 * m, oy + BH - t_ext, 1.8 * m); window_h(ox + 6.0 * m, oy + BH - t_ext, 2.4 * m); window_h(ox + 1.0 * m, oy, 2.0 * m)
    c.setStrokeColor(black); c.setLineWidth(0.2); c.setFillColor(white)
    c.rect(ox + 0.6 * m, oy + 0.8 * m, 1.6 * m, 2.0 * m, stroke=1, fill=0); c.rect(ox + 0.75 * m, oy + 2.35 * m, 0.55 * m, 0.35 * m); c.rect(ox + 1.5 * m, oy + 2.35 * m, 0.55 * m, 0.35 * m)
    c.rect(ox + 7.0 * m, oy + 0.6 * m, 1.4 * m, 1.9 * m, stroke=1, fill=0)
    c.circle(ox + 6.2 * m, oy + 6.9 * m, 0.55 * m)
    for k in range(4):
        a = k * math.pi / 2; c.rect(ox + 6.2 * m + math.cos(a) * 0.8 * m - 6, oy + 6.9 * m + math.sin(a) * 0.8 * m - 6, 12, 12)
    c.rect(ox + 9.6 * m, oy + 6.0 * m, 2.0 * m, 0.9 * m)
    c.rect(ox + 0.5 * m, oy + 7.6 * m, 3.4 * m, 0.6 * m)
    c.circle(ox + 1.3 * m, oy + 7.9 * m, 0.18 * m); c.circle(ox + 2.6 * m, oy + 7.9 * m, 0.22 * m)
    c.rect(ox + 11.0 * m, oy + 0.5 * m, 0.6 * m, 1.4 * m)
    c.ellipse(ox + 9.4 * m, oy + 2.1 * m, ox + 9.9 * m, oy + 2.7 * m)
    label(c, ox + 2.2 * m, oy + 6.4 * m, 'KITCHEN', '15.6 m²')
    label(c, ox + 8.2 * m, oy + 6.6 * m, 'LIVING ROOM', '22.4 m²', 10)
    label(c, ox + 2.2 * m, oy + 3.6 * m, 'BEDROOM 1', '17.9 m²')
    label(c, ox + 7.8 * m, oy + 2.9 * m, 'BEDROOM 2', '6.1 m²', 8)
    label(c, ox + 10.5 * m, oy + 1.6 * m, 'BATH', '7.6 m²', 8)
    label(c, ox + 5.5 * m, oy + 4.2 * m, 'CORRIDOR', '6.9 m²', 7)
    c.setFillColor(HexColor('#D0021B')); c.setFont('Helvetica-Bold', 9); c.drawString(ox + 0.3 * m, oy + BH + 0.6 * m, 'REV C: KITCHEN LAYOUT REVISED - SEE NOTE 4')
    c.setStrokeColor(HexColor('#D0021B')); c.setLineWidth(0.6)
    p = c.beginPath(); cx, cy, r = ox + 3.2 * m, oy + 7.2 * m, 1.0 * m
    for i in range(0, 361, 30):
        a = math.radians(i)
        if i: p.lineTo(cx + r * math.cos(a), cy + r * 0.6 * math.sin(a))
        else: p.moveTo(cx + r, cy)
    c.drawPath(p, stroke=1, fill=0)
    dim_h(c, ox, ox + 4.4 * m, oy - 0.9 * m, '4400'); dim_h(c, ox + 4.4 * m, ox + 9.0 * m, oy - 0.9 * m, '4600'); dim_h(c, ox + 9.0 * m, ox + BW, oy - 0.9 * m, '3000')
    dim_h(c, ox, ox + BW, oy - 1.6 * m, '12000'); dim_v(c, oy, oy + BH, ox - 1.0 * m, '8500'); dim_v(c, oy, oy + 4.6 * m, ox - 0.5 * m, '4600')
    c.setLineWidth(0.25); c.setStrokeColor(black)
    for i, gx in enumerate([0, 4.4, 9.0, 12.0]):
        x = ox + gx * m; c.setDash(6, 2); c.line(x, oy + BH + 0.2 * m, x, oy + BH + 1.6 * m); c.setDash(); c.circle(x, oy + BH + 1.9 * m, 0.3 * m); c.setFont('Helvetica', 8); c.setFillColor(black); c.drawCentredString(x, oy + BH + 1.83 * m, str(i + 1))
    title_block(c, W, H)
    c.setLineWidth(0.4); nx, ny = W - 40 * mm, H - 40 * mm; c.circle(nx, ny, 9 * mm); p = c.beginPath(); p.moveTo(nx, ny + 9 * mm); p.lineTo(nx - 3 * mm, ny - 5 * mm); p.lineTo(nx, ny - 2 * mm); p.close(); c.setFillColor(black); c.drawPath(p, fill=1); c.setFont('Helvetica-Bold', 10); c.drawCentredString(nx, ny + 11 * mm, 'N')

def hatch_zone(c, W, H):
    # a zone marked by coloured hatching (45° lines) instead of a solid fill
    ox, oy, m = 45 * mm, 70 * mm, 20 * mm
    x0, y0, x1, y1 = ox + 9.12 * m, oy + 3.12 * m, ox + 11.7 * m, oy + 5.2 * m
    c.saveState()
    p = c.beginPath(); p.rect(x0, y0, x1 - x0, y1 - y0); c.clipPath(p, stroke=0, fill=0)
    c.setStrokeColor(HexColor('#E8590C')); c.setLineWidth(0.5)
    k = -(y1 - y0)
    while k < (x1 - x0):
        c.line(x0 + k, y0, x0 + k + (y1 - y0), y1); k += 2.2 * mm
    c.restoreState()

def section_page(c, W, H):
    c.setStrokeColor(black); c.setLineWidth(0.6); c.rect(10 * mm, 10 * mm, W - 20 * mm, H - 20 * mm)
    ox, oy = 60 * mm, 80 * mm
    c.setLineWidth(1.2); c.line(ox - 20 * mm, oy, ox + 280 * mm, oy)
    c.setLineWidth(0.5)
    for k in range(3): c.rect(ox, oy + k * 50 * mm, 240 * mm, 50 * mm)
    c.setFont('Helvetica-Bold', 14); c.drawString(ox, oy + 165 * mm, 'SECTION A-A')
    c.setFont('Helvetica', 8)
    for k, t in enumerate(['GROUND FLOOR +0.00', 'FIRST FLOOR +3.20', 'ROOF +6.40']): c.drawString(ox + 245 * mm, oy + k * 50 * mm + 2, t)
    c.setLineWidth(0.15)
    for i in range(0, 300, 3): c.line(ox - 20 * mm + i * mm, oy, ox - 20 * mm + i * mm - 5 * mm, oy - 5 * mm)
    title_block(c, W, H, '1:100')

def grey_page(c, W, H):
    # grey zone fills (common for existing / service areas), coloured text inside a painted room
    ox, oy, m, t_ext = 45 * mm, 70 * mm, 20 * mm, 0.30 * 20 * mm
    c.setFillColor(HexColor('#D9D9D9')); c.rect(ox + 6.6 * m, oy + t_ext, 2.4 * m, 3.0 * m - t_ext, stroke=0, fill=1)   # bedroom 2, light grey
    c.setFillColor(HexColor('#BDBDBD')); c.rect(ox + 9.0 * m, oy + t_ext, 3.0 * m - t_ext, 3.0 * m - t_ext, stroke=0, fill=1)  # bath, mid grey
    c.setFillColor(HexColor('#FFE08A')); c.rect(ox + t_ext, oy + 4.6 * m, 4.4 * m - t_ext, 3.9 * m - t_ext, stroke=0, fill=1)   # kitchen, yellow
    plan_page(c, W, H, prepaint=False)
    c.setFillColor(HexColor('#1F5FBF')); c.setFont('Helvetica-Bold', 14); c.drawString(ox + 0.6 * m, oy + 5.4 * m, 'NEW WORKTOP')   # blue text in the yellow kitchen

def make_pdf(path, size, pages=('plan', 'section'), rotate=0, crop=None):
    W, H = size
    c = canvas.Canvas(path, pagesize=size)
    c.setTitle('Test plan')
    for p in pages:
        if rotate: c.setPageRotation(rotate)
        if crop: c.setCropBox(crop)
        if p == 'plan': plan_page(c, W, H)
        elif p == 'plan-clean': plan_page(c, W, H, prepaint=False)
        elif p == 'plan-zones': plan_page(c, W, H, prepaint=True, extra_paint=True); hatch_zone(c, W, H)
        elif p == 'plan-grey': grey_page(c, W, H)
        else: section_page(c, W, H)
        c.showPage()
    c.save()

A3L = (420 * mm, 297 * mm)
A1L = (841 * mm, 594 * mm)
make_pdf(OUT + '/plan_A3_2pages.pdf', A3L, ('plan', 'section'))
make_pdf(OUT + '/plan_A3_single.pdf', A3L, ('plan',))
make_pdf(OUT + '/plan_A1_single.pdf', A1L, ('plan',))
make_pdf(OUT + '/plan_zones.pdf', A3L, ('plan-zones',))
make_pdf(OUT + '/plan_rotated.pdf', A3L, ('plan',), rotate=90)
make_pdf(OUT + '/plan_cropped.pdf', A3L, ('plan',), crop=(30 * mm, 40 * mm, 400 * mm, 290 * mm))
make_pdf(OUT + '/plan_grey.pdf', A3L, ('plan-grey',))
print('ok')
