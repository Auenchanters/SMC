// Fig 2: the v2 cleaning station at the bay floor, cut in half on the line of the three rods.
//   node hardware/rover-v2/anatomy/cleaning-build.mjs [--light] [--audit] [--pose=<travel mm>]
// Writes probe-cleaning.html (dark) or probe-cleaning-light.html. Dimensions and timings from ../model.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as M from "../model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = process.env.ANATOMY_DIR ?? join(HERE, "..", "..", "..", ".claude", "skills", "anatomy");
const load = (rel) => import(pathToFileURL(join(SKILL, rel)).href);
const k = await load("kit/iso-kit.mjs");
const G = await load("kit/lathe.mjs");
const { tubePieces, tubeSvg } = await load("kit/tube.mjs");
const A = await load("kit/audit.mjs");
const { kitScript } = await load("scripts/inline-kit.mjs");

const THEME = process.argv.includes("--light") ? "light" : "dark";
const POSE = Number((process.argv.find((a) => a.startsWith("--pose=")) ?? "--pose=-1").slice(7));
const D = M.DIM;
const PR = D.probe;
const ST = D.station;
const W = 560;
const H = 760;

// World: the probe axis at x = y = 0; the cut plane is y = 0 and the near half (y > 0) is removed.
// The station's parts inside its 34 mm radius and 150..205 mm height (the model's envelope):
const BORE = PR.headR + 4; // the head passes through on its way to the soil
const LEAF = { z0: ST.z0, z1: ST.z0 + 4 }; // split polyurethane wiper plate, closed on the rods
const BRUSH = { z0: ST.z0 + 10, z1: ST.z0 + 22 }; // strip brushes above it
const RING = { z: ST.z1 - 6, r0: ST.r, r1: ST.r + 6, h: 10 }; // air and water ring at the top, aimed up at the parked rods
const AIM = 0.6; // nozzle tilt above the horizontal, rad
const PLATE = { z0: 236, z1: 242, x0: -95, x1: 95, y0: -70 }; // module plate the station hangs from (bay width)
const SOIL = { x0: -95, x1: 95, y0: -70, y1: 0, z0: -40, z1: 0 };
const BENCH = { x: -110, y: -86, w: 220, d: 110, r: 6 };
const ROOT0 = PR.tip0 + PR.needleL;
const SHOW_TOP = ROOT0 + PR.headL + 16; // the probe column is shown up to here, cut flat
const P = k.fitProjection(
  [...k.boxCorners(BENCH, SOIL.z0 - 14, SOIL.z0), [PLATE.x0, 0, SHOW_TOP], [PLATE.x1, PLATE.y0, SHOW_TOP], [PLATE.x1, 0, SOIL.z0 - 14]],
  W,
  H,
  { pad: 24, azimuth: 74, elevation: 14 },
);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const KS = G.scaleOf(P);
const ZUP = [0, 0, 1];
const frameZ = (x, y, z) => G.frameOf([x, y, z], ZUP, [1, 0, 0], [0, 1, 0]);

