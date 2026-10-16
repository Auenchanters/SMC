// AgriRover v2 anatomy figure (Fig 1), built with the Anatomy skill kit (MIT, github.com/wheresryan22/anatomy).
//   node hardware/rover-v2/anatomy/build.mjs [--light] [--audit] [--rest-order] [--pose=<mm>] [--rail=<mm>] [--twist=<mm>]
// Writes rover-anatomy.html (dark) or rover-anatomy-light.html next to this file. Every dimension
// and every number the page shows comes from ../model.mjs, so the figure, the drawings and
// CALCULATIONS.md agree. Pose flags build the figure in one pose for the audit and write nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as M from "../model.mjs";
import { rockerItems, rockerState } from "./rocker.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = process.env.ANATOMY_DIR ?? join(HERE, "..", "..", "..", ".claude", "skills", "anatomy");
const load = (rel) => import(pathToFileURL(join(SKILL, rel)).href);
const k = await load("kit/iso-kit.mjs");
const G = await load("kit/lathe.mjs");
const { tubePieces, tubeSvg } = await load("kit/tube.mjs");
const A = await load("kit/audit.mjs");
const { kitScript } = await load("scripts/inline-kit.mjs");

const THEME = process.argv.includes("--light") ? "light" : "dark";
const flag = (name) => Number((process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=-1`).split("=")[1]);
const POSE = flag("pose"); // probe travel, mm
const RAIL = flag("rail"); // probe module's sideways offset on the rail, mm (negative: toward the far side)
const TWIST = flag("twist"); // lift under the front-left and rear-right wheels, mm
const POSED = POSE >= 0 || RAIL !== -1 || TWIST >= 0;
const D = M.DIM;

const W = 660;
const H = 600;
const TRAY = { x: -330, y: -262, w: 700, d: 524, r: 12 };
const SOIL_Z0 = -100;
const NOTCH = { x0: -50, x1: 50, y0: -1.6 };
const P = k.fitProjection(
  [...k.boxCorners(TRAY, SOIL_Z0 - 22, 12), [D.gnss.x, D.gnss.y, D.gnss.z + 18], [0, 0, D.tower.z1 + 6], [D.lidar.x, 0, D.lidar.z + 30]],
  W,
  H,
  { pad: 22, azimuth: 78, elevation: 32 },
);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const ZUP = [0, 0, 1];
const frameZ = (x, y, z) => G.frameOf([x, y, z], ZUP, [1, 0, 0], [0, 1, 0]);
const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

// The twist pose: everything on the body rides up by bodyZ; the wheels move with their beams.
const LIFT = TWIST >= 0 ? TWIST : 0;
const ST = rockerState(D, M.rockerPose, LIFT);
const REST = rockerState(D, M.rockerPose, 0);
const BZ = ST.bodyZ - REST.bodyZ;

// Each drawn item rides one of these: the static tray, the body (and all it carries), one wheel,
// the probe module on its rail, or the probe on its axis. The page moves every item of a ride together.
const R = A.recorder(P);
const record = R.solid;
const RIDES = {};
// Shapes are given at home; in a pose they are moved with their ride, and recorded unless `solid: false`
// (cable chunks are recorded as routes instead).
function put(name, ref, svg, shapes = [], { bias = 0, ride = "tray", solid = true, ...rest } = {}) {
  const shift = RIDES[ride] ?? [0, 0, 0];
  const moved = shift.some((v) => v !== 0);
  const out = moved ? `<g transform="${k.translateAlong(P, shift)}">${svg}</g>` : svg;
  const posed = moved ? shapes.map((shape) => A.moved(shape, shift)) : shapes;
  if (solid) posed.forEach((shape) => record(shape));
  const item = R.put({ name, at: G.add3(ref, shift), bias, svg: out, shapes: posed, piece: "rover", ...rest });
  item.ride = ride;
  return item;
}
const rec = (shape) => shape;
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.6, steps = 3, bevel = 0, extra = "", inner = "", bias = 0, owner, meta = {}, ride = "body" } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = rec(A.slab(plan, z0, z1 - z0, { name, owner, ...meta }, steps));
  return put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, ride });
}
function post(name, x, y, r, z0, z1, style = {}, { steps = 28, bevel = 0, extra = "", inner = "", bias = 0, owner, ride = "body" } = {}) {
  const shape = rec(A.cylinder(x, y, r, z0, z1 - z0, { name, owner }));
  return put(name, [x, y, (z0 + z1) / 2], S(k.cylinder(x, y, r, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, ride });
}
function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, steps, owner, ref, ride = "body" } = {}) {
  const opts = { ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}) };
  const paths = G.solidOf(profile, F, P, opts);
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const shape = rec(A.solid(F, profile, { name, owner, radius: smooth && smooth.radius ? smooth.radius : null }));
  return put(name, ref ?? G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, ride });
}
const disc = (name, F, s0, s1, r, style = {}, options = {}) => turned(name, F, [[s0, r], [s1, r]], style, options);

const CABLES = [];
function cable(name, points, r, { tone = "mid", bend = 6, touch, ends = [true, true], ride = "body" } = {}) {
  const shift = RIDES[ride] ?? [0, 0, 0];
  const route = G.fillet(points, Math.max(bend, r * 2.6), 10, { P, tube: r });
  R.route(name, route.map((p) => G.add3(p, shift)), r, { limp: true, touch, piece: "rover" });
  CABLES.push(name);
  tubePieces(route, r, P, { maxLength: 18, spacing: Math.max(0.6, Math.min(1.6, r)) }).forEach((piece, index) =>
    put(`${name}:${index}`, piece.mid, tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii)], { bias: 0.05, route: name, chunk: index, ride, solid: false }),
  );
  [0, 1].forEach((i) => {
    if (!ends[i]) return;
    const end = i ? route[route.length - 1] : route[0];
    const size = Math.max(0.5, r * KS * 0.9);
    put(`${name}.end${i}`, end, Dots([at(end)], { size, tone: "hi" }), [A.ball(end, size / KS, { name: `${name}.end${i}`, owner: name })], { bias: 0.2, ride, solid: false });
  });
  return route;
}

// ---------------------------------------------------------------- rides for this pose
const WH = D.wheel;
const CORNERS = [];
for (const sx of [1, -1]) for (const sy of [1, -1]) CORNERS.push({ sx, sy, id: `${sx > 0 ? "f" : "r"}${sy > 0 ? "l" : "r"}` });
const axleOf = (state, c) => (c.sy > 0 ? state.near : state.far)[c.sx > 0 ? "front" : "rear"];
for (const c of CORNERS) {
  const [x0, z0] = axleOf(REST, c);
  const [x1, z1] = axleOf(ST, c);
  RIDES[`wheel.${c.id}`] = [x1 - x0, 0, z1 - z0];
}
RIDES.body = [0, 0, BZ];
const RAIL_Y = RAIL !== -1 ? RAIL : 0;
RIDES.module = [0, RAIL_Y, BZ];

// ---------------------------------------------------------------- soil tray (the bench)
const back = [`<path class="iso-halo" d="${k.haloOf(TRAY, SOIL_Z0 - 22, 30, P)}"/>`];
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
for (const [x, y] of byDepth(k.corners(TRAY, 30))) {
  back.push(S(k.cylinder(x, y, 13, SOIL_Z0 - 22, 3, P, 32), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 10, SOIL_Z0 - 19, 9, P, 32), { tone: "mid" }));
}
back.push(S(k.slabOf(TRAY, SOIL_Z0 - 10, 10, P, 8, 1.2), { tone: "lo", inner: Ln(k.sideSeam(TRAY, SOIL_Z0 - 5, P, 8), { tone: "faint" }) }));
record(A.slab(TRAY, SOIL_Z0 - 10, 10, { name: "stand.tray.floor", ground: true }, 8));
const WT = 8;
const LIP = 12;
const IN = { x0: TRAY.x + WT, x1: TRAY.x + TRAY.w - WT, y0: TRAY.y + WT, y1: TRAY.y + TRAY.d - WT };
const wall = (name, a, b, extra = "") => box(name, a, b, { tone: "mid" }, { r: 1, steps: 2, bevel: 0.5, extra, meta: { ground: true }, ride: "tray" });
wall("stand.wall.far", [TRAY.x, TRAY.y, SOIL_Z0], [TRAY.x + TRAY.w, IN.y0, LIP]);
wall("stand.wall.left", [TRAY.x, IN.y0, SOIL_Z0], [IN.x0, IN.y1, LIP]);
wall("stand.wall.right", [IN.x1, IN.y0, SOIL_Z0], [TRAY.x + TRAY.w, IN.y1, LIP]);
{
  const STRIP = { x: IN.x0 + 12, y: IN.y1 + 1, w: NOTCH.x0 - IN.x0 - 30, d: 6, r: 0.8 };
  const t = k.topTicks(STRIP.x + 2, STRIP.x + STRIP.w - 2, 10, 5, STRIP.y, LIP + 0.6, [2, 3.6], P);
  const strip = S(k.slabOf(STRIP, LIP, 0.6, P, 2), { tone: "lo", crease: "none" }) + Ln(t.minor, { tone: "lo" }) + Ln(t.major, { tone: "mid" });
  wall("stand.wall.near.left", [IN.x0, IN.y1, SOIL_Z0], [NOTCH.x0, TRAY.y + TRAY.d, LIP], strip);
}
{
  const LP = { x: NOTCH.x1 + 40, y: IN.y1 + 1.2, w: 46, d: 5.6, r: 0.6 };
  const label = S(k.slabOf(LP, LIP, 0.6, P, 2), { tone: "lo", crease: "none" }) +
    Ln([30, 22, 26].map((w, i) => k.lineOnTop([LP.x + 4, LP.y + 1.4 + i * 1.4], [LP.x + 4 + w, LP.y + 1.4 + i * 1.4], LIP + 0.6, P)).join(""), { tone: "faint", free: true }) +
    Dots([at([LP.x + LP.w - 2.4, LP.y + 2.8, LIP + 0.6])], { size: 0.45 });
  wall("stand.wall.near.right", [NOTCH.x1, IN.y1, SOIL_Z0], [IN.x1, TRAY.y + TRAY.d, LIP], label);
}
const RIB_Z = [SOIL_Z0 + 22, -26];
const NEAR_Y = TRAY.y + TRAY.d;
for (const [x0, x1] of [[IN.x0, NOTCH.x0], [NOTCH.x1, IN.x1]]) {
  for (const z of RIB_Z) box("stand.rib", [x0, NEAR_Y, z - 3], [x1, NEAR_Y + 2.4, z + 3], { tone: "mid" }, { r: 0.6, steps: 2, meta: { ground: true }, ride: "tray" });
  const hx = (x0 + x1) / 2;
  for (const dx of [-34, 26]) box("stand.handle.post", [hx + dx, NEAR_Y, -48], [hx + dx + 8, NEAR_Y + 14, -40], { tone: "mid" }, { r: 1, steps: 2, meta: { ground: true }, ride: "tray" });
  disc("stand.handle.bar", G.frameOf([hx - 26, NEAR_Y + 10, -44], [1, 0, 0], [0, 1, 0], [0, 0, 1]), 0, 52, 3.4, { tone: "hi" }, { steps: 20, owner: "stand.handle", ride: "tray" });
  put("stand.rivets", [hx, NEAR_Y, 0], Dots([x0 + 8, x1 - 8].flatMap((x) => [at([x, NEAR_Y, -8]), at([x, NEAR_Y, SOIL_Z0 + 8])]), { size: 0.5 }), [A.box([x0, NEAR_Y, SOIL_Z0], [x1, NEAR_Y + 0.1, 0], { name: "stand.rivets", ground: true })], { bias: 0.3 });
}
for (const z of RIB_Z) box("stand.rib", [TRAY.x + TRAY.w, IN.y0, z - 3], [TRAY.x + TRAY.w + 2.4, IN.y1, z + 3], { tone: "mid" }, { r: 0.6, steps: 2, meta: { ground: true }, ride: "tray" });

// Screen region above the near half of a horizontal circle (and everything inside it): what a pocket's rim lets show.
function aboveRim(cx, cy, r, z) {
  const ring = Array.from({ length: 96 }, (_, i) => at([cx + Math.cos((i / 96) * Math.PI * 2) * r, cy + Math.sin((i / 96) * Math.PI * 2) * r, z]));
  let li = 0;
  let ri = 0;
  ring.forEach((p, i) => { if (p[0] < ring[li][0]) li = i; if (p[0] > ring[ri][0]) ri = i; });
  const walk = (from, to) => { const out = []; for (let i = from; ; i = (i + 1) % ring.length) { out.push(ring[i]); if (i === to) break; } return out; };
  const a = walk(ri, li);
  const b = walk(li, ri).reverse();
  const low = a.reduce((s, p) => s + p[1], 0) / a.length > b.reduce((s, p) => s + p[1], 0) / b.length ? a : b;
  const pts = [[ring[li][0], -2000], [ring[ri][0], -2000], ...(low === a ? a : b)];
  return `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;
}
// Twist pads under the front-left and rear-right wheels: each sits in a pocket in the soil, flush,
// and a ram lifts it like a clod rising under the tyre.
const PAD_R = 46;
const PAD_T = 6;
const PADS = ["fl", "rr"].map((id) => CORNERS.find((c) => c.id === id)).map((c) => ({ ...c, x: (c.sx * WH.base) / 2, y: (c.sy * WH.track) / 2 }));
const pocket = (pad) => A.cylinder(pad.x, pad.y, PAD_R + 0.5, -PAD_T - 0.01, PAD_T + 1, { name: `pad.${pad.id}.pocket` });
const padOf = (y) => PADS.find((pad) => (pad.y > 0) === (y > 0));
// The pocket shows as a dark disc on the soil once its pad rises out of it.
const pocketSvg = (pad) => `<path class="rv-void" d="${k.ring(pad.x, pad.y, PAD_R + 0.5, 0, P, 72)}"/>` + Ln(k.ring(pad.x, pad.y, PAD_R + 0.5, 0, P, 72), { tone: "lo" });

// Soil: three blocks around the cutaway notch. The notch's back face is the plane the probe enters.
const STONES = [[-30, -16], [24, -38], [-6, -70], [36, -90], [-24, -94], [10, -48], [42, -12]];
const soilFace = (x0, x1) => Ln([-22, -52, -84].map((z) => path3([[x0, NOTCH.y0, z], [x1, NOTCH.y0, z]])).join(""), { tone: "faint" });
box("soil.back", [IN.x0, IN.y0, SOIL_Z0], [IN.x1, NOTCH.y0, 0], { tone: "lo", crease: "faint" }, {
  r: 0.4, steps: 2, meta: { ground: true, cut: [pocket(padOf(-1))] }, ride: "tray",
  extra: soilFace(NOTCH.x0, NOTCH.x1) + Dots(STONES.map(([x, z]) => at([x, NOTCH.y0, z])), { size: 0.7, tone: "lo" }) + pocketSvg(padOf(-1)),
});
box("soil.left", [IN.x0, NOTCH.y0, SOIL_Z0], [NOTCH.x0, IN.y1, 0], { tone: "lo", crease: "faint" }, {
  r: 0.4, steps: 2, meta: { ground: true }, ride: "tray",
  extra: Ln([-22, -52, -84].map((z) => path3([[NOTCH.x0, NOTCH.y0, z], [NOTCH.x0, IN.y1, z]])).join(""), { tone: "faint" }),
});
box("soil.right", [NOTCH.x1, NOTCH.y0, SOIL_Z0], [IN.x1, IN.y1, 0], { tone: "lo", crease: "faint" }, { r: 0.4, steps: 2, meta: { ground: true, cut: [pocket(padOf(1))] }, ride: "tray", extra: pocketSvg(padOf(1)) });
{
  const x0 = -44;
  const x1 = -34;
  const ticks = [];
  const major = [];
  for (let z = 0; z >= -90; z -= 10) (z % 50 === 0 ? major : ticks).push(path3([[x1, NOTCH.y0 + 0.8, z], [x1 - (z % 50 === 0 ? 6 : 3.4), NOTCH.y0 + 0.8, z]]));
  box("gauge.strip", [x0, NOTCH.y0, -94], [x1, NOTCH.y0 + 0.8, 0.6], { tone: "mid" }, {
    r: 0.2, steps: 1, extra: Ln(ticks.join(""), { tone: "lo" }) + Ln(major.join(""), { tone: "hi" }), bias: 0.3, ride: "tray",
  });
}
const CLODS = [[-270, -150, 6], [-240, 60, 4.6], [262, -70, 5.4], [300, 160, 4], [-110, 230, 5], [120, 236, 4.4], [-292, 214, 3.6], [80, -200, 4.2], [236, 30, 5]];
for (const [x, y, r] of CLODS) put("soil.clod", [x, y, r], S(G.sphereOf([x, y, r], r, P, { steps: 24 }), { tone: "lo" }), [A.ball([x, y, r], r, { name: "soil.clod" })], { ride: "tray" });
// Drip tape along the far side, with two emitters and the damp soil under them.
const TAPE_Y = -238;
const TAPE_R = 5;
for (const ex of [-40, 160]) {
  const wet = path3(Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    return [ex + Math.cos(a) * 46, TAPE_Y + Math.sin(a) * 9, 0.05];
  }), true);
  put("soil.damp", [ex, TAPE_Y, 0.02], `<path class="rv-damp" d="${wet}"/>`, [A.box([ex - 46, TAPE_Y - 9, 0], [ex + 46, TAPE_Y + 9, 0.05], { name: "soil.damp", ground: true })], { bias: 0.02 });
}
{
  const route = [[IN.x0, TAPE_Y, TAPE_R], [IN.x1, TAPE_Y, TAPE_R]];
  const EM = [-40, 160];
  const gaps = EM.map((x) => [x - IN.x0 - 7, x - IN.x0 + 7]);
  R.route("drip.tape", route, TAPE_R, { limp: true, gaps, touch: ["soil*", "stand*", "drip.emitter*"], piece: "rover" });
  CABLES.push("drip.tape");
  tubePieces(route, TAPE_R, P, { maxLength: 60, gaps }).forEach((piece, index) =>
    put(`drip.tape:${index}`, piece.mid, tubeSvg(piece, { tone: "lo" }), [A.tube(piece.points, piece.radii)], { bias: 0.05, solid: false }),
  );
  for (const x of EM) disc("drip.emitter", G.frameOf([x, TAPE_Y, TAPE_R], [1, 0, 0], [0, 1, 0], [0, 0, 1]), -7, 7, TAPE_R + 0.4, { tone: "mid" }, { owner: "drip.tape", ride: "tray" });
}
for (const pad of PADS) {
  // The pocket shows as a dark disc once the pad rises out of it; the ram is rebuilt live as it extends.
  // The pocket's near rim hides whatever is below the soil surface: the ram's foot and the parked pad's side.
  const rim = aboveRim(pad.x, pad.y, PAD_R + 0.5, 0);
  // Only the part of the pad above the soil is ever drawn (the rim clip hides the rest), so only that
  // part is recorded; the ram holds it up from the pocket floor, drawn only once it shows.
  const SKIN = 0.4;
  const ramSvg = LIFT - PAD_T > 0.4 ? S(k.cylinder(pad.x, pad.y, 16, -PAD_T, LIFT, P, 40), { tone: "hi" }) : "";
  put(`pad.${pad.id}.ram`, [pad.x, pad.y, (LIFT - SKIN - PAD_T) / 2], `<clipPath id="rv-rim-ram-${pad.id}"><path d="${rim}"/></clipPath><g clip-path="url(#rv-rim-ram-${pad.id})" data-part="ram-${pad.id}">${ramSvg}</g>`,
    [A.cylinder(pad.x, pad.y, 16, -PAD_T, LIFT - SKIN + PAD_T, { name: `pad.${pad.id}.ram`, ground: true })], { bias: 0.1 });
  RIDES[`pad.${pad.id}`] = [0, 0, LIFT];
  const top = 0;
  const bolts = [0, 1, 2, 3].map((i) => [pad.x + Math.cos((i * Math.PI) / 2 + 0.4) * (PAD_R - 10), pad.y + Math.sin((i * Math.PI) / 2 + 0.4) * (PAD_R - 10), top]);
  put(`pad.${pad.id}`, [pad.x, pad.y, -PAD_T / 2], `<clipPath id="rv-rim-${pad.id}"><path data-hold d="${rim}"/></clipPath><g clip-path="url(#rv-rim-${pad.id})">` +
    S(k.cylinder(pad.x, pad.y, PAD_R, -PAD_T, PAD_T, P, 72, 0.6), { tone: "mid", inner: Ln(k.sideArc(pad.x, pad.y, PAD_R, -PAD_T / 2, P, 72), { tone: "faint" }) }) +
      Ln(k.ring(pad.x, pad.y, PAD_R - 18, top, P, 64), { tone: "faint" }) + Dots(k.pointsAt(bolts, P), { size: 0.5 }) + "</g>",
    [A.cylinder(pad.x, pad.y, PAD_R, -SKIN, SKIN, { name: `pad.${pad.id}` })], { ride: `pad.${pad.id}`, bias: 0.2 });
}

