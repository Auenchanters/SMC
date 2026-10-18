# brag plan: agrisim videos

Made with the /brag-slim method (github.com/latent-spaces/brag). The team asked for two longer videos than brag's 20-second default, so its creative laws apply per scene: hook first, show the real thing, specific copy, readable text, music written for the piece, every frame postable.

## What it is, for whom, and why it matters

- **One sentence:** a simulator, benchmark and rover design for mapping where a planted tomato field is too dry, by probing between the rows without touching a plant.
- **For:** judges and engineers evaluating the project, and the farm-robotics people it is meant for.
- **What sets it apart:** lane-only motion with plant contact counted (zero in 15,232 benchmark surveys); probing aimed at the farmer's too-dry decision; a benchmark on fresh fields nobody has seen, where our entry scores 75.8 against 60.7 for the best re-implemented published method.
- **Most impressive true claim:** best of 12 real strategies on fresh fields, with zero plant contacts.
- **Visual hook:** the 3D replay from a drone camera, the ground coloured by the robot's own moisture map.
- **Share caption:** see `share-copy.txt` in docs/media.

## Tone and identity

Polished: serious, restrained, long holds, soft dips through the background between scenes. The palette, type and status colours are the replay's own (src/agrisim/viewer3d/viewer.css): graphite #0d1114, text #eef2f4, the moisture ramp from red-brown (dry) through yellow (the dry line) to blue (wet), green only for "safe". Segoe UI Variable for type, Cascadia Mono for commands. Voice: Kokoro af_heart, calm. Music: a slow A-minor pad with a soft arpeggio, ducked under the voice.

## Video 1: the explainer (3 min 18 s)

Angle: an honest pitch. The problem, why every existing approach leaves a gap, what we built, proof, and what is still missing.

| Beat | Picture | Point |
|---|---|---|
| e-hook | Drone camera over the replay, map colours on the ground | Which part of this field is too dry? |
| e-problem | Slide: the real demo field; one probe, then all 60 sites | One probe, one spot, 10 to 30 s each |
| e-gaps | Slide: seven approaches, one gap each | Every existing approach leaves a gap |
| e-research | Slide: research robots and two shut-down companies | No product we found probes between the rows; prove it in simulation |
| e-built | Slide: the four parts, with the real architecture diagram | What we built |
| e-safe | Follow camera in the lane, plain soil | It never touches a plant: 0 in 15,232 surveys |
| e-map | Overhead, map filling in, then the real moisture | Each reading sharpens the map |
| e-decision | Slide: the run's 48 coverage probes, then its 12 decision probes | Probe for the farmer's decision |
| e-results | Slide: agribench scores as bars, our interval drawn | 75.8 vs 60.7, 48.3, 30.6 |
| e-compare | Slide: the design comparison, real-robot row last | What agrisim checks, and what it lacks |
| e-rover | The rover v2 anatomy figure running a probe cycle | Designed from the physics; not yet built |
| e-honest | Slide: not done yet, and next | Placeholders until calibrated; map error ties |
| e-outro | Wordmark, repo, one command | agrisim |

## Video 2: the live demo (2 min 18 s)

Angle: a hands-on tour of the real thing, one action per beat, each caption saying what to look at.

| Beat | Picture | Point |
|---|---|---|
| d-title | Slide | Live demo |
| d-run | Real terminal output of `agrisim run ... --policy planned_survey` | One command, same numbers every time |
| d-open | The replay loading, then the intro panel | --view opens the 3D replay |
| d-probe | Follow camera; the six probe bars | The probe cycle, step by step |
| d-reading | The ripple, the flag, the map fading | Each value lands |
| d-drone | Key D | Drone view |
| d-timeline | Pointer over the time bar; arrow keys | The whole mission on one bar |
| d-layers | Key O; clicks through the ground colours | Judge the map against the truth |
| d-minimap | Click a reading on the mini-map | Shared selection; error chart; zero plants touched |
| d-rain | Rain run from the drone; the rain note | Weather during the mission |
| d-phone | The phone layout, switching panels | One panel at a time |
| d-bench | Real terminal output of `agrisim bench` | Compare strategies on the same fields |
| d-end | Slide: three commands | Try it yourself |

Beat lengths follow the voice: each lasts as long as its line plus a short pause (prepare.py), so the totals above are approximate.
