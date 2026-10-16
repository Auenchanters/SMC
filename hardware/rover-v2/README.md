# AgriRover v2 hardware

The redesigned rover: a rocker-differential chassis on hub-motor wheels, with an open tool bay between the axles for the soil probe, a LiFePO4 battery with a designed BMS, and probe cleaning that never needs a person. Why each choice was made, from the physics: [DESIGN.md](DESIGN.md). Every computed number: [CALCULATIONS.md](CALCULATIONS.md). It replaces [v1](../rover-v1/), which is kept for reference.

| | |
|---|---|
| `model.mjs` | Parametric model: dimensions, masses, stability, probe force, traction, probe cycle, battery, BMS limits, service intervals, BOM |
| `calc.mjs` → `CALCULATIONS.md` | Every number DESIGN.md quotes, recomputed from the model |
| `drawings.mjs` → `drawings/rover-v2-views.svg` | Front, side and plan views (third-angle, 1:5) with a parts list |
| `anatomy/build.mjs` + `anatomy/rocker.mjs` + `anatomy/live.js` → `anatomy/rover-anatomy-light.html`, `anatomy/rover-anatomy.html` | Fig 1, the whole rover on a soil tray. Hover or use the arrow keys to move the probe. Space runs a probe cycle, R shifts the probe module along its rail, T raises two pads under diagonal wheels (a 100 mm twist): the rocker beams turn, the differential bar rocks, and the body stays level |
| `anatomy/cleaning-build.mjs` + `anatomy/cleaning-live.js` → `anatomy/probe-cleaning-light.html`, `anatomy/probe-cleaning.html` | Fig 2, the cleaning station in section: wiper plate, strip brushes, air knife, wet clean and air check, escalating through levels 0 to 3 on one stubborn sample |

## Rebuild after changing `model.mjs`

Needs Node.js 20.10 or later. From the repository root in PowerShell:

```powershell
node hardware/rover-v2/calc.mjs
node hardware/rover-v2/drawings.mjs
```

`model.mjs` checks the probe drive when it loads (the zip chain fits the 400 mm tower, its magazine holds the whole stroke, only the chain column and the probe pass the cleaning station) and throws if a change breaks it.

The anatomy figures are built with the Anatomy skill kit (MIT, https://github.com/wheresryan22/anatomy), pinned as described in [../rover-v1/README.md](../rover-v1/README.md) (CI uses the same commit). Build both themes and audit the geometry:

```powershell
node hardware/rover-v2/anatomy/build.mjs
node hardware/rover-v2/anatomy/build.mjs --light --audit
node hardware/rover-v2/anatomy/build.mjs --light --audit --rest-order --pose=270
node hardware/rover-v2/anatomy/build.mjs --light --audit --rest-order --pose=120
node hardware/rover-v2/anatomy/build.mjs --light --audit --rest-order --rail=-60
node hardware/rover-v2/anatomy/build.mjs --light --audit --rest-order --twist=100
node hardware/rover-v2/anatomy/cleaning-build.mjs
node hardware/rover-v2/anatomy/cleaning-build.mjs --light --audit
```

Every `--audit` must end with `audit passed`. Run the plain `--audit` build first: it saves the page's paint order, which the `--rest-order` pose audits then check.
- `--pose=<mm>` audits the probe at that travel (270 is full depth on level ground).
- `--rail=<mm>` audits the probe module shifted along its rail (negative is toward the rover's right).
- `--twist=<mm>` audits the pads raised under the front-left and rear-right wheels.

Then copy the model to the 3D replay, which builds its rover from it (a test fails until the copies match):

```powershell
Copy-Item hardware/rover-v2/model.mjs src/agrisim/viewer3d/rover-model.mjs
```

Commit the regenerated `CALCULATIONS.md`, SVG and HTML files: CI rebuilds them and fails if they differ. If the footprint or probe cycle changes, update [configs/scenarios/rover_v2.yaml](../../configs/scenarios/rover_v2.yaml) to match.