const R = A.recorder(P);
const record = R.solid;
function put(name, ref, svg, shapes = [], { bias = 0, ...rest } = {}) {
  return R.put({ name, at: ref, bias, svg, shapes, piece: "station", ...rest });
}
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.6, steps = 2, bevel = 0, extra = "", inner = "", meta = {}, bias = 0 } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name, ...meta }, steps));
  put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  return shape;
}
// A half ring (the far half, angles 180..360 degrees), cut on the y = 0 plane, in pieces split at the
// silhouette angle, each one item of convex arc segments painted back to front, then its true edges.
const VIEW = G.viewOf(P);
const SIL = (Math.atan2(-VIEW[0], VIEW[1]) + 2 * Math.PI) % (2 * Math.PI);
const CUTS = [Math.PI, 1.5 * Math.PI, ...(SIL > 1.5 * Math.PI ? [SIL] : []), 2 * Math.PI];
function halfRing(name, rIn, rOut, z0, z1, style, { segments = 20, meta: given = {}, edges = true } = {}) {
  const meta = { owner: name, ...given };
  const F = frameZ(0, 0, 0);
  for (let c = 0; c + 1 < CUTS.length; c++) {
    const from = CUTS[c];
    const span = CUTS[c + 1] - from;
    const parts = [];
    const shapes = [];
    const n = Math.max(4, Math.round((segments * span) / (Math.PI / 2)));
    for (let i = 0; i < n; i++) {
      const a0 = from + (i / n) * span;
      const a1 = from + ((i + 1) / n) * span;
      const poly = [[rIn * Math.cos(a0), rIn * Math.sin(a0)], [rOut * Math.cos(a0), rOut * Math.sin(a0)], [rOut * Math.cos(a1), rOut * Math.sin(a1)], [rIn * Math.cos(a1), rIn * Math.sin(a1)]];
      const am = (a0 + a1) / 2;
      shapes.push(record(A.prism(F, poly, z0, z1, { name, ...meta })));
      const paths = { ...G.prismOf(F, poly, z0, z1, P), outline: "", crease: "", seamless: true };
      parts.push({ d: k.depthOf([((rIn + rOut) / 2) * Math.cos(am), ((rIn + rOut) / 2) * Math.sin(am), (z0 + z1) / 2], P), svg: S(paths, { tone: "mid", ...style }) });
    }
    parts.sort((a, b) => a.d - b.d);
    const arc = (r, z) => path3(Array.from({ length: 37 }, (_, j) => { const a = from + (j / 36) * span; return [r * Math.cos(a), r * Math.sin(a), z]; }));
    const ends = [from, from + span].filter((a) => Math.abs(Math.sin(a)) < 1e-6).map((a) => path3([[rIn * Math.cos(a), 0, z0], [rOut * Math.cos(a), 0, z0], [rOut * Math.cos(a), 0, z1], [rIn * Math.cos(a), 0, z1]], true)).join("");
    const am = from + span / 2;
    const lines = edges ? arc(rIn, z1) + arc(rOut, z1) + arc(rIn, z0) + arc(rOut, z0) + ends : ends;
    put(`${name}.p${c}`, [((rIn + rOut) / 2) * Math.cos(am), ((rIn + rOut) / 2) * Math.sin(am), (z0 + z1) / 2], parts.map((q) => q.svg).join("") + k.lineSvg(lines, { tone: "lo" }), shapes);
  }
}

// ---------------------------------------------------------------- bench and soil
const back = [`<path class="iso-halo" d="${k.haloOf(BENCH, SOIL.z0 - 14, 14, P)}"/>`];
for (const [x, y] of k.corners(BENCH, 14).sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))) {
  back.push(S(k.cylinder(x, y, 6, SOIL.z0 - 14, 1.4, P, 24), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 4.6, SOIL.z0 - 12.6, 4.6, P, 24), { tone: "mid" }));
}
back.push(S(k.slabOf(BENCH, SOIL.z0 - 8, 8, P, 6, 1), { tone: "mid" }));
record(A.slab(BENCH, SOIL.z0 - 8, 8, { name: "stand.bench", ground: true }, 6));
back.push(Dots(k.corners(BENCH, 6).map(([x, y]) => at([x, y, SOIL.z0])), { size: 0.5 }));
const SOIL_Y1 = -PR.needleR - 0.1;
const SOIL_PLAN = { x: SOIL.x0, y: SOIL.y0, w: SOIL.x1 - SOIL.x0, d: SOIL_Y1 - SOIL.y0, r: 0.4 };
box("soil", [SOIL.x0, SOIL.y0, SOIL.z0], [SOIL.x1, SOIL_Y1, SOIL.z1], { tone: "lo", crease: "faint" }, {
  r: 0.4, meta: { ground: true },
  inner: Ln([-12, -26].map((z) => k.sideSeam(SOIL_PLAN, z, P, 2)).join(""), { tone: "faint" }),
  extra: Dots([[-60, -8], [-30, -20], [50, -14], [72, -30], [-80, -33], [20, -34]].map(([x, z]) => at([x, SOIL_Y1, z])), { size: 0.6, tone: "lo" }),
});
{
  const ticks = [];
  for (let z = 0; z >= -36; z -= 5) ticks.push(path3([[-78, -PR.needleR + 0.7, z], [-78 + (z % 10 === 0 ? 5 : 2.6), -PR.needleR + 0.7, z]]));
  box("gauge", [-78, SOIL_Y1, -38], [-73, -PR.needleR + 0.7, 0.4], { tone: "mid" }, { r: 0.2, steps: 1, extra: Ln(ticks.join(""), { tone: "lo" }) });
}

