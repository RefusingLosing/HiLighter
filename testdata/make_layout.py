# A picture of a site layout that is already coloured, as layouts sent round on site often are:
# rows of buildings filled with colour, thin dark separators between them, a black outline, and each
# building's number written right across it (here a thick black stroke from near the top edge to near
# the bottom edge, so Fill with gap closing stops at it). Used by test/e2e/t10_cover.mjs.
import os, sys
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else 'testdata/out'
W, H = 1100, 520
im = Image.new('RGB', (W, H), (255, 255, 255))
d = ImageDraw.Draw(im)
fills = [(88, 204, 12), (88, 204, 12), (255, 192, 0), (88, 204, 12), (0, 238, 245), (88, 204, 12)]
x0, y0, bw, bh = 80, 150, 150, 110
for i, c in enumerate(fills):
    bx = x0 + i * bw
    d.rectangle([bx, y0, bx + bw - 1, y0 + bh - 1], fill=c)
    # the number, written right across: a thick dark stroke with only 3 px to the outline at each end
    d.line([(bx + 45, y0 + 6), (bx + 105, y0 + bh - 7)], fill=(12, 12, 12), width=7)
# separators between buildings (dark green, thin) and the outline of the row (black)
for i in range(1, len(fills)):
    bx = x0 + i * bw
    d.line([(bx, y0), (bx, y0 + bh - 1)], fill=(35, 110, 20), width=3)
d.rectangle([x0 - 2, y0 - 2, x0 + len(fills) * bw + 1, y0 + bh + 1], outline=(0, 0, 0), width=3)
# water below the row
d.rectangle([x0, y0 + bh + 40, x0 + len(fills) * bw, y0 + bh + 140], fill=(55, 165, 200))
im.save(os.path.join(OUT, 'layout_coloured.png'), dpi=(200, 200))
print('ok')
