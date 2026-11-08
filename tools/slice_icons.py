#!/usr/bin/env python3
"""Recorta una lámina de iconos (rejilla con huecos transparentes) en PNG cuadrados de SIZE px.
Uso: python3 tools/slice_icons.py <lamina.png> <carpeta_salida> nombre1 nombre2 ... (en orden de lectura)"""
import sys, pathlib
import numpy as np
from PIL import Image

SIZE = 96
def runs(mask, min_len):
    segs, st = [], None
    for i, v in enumerate(list(mask) + [False]):
        if v and st is None: st = i
        elif not v and st is not None:
            if i - st >= min_len: segs.append((st, i))
            st = None
    return segs

src, out, names = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3:]
im = Image.open(src).convert("RGBA")
al = np.asarray(im)[:, :, 3] >= 40
rows = runs(al.sum(1) > 2, 40)
icons = []
for y1, y2 in rows:
    for x1, x2 in runs(al[y1:y2].sum(0) > 2, 40):
        sub = im.crop((x1, y1, x2, y2)); bb = sub.getbbox(); sub = sub.crop(bb)
        s = max(sub.size); pad = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        pad.alpha_composite(sub, ((s - sub.width) // 2, (s - sub.height) // 2))
        icons.append(pad.resize((SIZE, SIZE), Image.LANCZOS))
print(f"{len(rows)} filas, {len(icons)} iconos")
if len(icons) != len(names):
    raise SystemExit(f"se esperaban {len(names)} iconos y hay {len(icons)}")
out.mkdir(parents=True, exist_ok=True)
for n, ic in zip(names, icons):
    ic.save(out / f"{n}.png", optimize=True)