// ---------------------------------------------------------------- module plate, cut on the rod line, and its stand-ins
const HOLE = BORE + 2;
box("plate.left", [PLATE.x0, PLATE.y0, PLATE.z0], [-HOLE, 0, PLATE.z1], { tone: "mid" }, { r: 0.4 });
box("plate.right", [HOLE, PLATE.y0, PLATE.z0], [PLATE.x1, 0, PLATE.z1], { tone: "mid" }, { r: 0.4 });
box("plate.back", [-HOLE, PLATE.y0, PLATE.z0], [HOLE, -HOLE, PLATE.z1], { tone: "mid" }, { r: 0.4 });
// Posts from the soil to the plate stand in for the rover around the bay (Fig 1 shows it).
for (const x of [PLATE.x0 + 4, PLATE.x1 - 12]) box("stand.post", [x, PLATE.y0 + 4, SOIL.z1], [x + 8, PLATE.y0 + 12, PLATE.z0], { tone: "lo" }, { r: 1, meta: { ground: true } });
// Two hangers drop from the plate to the station's ears.
const EAR = { x: ST.r + 12 };
for (const sx of [-1, 1]) {
  const x = sx * EAR.x;
  const side = sx > 0 ? "right" : "left";
  box(`ear.${side}`, [sx > 0 ? RING.r1 - 0.3 : -EAR.x - 6, -16, RING.z - RING.h / 2], [sx > 0 ? EAR.x + 6 : -RING.r1 + 0.3, -4, RING.z + RING.h / 2], { tone: "mid" }, { r: 0.6, meta: { owner: "station" } });
  box(`hanger.${side}`, [x - 4, -14, RING.z + RING.h / 2], [x + 4, -6, PLATE.z0], { tone: "mid" }, { r: 0.6, meta: { owner: "station" }, extra: Dots([at([x, -6, RING.z + RING.h / 2 + 4]), at([x, -6, PLATE.z0 - 4])], { size: 0.45 }) });
}

