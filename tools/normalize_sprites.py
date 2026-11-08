#!/usr/bin/env python3
"""Normaliza los sprites generados en Summer Engine a una escala y un anclaje idénticos.

Cada personaje se procesa desde  assets/characters/_source/<personaje>/ :
    turnaround.png    hoja con 4 vistas en fila (frente, espalda, perfil derecho, perfil izquierdo), fondo transparente
    walk_front.png    hoja de 8 frames en horizontal (caminar hacia la cámara)
    walk_back.png     caminar de espaldas
    walk_right.png    caminar hacia la derecha (la izquierda se obtiene en espejo)
    work_front.png    trabajar de frente            (opcional)
    work_right.png    trabajar de perfil derecho    (opcional)
    sit_right.png / deliver_front.png ...           (opcionales, mismo formato)

Salida en assets/characters/<personaje>/ :
    <personaje>.png   atlas: una fila por (animación, dirección), celdas de 128x168
    preview.png       hoja de control con la línea de pies y la altura objetivo dibujadas
y actualiza la entrada del personaje en assets/manifest.json.

Reglas de normalización (idénticas para todos los personajes):
  * Lienzo de celda 128x168 px (= 64x84 lógicos a 2x).
  * Pies en (64, 156) px  ->  (32, 78) lógicos.
  * Altura del personaje = TARGET_H px para TODAS las hojas. La altura de referencia de cada hoja es el
    percentil 90 de las alturas de sus frames (la pose de paso en las de caminar = altura de pie), y se aplica
    una única escala a toda la hoja: así el balanceo natural se conserva y nada crece ni encoge al girar o
    al pasar de caminar a trabajar.
  * Alineación horizontal por el centro de cabeza y tronco (no por la caja completa), para que brazos,
    zancadas o bayetas no desplacen al personaje.
  * Limpieza del halo verde/gris que deja el recorte de fondo.

Uso:
    python3 tools/normalize_sprites.py encargado [encargada ...]
    python3 tools/normalize_sprites.py --all
Requiere Pillow y numpy:  python3 -m pip install --user pillow numpy
"""
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "characters" / "_source"
OUT = ROOT / "assets" / "characters"
MANIFEST = ROOT / "assets" / "manifest.json"

CELL_W, CELL_H = 128, 168
ANCHOR_X, ANCHOR_Y = 64, 156
TARGET_H = 112          # px a 2x  (56 px lógicos, la talla del peón original)
ALPHA_CUT = 40          # píxeles con alfa menor se consideran fondo
SHEET_FRAMES = 8

DIRS = ["down", "up", "left", "right"]
# animación -> dirección -> (archivo fuente, espejo)
PLAN = {
    "walk": {"down": ("walk_front", False), "up": ("walk_back", False), "right": ("walk_right", False), "left": ("walk_right", True)},
    "work": {"down": ("work_front", False), "up": ("idle:up", False), "right": ("work_right", False), "left": ("work_right", True)},
    "sit": {"down": ("sit_front", False), "up": ("sit_back", False), "right": ("sit_right", False), "left": ("sit_right", True)},
    "deliver": {"down": ("deliver_front", False), "up": ("idle:up", False), "right": ("deliver_right", False), "left": ("deliver_right", True)},
}
FPS = {"idle": 2, "walk": 10, "work": 6, "sit": 2, "deliver": 6}


def clean(img):
    """Recorta el alfa débil y elimina el halo de color del recorte de fondo."""
    a = np.asarray(img.convert("RGBA")).astype(np.int16)
    rgb, al = a[:, :, :3], a[:, :, 3]
    al = np.where(al < ALPHA_CUT, 0, al)
    edge = (al > 0) & (al < 250)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    spill = edge & (g > np.maximum(r, b) + 6)
    g = np.where(spill, np.maximum(r, b), g)
    out = np.dstack([r, g, b, al]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out)


def bbox(img):
    al = np.asarray(img)[:, :, 3]
    ys, xs = np.where(al >= ALPHA_CUT)
    if not len(ys):
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def torso_center_x(img, box):
    """Centro horizontal de la mitad superior (cabeza y tronco) del personaje."""
    x1, y1, x2, y2 = box
    al = np.asarray(img)[y1:y1 + int((y2 - y1) * 0.45), x1:x2, 3] >= ALPHA_CUT
    cols = al.sum(0)
    if cols.sum() == 0:
        return (x1 + x2) / 2
    return x1 + float((np.arange(len(cols)) * cols).sum() / cols.sum())


