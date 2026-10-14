# AgriRover v1 hardware

The physical rover for the soil-moisture survey: a soil-probe module on a 4WD skid-steer RC chassis. Design, calculations and bill of materials: [DESIGN.md](DESIGN.md).

| | |
|---|---|
| `model.mjs` | Parametric model: every dimension, the probe force and timing model, and the BOM |
| `drawings.mjs` → `drawings/rover-v1-views.svg` | Front, side and plan views (third-angle, 1:5), with dimensions and a parts list |
| `anatomy/build.mjs` + `anatomy/live.js` → `anatomy/rover-anatomy-light.html`, `anatomy/rover-anatomy.html` | Interactive isometric anatomy figure: hover or use the arrow keys to move the probe; Space runs a full probe cycle |

Open the HTML or SVG files in a browser to view them. Nothing needs installing to view.

## Rebuild after changing `model.mjs`

Needs Node.js 20.10 or later. Run from the repository root in PowerShell:

```powershell
node hardware/rover-v1/drawings.mjs
```

The anatomy figure is built with the Anatomy skill kit (MIT, https://github.com/wheresryan22/anatomy). Install it once into the project (it is gitignored):

```powershell
git clone https://github.com/wheresryan22/anatomy.git .claude/skills/anatomy
```

Then build both themes and audit the geometry:

```powershell
node hardware/rover-v1/anatomy/build.mjs
node hardware/rover-v1/anatomy/build.mjs --light
node hardware/rover-v1/anatomy/build.mjs --light --audit
node hardware/rover-v1/anatomy/build.mjs --light --audit --pose=167
```

`--audit` must end with `audit passed`. `--pose=<mm>` audits the probe at that point of its 167 mm stroke. Set `ANATOMY_DIR` if the skill lives elsewhere. Once installed, the skill can also be used in Claude Code as `/anatomy`.
