"""Genera src/data/bundle.js a partir de los JSON de src/data.

El bundle permite abrir index.html directamente (file://) sin servidor.
Si se sirve por HTTP, el juego carga los .json directamente y el bundle es solo respaldo.
Uso:  py tools/build_data.py
"""
import json, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
data = root / "src" / "data"
names = ["config", "map", "events", "questions", "opening", "audioManifest"]
bundle = {}
for n in names:
    bundle[n] = json.loads((data / f"{n}.json").read_text(encoding="utf-8"))
(data / "bundle.js").write_text(
    "/* GENERADO por tools/build_data.py - no editar a mano */\nwindow.BK_BUNDLE = "
    + json.dumps(bundle, ensure_ascii=False) + ";\n",
    encoding="utf-8",
)
print("bundle.js generado con", ", ".join(names))
