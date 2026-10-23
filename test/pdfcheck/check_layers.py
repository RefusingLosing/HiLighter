"""The exported PDF must keep the drawing's layers: a layer that is off stays off in every engine."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engines import render, ENGINES
import pikepdf
import tempfile
D = os.path.join(os.environ.get('PLANTINT_TEST_OUT', os.path.join(tempfile.gettempdir(), 'plantint-test')), 'pdfnew')
exp = f'{D}/plan_layers_vector.pdf'
pdf = pikepdf.open(exp)
ocp = pdf.Root.get('/OCProperties')
names = [str(o.Name) for o in ocp.OCGs] if ocp is not None else []
print('layers in export:', names, 'off:', [str(o.Name) for o in ocp.D.OFF] if ocp is not None else None)
fails = 0 if names == ['Furniture', 'Hidden notes'] else 1
for eng in ENGINES:
    im = render(exp, 30, eng)
    W, H = im.size
    box = im.crop((int(300 / 1190.55 * W), int((841.89 - 620) / 841.89 * H), int(680 / 1190.55 * W), int((841.89 - 500) / 841.89 * H)))
    import numpy as np
    a = np.asarray(box.convert('RGB')).reshape(-1, 3)
    share = float(((a[:, 0] > 150) & (a[:, 1] < 90) & (a[:, 2] < 90)).mean())
    red = share > 0.05
    print(f'{eng:12s} red pixels in the hidden box {share*100:5.1f}%  {"SHOWN (FAIL)" if red else "hidden OK"}')
    fails += red
print('FAILS', fails)
sys.exit(1 if fails else 0)