// ---------------------------------------------------------------- the station (far half)
// Housing: cut into bands where the wiper slot, the brush slot and the ring sit.
for (const [z0, z1] of [[LEAF.z1, BRUSH.z0], [BRUSH.z0, BRUSH.z1], [BRUSH.z1, RING.z - RING.h / 2], [RING.z - RING.h / 2, RING.z + RING.h / 2], [RING.z + RING.h / 2, ST.z1]]) {
  halfRing("station.body", BORE, ST.r, z0, z1, { tone: "mid" }, { meta: { owner: "station" } });
}
halfRing("station.ring", ST.r, RING.r1, RING.z - RING.h / 2, RING.z + RING.h / 2, { tone: "hi" }, { meta: { owner: "station" } });
// Wiper plate: the far leaf of a split polyurethane plate; its half-round notches close round the rods.
{
  const ry = -PR.needleR - 0.1;
  const notch = (x) => Array.from({ length: 9 }, (_, i) => { const a = Math.PI + (i / 8) * Math.PI; return [x + Math.cos(a) * PR.needleR, ry + Math.sin(a) * PR.needleR * 0.4]; });
  const edge = [[-ST.r, ry], ...PR.needleX.flatMap((x) => notch(x)), [ST.r, ry]];
  const faceLines = path3(edge.map(([x, y]) => [x, y, LEAF.z1]));
  box("wiper.leaf", [-ST.r, -ST.r, LEAF.z0], [ST.r, ry, LEAF.z1], { tone: "hi" }, { r: 0.4, meta: { owner: "station" }, extra: Ln(faceLines, { tone: "lo" }) });
  [-24, 24].forEach((x) => put("wiper.screw", [x, -28, LEAF.z1], Dots([at([x, -28, LEAF.z1])], { size: 0.5 }), [A.ball([x, -28, LEAF.z1], 0.5, { name: "wiper.screw", owner: "station" })], { bias: 0.3 }));
}
// Strip brush: the far one of the pair, pressed into a slot in the bore; its bristles meet the near
// brush (cut away) on the rod line.
{
  const x = 14;
  const y0 = -Math.sqrt(BORE ** 2 - x ** 2) + 0.02;
  const y1 = -PR.needleR - 0.1;
  const lines = [];
  for (let u = -x + 2; u <= x - 2; u += 2) lines.push(path3([[u, y0, BRUSH.z1], [u, y1, BRUSH.z1]]));
  box("brush.bristles", [-x, y0, BRUSH.z0], [x, y1, BRUSH.z1], { tone: "lo" }, { r: 0.2, steps: 1, extra: Ln(lines.join(""), { tone: "faint" }), meta: { owner: "station" } });
}
// Nozzles: six round the bore at 60 degree spacing, three on the far half. Air knife and wet clean
// share them: a valve picks air (the blast and the dry) or water (the wet clean).
const NOZZLES = [210, 270, 330].map((deg) => (deg * Math.PI) / 180);
for (const a of NOZZLES) {
  const F = G.frameAlong([Math.cos(a) * BORE, Math.sin(a) * BORE, RING.z], [-Math.cos(a) * Math.cos(AIM), -Math.sin(a) * Math.cos(AIM), Math.sin(AIM)]);
  put("nozzle", [Math.cos(a) * (BORE - 2), Math.sin(a) * (BORE - 2), RING.z + 1], S(G.disc(1.1, 3, 1.8, F, P, { steps: 16 }), { tone: "hi" }), [record(A.disc(F, 1.1, 3, 1.8, { name: "nozzle", owner: "station" }))], { bias: 0.2 });
}
// Valve block on the plate, fed by the pump and the water tank in the front box; two lines to the ring.
const VB = { x0: -88, x1: -58, y0: -60, y1: -36, z0: PLATE.z1, z1: PLATE.z1 + 18 };
box("valves", [VB.x0, VB.y0, VB.z0], [VB.x1, VB.y1, VB.z1], { tone: "mid" }, {
  r: 2, steps: 3, bevel: 0.5, extra: Dots([at([VB.x0 + 4, VB.y1, VB.z1 - 4]), at([VB.x1 - 4, VB.y1, VB.z1 - 4])], { size: 0.45 }),
});
for (const [i, x] of [[0, VB.x0 + 8], [1, VB.x1 - 8]]) {
  post(`valve.coil.${i}`, x, (VB.y0 + VB.y1) / 2, 5, VB.z1, VB.z1 + 10, i ? "hi" : "mid");
}
function post(name, x, y, r, z0, z1, tone) {
  const shape = record(A.cylinder(x, y, r, z0, z1 - z0, { name }));
  put(name, [x, y, (z0 + z1) / 2], S(k.cylinder(x, y, r, z0, z1 - z0, P, 28, 0.3), { tone }), [shape]);
}
const LINES = [];
for (const [name, deg, x] of [["air", 230, VB.x0 + 8], ["water", 250, VB.x1 - 8]]) {
  const a = (deg * Math.PI) / 180;
  const axis = [Math.cos(a), Math.sin(a), 0];
  const barb = G.add3([0, 0, RING.z], G.mul3(axis, RING.r1));
  const F = G.frameAlong(barb, axis);
  put(`barb.${name}`, G.add3(barb, G.mul3(axis, 3)), S(G.disc(0, 6, 2.6, F, P, { steps: 20 }), { tone: "mid" }), [record(A.disc(F, 0, 6, 2.6, { name: `barb.${name}`, owner: "station" }))]);
  const start = [x, VB.y0 - 0.1, VB.z0 + 6];
  const end = G.add3(barb, G.mul3(axis, 6));
  const out = G.add3(end, G.mul3(axis, 12));
  const route = G.fillet([start, [x, PLATE.y0 - 6, start[2]], [x, PLATE.y0 - 6, RING.z + 22], [out[0], out[1], RING.z + 22], out, end], 6, 10, { P, tube: 2 });
  R.route(`line.${name}`, route, 2, { limp: true, piece: "station" });
  LINES.push(`line.${name}`);
  tubePieces(route, 2, P, { maxLength: 16 }).forEach((piece, index) => put(`line.${name}:${index}`, piece.mid, tubeSvg(piece, { tone: name === "air" ? "mid" : "hi" }), [A.tube(piece.points, piece.radii)], { bias: 0.05 }));
}

