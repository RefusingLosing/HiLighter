"""Compares exported PDFs against the original drawing in four engines at sample points."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engines import render, ENGINES
import tempfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..'))
DATA = os.environ.get('PLANTINT_TESTDATA', os.path.join(ROOT, 'testdata/out'))
D = os.path.join(os.environ.get('PLANTINT_TEST_OUT', os.path.join(tempfile.gettempdir(), 'plantint-test')), 'pdfnew')
YEL, BLU, A = (255, 214, 10), (63, 167, 224), 0.45
tint = lambda o, c: tuple(round(o[i] * (1 - A + A * c[i] / 255)) for i in range(3))
fails = 0
for name in ['plan_A3_single', 'plan_rotated', 'plan_cropped']:
    for eng in ENGINES:
        orig = render(f'{DATA}/{name}.pdf', 36, eng)
        exp = render(f'{D}/{name}_vector.pdf', 36, eng)
        W, H = orig.size
        if exp.size != orig.size:
            print('SIZE MISMATCH', name, eng, orig.size, exp.size); fails += 1; continue
        # sample points (fractions of the sheet) and what should be there
        pts = [((0.25, 0.35), YEL), ((0.45, 0.42), YEL), ((0.55, 0.65), BLU), ((0.45, 0.55), BLU), ((0.65, 0.75), BLU), ((0.85, 0.15), None), ((0.1, 0.9), None)]
        bad = []
        for (fx, fy), col in pts:
            x, y = int(fx * W), int(fy * H)
            o, e = orig.getpixel((x, y)), exp.getpixel((x, y))
            want = tint(o, col) if col else o
            if max(abs(want[i] - e[i]) for i in range(3)) > 10: bad.append(((fx, fy), o, e, want))
        print(f'{name:16s} {eng:12s} {"OK" if not bad else "FAIL " + str(bad)}')
        fails += bool(bad)
print('FAILS', fails)
