"""One-off helper: builds the site's images from the original course materials.

Run from the folder that contains `wyklady/` and `SYC SCE/` (the course materials):
    py syc-site/tools/make_images.py <slides_dir>
<slides_dir> = folder with lab03/ and lab04/ slide exports (sNN.jpg) made from the .pptx files.
Needs: PyMuPDF, Pillow.  Output: syc-site/src/assets/img/** (WebP) + manifest.json
"""
import os, sys, json, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from figcrop import fitz, auto_box, render
from PIL import Image, ImageChops

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'assets', 'img')
SLIDES = sys.argv[1] if len(sys.argv) > 1 else 'slides'
manifest = {}

def trim(im, m=14):
    bg = Image.new('RGB', im.size, 'white')
    diff = ImageChops.difference(im.convert('RGB'), bg).convert('L').point(lambda v: 255 if v > 14 else 0)
    bb = diff.getbbox()
    if not bb: return im
    return im.crop((max(bb[0]-m, 0), max(bb[1]-m, 0), min(bb[2]+m, im.width), min(bb[3]+m, im.height)))

def save(im, rel, maxw, q=82):
    im = im.convert('RGB')
    if im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    path = os.path.join(OUT, rel + '.webp')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=q, method=6)
    manifest[rel + '.webp'] = [im.width, im.height]

def full_page(page, width=1600):
    z = width / page.rect.width
    pm = page.get_pixmap(matrix=fitz.Matrix(z, z), alpha=False)
    return trim(Image.frombytes('RGB', (pm.width, pm.height), pm.samples))

# ---------- lectures: every slide that contains a figure ----------
for i in range(1, 16):
    doc = fitz.open('wyklady/SYCwyklad%d.pdf' % i)
    for pn, page in enumerate(doc, 1):
        if len(page.get_images()) < 1 and len(page.get_drawings()) < 8: continue
        box, wo = auto_box(page)
        if box is None or box.width < 30 or box.height < 20: continue
        save(render(page, box, wo), 'lectures/w%02d-p%02d' % (i, pn), 1100)

# ---------- labs: slides from PDF ----------
LAB = {
 'lab01': ('SYC SCE/01/01 SYC labs PL.pdf', {38:'full',39:'full',54:'full',58:'full',63:'auto',64:'auto',67:'auto',68:'auto',69:'auto',70:'auto',71:'auto',72:'full',73:'auto'}),
 'lab02': ('SYC SCE/02/02 SYC labs ENG.pdf', {15:'full',16:'full',17:'full',19:'full',20:'full',22:'full',23:'full'}),
 'lab05': ('SYC SCE/05 Semiconductors - diodes and transistors/05 SYC labs transistors.pdf', {12:'full',13:'full',14:'auto',22:'full',23:'full',24:'full',25:'full',26:'full',27:'full',28:'full',29:'full'}),
 'lab06': ('SYC SCE/06/06 Operational amplifier.pdf', {3:'full',8:'full',11:'full',12:'full',13:'full',16:'full',17:'full',20:'full',21:'full'}),
 'lab07': ('SYC SCE/07 and 08/07 and 08 Logisim and Minimization of Boolean functions.pdf', {2:'full',10:'full',19:'full',22:'full',23:'full'}),
 'lab09': ('SYC SCE/09/09 MUX.pdf', {3:'full',8:'full',11:'full',14:'full',21:'full',22:'full',25:'full'}),
 'lab10': ('SYC SCE/10/10 Flip-flop.pdf', {5:'full',10:'full'}),
 'lab11': ('SYC SCE/11/11 Designing of Sequential Circuits_PL.pdf', {14:'full',19:'full',24:'full',28:'full',33:'full',37:'full'}),
 'lab12': ('SYC SCE/12/12 SYC labs.pdf', {11:'auto',13:'auto'}),
 'lab13': ('SYC SCE/13/13 SYC labs.pdf', {13:'full',15:'auto',16:'auto',18:'full',22:'auto',23:'auto'}),
 'lab14': ('SYC SCE/14/14 SYC labs.pdf', {2:'full',4:'full'}),
}
for name, (path, pages) in LAB.items():
    doc = fitz.open(path)
    for pn, mode in pages.items():
        page = doc[pn-1]
        if mode == 'auto':
            box, wo = auto_box(page, near=12, maxlen=60)
            im = render(page, box, [], width_px=1600)
        else:
            im = full_page(page)
        save(im, 'labs/%s-p%02d' % (name, pn), 1400)

# ---------- labs 3 and 4: slides exported from .pptx ----------
for name, nums in {'lab03': [10,11,16,17,18,19,22,23,24,27,28,29], 'lab04': [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]}.items():
    for n in nums:
        f = os.path.join(SLIDES, name, 's%02d.jpg' % n)
        save(trim(Image.open(f)), 'labs/%s-s%02d' % (name, n), 1400)

# ---------- labs 1 and 2: original photos ----------
PHOTOS = {
 'SYC SCE/01/miernik_01.jpg':'lab01-multimeter', 'SYC SCE/01/oscyloskop.jpg':'lab01-oscilloscope',
 'SYC SCE/01/oscyloskop_przelaczniki.jpg':'lab01-scope-panel', 'SYC SCE/01/podzespoły.jpg':'lab01-parts',
 'SYC SCE/01/sygnał generator funkcyjny.jpg':'lab01-generator', 'SYC SCE/01/zasilacz labolatoryjny.jpg':'lab01-psu-front',
 'SYC SCE/01/zasilacz labolatoryjny tyl.jpg':'lab01-psu-back', 'SYC SCE/01/złącza.jpg':'lab01-bnc',
 'SYC SCE/02/00.jpg':'lab02-dmm-spec', 'SYC SCE/02/00_task 1 1 a.jpg':'lab02-t11a', 'SYC SCE/02/01_task 1 1 b.jpg':'lab02-t11b',
 'SYC SCE/02/02_task 1 2 a.jpg':'lab02-t12a', 'SYC SCE/02/03_task 1 2 b.jpg':'lab02-t12b', 'SYC SCE/02/04_task 1 2 c.jpg':'lab02-t12c',
 'SYC SCE/02/05_task 2 a.jpg':'lab02-t2a', 'SYC SCE/02/06_task 2 b.jpg':'lab02-t2b', 'SYC SCE/02/07_task 3 1.jpg':'lab02-t31',
 'SYC SCE/02/08_task 3 2 a.jpg':'lab02-t32a', 'SYC SCE/02/09_task 3 2 b.jpg':'lab02-t32b', 'SYC SCE/02/10_task 4 a.jpg':'lab02-t4a',
 'SYC SCE/02/11_task 4 b.jpg':'lab02-t4b', 'SYC SCE/02/12_task 4 c.jpg':'lab02-t4c',
}
for src, nm in PHOTOS.items():
    im = Image.open(src)
    save(im, 'labs/' + nm, 1300 if im.width >= im.height else 900, q=80)

json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=0, sort_keys=True)
print(len(manifest), 'images')