// ---------------------------------------------------------------- the probe (moves), crumbs, jets
const travel = POSE >= 0 ? POSE : 0;
function probeSvg(t) {
  const root = ROOT0 - t;
  const top = Math.min(root + PR.headL, SHOW_TOP);
  const parts = [];
  const shapes = [];
  const F = frameZ(0, 0, 0);
  for (const x of PR.needleX) {
    const tip = root - PR.needleL;
    const NF = frameZ(x, 0, tip);
    const profile = [[0, 0.25], [6, PR.needleR], [PR.needleL, PR.needleR]];
    parts.push(S(G.solidOf(profile, NF, P, { steps: 16 }), { tone: "hi", lit: true }));
    shapes.push(A.solid(NF, profile, { name: "probe.needle", ground: true }));
  }
  parts.unshift(S(G.disc(root, top, PR.headR, F, P, { steps: 48 }), { tone: "hi", lit: true }) + Ln(k.sideArc(0, 0, PR.headR, root + 14, P, 48), { tone: "lo" }));
  shapes.push(A.disc(F, root, top, PR.headR, { name: "probe.head", ground: true }));
  // The extension rod, drawn long enough to reach the cut at any travel; the clip ends it there.
  if (root + PR.headL < SHOW_TOP) {
    parts.unshift(S(G.disc(root + PR.headL, SHOW_TOP + PR.tip0 + PR.depth, PR.extR, F, P, { steps: 32 }), { tone: "hi" }));
    shapes.push(A.disc(F, root + PR.headL, SHOW_TOP, PR.extR, { name: "probe.ext", ground: true }));
  }
  return { svg: parts.join(""), shapes, root };
}
const pr = probeSvg(travel);
const cutY = at([0, 0, SHOW_TOP])[1];
const probeGroup = `<g data-part="probe"><clipPath id="cl-top"><path data-hold d="M-1000 ${cutY.toFixed(2)}H3000V3000H-1000Z"/></clipPath><g clip-path="url(#cl-top)">${pr.svg}</g></g>`;
put("probe", [0, 0, pr.root], probeGroup, pr.shapes.map(record), { bias: 5 });
put("crumbs", [0, -3, 40], `<g data-part="crumbs"></g><g data-part="fallen"></g>`, [record(A.box([-14, -4.6, 0], [14, -1.7, 2], { name: "crumbs", ground: true }))], { bias: 6 });
put("jets", [0, -15, RING.z + 12], `<g data-part="jets"></g>`, [record(A.box([-10, -20, ST.z1 + 2], [10, -3, RING.z + 22], { name: "jets", ground: true }))], { bias: 7 });

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const MATERIAL = [[/^soil/, "rv-soil"], [/^brush\.bristles/, "rv-rubber"], [/^line\.air/, "rv-rubber"]];
const materialOf = (name) => (MATERIAL.find(([re]) => re.test(name)) ?? [null, ""])[1];
const groups = R.items.map((item) => `<g class="it${materialOf(item.name) ? " " + materialOf(item.name) : ""}" data-name="${item.name}">${item.svg}</g>`).join("");

