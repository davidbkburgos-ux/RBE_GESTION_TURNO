"""Genera src/data/bundle.js a partir de los JSON de src/data.

El bundle permite abrir index.html directamente (file://) sin servidor.
Si se sirve por HTTP, el juego carga los .json directamente y el bundle es solo respaldo.
Incluye assets/manifest.json (capa visual) si existe.
Uso:  python3 tools/build_data.py   (Windows: py tools/build_data.py)
"""
import json, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
data = root / "src" / "data"
names = ["config", "map", "events", "questions", "opening", "audioManifest", "brands"]
bundle = {}
for n in names:
    bundle[n] = json.loads((data / f"{n}.json").read_text(encoding="utf-8"))
# Manifest visual (planos por marca, sprites, retratos y props). Avisa si cita archivos que no existen.
manifest_path = root / "assets" / "manifest.json"
if manifest_path.exists():
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    missing = []
    for b in manifest.get("brands", {}).values():
        missing += [v for v in b.get("maps", {}).values() if not (root / v).exists()]
        missing += [v for v in [b.get("menu"), b.get("logo")] if v and not (root / v).exists()]
        missing += [pr["src"] for pr in b.get("props", []) if not (root / pr["src"]).exists()]
    for c in manifest.get("characters", {}).values():
        if not (root / c["sheet"]).exists():
            missing.append(c["sheet"])
    if missing:
        print("AVISO: el manifest cita archivos que no existen:\n  " + "\n  ".join(missing))
    bundle["manifest"] = manifest
    names.append("manifest")

(data / "bundle.js").write_text(
    "/* GENERADO por tools/build_data.py - no editar a mano */\nwindow.BK_BUNDLE = "
    + json.dumps(bundle, ensure_ascii=False) + ";\n",
    encoding="utf-8",
)
print("bundle.js generado con", ", ".join(names))
