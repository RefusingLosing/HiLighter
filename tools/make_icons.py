"""Draws the PlanTint app icon and the project-file icon (PNG + multi-size ICO)."""
from PIL import Image, ImageDraw
import os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets'
os.makedirs(OUT, exist_ok=True)
N = 1024
WALL = (38, 44, 41, 255)
SHEET = (252, 252, 249, 255)
EDGE = (196, 200, 194, 255)
YEL = (255, 206, 64, 255)
BLUE = (96, 165, 250, 255)


def plan(d, x0, y0, x1, y1, w):
    """A small floor plan: outer walls, one cross wall with a door gap, two tinted rooms."""
    mx = x0 + (x1 - x0) * 0.52
    my = y0 + (y1 - y0) * 0.50
    d.rectangle([x0, y0, mx - w / 2, my - w / 2], fill=YEL)
    d.rectangle([mx + w / 2, my + w / 2, x1, y1], fill=BLUE)
    d.rectangle([x0, y0, x1, y0 + w], fill=WALL)
    d.rectangle([x0, y1 - w, x1, y1], fill=WALL)
    d.rectangle([x0, y0, x0 + w, y1], fill=WALL)
    d.rectangle([x1 - w, y0, x1, y1], fill=WALL)
    gap = (y1 - y0) * 0.16
    d.rectangle([mx - w / 2, y0, mx + w / 2, my - gap / 2], fill=WALL)
    d.rectangle([mx - w / 2, my + gap / 2 + gap * 0.6, mx + w / 2, y1], fill=WALL)
    d.rectangle([x0, my - w / 2, mx - gap * 1.2, my + w / 2], fill=WALL)
    d.rectangle([mx, my - w / 2, x1, my + w / 2], fill=WALL)


def app_icon():
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    m = 64
    d.rounded_rectangle([m, m, N - m, N - m], radius=170, fill=SHEET, outline=EDGE, width=14)
    plan(d, 210, 210, N - 210, N - 210, 46)
    return im


def project_icon():
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1, f = 170, 60, N - 170, N - 60, 190
    d.polygon([(x0, y0), (x1 - f, y0), (x1, y0 + f), (x1, y1), (x0, y1)], fill=SHEET, outline=EDGE)
    d.line([(x0, y0), (x1 - f, y0), (x1, y0 + f), (x1, y1), (x0, y1), (x0, y0)], fill=EDGE, width=16, joint='curve')
    d.polygon([(x1 - f, y0), (x1 - f, y0 + f), (x1, y0 + f)], fill=(226, 229, 223, 255), outline=EDGE)
    plan(d, x0 + 90, y0 + 330, x1 - 90, y1 - 120, 34)
    return im


SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
for name, im in (('icon', app_icon()), ('project', project_icon())):
    big = im.resize((512, 512), Image.LANCZOS)
    if name == 'icon':
        big.save(os.path.join(OUT, 'icon.png'))
    im.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, name + '.ico'), sizes=[(s, s) for s in SIZES])
print('ok')
