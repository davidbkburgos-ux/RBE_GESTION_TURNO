#!/usr/bin/env python3
"""Ensambla un plano HD (3072x2048) a partir de trozos mejorados con IA, verificando la alineación.

Uso: python3 tools/hd_map.py <origen_1536x1024.png> <resultados.txt> <salida.webp> [informe.png]
  resultados.txt: líneas "x y url" (trozo de 480x360 en (x, y) del plano original, imagen IA 4:3).

Por cada trozo: se iguala el color al original, se mide por bloques de 60 px (a 2x) el desplazamiento y la
correlación de bordes, y solo se aceptan los bloques alineados (≤ MAX_SHIFT px y estructura parecida). Los
bloques rechazados conservan el plano original reescalado. Los trozos se funden con bordes suaves.
La geometría (paredes, puertas, muebles) no puede moverse más de MAX_SHIFT px a 2x, así que los datos de
navegación (map.json / brands.json) siguen siendo válidos sin cambios.
"""
import sys, io, urllib.request
import numpy as np
from PIL import Image, ImageFilter

S = 2; TW, TH = 480, 360; BLK = 60; MAX_SHIFT = 3; MIN_CORR = 0.55; FEATHER = 48

def edges(a):
    # bordes a escala de estructura (desenfoque 2 px): paredes, muebles y equipos cuentan; la textura fina
    # nueva (veta, juntas) no, que es justo la mejora que se busca
    return np.asarray(Image.fromarray(a.astype(np.uint8)).convert('L').filter(ImageFilter.GaussianBlur(2)).filter(ImageFilter.FIND_EDGES)).astype(float)

def shift(a, b):
    A = np.fft.fft2(a - a.mean()); B = np.fft.fft2(b - b.mean()); R = A * np.conj(B); R /= np.abs(R) + 1e-9
    r = np.fft.ifft2(R).real; y, x = np.unravel_index(r.argmax(), r.shape)
    if y > a.shape[0] // 2: y -= a.shape[0]
    if x > a.shape[1] // 2: x -= a.shape[1]
    return x, y

def main(src, res, out, report=None):
    orig = Image.open(src).convert('RGB'); W, H = orig.size
    base = np.asarray(orig.resize((W * S, H * S), Image.LANCZOS)).astype(float)
    acc = np.zeros_like(base); wsum = np.zeros(base.shape[:2]); okmap = np.zeros((H * S, W * S)); stats = []
    for line in open(res):
        if not line.strip(): continue
        x, y, url = line.split(); x, y = int(x), int(y)
        ai = Image.open(io.BytesIO(urllib.request.urlopen(url).read())).convert('RGB').resize((TW * S, TH * S), Image.LANCZOS)
        ai = np.asarray(ai).astype(float); ref = base[y * S:(y + TH) * S, x * S:(x + TW) * S]
        # igualar color (media y desviación por canal) para que no haya saltos de tono entre trozos
        for c in range(3):
            ai[..., c] = (ai[..., c] - ai[..., c].mean()) / (ai[..., c].std() + 1e-6) * ref[..., c].std() + ref[..., c].mean()
        ai = np.clip(ai, 0, 255)
        ea, eb = edges(ref), edges(ai); gx, gy = shift(ea, eb)
        mask = np.zeros(ref.shape[:2]); good = tot = 0
        if abs(gx) <= MAX_SHIFT and abs(gy) <= MAX_SHIFT:
            for by in range(0, TH * S, BLK):
                for bx in range(0, TW * S, BLK):
                    a = ea[by:by + BLK, bx:bx + BLK]; b = eb[by:by + BLK, bx:bx + BLK]; tot += 1
                    if a.std() < 2:  # bloque liso (suelo/cielo): sin estructura que pueda moverse
                        mask[by:by + BLK, bx:bx + BLK] = 1; good += 1; continue
                    dx, dy = shift(a, b); corr = np.corrcoef(a.ravel(), b.ravel())[0, 1]
                    if abs(dx) <= MAX_SHIFT and abs(dy) <= MAX_SHIFT and corr >= MIN_CORR:
                        mask[by:by + BLK, bx:bx + BLK] = 1; good += 1
        # bordes suaves del trozo y de los bloques aceptados
        m = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))
        m = np.asarray(m).astype(float) / 255
        ramp_x = np.minimum(1, np.minimum(np.arange(TW * S) + 1, np.arange(TW * S)[::-1] + 1) / FEATHER)
        ramp_y = np.minimum(1, np.minimum(np.arange(TH * S) + 1, np.arange(TH * S)[::-1] + 1) / FEATHER)
        w = m * np.outer(ramp_y, ramp_x)
        sl = (slice(y * S, (y + TH) * S), slice(x * S, (x + TW) * S))
        acc[sl] += ai * w[..., None]; wsum[sl] += w; okmap[sl] = np.maximum(okmap[sl], mask)
        stats.append((x, y, gx, gy, good, tot))
    k = np.clip(wsum, 0, 1)[..., None]
    outimg = np.where(wsum[..., None] > 0, acc / np.maximum(wsum, 1e-6)[..., None], base)
    outimg = outimg * k + base * (1 - k)
    Image.fromarray(np.clip(outimg, 0, 255).astype(np.uint8)).save(out, 'WEBP', quality=90, method=6)
    cov = okmap.mean()
    for s in stats: print('trozo (%4d,%3d) desplaz. global (%d,%d)  bloques aceptados %d/%d' % s)
    print('cobertura HD: %.1f %% del plano' % (cov * 100))
    if report:
        r = Image.fromarray((okmap * 255).astype(np.uint8)).resize((W // 2, H // 2)); r.save(report)

if __name__ == '__main__':
    main(*sys.argv[1:])