// ---------------------------------------------------------------- wheels: pneumatic tyres on hub motors
const tyreA = WH.w / 2;
const tyreR0 = D.hub.r + 4;
const tyreH = WH.r - tyreR0;
const POW = 4;
const tyreRadius = (s) => {
  const u = Math.min(0.9995, Math.abs(s) / tyreA);
  return tyreR0 + tyreH * (1 - u ** POW) ** (1 / POW);
};
const tyreSlope = (s) => {
  const u = Math.min(0.9995, Math.abs(s) / tyreA);
  if (u === 0) return 0;
  return (-Math.sign(s) * tyreH * u ** (POW - 1) * (1 - u ** POW) ** (1 / POW - 1)) / tyreA;
};
const TYRE = Array.from({ length: 29 }, (_, i) => {
  const s = -tyreA + (i / 28) * WH.w;
  return [s, tyreRadius(s), 1];
});
const HUB = D.hub;
for (const c of CORNERS) {
  const ride = `wheel.${c.id}`;
  const owner = `corner.${c.id}`;
  const x = (c.sx * WH.base) / 2;
  const y = (c.sy * WH.track) / 2;
  const F = G.frameOf([x, y, WH.r], [0, c.sy, 0], [1, 0, 0], [0, 0, 1]);
  // Axle stub from the bracket to the motor (the motor cable runs inside it). The far wheels show the
  // motor's inner face, where the stub meets it; the near ones its outer face, with the cover and nut.
  const inner = D.beam.y + D.beam.w / 2 - 2; // the bracket's outer face
  const far = c.sy < 0;
  disc(`axle.${c.id}`, G.frameOf([x, 0, WH.r], [0, c.sy, 0], [1, 0, 0], [0, 0, 1]), inner, Math.abs(y) - tyreA - (far ? 2 : 0), 9, { tone: "hi" }, { owner, ride, steps: 32 });
  const tread = G.ribsOf(F, -16, 16, tyreRadius(16), 46, P, { fade: [0.1, 0.55], seams: true });
  turned(`tyre.${c.id}`, F, TYRE, { tone: "lo" }, { smooth: { slope: tyreSlope, radius: tyreRadius }, owner, ride, extra: k.fadedSvg(tread, { tone: "faint" }) });
  if (far) {
    disc(`motor.rim.${c.id}`, F, -tyreA - 2, -tyreA, HUB.r, { tone: "mid" }, {
      owner, ride, extra: Ln(G.circleOf(F, -tyreA - 2, HUB.r - 5, P, 72), { tone: "faint" }) + Dots(G.dotsOf(F, -tyreA - 2, 30, 6, P, { all: true, phase: 0.3 }), { size: 0.5 }),
    });
    continue;
  }
  disc(`motor.rim.${c.id}`, F, tyreA, tyreA + 3, HUB.r, { tone: "mid" }, { owner, ride, extra: Ln(G.circleOf(F, tyreA + 3, HUB.r - 5, P, 72), { tone: "faint" }) });
  disc(`motor.cover.${c.id}`, F, tyreA + 3, tyreA + 5.4, 46, { tone: "hi" }, {
    owner, ride, extra: Dots(G.dotsOf(F, tyreA + 5.4, 38, 6, P, { all: true, phase: 0.3 }), { size: 0.55, tone: "mid" }) + Ln(G.circleOf(F, tyreA + 5.4, 22, P, 48), { tone: "faint" }),
  });
  disc(`motor.nut.${c.id}`, F, tyreA + 5.4, tyreA + 10.4, 10, { tone: "mid" }, { owner, ride, steps: 6 });
}

