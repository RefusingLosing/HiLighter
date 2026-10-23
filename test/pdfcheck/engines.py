"""Render a PDF's first page with MuPDF, PDFium (Chrome/Edge), Poppler and Ghostscript."""
import os, subprocess, sys, tempfile
import pypdfium2 as pdfium
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

def render(path, dpi, engine):
    out = tempfile.mktemp(suffix='.png')
    if engine == 'pdfium':
        pdf = pdfium.PdfDocument(path)
        img = pdf[0].render(scale=dpi / 72).to_pil().convert('RGB')
        pdf.close()
        return img
    if engine == 'poppler':
        base = out[:-4]
        subprocess.run(['pdftoppm', '-cropbox', '-r', str(dpi), '-png', '-singlefile', path, base], check=True, capture_output=True)
        return Image.open(base + '.png').convert('RGB')
    if engine == 'ghostscript':
        subprocess.run(['gs', '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dUseCropBox', '-sDEVICE=png16m', f'-r{dpi}', '-dFirstPage=1', '-dLastPage=1', f'-sOutputFile={out}', path], check=True, capture_output=True)
        return Image.open(out).convert('RGB')
    if engine == 'mupdf':
        subprocess.run(['node', os.path.join(HERE, 'render.mjs'), path, out, str(dpi)], check=True, capture_output=True)
        return Image.open(out).convert('RGB')
    raise ValueError(engine)

ENGINES = ['mupdf', 'pdfium', 'poppler', 'ghostscript']