def split_sheet(path, frames=SHEET_FRAMES):
    im = clean(Image.open(path))
    fw = im.width // frames
    return [im.crop((i * fw, 0, (i + 1) * fw, im.height)) for i in range(frames)]


def split_turnaround(path):
    """Separa las 4 vistas de la hoja de referencia por columnas vacías de alfa."""
    im = clean(Image.open(path))
    al = np.asarray(im)[:, :, 3] >= ALPHA_CUT
    cols = al.sum(0) > 2
    segs, start = [], None
    for x, v in enumerate(list(cols) + [False]):
        if v and start is None:
            start = x
        elif not v and start is not None:
            if x - start > 30:
                segs.append((start, x))
            start = None
    if len(segs) != 4:
        raise SystemExit(f"{path}: se esperaban 4 vistas y hay {len(segs)}")
    views = [im.crop((s, 0, e, im.height)) for s, e in segs]
    return dict(zip(["down", "up", "right", "left"], views))


HEAD_TOL = 1.06


def head_ratio(frames, boxes):
    """Mediana de (anchura de cabeza / altura) de una hoja: mide lo cerca que encuadró la cámara."""
    vals = []
    for f, b in zip(frames, boxes):
        if not b:
            continue
        x1, y1, x2, y2 = b
        al = np.asarray(f)[y1:y1 + int((y2 - y1) * 0.12), x1:x2, 3] >= ALPHA_CUT
        vals.append(al.sum(1).max() / (y2 - y1))
    return float(np.median(vals)) if vals else 1.0


# Altura relativa por animación: sentado mide ~3/4 de la talla de pie (misma escala de cuerpo).
ANIM_HEIGHT = {"sit": 0.74}
# Frames con menos de esta fracción de la altura de referencia salen cortados (p. ej. la IA dibuja un
# mostrador que tapa las piernas): se descartan para que nadie aparezca partido por la cintura.
MIN_FRAME_H = 0.85


def place(frames, mirror, anim=None, head_ref=None):
    """Escala única por hoja + anclaje de pies por frame. Devuelve celdas 128x168 y métricas."""
    boxes = [bbox(f) for f in frames]
    heights = [b[3] - b[1] for b in boxes if b]
    ref_h = float(np.percentile(heights, 90))
    if len(frames) > 1 and anim != "sit":
        keep = [(f, b) for f, b in zip(frames, boxes) if b and (b[3] - b[1]) >= MIN_FRAME_H * ref_h]
        if len(keep) >= 2 and len(keep) < len(frames):
            print(f"  {anim}: descartados {len(frames) - len(keep)} frames cortados")
            frames, boxes = [k[0] for k in keep], [k[1] for k in keep]
    k = TARGET_H * ANIM_HEIGHT.get(anim, 1.0) / ref_h
    if head_ref and anim not in ("walk", "sit"):
        # La IA a veces encuadra más cerca (cabeza mayor para la misma altura). Se compara la proporción
        # cabeza/altura con la de caminar en la misma vista y se corrige a medias: cabeza y cuerpo ceden igual.
        r = head_ratio(frames, boxes) / head_ref
        if r > HEAD_TOL:
            k /= r ** 0.5
            print(f"  {anim}: encuadre cercano (cabeza x{r:.2f}), escala corregida x{1 / r ** 0.5:.2f}")
    cells, metrics = [], []
    for f, b in zip(frames, boxes):
        cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
        if b:
            cx = torso_center_x(f, b)
            sub = f.crop(b)
            if mirror:
                sub = sub.transpose(Image.FLIP_LEFT_RIGHT)
                cx = b[0] + (b[2] - cx)
            w, h = max(1, round(sub.width * k)), max(1, round(sub.height * k))
            sub = sub.resize((w, h), Image.LANCZOS)
            ox = round(ANCHOR_X - (cx - b[0]) * k)
            if w <= CELL_W:  # brazos extendidos: se desplaza lo justo para no cortar la mano
                ox = min(max(ox, 0), CELL_W - w)
            oy = ANCHOR_Y - h
            layer = Image.new("RGBA", cell.size, (0, 0, 0, 0))
            layer.paste(sub, (ox, oy), sub)
            cell = Image.alpha_composite(cell, layer)
            if oy < 0 or ox < 0 or ox + w > CELL_W:
                print(f"  aviso: frame recortado (ox={ox}, oy={oy}, w={w}); revisa la pose o baja TARGET_H")
        nb = bbox(cell)
        metrics.append({"h": (nb[3] - nb[1]) if nb else 0, "feet": nb[3] if nb else 0})
        cells.append(cell)
    return cells, metrics