// ---------------------------------------------------------------- rocker beams and differential (rebuilt live)
for (const item of rockerItems({ k, G, A }, P, D, ST)) put(item.name, item.at, `<g data-part="${item.name}">${item.svg}</g>`, item.shapes, { ride: "rocker" });

// ---------------------------------------------------------------- body: side plates, cross boxes, pivots
const B = D.body;
for (const sy of [1, -1]) {
  const y0 = sy > 0 ? B.yIn : -B.yOut;
  const y1 = sy > 0 ? B.yOut : -B.yIn;
  const near = sy > 0;
  // Holes save weight where the plate spans the bay; rivets hold the cross boxes; clips carry the lines.
  const holes = near ? [-60, 60].map((x) => path3(Array.from({ length: 33 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    return [x + Math.cos(a) * 18, B.yOut + 0.05, 200 + Math.sin(a) * 18];
  }), true)).join("") : "";
  const rivets = near ? [-165, -105, 105, 165].flatMap((x) => [at([x, B.yOut, 160]), at([x, B.yOut, 240])]) : [];
  box(`body.plate.${near ? "near" : "far"}`, [-B.x, y0, B.z0], [B.x, y1, B.z1], { tone: "mid" }, {
    r: 0.6, steps: 2, bevel: 0.3,
    extra: (near ? `<path class="rv-void" d="${holes}"/>` + Ln(holes, { tone: "lo" }) : "") + Dots(rivets, { size: 0.45 }),
  });
  disc(`pivot.${near ? "near" : "far"}`, G.frameOf([0, 0, D.pivot.z], [0, sy, 0], [1, 0, 0], [0, 0, 1]), B.yOut, D.beam.y - D.beam.w / 2, D.pivot.r, { tone: "hi" }, { steps: 32 });
}
// Front box: two dual BLDC controllers, the cleaning pump and the water tank. Rear box: the battery.
const lid = (x0, x1) => {
  const plan = { x: x0 + 6, y: -B.yIn + 6, w: x1 - x0 - 12, d: 2 * B.yIn - 12, r: 3 };
  return { plan, svg: Ln(k.planOutline(plan, B.z1, P, 4), { tone: "faint" }) + Dots(k.corners(plan, 4).map(([x, y]) => at([x, y, B.z1])), { size: 0.5 }) };
};
{
  const L = lid(D.bay.x, B.x);
  const vents = Array.from({ length: 5 }, (_, i) => k.planOutline({ x: D.bay.x + 14 + i * 9, y: -70, w: 4, d: 40, r: 2 }, B.z1, P, 3)).join("");
  box("box.front", [D.bay.x, -B.yIn, B.z0], [B.x, B.yIn, B.z1], { tone: "mid" }, { r: 1, steps: 2, bevel: 0.4, extra: L.svg + Ln(vents, { tone: "lo" }) });
}
box("box.rear", [-B.x, -B.yIn, B.z0], [-D.bay.x, B.yIn, B.z1], { tone: "mid" }, { r: 1, steps: 2 });
{
  const K = D.deck;
  const plan = { x: K.x0, y: -B.yOut, w: K.x1 - K.x0, d: 2 * B.yOut, r: 2 };
  const screws = [[K.x0 + 5, -B.yOut + 5], [K.x1 - 5, -B.yOut + 5], [K.x0 + 5, B.yOut - 5], [K.x1 - 5, B.yOut - 5]];
  box("deck", [K.x0, -B.yOut, K.z0], [K.x1, B.yOut, K.z1], { tone: "mid" }, { r: 2, steps: 3, bevel: 0.5, extra: Dots(screws.map(([x, y]) => at([x, y, K.z1])), { size: 0.5 }) });
  void plan;
}
// Differential bar pivot: a post on the front box lid with two cheeks and a fore-aft pin through the bar.
{
  const DF = D.diff;
  const top = DF.z - DF.r - 4; // room for the bar to rock
  box("diff.post", [DF.x - DF.pin, -DF.pin, B.z1], [DF.x + DF.pin, DF.pin, top], { tone: "mid" }, { r: 1, steps: 2, bevel: 0.3, owner: "diff", extra: Dots([at([DF.x - DF.pin + 3, DF.pin, B.z1 + 4]), at([DF.x + DF.pin - 3, DF.pin, B.z1 + 4])], { size: 0.4 }) });
  for (const sx of [-1, 1]) box("diff.cheek", [DF.x + sx * (DF.r + 1) - (sx > 0 ? 0 : 3), -DF.pin, top], [DF.x + sx * (DF.r + 1) + (sx > 0 ? 3 : 0), DF.pin, DF.z + 6], { tone: "mid" }, { r: 0.6, steps: 2, owner: "diff" });
  const PF = G.frameOf([DF.x, 0, DF.z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  // Only the pin's ends show, standing out of the cheeks (it runs on through the bar).
  disc("diff.pin", PF, DF.r + 4, DF.r + 6, 3, { tone: "hi" }, { owner: "diff", steps: 20, extra: Dots([at([DF.x + DF.r + 6, 0, DF.z])], { size: 0.5, tone: "mid" }) });
  disc("diff.pin", PF, -DF.r - 6, -DF.r - 4, 3, { tone: "hi" }, { owner: "diff", steps: 20 });
}
// ---------------------------------------------------------------- electronics enclosure, GNSS, e-stop (rear deck)
const E = D.enclosure;
const EZ0 = D.deck.z1;
const EZ1 = EZ0 + E.h;
{
  const plan = { x: E.x0, y: -E.y, w: E.x1 - E.x0, d: 2 * E.y, r: 4 };
  const lidZ = EZ1 - 12;
  const screws = k.corners(plan, 5).map(([x, y]) => at([x, y, EZ1]));
  box("enc.body", [E.x0, -E.y, EZ0], [E.x1, E.y, EZ1], { tone: "hi" }, {
    r: 4, steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(plan, lidZ, P, 4), { tone: "lo" }),
    extra: Dots(screws, { size: 0.5 }) + Ln([[22, 14, 18]].flat().map((w, i) => path3([[E.x1 - 10 - w, E.y + 0.05, lidZ - 12 - i * 5], [E.x1 - 10, E.y + 0.05, lidZ - 12 - i * 5]])).join(""), { tone: "lo", free: true }),
  });
  // M12 connectors on the face toward the bay, and the membrane vent on the near face.
  [[-40, 290], [-14, 290], [12, 290], [38, 290]].forEach(([y, z], i) => {
    const F = G.frameOf([E.x1, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    disc(`enc.m12.${i}`, F, 0, 4, 7.5, { tone: "mid" }, { steps: 6, owner: `enc.m12.${i}` });
    disc(`enc.m12.${i}.plug`, F, 4, 12, 6, { tone: "lo" }, { owner: `enc.m12.${i}`, extra: Ln(G.arcOf(F, 8, 6, P), { tone: "faint" }) });
  });
  const VF = G.frameOf([-120, E.y, 300], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  disc("enc.vent", VF, 0, 3, 8, { tone: "mid" }, { extra: Ln(G.circleOf(VF, 3, 4, P, 32), { tone: "faint" }) });
}
const GN = D.gnss;
post("gnss.foot", GN.x, GN.y, 11, EZ1, EZ1 + 4, { tone: "lo" }, { steps: 32 });
post("gnss.mast", GN.x, GN.y, 6, EZ1 + 4, GN.z, { tone: "mid" }, { steps: 24, inner: Ln(k.sideArc(GN.x, GN.y, 6, EZ1 + 30, P, 24), { tone: "faint" }) });
post("gnss.antenna", GN.x, GN.y, 30, GN.z, GN.z + 18, { tone: "hi" }, {
  steps: 64, bevel: 0.8, extra: Ln(k.ring(GN.x, GN.y, 22, GN.z + 18, P, 64), { tone: "faint" }) + Dots([at([GN.x, GN.y, GN.z + 18])], { size: 0.5 }),
});
{
  const ES = D.estop;
  post("estop.box", ES.x, ES.y, 17, EZ0, EZ0 + 26, { tone: "mid" }, { steps: 40, bevel: 0.4 });
  post("estop.collar", ES.x, ES.y, 12, EZ0 + 26, EZ0 + 31, { tone: "lo" }, { steps: 40 });
  const DOME_H = 10;
  const domeR = (s) => 16 * Math.sqrt(Math.max(0, 1 - (s / DOME_H) ** 2));
  const domeSlope = (s) => (s >= DOME_H ? -1e3 : (-16 * (s / DOME_H ** 2)) / Math.sqrt(Math.max(1e-6, 1 - (s / DOME_H) ** 2)));
  const profile = [[0, 16], ...Array.from({ length: 20 }, (_, i) => { const s = ((i + 1) / 21) * DOME_H; return [s, domeR(s), 1]; }), [DOME_H, 0.4]];
  turned("estop.head", frameZ(ES.x, ES.y, EZ0 + 31), profile, { tone: "hi" }, { smooth: { slope: domeSlope, radius: domeR }, owner: "estop" });
}

// ---------------------------------------------------------------- front: lidar mast, scan beam, camera heads
const LI = D.lidar;
{
  const mx = LI.x;
  box("lidar.foot", [mx - 12, -16, B.z1], [mx + 12, 16, B.z1 + 3], { tone: "lo" }, { r: 1, steps: 2, extra: Dots([at([mx - 8, -12, B.z1 + 3]), at([mx + 8, -12, B.z1 + 3]), at([mx - 8, 12, B.z1 + 3]), at([mx + 8, 12, B.z1 + 3])], { size: 0.4 }) });
  box("lidar.mast", [mx - 2, -12, B.z1 + 3], [mx + 2, 12, LI.z - 3], { tone: "mid" }, { r: 0.6, steps: 2, bevel: 0.3 });
  box("lidar.shelf", [mx - 22, -22, LI.z - 3], [mx + 22, 22, LI.z], { tone: "mid" }, { r: 3, steps: 3 });
  post("lidar.body", mx, 0, LI.s / 2, LI.z, LI.z + 18, { tone: "mid" }, { steps: 56, bevel: 0.5, inner: Ln(k.sideArc(mx, 0, LI.s / 2, LI.z + 6, P, 56), { tone: "faint" }) });
  post("lidar.window", mx, 0, LI.s / 2 - 3, LI.z + 18, LI.z + 26, { tone: "lo" }, { steps: 56 });
  post("lidar.cap", mx, 0, LI.s / 2, LI.z + 26, LI.z + 30, { tone: "hi" }, { steps: 56, bevel: 0.4 });
}
const SC = D.scan;
{
  const plan = { x: SC.x0, y: -SC.y, w: SC.x1 - SC.x0, d: 2 * SC.y, r: 3 };
  box("scan.beam", [SC.x0, -SC.y, SC.z0], [SC.x1, SC.y, SC.z1], { tone: "mid" }, {
    r: 3, steps: 3, bevel: 0.6, inner: Ln(k.sideSeam(plan, SC.z1 - 10, P, 3), { tone: "faint" }),
    extra: Dots([-150, -60, 60, 150].map((y) => at([SC.x1, y, SC.z1 - 5])), { size: 0.45 }),
  });
  for (const sy of [1, -1]) {
    box("scan.strut", [B.x, sy * 70 - 8, 170], [SC.x0, sy * 70 + 8, 186], { tone: "mid" }, { r: 1, steps: 2, bevel: 0.3 });
    // A camera head at each end of the beam, folded up (it drops to under-leaf height when deployed).
    const y0 = sy > 0 ? SC.y - 34 : -SC.y + 8;
    box("scan.head", [SC.x1, y0, SC.z0 + 4], [SC.x1 + 10, y0 + 26, SC.z1 - 4], { tone: "hi" }, { r: 1.6, steps: 2, bevel: 0.3 });
    const LF = G.frameOf([SC.x1 + 10, y0 + 13, (SC.z0 + SC.z1) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    disc("scan.lens", LF, 0, 2.4, 7, { tone: "lo" }, { extra: Ln(G.circleOf(LF, 2.4, 4, P, 32), { tone: "faint" }) + Dots([at(G.add3(LF.o, [2.4, 0, 0]))], { size: 0.5, tone: "hi" }) });
  }
}

// ---------------------------------------------------------------- probe module: rails, sled, linear axis, station, probe
const RL = D.probeRail;
const SL = D.sled;
const TW = D.tower;
const CA = D.carriage;
const STN = D.station;
const PB = D.probe;
const SZ = RL.z + RL.h; // sled underside
const TZ = SZ + SL.h; // the axis stands on the sled's top
const HOLE = STN.bore; // the probe passes the sled through a hole this size
// Rails: fixed to the body, resting on the side plates fore and aft of the probe axis. The front rail
// carries a scale for the sideways offset.
for (const sx of [1, -1]) {
  const x0 = sx * RL.x - RL.w / 2;
  const front = sx > 0;
  const t = front ? k.topTicks(-100, 100, 10, 5, x0 + 0.01, RL.z + RL.h, [2.4, 4.4], P, "y") : null;
  box(`rail.${front ? "front" : "rear"}`, [x0, -B.yOut, RL.z], [x0 + RL.w, B.yOut, RL.z + RL.h], { tone: "mid" }, {
    r: 0.8, steps: 2, bevel: 0.3,
    extra: (t ? Ln(t.minor, { tone: "lo" }) + Ln(t.major, { tone: "hi" }) : "") + Dots([B.yOut - 4, -B.yOut + 4].map((y) => at([x0 + RL.w / 2, y, RL.z + RL.h])), { size: 0.5 }),
  });
}
// The sled: a plate on the rails with a hole for the probe, and a thumb screw at each corner.
{
  const plan = { x: -SL.x, y: -SL.y, w: 2 * SL.x, d: 2 * SL.y, r: 3 };
  const hole = k.ring(0, 0, HOLE, TZ, P, 64);
  const shapes = [[[HOLE, -SL.y], [SL.x, SL.y]], [[-SL.x, -SL.y], [-HOLE, SL.y]], [[-HOLE, HOLE], [HOLE, SL.y]], [[-HOLE, -SL.y], [HOLE, -HOLE]]].map(([[a, b], [c, d]]) =>
    A.slab({ x: a, y: b, w: c - a, d: d - b, r: 0.4 }, SZ, SL.h, { name: "sled" }, 2));
  put("sled", [0, 0, SZ + SL.h / 2], S(k.slabOf(plan, SZ, SL.h, P, 3, 0.4), { tone: "mid" }) + `<path class="rv-void" d="${hole}"/>` + Ln(hole, { tone: "lo" }) +
    Dots(k.corners(plan, 5).map(([x, y]) => at([x, y, TZ])), { size: 0.6, tone: "hi" }), shapes, { ride: "module" });
}
// Linear axis: an aluminium extrusion standing on the sled behind the probe with the belt inside it,
// a top plate with the belt pulley, the stepper beside it near the top, and a bellows below the
// carriage that keeps mud off the belt (rebuilt live as the carriage moves).
const AX = { y0: -TW.y, y1: -TW.y + TW.back, z1: TW.z1 - TW.cap };
const BELLOWS = { x: 14, y0: AX.y1, y1: AX.y1 + 10 };
{
  const face = AX.y1 + 0.05;
  const slots = [-18, 18].map((x) => path3([[x, face, TZ], [x, face, AX.z1]])).join("");
  box("axis", [TW.x0, AX.y0, TZ], [TW.x1, AX.y1, AX.z1], { tone: "mid" }, { r: 0.6, steps: 2, ride: "module", extra: Ln(slots, { tone: "lo" }) });
  const top = { x: TW.x0, y: -TW.y, w: TW.x1 - TW.x0, d: 2 * TW.y, r: 1.5 };
  box("axis.top", [TW.x0, -TW.y, AX.z1], [TW.x1, TW.y, TW.z1], { tone: "mid" }, {
    r: 1.5, steps: 2, bevel: 0.4, ride: "module",
    extra: Dots(k.corners(top, 5).map(([x, y]) => at([x, y, TW.z1])), { size: 0.5 }) + Ln(k.ring(0, AX.y1 + 10, 9, TW.z1, P, 32), { tone: "faint" }),
  });
}
function bellowsSvg(cz) {
  const B2 = BELLOWS;
  const plan = { x: -B2.x, y: B2.y0, w: 2 * B2.x, d: B2.y1 - B2.y0, r: 0.4 };
  const h = cz - TZ;
  const n = Math.max(1, Math.round(h / 6));
  const pleats = Array.from({ length: n - 1 }, (_, i) => k.sideSeam(plan, TZ + ((i + 1) * h) / n, P, 2)).join("");
  return S(k.slabOf(plan, TZ, h, P, 2), { tone: "lo", inner: Ln(pleats, { tone: "faint" }) });
}
{
  const cz = M.CARRIAGE_Z0 - (POSE >= 0 ? POSE : 0);
  put("bellows", [0, (BELLOWS.y0 + BELLOWS.y1) / 2, (TZ + cz) / 2], `<g data-part="bellows">${bellowsSvg(cz)}</g>`,
    [A.slab({ x: -BELLOWS.x, y: BELLOWS.y0, w: 2 * BELLOWS.x, d: BELLOWS.y1 - BELLOWS.y0, r: 0.4 }, TZ, cz - TZ, { name: "bellows", owner: "axis" }, 2)], { ride: "module" });
}
{
  const m = { x0: TW.x1, x1: TW.x1 + 42, y: 21, z0: TW.z1 - 50, z1: TW.z1 - 8 };
  const plan = { x: m.x0, y: -m.y, w: m.x1 - m.x0, d: 2 * m.y, r: 3 };
  box("stepper.cap.low", [m.x0, -m.y, m.z0], [m.x1, m.y, m.z0 + 7], { tone: "mid" }, { r: 3, steps: 3, bevel: 0.4, ride: "module" });
  box("stepper.stack", [m.x0 + 1, -m.y + 1, m.z0 + 7], [m.x1 - 1, m.y - 1, m.z1 - 7], { tone: "lo" }, {
    r: 2, steps: 3, ride: "module", inner: Ln([m.z0 + 13, m.z0 + 19, m.z0 + 25].map((z) => k.sideSeam(k.insetPlan(plan, 1), z, P, 3)).join(""), { tone: "faint" }),
  });
  box("stepper.cap.high", [m.x0, -m.y, m.z1 - 7], [m.x1, m.y, m.z1], { tone: "mid" }, { r: 3, steps: 3, bevel: 0.4, ride: "module", extra: Dots(k.corners(plan, 5).map(([x, y]) => at([x, y, m.z1])), { size: 0.55 }) });
  box("stepper.plug", [m.x1 - 20, m.y, m.z0 + 2], [m.x1 - 8, m.y + 5, m.z0 + 10], { tone: "hi" }, { r: 0.8, steps: 2, ride: "module" });
}
// Cleaning station: hangs from the sled on two hangers, so it rides the rail under the probe.
{
  const RG = { z0: STN.z1 - 15, z1: STN.z1 - 5 };
  const F = frameZ(0, 0, 0);
  const bore = k.ring(0, 0, STN.bore, STN.z1, P, 64);
  // Stacked: the body, the nozzle ring round it, and a top band with the bore.
  put("station", [0, 0, (STN.z0 + RG.z0) / 2], S(k.cylinder(0, 0, STN.r, STN.z0, RG.z0 - STN.z0, P, 72, 0.5), { tone: "mid", inner: Ln(k.sideArc(0, 0, STN.r, STN.z0 + 8, P, 72), { tone: "faint" }) }),
    [A.ring(F, STN.z0, RG.z0, STN.bore, STN.r, { name: "station", owner: "station" })], { ride: "module" });
  put("station.ring", [0, 0, (RG.z0 + RG.z1) / 2], S(k.cylinder(0, 0, STN.r + 6, RG.z0, RG.z1 - RG.z0, P, 72, 0.4), { tone: "hi" }) + Dots(G.dotsOf(F, RG.z1, STN.r + 3, 12, P, { fade: [0.04, 0.42] }), { size: 0.4 }),
    [A.ring(F, RG.z0, RG.z1, STN.bore, STN.r + 6, { name: "station.ring", owner: "station" })], { ride: "module" });
  put("station.top", [0, 0, (RG.z1 + STN.z1) / 2], S(k.cylinder(0, 0, STN.r, RG.z1, STN.z1 - RG.z1, P, 72, 0.4), { tone: "mid" }) + `<path class="rv-void" d="${bore}"/>` + Ln(bore, { tone: "lo" }),
    [A.ring(F, RG.z1, STN.z1, STN.bore, STN.r, { name: "station.top", owner: "station" })], { ride: "module" });
  for (const sx of [1, -1]) {
    const x = sx * STN.hangerX;
    box("station.ear", [sx > 0 ? STN.r - 0.3 : x - 4, -6, RG.z1], [sx > 0 ? x + 4 : -STN.r + 0.3, 6, STN.z1], { tone: "mid" }, { r: 0.4, steps: 2, ride: "module", owner: "station" });
    box("station.hanger", [x - 4, -6, STN.z1], [x + 4, 6, SZ], { tone: "mid" }, { r: 0.6, steps: 2, ride: "module", extra: Dots([at([x, 6, STN.z1 + 5]), at([x, 6, SZ - 5])], { size: 0.45 }) });
  }
}

// ---------------------------------------------------------------- the probe (moves), in three clipped layers
// Top: above the sled, with the carriage; mid: between the sled and the station, and down
// into its bore; low: below the station. Each layer draws the whole probe and its own clip keeps the part
// that shows there, held in the module's frame while the probe moves inside it.
const travel = POSE >= 0 ? POSE : 0;
const FULL = PB.tip0 + PB.depth;
const ROOT0 = PB.tip0 + PB.needleL;
function belowRim(cx, cy, r, z) {
  return aboveRim(cx, cy, r, z).replace(/-2000/g, "4000");
}
const belowLine = (z) => `M-2000 ${at([0, 0, z])[1].toFixed(2)}H4000V4000H-2000Z`;
function probeParts(t, zMin, zMax, layer) {
  const root = ROOT0 - t;
  const head = [root, root + PB.headL];
  const parts = [];
  const shapes = [];
  const span = (a, b) => [Math.max(a, zMin), Math.min(b, zMax)];
  const F = frameZ(0, 0, 0);
  // The carriage and the extension rod it holds the head by.
  const cz = M.CARRIAGE_Z0 - t;
  const car = { x: CA.x0, y: AX.y1, w: CA.x1 - CA.x0, d: CA.y - AX.y1, r: 2 };
  parts.push({ d: k.depthOf([0, 0, cz + CA.h / 2], P), svg: S(k.slabOf(car, cz, CA.h, P, 3, 0.4), { tone: "hi" }) + Dots(k.corners(car, 5).map(([x, y]) => at([x, y, cz + CA.h])), { size: 0.5 }) });
  {
    const [a, b] = span(cz, cz + CA.h);
    if (b - a > 0.2) shapes.push(A.slab(car, a, b - a, { name: `probe.${layer}.carriage` }, 3));
  }
  parts.push({ d: k.depthOf([0, 0, (head[1] + cz) / 2], P), svg: S(G.disc(head[1], cz, PB.extR, F, P, { steps: 32 }), { tone: "hi", inner: Ln(G.arcOf(F, cz - 12, PB.extR, P), { tone: "faint" }) }) });
  {
    const [a, b] = span(head[1], cz);
    if (b - a > 0.2) shapes.push(A.disc(F, a, b, PB.extR, { name: `probe.${layer}.ext` }));
  }
  parts.push({ d: k.depthOf([0, 0, (head[0] + head[1]) / 2], P), svg: S(G.disc(head[0], head[1], PB.headR, F, P, { steps: 48 }), { tone: "hi", lit: true, inner: Ln(G.arcOf(F, head[0] + 14, PB.headR, P) + G.arcOf(F, head[0] + 34, PB.headR, P), { tone: "lo" }) }) });
  {
    const [a, b] = span(head[0], head[1]);
    if (b - a > 0.2) shapes.push(A.disc(F, a, b, PB.headR, { name: `probe.${layer}.head` }));
  }
  for (const x of PB.needleX) {
    const tip = root - PB.needleL;
    const NF = frameZ(x, 0, tip);
    const profile = [[0, 0.25], [6, PB.needleR], [PB.needleL, PB.needleR]];
    parts.push({ d: k.depthOf([x, 0, (tip + root) / 2], P), svg: S(G.solidOf(profile, NF, P, { steps: 16 }), { tone: "hi", lit: true }) });
    const [a, b] = span(tip, root);
    if (b - a > 0.2) shapes.push(A.solid(NF, profile.map(([s, r]) => [Math.min(Math.max(s, a - tip), b - tip), r]), { name: `probe.${layer}.needle` }));
  }
  parts.sort((p, q) => p.d - q.d);
  return { svg: parts.map((p) => p.svg).join(""), shapes };
}
// The low layer is empty while the probe is parked, so on the page it keeps the slot the probe has at
// full depth: its order is settled from the probe there (pose audits check every travel against it).
const layerItem = (name, part, zMin, zMax, clips, soil = false) => {
  const pp = probeParts(travel, zMin, zMax, part);
  const standIn = !POSED && !pp.shapes.length;
  if (standIn) pp.shapes = probeParts(FULL, zMin, zMax, part).shapes;
  let inner = `<g data-part="${part}">${pp.svg}</g>`;
  let defs = "";
  clips.forEach((d, i) => {
    const id = `rv-${part}-${i}`;
    defs += `<clipPath id="${id}"><path d="${d}"/></clipPath>`;
    inner = `<g clip-path="url(#${id})">${inner}</g>`;
  });
  if (soil) {
    defs += `<clipPath id="rv-${part}-soil"><path data-hold data-soil d="${soilClip(RAIL_Y)}"/></clipPath>`;
    inner = `<g clip-path="url(#rv-${part}-soil)">${inner}</g>`;
  }
  // A layer with nothing in it yet keeps its slot with a mark on the ground, which it never draws.
  const shapes = pp.shapes.length ? pp.shapes : [A.box([-1, -1, 0], [1, 1, 0.1], { name: `${name}.empty`, ground: true })];
  return put(name, [0, 0, (Math.max(zMin, -60) + Math.min(zMax, TW.z1)) / 2 - travel / 2], defs + inner, shapes, { ride: "module", solid: !standIn });
};
// Where the rail has moved the probe behind the notch, the soil hides the rods below its surface.
function soilClip(y) {
  if (y > NOTCH.y0 - PB.needleR - 0.5) return "M-2000 -2000H4000V4000H-2000Z";
  const a = at([-1000, y, 0]);
  const b = at([1000, y, 0]);
  return `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}L${b[0].toFixed(2)} -2000L${a[0].toFixed(2)} -2000Z`;
}
layerItem("probe.top", "probe-top", TZ, 1000, [aboveRim(0, 0, HOLE, TZ)]);
layerItem("probe.mid", "probe-mid", STN.z1, SZ, [aboveRim(0, 0, STN.bore, STN.z1), belowLine(SZ)]);
// The probe is drawn whole in every layer, so record what each clip hides for the support check too.
for (const [a, b] of [[SZ, TZ], [STN.z0, STN.z1]]) probeParts(travel, a, b, "hidden").shapes.forEach((shape) => record(A.moved(shape, RIDES.module)));
layerItem("probe.low", "probe-low", -1000, STN.z0, [belowRim(0, 0, STN.r, STN.z0)], true);

const TW100 = rockerState(D, M.rockerPose, M.STABILITY.stepMm);
const CAPTION =
  `The body hangs between two rocker beams carrying ${2 * WH.r} mm hub-motor wheels (${WH.base} mm wheelbase, ${WH.track} mm track); a differential bar on the front box makes the body take the mean of the two beams' angles. ` +
  `The pads in the tray lift the front-left and rear-right wheels ${M.STABILITY.stepMm} mm, a twist: the beams turn ${((TW100.near.th * 180) / Math.PI).toFixed(1)}° each way, the bar rocks, and the body stays level, rising ${(TW100.bodyZ - REST.bodyZ).toFixed(0)} mm with all four wheels down (one ${M.STABILITY.stepMm} mm clod alone tilts its beam ${M.STABILITY.beamTiltDeg.toFixed(1)}° and the body ${M.STABILITY.bodyPitchDeg.toFixed(1)}°). ` +
  `The probe works in an open bay between the axles, on the pivot line, where the whole ${M.TOTAL_KG.toFixed(1)} kg holds it down: ${(M.PUSH_SAFETY * M.availableForce(0)).toFixed(0)} N usable push centred, ${(M.PUSH_SAFETY * M.availableForce(RL.y)).toFixed(0)} N with the probe ${RL.y} mm to one side on its rail. ` +
  `A carriage on a ${TW.z1} mm belt-driven axis (as tall as the ${M.STROKE} mm stroke needs, with only the extension rod passing the cleaning station) lowers it at ${M.SPEED.approach} mm/s and pushes it ${PB.depth} mm into the soil at ${M.SPEED.insert} mm/s; the push shown is for dry crust in the placeholder soil model. On the way back up the cleaning station hanging under the sled wipes, brushes and blows the rods (Fig 2). ` +
  `Cycle ${M.cycle().t6.toFixed(1)} s, played 3× fast; the rail shift and the twist run at an illustrative pace. A bellows keeps mud off the belt below the carriage. Design targets, not a built rover.`;

// ---------------------------------------------------------------- order, page
// The page draws in the order settled for the rest pose. Pose audits with --rest-order reuse those keys
// (items are created in the same sequence in every build), so they check the order the page really uses.
const KEYS_FILE = join(tmpdir(), "agrisim-rover-v2-anatomy-keys.json");
const nthNames = () => {
  const seen = {};
  return R.items.map((item) => `${item.name}#${(seen[item.name] = (seen[item.name] ?? 0) + 1)}`);
};
if (process.argv.includes("--rest-order")) {
  const keys = JSON.parse(readFileSync(KEYS_FILE, "utf8"));
  nthNames().forEach((id, i) => {
    if (!(id in keys)) throw new Error(`no rest key for ${id}`);
    R.items[i].key = keys[id];
  });
} else {
  A.settle(R, P);
  if (!POSED) writeFileSync(KEYS_FILE, JSON.stringify(Object.fromEntries(nthNames().map((id, i) => [id, R.items[i].key]))));
}
R.items.sort((a, b) => a.key - b.key);
const MATERIAL = [[/^soil\./, "rv-soil"], [/^(tyre|drip\.tape|lidar\.window|motor\.nut)/, "rv-rubber"]];
const materialOf = (name) => (MATERIAL.find(([re]) => re.test(name)) ?? [null, ""])[1];
const groups = R.items.map((item) => `<g class="it${materialOf(item.name) ? " " + materialOf(item.name) : ""}" data-name="${item.name}" data-ride="${item.ride}">${item.svg}</g>`).join("");

const LABEL_TEXT =
  "AgriRover v2 standing on a soil test tray with a cutaway notch. Each side's two wheels, pneumatic tyres on hub motors, hang from a rocker beam that pivots on the body; a differential bar across the front box links the two beams so the body takes the mean of their angles. Two pads in the tray under the front-left and rear-right wheels rise like clods: the beams tilt opposite ways, the bar rocks, and the body only rises, level, with all four wheels on the ground. Between the front box (motor controllers, pump, water tank) and the rear box (battery and BMS) is an open bay: a probe module rides two sideways rails across it: a carriage on a tall belt-driven axis pushes a three-rod soil probe, on an extension rod, down through a cleaning station hanging below into the soil, and the module can shift sideways to dodge a stone. A white electronics enclosure with a GNSS antenna and an emergency stop sits on the rear deck; a lidar stands on the front box and a scan beam with two folded camera heads runs across the front.";
const svg = k.figureSvg({ width: W, height: H, label: LABEL_TEXT, body: [...back, `<g class="rv-rover">${groups}</g>`] });

const C = M.cycle();
const DATA = {
  P,
  dim: { wheel: D.wheel, pivot: D.pivot, beam: D.beam, diff: D.diff },
  rockerPose: M.rockerPose.toString(),
  rest: REST,
  maxLift: M.STABILITY.stepMm,
  padT: PAD_T,
  pads: PADS.map(({ id, x, y }) => ({ id, x, y })),
  wheels: CORNERS.map((c) => ({ id: c.id, sx: c.sx, sy: c.sy })),
  playback: 3,
  cycle: C,
  speed: M.SPEED,
  tip0: PB.tip0,
  depth: PB.depth,
  needleL: PB.needleL,
  full: FULL,
  stroke: M.STROKE,
  soil: M.SOIL,
  area: PB.needleX.length * Math.PI * PB.needleR ** 2,
  perimeter: PB.needleX.length * 2 * Math.PI * PB.needleR,
  // Usable push (80% of lift-off) at each sideways offset 0..60 mm, from the model.
  usable: Array.from({ length: RL.y + 1 }, (_, y) => M.PUSH_SAFETY * M.availableForce(y)),
  railMax: RL.y,
  station: { z0: STN.z0, z1: STN.z1 },
  axis: { z0: TZ, carriageZ0: M.CARRIAGE_Z0, bellows: BELLOWS },
  notchY0: NOTCH.y0,
  needleR: PB.needleR,
  clean: M.CLEAN.airMax,
};
const strip = (rel) => readFileSync(join(SKILL, rel), "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
const latheScript = `const G = (() => {${strip("kit/lathe.mjs")}\nreturn { frameOf, frameAlong, prismOf, disc, dotsOf, arcOf, circleOf, sphereOf, add3, sub3, mul3, unit3, len3, lerp3 };})();\n`;
const rockerScript = readFileSync(join(HERE, "rocker.mjs"), "utf8").replace(/^export /gm, "");
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const CSS = `
.iso .rv-void { fill: var(--anatomy-shade-0); stroke: none; }
.iso .rv-soil { --anatomy-paper: #d8d2c6; --anatomy-face: #ddd7cb; --anatomy-top: #e3ddd1; --anatomy-shade-0: #b8b1a4; --anatomy-shade-1: #c2bbae; --anatomy-shade-2: #ccc5b8; --anatomy-shade-3: #d5cec1; --anatomy-lo: #988f82; --anatomy-faint: #b9b1a4; --anatomy-mid: #7c7468; }
.iso .rv-rubber { --anatomy-paper: #c9c9c9; --anatomy-face: #d2d2d2; --anatomy-top: #d6d6d6; --anatomy-shade-0: #a7a7a7; --anatomy-shade-1: #b2b2b2; --anatomy-shade-2: #bcbcbc; --anatomy-shade-3: #c5c5c5; --anatomy-lo: #8c8c8c; --anatomy-faint: #a9a9a9; }
.iso:not([data-theme="light"]) .rv-soil { --anatomy-paper: #1f1b16; --anatomy-face: #25211b; --anatomy-top: #29241e; --anatomy-shade-0: #16130f; --anatomy-shade-1: #1a1712; --anatomy-shade-2: #1e1a15; --anatomy-shade-3: #221e18; --anatomy-lo: #4a4238; --anatomy-faint: #332d26; --anatomy-mid: #6c6255; }
.iso:not([data-theme="light"]) .rv-rubber { --anatomy-paper: #0d0d0d; --anatomy-face: #111; --anatomy-top: #141414; --anatomy-shade-0: #080808; --anatomy-shade-1: #0b0b0b; --anatomy-shade-2: #0e0e0e; --anatomy-shade-3: #111; --anatomy-lo: #2e2e2e; --anatomy-faint: #222; }
.iso .rv-damp { fill: var(--anatomy-shade-1); stroke: none; opacity: 0.55; }
`;
const body =
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 1",
    title: "AgriRover v2, probe rover",
    hint: "Space: cycle · R: rail · T: twist · ↑↓: probe",
    readout: "parked · probe up",
    keys: [
      { mark: "lit", label: "Soil probe: the sensing end, in the open bay between the axles" },
      { mark: "raised", label: "Rocker beams and differential bar: all four wheels stay down" },
      { mark: "edge", label: "Probe module on its sideways rail, cleaning station at the bay floor" },
    ],
    caption: CAPTION,
    body: `<div class="iso-stage rv-stage" tabindex="0" role="slider" aria-label="AgriRover v2. Space runs a probe cycle with cleaning; R shifts the probe along its rail; T raises the twist pads under two wheels; up and down arrows move the probe 10 millimetres; Home retracts it; End drives it to full depth." aria-valuemin="0" aria-valuemax="${D.probe.depth}" aria-valuenow="0" aria-valuetext="Parked, probe up">${svg}</div>`,
  });
const page = k.pageHtml({ title: "AgriRover v2 anatomy", theme: THEME, body, script: kitScript() + latheScript + rockerScript + LIVE, width: 720 });
if (!POSED) {
  const name = THEME === "light" ? "rover-anatomy-light.html" : "rover-anatomy.html";
  writeFileSync(join(HERE, name), page);
  console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `${R.solids.length} shapes`, `scale ${KS.toFixed(3)}`, `${CABLES.length} lines`);
}
A.auditOrExit(R, P, {});