// Crumbs of soil stuck to the far side of each rod, by distance from the tip (mm), radius, and how
// stubborn each is: 0 comes off on the wiper plate, 1 survives it but not a second stroke, 2 needs water.
const CRUMBS = PR.needleX.flatMap((x, i) => [6, 17, 29, 41, 53].map((s, j) => ({ x: x + (j % 2 ? 0.6 : -0.6), s: s + i * 2, r: 1.1 + ((i + j) % 3) * 0.35, sticky: (i * 5 + j) % 5 === 1 ? 2 : (i * 5 + j) % 4 === 2 ? 1 : 0 })));
const C = M.cycle();
const DATA = {
  P,
  tip0: PR.tip0,
  needleL: PR.needleL,
  root0: ROOT0,
  speed: M.SPEED,
  cycle: C,
  depth: PR.depth,
  needleR: PR.needleR,
  leaf: LEAF,
  brush: BRUSH,
  ringZ: RING.z,
  bore: BORE,
  nozzles: NOZZLES,
  needleX: PR.needleX,
  crumbs: CRUMBS,
  clean: M.CLEAN,
  // Air-check readings for the tour, above the clean-air baseline (illustrative, not measured).
  checks: [0.041, 0.027, 0.006],
  playback: 2.5,
  scale: KS,
};
const LIVE = readFileSync(join(HERE, "cleaning-live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const CSS = `
.iso .rv-void { fill: var(--anatomy-shade-0); stroke: none; }
.iso [data-part="jets"] .iso-line { stroke-dasharray: 2.2 2; animation: rv-flow 0.4s linear infinite; }
.iso [data-part="jets"] .cl-water .iso-line { stroke-dasharray: 0.6 1.6; }
@keyframes rv-flow { to { stroke-dashoffset: -4.2; } }
@media (prefers-reduced-motion: reduce) { .iso [data-part="jets"] .iso-line { animation: none; } }
.iso .rv-soil { --anatomy-paper: #d8d2c6; --anatomy-face: #ddd7cb; --anatomy-top: #e3ddd1; --anatomy-shade-0: #b8b1a4; --anatomy-shade-1: #c2bbae; --anatomy-shade-2: #ccc5b8; --anatomy-shade-3: #d5cec1; --anatomy-lo: #988f82; --anatomy-faint: #b9b1a4; --anatomy-mid: #7c7468; }
.iso .rv-rubber { --anatomy-paper: #c9c9c9; --anatomy-face: #d2d2d2; --anatomy-top: #d6d6d6; --anatomy-shade-0: #a7a7a7; --anatomy-shade-1: #b2b2b2; --anatomy-shade-2: #bcbcbc; --anatomy-shade-3: #c5c5c5; --anatomy-lo: #8c8c8c; --anatomy-faint: #a9a9a9; }
.iso:not([data-theme="light"]) .rv-soil { --anatomy-paper: #1f1b16; --anatomy-face: #25211b; --anatomy-top: #29241e; --anatomy-shade-0: #16130f; --anatomy-shade-1: #1a1712; --anatomy-shade-2: #1e1a15; --anatomy-shade-3: #221e18; --anatomy-lo: #4a4238; --anatomy-faint: #332d26; --anatomy-mid: #6c6255; }
.iso:not([data-theme="light"]) .rv-rubber { --anatomy-paper: #0d0d0d; --anatomy-face: #111; --anatomy-top: #141414; --anatomy-shade-0: #080808; --anatomy-shade-1: #0b0b0b; --anatomy-shade-2: #0e0e0e; --anatomy-shade-3: #111; --anatomy-lo: #2e2e2e; --anatomy-faint: #222; }
.iso .cl-crumb { fill: #8a7a62; } .iso:not([data-theme="light"]) .cl-crumb { fill: #6b5a44; }
`;
const CL = M.CLEAN;
const svg = k.figureSvg({
  width: W,
  height: H,
  label: "The v2 probe's cleaning station, cut in half on the line of the three rods, hanging from the probe module's plate above a block of soil. From the bottom up: the far leaf of a split polyurethane wiper plate whose notches close round the rods, the far brush of a pair of strip brushes, and a ring of nozzles that blows air or sprays water. The probe pushes through into the soil; on the way back up the wiper and brushes scrape off soil crumbs, which fall back onto the soil. Then the nozzles blow the parked rods dry and the probe checks it reads clean air; if it does not, it strokes through the wipers again, and if it still does not, the nozzles spray water and blow the rods dry again before the check.",
  body: [...back, `<g class="cl-fig">${groups}</g>`],
});
const body =
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 2",
    title: "Cleaning station, levels 0 to 3",
    hint: "Space: cycle with escalation · ↑ ↓ or hover: probe",
    readout: "parked · rods clean",
    keys: [
      { mark: "lit", label: "Probe rods: soil sticks to them on the way out" },
      { mark: "raised", label: "Wiper plate, strip brushes, air and water ring" },
      { mark: "edge", label: "Air and water lines from the valve block" },
    ],
    caption: `No step of the cleaning needs a person, so every cycle ends by proving the rods are clean. Level 0: as the probe retracts, the split polyurethane wiper plate closes its notches round the rods and scrapes the soil off, then two strip brushes (the near one of each is cut away here); the head pushes both apart on the way down, and the crumbs fall back where they came from. Level 1: with the rods parked in the ring, six nozzles (three shown) blow them dry for ${M.SPEED.blast} s, and the probe must then read within ${CL.airMax} m³/m³ of its clean-air baseline. Level 2: if it does not, it strokes down through the wipers and back without touching soil, blasts and checks again. Level 3: if it still fails, the same nozzles spray water for ${CL.wetS} s (${CL.wetMl} mL from the ${D.waterTank.ml / 1000} L tank), dry the rods with air for ${CL.dryS} s, and check: the check proves the water film is gone before the next reading. Level 4 (not shown): after ${CL.wetRetries} wet cleans the reading is marked invalid and the survey goes on. The tour plays one stubborn sample through levels 0 to 3, ${DATA.playback}× fast; the crumbs and the air-check readings are illustrative.`,
    body: `<div class="iso-stage cl-stage" tabindex="0" role="slider" aria-label="Probe cleaning station. Space runs a probe cycle that escalates through the cleaning levels; up and down arrows move the probe; Home parks it." aria-valuemin="0" aria-valuemax="${PR.depth}" aria-valuenow="0" aria-valuetext="Parked, rods clean">${svg}</div>`,
  });
const page = k.pageHtml({ title: "AgriRover v2 probe cleaning", theme: THEME, body, script: kitScript() + LIVE, width: 650 });
if (POSE < 0) {
  const name = THEME === "light" ? "probe-cleaning-light.html" : "probe-cleaning.html";
  writeFileSync(join(HERE, name), page);
  console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`, `${LINES.length} lines`);
}
A.auditOrExit(R, P, {});
