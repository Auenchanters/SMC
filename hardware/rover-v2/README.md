# AgriRover v2 hardware

The redesigned rover: a rocker-differential chassis on hub-motor wheels, with an open tool bay between the axles for the soil probe, a LiFePO4 battery with a designed BMS, and probe cleaning that never needs a person. Why each choice was made, from the physics: [DESIGN.md](DESIGN.md). Every computed number: [CALCULATIONS.md](CALCULATIONS.md). It replaces [v1](../rover-v1/), which is kept for reference.

| | |
|---|---|
| `model.mjs` | Parametric model: dimensions, masses, stability, probe force, traction, probe cycle, battery, BMS limits, service intervals, BOM |
| `calc.mjs` → `CALCULATIONS.md` | Every number DESIGN.md quotes, recomputed from the model |
| `drawings.mjs` → `drawings/rover-v2-views.svg` | Front, side and plan views (third-angle, 1:5) with a parts list |

## Rebuild after changing `model.mjs`

Needs Node.js 20.10 or later. From the repository root in PowerShell:

```powershell
node hardware/rover-v2/calc.mjs
node hardware/rover-v2/drawings.mjs
```

Commit the regenerated `CALCULATIONS.md` and SVG: CI rebuilds them and fails if they differ. If the footprint or probe cycle changes, update [configs/scenarios/rover_v2.yaml](../../configs/scenarios/rover_v2.yaml) to match.

Not yet done for v2: the interactive anatomy figures (v1 has them) and the rover in the 3D replay, which still builds v1 from its `model.mjs`.
