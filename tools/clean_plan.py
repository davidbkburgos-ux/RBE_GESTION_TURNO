"""Genera assets/map/plano_limpio.png a partir del plano original.

Elimina los coches y los 4 empleados 'horneados' en la imagen (el AutoKing debe
comenzar vacio y los NPC se dibujan dinamicamente). No altera la arquitectura.
Uso (desde la raiz del proyecto):  py tools/clean_plan.py
"""
import cv2
import numpy as np

src = cv2.imread("assets/references/plano_original.png")
h, w = src.shape[:2]
mask = np.zeros((h, w), np.uint8)

# (x1, y1, x2, y2) en pixeles del plano
CARS = [(236, 138, 408, 232), (818, 0, 908, 104), (1488, 176, 1536, 352),
        (200, 822, 408, 925), (538, 820, 748, 930)]
PEOPLE = [(226, 404, 266, 474), (460, 534, 498, 590), (524, 716, 562, 778),
          (1300, 484, 1338, 550)]
for x1, y1, x2, y2 in CARS:
    cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
for x1, y1, x2, y2 in PEOPLE:
    cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)

out = cv2.inpaint(src, mask, 7, cv2.INPAINT_TELEA)

# Coches: relleno con el color medio del asfalto circundante + grano (evita manchas oscuras)
rng = np.random.default_rng(7)
outf = out.astype(np.float32)
for x1, y1, x2, y2 in CARS:
    pad = 14
    ring = src[max(0, y1 - pad):min(h, y2 + pad), max(0, x1 - pad):min(w, x2 + pad)].copy()
    rm = np.ones(ring.shape[:2], bool)
    rm[pad:ring.shape[0] - pad, pad:ring.shape[1] - pad] = False
    px = ring[rm].astype(np.float32)
    px = px[px.sum(1) < 330]  # descarta marcas viales claras
    base = np.median(px, axis=0)
    fill = np.tile(base, (y2 - y1, x2 - x1, 1))
    lowf = cv2.GaussianBlur(rng.normal(0, 7, (y2 - y1, x2 - x1)).astype(np.float32), (0, 0), 14)
    fill += lowf[..., None] + rng.normal(0, 3.5, (y2 - y1, x2 - x1, 1))
    m = np.zeros((h, w), np.float32)
    m[y1:y2, x1:x2] = 1
    m = cv2.GaussianBlur(m, (0, 0), 5)[..., None]
    layer = outf.copy()
    layer[y1:y2, x1:x2] = fill
    outf = outf * (1 - m) + layer * m
out = np.clip(outf, 0, 255).astype(np.uint8)

# Repinta la linea discontinua central de la calzada superior (tapada por el coche)
for x in (275, 345, 415):
    cv2.line(out, (x, 217), (x + 30, 217), (150, 150, 150), 3)

cv2.imwrite("assets/map/plano_limpio.png", out)
print("ok", out.shape)
