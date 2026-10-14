// Fig 2: the probe's self-cleaning cartridge, cut in half on the rod line.
//   node hardware/rover-v1/anatomy/cleaning-build.mjs [--light] [--audit] [--pose=<travel mm>]
// Writes probe-cleaning.html (dark) or probe-cleaning-light.html. Dimensions from ../model.mjs.
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
const CR = D.cartridge;
const W = 600;
const H = 520;

// World: the probe axis at x = y = 0; the cut plane is y = 0 and the near half (y > 0) is removed.
const BELLY = { z0: D.tub.z0, z1: D.tub.z0 + 4 }; // chassis belly plate (4 mm shown)
const PLATE = { x0: -95, x1: 95, y0: -70 };
const SOIL = { x0: -95, x1: 95, y0: -70, y1: 0, z0: -40, z1: 0 };
const BENCH = { x: -110, y: -86, w: 220, d: 110, r: 6 };
const SHOW_TOP = 252; // the probe column is shown up to here, cut flat
const P = k.fitProjection(
  [...k.boxCorners(BENCH, SOIL.z0 - 14, SOIL.z0), [PLATE.x0, 0, SHOW_TOP], [PLATE.x1, PLATE.y0, SHOW_TOP], [PLATE.x1, 0, SOIL.z0 - 14]],
  W,
  H,
  { pad: 24, azimuth: 74, elevation: 12 },
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
  return R.put({ name, at: ref, bias, svg, shapes, piece: "cartridge", ...rest });
}
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.6, steps = 2, bevel = 0, extra = "", inner = "", meta = {} } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name, ...meta }, steps));
  put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape]);
  return shape;
}
// A half ring (the far half, angles 180..360 degrees), cut on the y = 0 plane, in pieces. Each piece is
// one item of convex arc segments painted back to front without their own edges, then its true edges.
// A collar round a tube is behind it on one side of the silhouette angle (where the radius is square to
// the view) and in front of it on the other, so every ring is split there too.
const VIEW = G.viewOf(P);
const SIL = (Math.atan2(-VIEW[0], VIEW[1]) + 2 * Math.PI) % (2 * Math.PI);
const CUTS = [Math.PI, 1.5 * Math.PI, ...(SIL > 1.5 * Math.PI ? [SIL] : []), 2 * Math.PI];
function halfRing(name, rIn, rOut, z0, z1, style, { segments = 20, meta: given = {} } = {}) {
  const meta = { owner: name, ...given };
  const F = frameZ(0, 0, 0);
  for (let c = 0; c + 1 < CUTS.length; c++) {
    const from = CUTS[c];
    const span = CUTS[c + 1] - from;
    const side = `p${c}`;
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
    put(`${name}.${side}`, [((rIn + rOut) / 2) * Math.cos(am), ((rIn + rOut) / 2) * Math.sin(am), (z0 + z1) / 2], parts.map((q) => q.svg).join("") + k.lineSvg(arc(rIn, z1) + arc(rOut, z1) + arc(rIn, z0) + ends, { tone: "lo" }), shapes);
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
const SOIL_PLAN = { x: SOIL.x0, y: SOIL.y0, w: SOIL.x1 - SOIL.x0, d: -PR.needleR - 0.1 - SOIL.y0, r: 0.4 };
box("soil", [SOIL.x0, SOIL.y0, SOIL.z0], [SOIL.x1, -PR.needleR - 0.1, SOIL.z1], { tone: "lo", crease: "faint" }, {
  r: 0.4, meta: { ground: true },
  inner: Ln([-12, -26].map((z) => k.sideSeam(SOIL_PLAN, z, P, 2)).join(""), { tone: "faint" }),
  extra:
    Dots([[-60, -8], [-30, -20], [50, -14], [72, -30], [-80, -33], [20, -34]].map(([x, z]) => at([x, -PR.needleR - 0.1, z])), { size: 0.6, tone: "lo" }),
});
// Depth gauge on the section face.
{
  const ticks = [];
  for (let z = 0; z >= -36; z -= 5) ticks.push(path3([[-78, -PR.needleR + 0.7, z], [-78 + (z % 10 === 0 ? 4.4 : 2.6), -PR.needleR + 0.7, z]]));
  box("gauge", [-78, -PR.needleR - 0.1, -38], [-70, -PR.needleR + 0.7, 0.4], { tone: "mid" }, { r: 0.2, steps: 1, extra: Ln(ticks.join(""), { tone: "lo" }) });
}

// ---------------------------------------------------------------- chassis belly, cut on the rod line
box("belly.left", [PLATE.x0, PLATE.y0, BELLY.z0], [-CR.flangeR, 0, BELLY.z1], { tone: "mid" }, { r: 0.4 });
box("belly.right", [CR.flangeR, PLATE.y0, BELLY.z0], [PLATE.x1, 0, BELLY.z1], { tone: "mid" }, { r: 0.4 });
box("belly.back", [-CR.flangeR, PLATE.y0, BELLY.z0], [CR.flangeR, -CR.flangeR, BELLY.z1], { tone: "mid" }, { r: 0.4 });
halfRing("belly.ring", D.well.rOut, CR.flangeR, BELLY.z0, BELLY.z1, { tone: "mid" }, { segments: 16 });
// Struts that carry the belly plate from the bench (stand-ins for the chassis around it).
for (const x of [PLATE.x0 + 6, PLATE.x1 - 14]) box("stand.post", [x, PLATE.y0 + 4, SOIL.z1], [x + 8, PLATE.y0 + 12, BELLY.z0], { tone: "lo" }, { r: 1, meta: { ground: true } });

// ---------------------------------------------------------------- the cartridge (far half)
halfRing("cartridge.flange", D.well.rIn, CR.flangeR, CR.z0, CR.flangeZ1, { tone: "hi" }, { meta: { owner: "cartridge" } });
// The body is cut into bands where the belly plate and the air manifold ring it.
for (const [z0, z1] of [[CR.flangeZ1, BELLY.z1], [BELLY.z1, CR.airZ - 5], [CR.airZ - 5, CR.airZ + 5], [CR.airZ + 5, CR.z1]]) halfRing("cartridge.body", D.well.rIn, D.well.rOut, z0, z1, { tone: "mid" }, { meta: { owner: "cartridge" } });
const MAN = { r0: D.well.rOut, r1: D.well.rOut + 6, z0: CR.airZ - 5, z1: CR.airZ + 5 };
halfRing("air.manifold", MAN.r0, MAN.r1, MAN.z0, MAN.z1, { tone: "hi" }, { meta: { owner: "cartridge" } });
// Brush seal: the far brush of the pair; its bristles meet the near brush (cut away) on the rod line.
// The strip brush is pressed into a slot in the cartridge wall, so it is owned by the cartridge.
const BR = { x: 14, y0: -24, y1: -PR.needleR - 0.1, z0: CR.brushZ[0], z1: CR.brushZ[1] };
box("brush.holder", [-BR.x, -27, BR.z0 - 1], [BR.x, BR.y0, BR.z1 + 1], { tone: "mid" }, { r: 0.6, meta: { owner: "cartridge" } });
{
  const lines = [];
  for (let x = -BR.x + 2; x <= BR.x - 2; x += 2) lines.push(path3([[x, BR.y0, BR.z1], [x, BR.y1, BR.z1]]));
  box("brush.bristles", [-BR.x, BR.y0, BR.z0], [BR.x, BR.y1, BR.z1], { tone: "lo" }, { r: 0.2, steps: 1, extra: Ln(lines.join(""), { tone: "faint" }), meta: { owner: "cartridge" } });
}
// Air-knife nozzles on the far half of the bore, aimed down at the parked rods.
// Six nozzles at 60 degree spacing; the three on the far half show in the section.
const NOZZLES = [210, 270, 330].map((deg) => (deg * Math.PI) / 180);
for (const a of NOZZLES) {
  const r = D.well.rIn - 2;
  const F = G.frameAlong([Math.cos(a) * D.well.rIn, Math.sin(a) * D.well.rIn, CR.airZ], [-Math.cos(a), -Math.sin(a), 0]);
  const shape = record(A.disc(F, 0, 2, 1.8, { name: "air.nozzle" }));
  put("air.nozzle", [Math.cos(a) * r, Math.sin(a) * r, CR.airZ], S(G.disc(0, 2, 1.8, F, P, { steps: 16 }), { tone: "hi" }), [shape], { bias: 0.2 });
}
// Pump line: a 12 V diaphragm pump on the belly plate (inside the chassis) feeds a barb on the manifold.
const BA = (225 * Math.PI) / 180;
const BAXIS = [Math.cos(BA), Math.sin(BA), 0];
const BARB = [Math.cos(BA) * MAN.r1, Math.sin(BA) * MAN.r1, CR.airZ];
{
  const F = G.frameAlong(BARB, BAXIS);
  const shape = record(A.disc(F, 0, 6, 2.6, { name: "air.barb", owner: "cartridge" }));
  put("air.barb", G.add3(BARB, G.mul3(BAXIS, 3)), S(G.disc(0, 6, 2.6, F, P, { steps: 20 }), { tone: "mid" }), [shape]);
}
const PUMP = { x0: -86, x1: -58, y0: -64, y1: -42, z0: BELLY.z1, z1: BELLY.z1 + 20 };
box("pump.body", [PUMP.x0, PUMP.y0, PUMP.z0], [PUMP.x1, PUMP.y1, PUMP.z1], { tone: "mid" }, { r: 2.4, steps: 3, bevel: 0.5, extra: Dots([at([PUMP.x0 + 4, PUMP.y1, PUMP.z1 - 4]), at([PUMP.x1 - 4, PUMP.y1, PUMP.z1 - 4])], { size: 0.45 }) });
{
  const PX = (PUMP.x0 + PUMP.x1) / 2;
  const PYc = (PUMP.y0 + PUMP.y1) / 2;
  const F = frameZ(PX, PYc, PUMP.z1);
  const shape = record(A.disc(F, 0, 4, 4, { name: "pump.port" }));
  put("pump.port", [PX, PYc, PUMP.z1 + 2], S(G.disc(0, 4, 4, F, P, { steps: 24 }), { tone: "hi" }), [shape]);
  const start = [PX, PYc, PUMP.z1 + 4];
  const end = G.add3(BARB, G.mul3(BAXIS, 6));
  const turn = G.add3(end, G.mul3(BAXIS, 14));
  const route = G.fillet([start, [PX, PYc, CR.airZ + 18], [turn[0], turn[1], CR.airZ + 18], turn, end], 7, 10, { P, tube: 2.2 });
  R.route("air.line", route, 2.2, { limp: true, piece: "cartridge" });
  tubePieces(route, 2.2, P, { maxLength: 20 }).forEach((piece, index) => put(`air.line:${index}`, piece.mid, tubeSvg(piece, { tone: "mid" }), [A.tube(piece.points, piece.radii)], { bias: 0.05 }));
}

// ---------------------------------------------------------------- the probe (moves) and the crumbs
const travel = POSE >= 0 ? POSE : 0;
function probeSvg(t) {
  const root = M.NEEDLE_ROOT0 - t;
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
  if (root + PR.headL < SHOW_TOP) {
    parts.unshift(S(G.disc(root + PR.headL, SHOW_TOP, PR.extR, F, P, { steps: 32 }), { tone: "hi" }));
    shapes.push(A.disc(F, root + PR.headL, SHOW_TOP, PR.extR, { name: "probe.ext", ground: true }));
  }
  return { svg: parts.join(""), shapes, root };
}
const pr = probeSvg(travel);
// Clip the column to the shown height (the rest of the tower is in Fig 1).
const cutY = at([0, 0, SHOW_TOP])[1];
const probeGroup = `<g data-part="probe"><clipPath id="cl-top"><path data-hold d="M-1000 ${cutY.toFixed(2)}H3000V3000H-1000Z"/></clipPath><g clip-path="url(#cl-top)">${pr.svg}</g></g>`;
put("probe", [0, 0, pr.root], probeGroup, pr.shapes.map(record), { bias: 5 });
put("crumbs", [0, -3, 40], `<g data-part="crumbs"></g><g data-part="fallen"></g>`, [record(A.box([-14, -4.6, 0], [14, -1.7, 2], { name: "crumbs", ground: true }))], { bias: 6 });
put("jets", [0, -15, CR.airZ], `<g data-part="jets"></g>`, [record(A.box([-10, -20, CR.brushZ[1] + 2], [10, -3, CR.airZ - 1], { name: "jets", ground: true }))], { bias: 7 });

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const MATERIAL = [[/^soil/, "rv-soil"], [/^brush\.bristles/, "rv-rubber"], [/^air\.line/, "rv-rubber"]];
const materialOf = (name) => (MATERIAL.find(([re]) => re.test(name)) ?? [null, ""])[1];
const groups = R.items.map((item) => `<g class="it${materialOf(item.name) ? " " + materialOf(item.name) : ""}" data-name="${item.name}">${item.svg}</g>`).join("");

// Crumbs of soil stuck to the far side of each rod, by distance from the tip (mm) and radius.
const CRUMBS = PR.needleX.flatMap((x, i) => [6, 17, 29, 41, 53].map((s, j) => ({ x: x + (j % 2 ? 0.6 : -0.6), s: s + i * 2, r: 1.1 + ((i + j) % 3) * 0.35 })));
const C = M.cycle();
const DATA = {
  P,
  tip0: PR.tip0,
  stroke: M.STROKE,
  speed: M.SPEED,
  cycle: C,
  depth: PR.depth,
  needleR: PR.needleR,
  brush: CR.brushZ,
  airZ: CR.airZ,
  rIn: D.well.rIn,
  nozzles: NOZZLES,
  needleX: PR.needleX,
  crumbs: CRUMBS,
  clean: M.CLEAN.airMax,
  playback: 1.5,
  scale: KS,
};
const LIVE = readFileSync(join(HERE, "cleaning-live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const CSS = `
.iso .rv-void { fill: var(--anatomy-shade-0); stroke: none; }
.iso [data-part="jets"] .iso-line { stroke-dasharray: 2.2 2; animation: rv-flow 0.4s linear infinite; }
@keyframes rv-flow { to { stroke-dashoffset: -4.2; } }
@media (prefers-reduced-motion: reduce) { .iso [data-part="jets"] .iso-line { animation: none; } }
.iso .rv-soil { --anatomy-paper: #d8d2c6; --anatomy-face: #ddd7cb; --anatomy-top: #e3ddd1; --anatomy-shade-0: #b8b1a4; --anatomy-shade-1: #c2bbae; --anatomy-shade-2: #ccc5b8; --anatomy-shade-3: #d5cec1; --anatomy-lo: #988f82; --anatomy-faint: #b9b1a4; --anatomy-mid: #7c7468; }
.iso .rv-rubber { --anatomy-paper: #c9c9c9; --anatomy-face: #d2d2d2; --anatomy-top: #d6d6d6; --anatomy-shade-0: #a7a7a7; --anatomy-shade-1: #b2b2b2; --anatomy-shade-2: #bcbcbc; --anatomy-shade-3: #c5c5c5; --anatomy-lo: #8c8c8c; --anatomy-faint: #a9a9a9; }
.iso:not([data-theme="light"]) .rv-soil { --anatomy-paper: #1f1b16; --anatomy-face: #25211b; --anatomy-top: #29241e; --anatomy-shade-0: #16130f; --anatomy-shade-1: #1a1712; --anatomy-shade-2: #1e1a15; --anatomy-shade-3: #221e18; --anatomy-lo: #4a4238; --anatomy-faint: #332d26; --anatomy-mid: #6c6255; }
.iso:not([data-theme="light"]) .rv-rubber { --anatomy-paper: #0d0d0d; --anatomy-face: #111; --anatomy-top: #141414; --anatomy-shade-0: #080808; --anatomy-shade-1: #0b0b0b; --anatomy-shade-2: #0e0e0e; --anatomy-shade-3: #111; --anatomy-lo: #2e2e2e; --anatomy-faint: #222; }
.iso .cl-crumb { fill: #8a7a62; } .iso:not([data-theme="light"]) .cl-crumb { fill: #6b5a44; }
`;
const svg = k.figureSvg({
  width: W,
  height: H,
  label: "The probe's cleaning cartridge, cut in half on the line of the three rods, mounted in the chassis belly above a block of soil. The far brush of the brush seal sits at the well mouth, an air-knife ring with three of its six nozzles in view sits above it, fed by a tube from a small pump, and a bayonet flange holds the cartridge in the belly. The probe pushes its rods through the bristles into the soil, and on the way back up the bristles scrape off the soil crumbs, which drop back onto the soil; then the nozzles blow the parked rods dry.",
  body: [...back, `<g class="cl-fig">${groups}</g>`],
});
const body =
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 2",
    title: "Self-cleaning probe cartridge",
    hint: "Space: probe cycle · ↑ ↓ or hover: probe",
    readout: "parked · rods clean",
    keys: [
      { mark: "lit", label: "Probe rods: soil sticks to them on the way out" },
      { mark: "raised", label: "Brush seal and air-knife ring: wipe, then blow dry" },
      { mark: "edge", label: "Air line from the 12 V pump in the chassis" },
    ],
    caption: `Soil left on the rods would sit in the most sensitive part of the probe's field at the next spot and bias the reading, so every cycle cleans the rods before the rover moves on. Two nylon strip brushes meet on the rod line at the well mouth (the near one is cut away here): the probe head pushes them apart, and the rods are scraped on every pass, so crumbs fall back where they came from. With the rods parked inside the ring, six nozzles (three shown) blow them dry for ${M.SPEED.blast} s; air leaves no wet film, unlike a rinse. The probe then reads in air and must be within ${M.CLEAN.airMax} m³/m³ of its clean baseline, or it strokes through the brushes again without touching soil and repeats the blast; after ${M.CLEAN.retries} retries the next reading is flagged. The cartridge drops out of the belly on a bayonet for washing. Cycle ${C.t6.toFixed(1)} s, played ${DATA.playback}× fast; the crumbs are illustrative.`,
    body: `<div class="iso-stage cl-stage" tabindex="0" role="slider" aria-label="Probe cleaning cartridge. Space runs a probe cycle; up and down arrows move the probe; Home parks it." aria-valuemin="0" aria-valuemax="${PR.depth}" aria-valuenow="0" aria-valuetext="Parked, rods clean">${svg}</div>`,
  });
const page = k.pageHtml({ title: "AgriRover probe cleaning", theme: THEME, body, script: kitScript() + LIVE, width: 650 });
if (POSE < 0) {
  const name = THEME === "light" ? "probe-cleaning-light.html" : "probe-cleaning.html";
  writeFileSync(join(HERE, name), page);
  console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`);
}
A.auditOrExit(R, P, {});