def process(name):
    src = SRC / name
    if not src.is_dir():
        raise SystemExit(f"No existe {src}")
    print(f"== {name}")
    rows = {}   # (anim, dir) -> cells
    report = []

    idle = split_turnaround(src / "turnaround.png")
    for d in DIRS:
        cells, m = place([idle[d]], False)
        rows[("idle", d)] = cells
        report.append(("idle", d, m))

    for anim, plan in PLAN.items():
        for d in DIRS:
            fname, mirror = plan[d]
            if fname.startswith("idle:"):
                if (anim, "down") in rows or (src / (plan["down"][0] + ".png")).exists():
                    rows[(anim, d)] = rows[("idle", fname.split(":")[1])]
                continue
            p = src / (fname + ".png")
            if not p.exists():
                continue
            view = fname.rsplit("_", 1)[-1]
            ref = None
            if anim != "walk" and (src / f"walk_{view}.png").exists():
                wf = split_sheet(src / f"walk_{view}.png")
                ref = head_ratio(wf, [bbox(f) for f in wf])
            cells, m = place(split_sheet(p), mirror, anim, ref)
            rows[(anim, d)] = cells
            report.append((anim, d, m))

    order = [(a, d) for a in ["idle"] + list(PLAN) for d in DIRS if (a, d) in rows]
    ncols = max(len(rows[k]) for k in order)
    atlas = Image.new("RGBA", (CELL_W * ncols, CELL_H * len(order)), (0, 0, 0, 0))
    entry = {"sheet": f"assets/characters/{name}/{name}.png", "cell": [CELL_W, CELL_H], "anchor": [ANCHOR_X, ANCHOR_Y],
             "targetHeight": TARGET_H, "anims": {}}
    for r, (anim, d) in enumerate(order):
        for c, cell in enumerate(rows[(anim, d)]):
            atlas.alpha_composite(cell, (c * CELL_W, r * CELL_H))
        entry["anims"].setdefault(anim, {"fps": FPS.get(anim, 4), "dirs": {}})
        entry["anims"][anim]["dirs"][d] = {"row": r, "frames": len(rows[(anim, d)])}

    out = OUT / name
    out.mkdir(parents=True, exist_ok=True)
    atlas.save(out / f"{name}.png", optimize=True)

    # hoja de control: fondo neutro, línea de pies y de altura objetivo
    prev = Image.new("RGBA", atlas.size, (58, 62, 70, 255))
    prev.alpha_composite(atlas)
    dr = ImageDraw.Draw(prev)
    for r in range(len(order)):
        y0 = r * CELL_H
        dr.line([(0, y0 + ANCHOR_Y), (prev.width, y0 + ANCHOR_Y)], fill=(255, 80, 80, 255))
        dr.line([(0, y0 + ANCHOR_Y - TARGET_H), (prev.width, y0 + ANCHOR_Y - TARGET_H)], fill=(80, 200, 255, 255))
        dr.text((2, y0 + 2), "%s/%s" % order[r], fill=(255, 255, 255, 255))
    prev.convert("RGB").save(out / "preview.png")

    # informe: altura de referencia (p90) y pies por hoja, deben coincidir en todas
    for anim, d, m in report:
        hs = [x["h"] for x in m]
        feet = sorted({x["feet"] for x in m})
        print(f"  {anim:8s} {d:5s} frames={len(m)} altura p90={np.percentile(hs, 90):.0f}px "
              f"(min {min(hs)} max {max(hs)}) pies_y={feet}")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    # conserva las secuencias de frames elegidas a mano ("seq") de una ejecución anterior
    old = manifest.get("characters", {}).get(name, {}).get("anims", {})
    for anim, a in entry["anims"].items():
        for d, info in a["dirs"].items():
            seq = old.get(anim, {}).get("dirs", {}).get(d, {}).get("seq")
            if seq and max(seq) < info["frames"]:
                info["seq"] = seq
    manifest.setdefault("characters", {})[name] = entry
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  -> {out / (name + '.png')}  ({atlas.width}x{atlas.height})")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    names = sorted(p.name for p in SRC.iterdir() if p.is_dir()) if args == ["--all"] else args
    for n in names:
        process(n)
