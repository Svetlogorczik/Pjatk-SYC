import pymupdf as fitz, os, sys, json
from PIL import Image, ImageDraw, ImageFont
S = os.path.dirname(os.path.abspath(__file__))
font=ImageFont.truetype('arial.ttf',16)

def infl(r,d): return fitz.Rect(r.x0-d,r.y0-d,r.x1+d,r.y1+d)
def uni(a,b): return fitz.Rect(min(a.x0,b.x0),min(a.y0,b.y0),max(a.x1,b.x1),max(a.y1,b.y1))
def touch(a,b,g): return not (a.x1+g<b.x0 or b.x1+g<a.x0 or a.y1+g<b.y0 or b.y1+g<a.y0)

def clusters(seeds,g=5):
    cl=[]   # list of [rect, count, allthin, hasimg]
    for r,thin,isimg in seeds:
        cur=[r,1,thin,isimg]
        merged=True
        while merged:
            merged=False
            for c in cl:
                if touch(c[0],cur[0],g):
                    cur=[uni(c[0],cur[0]),c[1]+cur[1],c[2] and cur[2],c[3] or cur[3]]; cl.remove(c); merged=True; break
        cl.append(cur)
    return cl

def lines_of(page):
    out=[]
    for b in page.get_text('dict')['blocks']:
        for l in b.get('lines',[]):
            txt=''.join(s['text'] for s in l['spans']).strip()
            if not txt: continue
            bold=any((s['flags']&16) or 'bx' in s['font'].lower() or 'bold' in s['font'].lower() for s in l['spans'])
            size=max(s['size'] for s in l['spans'])
            out.append((fitz.Rect(l['bbox']),txt,bold,size))
    return out

def auto_box(page, near=9, maxlen=34, pad=5):
    pr=page.rect; W,H=pr.width,pr.height
    seeds=[]
    for img in page.get_images(full=True):
        for r in page.get_image_rects(img[0]):
            if r.width>4 and r.height>4: seeds.append((fitz.Rect(r),False,True))
    for d in page.get_drawings():
        r=fitz.Rect(d['rect'])
        if r.width>0.80*W or r.height>0.80*H: continue          # frame / rules
        if r.y1<0.07*H: continue
        thin = (r.height<1.5 or r.width<1.5)
        seeds.append((infl(r,0.6),thin,False))
    frame=None
    for d in page.get_drawings():
        r=fitz.Rect(d['rect'])
        if r.width>0.80*W and r.height>0.5*H:
            if frame is None or r.get_area()<frame.get_area(): frame=r
    if not seeds: return None,[]
    cl=[c for c in clusters(seeds) if not (c[2] and c[1]<=2)]   # drop isolated rules (fraction bars)
    if not cl: return None,[]
    U=cl[0][0]
    for c in cl[1:]: U=uni(U,c[0])
    U0=fitz.Rect(U)
    lines=lines_of(page)
    for _ in range(3):
        E=infl(U,near)
        for r,t,bold,size in lines:
            if len(t)<=maxlen and r.intersects(E) and r.y0>0.06*H and not (bold and r.y0<0.30*H and size>9.5):
                U=uni(U,r)
    U=infl(U,pad); U=fitz.Rect(max(U.x0,0),max(U.y0,0),min(U.x1,W),min(U.y1,H))
    if frame is not None:
        fi=infl(frame,-2.5)
        if fi.contains(U0): U=U & fi
    # long text lines to white-out: intersect U but are not mostly inside the seed clusters
    wo=[]
    for r,t,bold,size in lines:
        if not r.intersects(U): continue
        is_label = len(t)<=maxlen and not (bold and r.y0<0.30*H and size>9.5)
        if is_label: continue
        inside=any((not c[3]) and (r & c[0]).get_area() > 0.6*r.get_area() for c in cl)
        if not inside: wo.append(r)
    return U,wo

def render(page, box, wo=(), width_px=1400):
    z=min(width_px/box.width, 4.0)
    pm=page.get_pixmap(matrix=fitz.Matrix(z,z),clip=box,alpha=False)
    im=Image.frombytes('RGB',(pm.width,pm.height),pm.samples)
    d=ImageDraw.Draw(im)
    for r in wo:
        d.rectangle([(r.x0-box.x0)*z-2,(r.y0-box.y0)*z-2,(r.x1-box.x0)*z+2,(r.y1-box.y0)*z+2],fill='white')
    # trim white borders
    from PIL import ImageChops
    bg=Image.new('RGB',im.size,'white'); diff=ImageChops.difference(im,bg).convert('L').point(lambda v:255 if v>12 else 0)
    bb=diff.getbbox()
    if bb:
        m=int(6*z)
        im=im.crop((max(bb[0]-m,0),max(bb[1]-m,0),min(bb[2]+m,im.width),min(bb[3]+m,im.height)))
    return im

def sheet(items, out, cols=5, tw=312, th=240):
    rows=(len(items)+cols-1)//cols
    sh=Image.new('RGB',(cols*tw,rows*(th+20)),(235,235,235)); d=ImageDraw.Draw(sh)
    for k,(im,l) in enumerate(items):
        x=(k%cols)*tw; y=(k//cols)*(th+20)
        d.rectangle([x,y,x+tw,y+20],fill=(20,90,40)); d.text((x+4,y+1),l,fill='white',font=font)
        t=im.copy(); t.thumbnail((tw-4,th-4)); sh.paste(t,(x+2,y+22))
    sh.save(out,quality=80)

if __name__=='__main__':
    os.makedirs(S+'/crops',exist_ok=True); os.makedirs(S+'/csheets',exist_ok=True)
    for f in os.listdir(S+'/csheets'): os.remove(S+'/csheets/'+f)
    items=[]
    for i in range(1,16):
        doc=fitz.open('wyklady/SYCwyklad%d.pdf'%i)
        for pn,page in enumerate(doc,1):
            if len(page.get_images())<1 and len(page.get_drawings())<8: continue
            box,wo=auto_box(page)
            if box is None or box.width<30 or box.height<20: continue
            im=render(page,box,wo)
            name='w%02d-p%02d'%(i,pn)
            im.save('%s/crops/%s.png'%(S,name))
            items.append((im,'%s %dx%d'%(name,im.width,im.height)))
    for k in range(0,len(items),20):
        sheet(items[k:k+20],'%s/csheets/C%02d.jpg'%(S,k//20+1))
    print(len(items),'crops')
