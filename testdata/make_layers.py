# A drawing with two layers: "Furniture" (on) and "Hidden notes" (off by default).
import pikepdf, sys
src = sys.argv[1] if len(sys.argv) > 1 else 'testdata/out/plan_A3_single.pdf'
dst = sys.argv[2] if len(sys.argv) > 2 else 'testdata/out/plan_layers.pdf'
pdf = pikepdf.open(src)
on = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.OCG, Name=pikepdf.String('Furniture')))
off = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.OCG, Name=pikepdf.String('Hidden notes')))
pdf.Root.OCProperties = pikepdf.Dictionary(OCGs=[on, off], D=pikepdf.Dictionary(ON=[on], OFF=[off], Order=[on, off]))
pg = pdf.pages[0]
res = pg.Resources
res.Properties = pikepdf.Dictionary(oc1=on, oc2=off)
font = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica)
if '/Font' not in res: res.Font = pikepdf.Dictionary()
res.Font.PTH = font
extra = b"""
/OC /oc2 BDC q 0.85 0 0 rg 300 500 380 120 re f BT /PTH 28 Tf 1 1 1 rg 320 550 Td (HIDDEN LAYER) Tj ET Q EMC
/OC /oc1 BDC q 0 0 0.6 RG 2 w 900 200 m 1100 300 l S Q EMC
"""
pg.contents_add(pikepdf.Stream(pdf, extra), prepend=False)
pdf.save(dst)
print('ok')
