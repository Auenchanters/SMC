# AgriRover v1 hardware

The physical rover for the soil-moisture survey: a soil-probe module on a 4WD skid-steer RC chassis. Design, calculations and bill of materials: [DESIGN.md](DESIGN.md).

| | |
|---|---|
| `model.mjs` | Parametric model: every dimension, the probe force and timing model, and the BOM |
| `drawings.mjs` → `drawings/rover-v1-views.svg` | Front, side and plan views (third-angle, 1:5), with dimensions and a parts list |
| `anatomy/build.mjs` + `anatomy/live.js` → `anatomy/rover-anatomy-light.html`, `anatomy/rover-anatomy.html` | Fig 1, the whole rover: hover or use the arrow keys to move the probe; Space runs a probe cycle with cleaning; A slides the left under-leaf camera arm |
| `anatomy/cleaning-build.mjs` + `anatomy/cleaning-live.js` → `anatomy/probe-cleaning-light.html`, `anatomy/probe-cleaning.html` | Fig 2, the self-cleaning probe cartridge in section: brushes, air-knife, air check |

Open the HTML or SVG files in a browser to view them. Nothing needs installing to view.

## Rebuild after changing `model.mjs`

Needs Node.js 20.10 or later. Run from the repository root in PowerShell:

```powershell
node hardware/rover-v1/drawings.mjs
```

The anatomy figure is built with the Anatomy skill kit (MIT, https://github.com/wheresryan22/anatomy). Install it once into the project (it is gitignored):

```powershell
git clone https://github.com/wheresryan22/anatomy.git .claude/skills/anatomy
git -C .claude/skills/anatomy checkout e6600ffc4e8e6620eeb45bf49bcdbd5e4b84163f
```

That commit is the one the figures were built and audited with; CI pins the same one.

Then build both themes and audit the geometry:

```powershell
node hardware/rover-v1/anatomy/build.mjs
node hardware/rover-v1/anatomy/build.mjs --light --audit
node hardware/rover-v1/anatomy/build.mjs --light --audit --rest-order --pose=167
node hardware/rover-v1/anatomy/build.mjs --light --audit --rest-order --arm=0.5
node hardware/rover-v1/anatomy/cleaning-build.mjs
node hardware/rover-v1/anatomy/cleaning-build.mjs --light --audit
```

Then copy the model to the 3D replay, which builds its rover from it (a test fails until the copies match):

```powershell
Copy-Item hardware/rover-v1/model.mjs src/agrisim/viewer3d/rover-model.mjs
```

`--audit` must end with `audit passed`. Commit the rebuilt HTML and SVG files: CI rebuilds them and fails if they differ from the committed ones. Run the plain `--audit` build first: it saves the page's paint order, which the `--rest-order` pose audits then check.
- `--pose=<mm>` audits the probe at that point of its 167 mm stroke.
- `--arm=<0..1>` audits the left camera arm at that share of its extension.

Set `ANATOMY_DIR` if the skill lives elsewhere. Once installed, the skill can also be used in Claude Code as `/anatomy`.
