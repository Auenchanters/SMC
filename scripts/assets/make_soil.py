"""Download the CC0 soil textures (Poly Haven) and re-encode them compactly for the 3D replay.

For each soil it writes, into src/agrisim/viewer3d/assets/soil/:
  <id>_color.jpg   2K colour (albedo)
  <id>_normal.jpg  1K normal map (OpenGL convention)
  <id>_arh.jpg     1K packed: R = ambient occlusion, G = roughness, B = height (displacement)
Downloads are cached in runs/asset_src/. Run from the repository root:
    uv run python scripts/assets/make_soil.py
"""

import json
import urllib.request
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / "runs" / "asset_src"
OUT = REPO / "src" / "agrisim" / "viewer3d" / "assets" / "soil"
SOILS = ("farm_soil", "brown_mud_02")
AGENT = {"User-Agent": "agrisim-assets/1.0"}


def fetch(url: str) -> Path:
    path = CACHE / url.rsplit("/", 1)[1]
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT)) as r:
            path.write_bytes(r.read())
    return path


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for soil in SOILS:
        req = urllib.request.Request(f"https://api.polyhaven.com/files/{soil}", headers=AGENT)
        with urllib.request.urlopen(req) as r:
            files = json.load(r)

        def url(kind: str, res: str, files: dict = files) -> str:
            return str(files[kind][res]["jpg"]["url"])

        color = Image.open(fetch(url("Diffuse", "2k"))).convert("RGB")
        color.save(OUT / f"{soil}_color.jpg", quality=82, optimize=True)
        normal = Image.open(fetch(url("nor_gl", "1k"))).convert("RGB")
        normal.save(OUT / f"{soil}_normal.jpg", quality=90, optimize=True)
        ao, rough, height = (
            Image.open(fetch(url(kind, "1k"))).convert("L").resize(normal.size)
            for kind in ("AO", "Rough", "Displacement")
        )
        Image.merge("RGB", (ao, rough, height)).save(
            OUT / f"{soil}_arh.jpg", quality=90, optimize=True
        )
        sizes = ", ".join(
            f"{p.name} {p.stat().st_size / 1e6:.2f} MB" for p in sorted(OUT.glob(f"{soil}_*"))
        )
        print(sizes)


if __name__ == "__main__":
    main()
