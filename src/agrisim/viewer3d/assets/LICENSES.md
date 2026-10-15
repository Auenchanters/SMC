# Assets used by the 3D replay

Every file here is either CC0 (public domain) or made for this project. The sky is kept exactly as downloaded; the soil photos are re-encoded smaller by a script, so they can be rebuilt from the originals.

| File | What | Source | Licence |
|---|---|---|---|
| `soil/farm_soil_*.jpg` | Dry tilled soil: colour (2K), normal (1K), and AO + roughness + height packed into one 1K image | [Poly Haven: Farm Soil](https://polyhaven.com/a/farm_soil); re-encoded and packed by `scripts/assets/make_soil.py` | [CC0 1.0](https://polyhaven.com/license) |
| `soil/brown_mud_02_*.jpg` | Damp mud for wet, low ground; same set of maps | [Poly Haven: Brown Mud 02](https://polyhaven.com/a/brown_mud_02); re-encoded and packed by `scripts/assets/make_soil.py` | [CC0 1.0](https://polyhaven.com/license) |
| `sky/kloofendal_48d_partly_cloudy_puresky_2k.hdr` | Sky photo (HDR) that lights the scene and is the visible sky | [Poly Haven: Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), by Greg Zaal (original) and Jarod Guest (sky edits) | [CC0 1.0](https://polyhaven.com/license) |

The three.js library itself is in `../vendor/` (MIT, see `../vendor/LICENSE-three.txt`).
