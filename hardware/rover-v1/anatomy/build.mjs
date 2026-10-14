// AgriRover v1 anatomy figure, built with the Anatomy skill kit (MIT, github.com/wheresryan22/anatomy).
//   node hardware/rover-v1/anatomy/build.mjs [--light] [--audit] [--pose=<travel mm>]
// Writes rover-anatomy.html (dark) or rover-anatomy-light.html next to this file.
// Dimensions come from ../model.mjs, so the figure, the drawings and DESIGN.md agree.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const ARM = Number((process.argv.find((a) => a.startsWith("--arm=")) ?? "--arm=-1").slice(6));
const D = M.DIM;

const W = 640;
const H = 560;
const TRAY = { x: -300, y: -235, w: 600, d: 485, r: 12 };
const SOIL_Z0 = -100;
const NOTCH = { x0: -50, x1: 50, y0: -1.6 };
const P = k.fitProjection(
  [...k.boxCorners(TRAY, SOIL_Z0 - 22, 12), [D.tower.screwX, 0, D.tower.top.z1 + D.tower.motor.h], [D.gnss.x, D.gnss.y, D.gnss.top + 18]],
  W,
  H,
  { pad: 26, azimuth: 66, elevation: 28 },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (v) => Math.round(v * 100) / 100;
const ZUP = [0, 0, 1];
const frameZ = (x, y, z) => G.frameOf([x, y, z], ZUP, [1, 0, 0], [0, 1, 0]);

const R = A.recorder(P);
const record = R.solid;
function put(name, ref, svg, shapes = [], { bias = 0, ...rest } = {}) {
  return R.put({ name, at: ref, bias, svg, shapes, piece: "rover", ...rest });
}
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.6, steps = 3, bevel = 0, extra = "", inner = "", bias = 0, owner, meta = {} } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name, owner, ...meta }, steps));
  put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  return shape;
}
function post(name, x, y, r, z0, z1, style = {}, { steps = 28, bevel = 0, extra = "", inner = "", bias = 0, owner } = {}) {
  const shape = record(A.cylinder(x, y, r, z0, z1 - z0, { name, owner }));
  put(name, [x, y, (z0 + z1) / 2], S(k.cylinder(x, y, r, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  return shape;
}
function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, steps, owner, ref } = {}) {
  const opts = { ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}) };
  const paths = G.solidOf(profile, F, P, opts);
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const shape = record(A.solid(F, profile, { name, owner, radius: smooth && smooth.radius ? smooth.radius : null }));
  put(name, ref ?? G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  return shape;
}
const disc = (name, F, s0, s1, r, style = {}, options = {}) => turned(name, F, [[s0, r], [s1, r]], style, options);
function prism(name, F, poly, s0, s1, style = {}, { extra = "", bias = 0, owner } = {}) {
  const shape = record(A.prism(F, poly, s0, s1, { name, owner }));
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const centre = G.add3(G.add3(G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), G.mul3(F.u, cx)), G.mul3(F.v, cy));
  put(name, centre, S(G.prismOf(F, poly, s0, s1, P), { tone: "mid", ...style }) + extra, [shape], { bias });
  return shape;
}
const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
// Shapes of a plate [x0..x1] x [y0..y1] pierced by a square hole of half-width h at the probe axis.
const holed = (name, x0, y0, x1, y1, z0, z1, h, meta = {}) =>
  [[[h, y0], [x1, y1]], [[x0, y0], [-h, y1]], [[-h, h], [h, y1]], [[-h, y0], [h, -h]]].map(([[a, b], [c, d]]) =>
    record(A.slab({ x: a, y: b, w: c - a, d: d - b, r: 0.4 }, z0, z1 - z0, { name, ...meta }, 2)));

const CABLES = [];
function cable(name, points, r, { tone = "mid", bend = 6, touch, ends = [true, true] } = {}) {
  const route = G.fillet(points, Math.max(bend, r * 2.6), 10, { P, tube: r });
  R.route(name, route, r, { limp: true, touch, piece: "rover" });
  CABLES.push(name);
  tubePieces(route, r, P, { maxLength: 18, spacing: Math.max(0.6, Math.min(1.6, r)) }).forEach((piece, index) =>
    put(`${name}:${index}`, piece.mid, tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii)], { bias: 0.05, route: name, chunk: index }),
  );
  [0, 1].forEach((i) => {
    if (!ends[i]) return;
    const end = i ? route[route.length - 1] : route[0];
    const size = Math.max(0.5, r * KS * 0.9);
    put(`${name}.end${i}`, end, Dots([at(end)], { size, tone: "hi" }), [A.ball(end, size / KS, { name: `${name}.end${i}`, owner: name })], { bias: 0.2 });
  });
  return route;
}

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
const wall = (name, a, b, extra = "") => box(name, a, b, { tone: "mid" }, { r: 1, steps: 2, bevel: 0.5, extra, meta: { ground: true } });
wall("stand.wall.far", [TRAY.x, TRAY.y, SOIL_Z0], [TRAY.x + TRAY.w, IN.y0, LIP]);
wall("stand.wall.left", [TRAY.x, IN.y0, SOIL_Z0], [IN.x0, IN.y1, LIP]);
wall("stand.wall.right", [IN.x1, IN.y0, SOIL_Z0], [TRAY.x + TRAY.w, IN.y1, LIP]);
const STRIP = { x: IN.x0 + 12, y: IN.y1 + 1, w: NOTCH.x0 - IN.x0 - 30, d: 6, r: 0.8 };
{
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
  for (const z of RIB_Z) box("stand.rib", [x0, NEAR_Y, z - 3], [x1, NEAR_Y + 2.4, z + 3], { tone: "mid" }, { r: 0.6, steps: 2, meta: { ground: true } });
  const hx = (x0 + x1) / 2;
  for (const dx of [-34, 26]) box("stand.handle.post", [hx + dx, NEAR_Y, -48], [hx + dx + 8, NEAR_Y + 14, -40], { tone: "mid" }, { r: 1, steps: 2, meta: { ground: true } });
  const HF = G.frameOf([hx - 26, NEAR_Y + 10, -44], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  disc("stand.handle.bar", HF, 0, 52, 3.4, { tone: "hi" }, { steps: 20, owner: "stand.handle" });
  put("stand.rivets", [hx, NEAR_Y, 0], Dots([x0 + 8, x1 - 8].flatMap((x) => [at([x, NEAR_Y, -8]), at([x, NEAR_Y, SOIL_Z0 + 8])]), { size: 0.5 }), [record(A.box([x0, NEAR_Y, SOIL_Z0], [x1, NEAR_Y + 0.1, 0], { name: "stand.rivets", ground: true }))], { bias: 0.3 });
}
for (const z of RIB_Z) box("stand.rib", [TRAY.x + TRAY.w, IN.y0, z - 3], [TRAY.x + TRAY.w + 2.4, IN.y1, z + 3], { tone: "mid" }, { r: 0.6, steps: 2, meta: { ground: true } });

// Soil: three blocks around the cutaway notch. The notch's back face is the plane the probe enters.
const soilFace = (x0, x1) => {
  const lines = [-22, -52, -84].map((z) => path3([[x0, NOTCH.y0, z], [x1, NOTCH.y0, z]]));
  return Ln(lines.join(""), { tone: "faint" });
};
const STONES = [[-30, -16], [24, -38], [-6, -70], [36, -90], [-24, -94], [10, -48], [42, -12]];
box("soil.back", [IN.x0, IN.y0, SOIL_Z0], [IN.x1, NOTCH.y0, 0], { tone: "lo", crease: "faint" }, {
  r: 0.4, steps: 2, meta: { ground: true },
  extra: soilFace(NOTCH.x0, NOTCH.x1) + Dots(STONES.map(([x, z]) => at([x, NOTCH.y0, z])), { size: 0.7, tone: "lo" }),
});
box("soil.left", [IN.x0, NOTCH.y0, SOIL_Z0], [NOTCH.x0, IN.y1, 0], { tone: "lo", crease: "faint" }, {
  r: 0.4, steps: 2, meta: { ground: true },
  extra: Ln([-22, -52, -84].map((z) => path3([[NOTCH.x0, NOTCH.y0, z], [NOTCH.x0, IN.y1, z]])).join(""), { tone: "faint" }),
});
box("soil.right", [NOTCH.x1, NOTCH.y0, SOIL_Z0], [IN.x1, IN.y1, 0], { tone: "lo", crease: "faint" }, { r: 0.4, steps: 2, meta: { ground: true } });
// Depth gauge strip on the notch face: a thin plate with ticks every 10 mm from the surface down.
{
  const x0 = -44;
  const x1 = -34;
  const gauge = { x: x0, y: NOTCH.y0, w: x1 - x0, d: 0.8, r: 0.2 };
  const ticks = [];
  const major = [];
  for (let z = 0; z >= -90; z -= 10) (z % 50 === 0 ? major : ticks).push(path3([[x1, NOTCH.y0 + 0.8, z], [x1 - (z % 50 === 0 ? 6 : 3.4), NOTCH.y0 + 0.8, z]]));
  box("gauge.strip", [x0, NOTCH.y0, -94], [x1, NOTCH.y0 + 0.8, 0.6], { tone: "mid" }, {
    r: 0.2, steps: 1, extra: Ln(ticks.join(""), { tone: "lo" }) + Ln(major.join(""), { tone: "hi" }), bias: 0.3,
  });
}
const CLODS = [[-240, -120, 6], [-215, 40, 4.6], [235, -60, 5.4], [255, 150, 4], [-100, 215, 5], [110, 222, 4.4], [-262, 200, 3.6], [80, -160, 4.2]];
for (const [x, y, r] of CLODS) {
  const shape = record(A.ball([x, y, r], r, { name: "soil.clod" }));
  put("soil.clod", [x, y, r], S(G.sphereOf([x, y, r], r, P, { steps: 24 }), { tone: "lo" }), [shape]);
}
// Drip tape along the far side, with two emitters and the damp soil under them.
const TAPE_Y = -216;
const TAPE_R = 5;
for (const ex of [-150, 130]) {
  const wet = path3(Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    return [ex + Math.cos(a) * 46, TAPE_Y + Math.sin(a) * 9, 0.05];
  }), true);
  put("soil.damp", [ex, TAPE_Y, 0.02], `<path class="rv-damp" d="${wet}"/>`, [record(A.box([ex - 46, TAPE_Y - 9, 0], [ex + 46, TAPE_Y + 9, 0.05], { name: "soil.damp", ground: true }))], { bias: 0.02 });
}
{
  const route = [[IN.x0, TAPE_Y, TAPE_R], [IN.x1, TAPE_Y, TAPE_R]];
  const total = IN.x1 - IN.x0;
  const EM = [-150, 130];
  const gaps = EM.map((x) => [x - IN.x0 - 7, x - IN.x0 + 7]);
  R.route("drip.tape", route, TAPE_R, { limp: true, gaps, touch: ["soil*", "stand*", "drip.emitter*"], piece: "rover" });
  CABLES.push("drip.tape");
  tubePieces(route, TAPE_R, P, { maxLength: 60, gaps }).forEach((piece, index) =>
    put(`drip.tape:${index}`, piece.mid, tubeSvg(piece, { tone: "lo" }), [A.tube(piece.points, piece.radii)], { bias: 0.05 }),
  );
  const F = G.frameAlong([0, TAPE_Y, TAPE_R], [1, 0, 0]);
  for (const x of EM) disc("drip.emitter", G.frameOf([x, TAPE_Y, TAPE_R], [1, 0, 0], [0, 1, 0], [0, 0, 1]), -7, 7, TAPE_R + 0.4, { tone: "mid" }, { owner: "drip.tape" });
  void F;
  void total;
}

// ---------------------------------------------------------------- chassis (bought RC platform)
const WH = D.wheel;
const tyreA = WH.w / 2;
const tyreR0 = 52;
const tyreH = WH.r - tyreR0;
const POW = 4;
const tyreRadius = (s) => {
  const u = Math.min(0.9995, Math.abs(s) / tyreA);
  return tyreR0 + tyreH * (1 - u ** POW) ** (1 / POW);
};
const tyreSlope = (s) => {
  const u = Math.min(0.9995, Math.abs(s) / tyreA);
  if (u === 0) return 0;
  return -Math.sign(s) * tyreH * u ** (POW - 1) * (1 - u ** POW) ** (1 / POW - 1) / tyreA;
};
const TYRE = Array.from({ length: 29 }, (_, i) => {
  const s = -tyreA + (i / 28) * WH.w;
  return [s, tyreRadius(s), 1];
});
const CORNERS = [];
for (const sx of [1, -1]) for (const sy of [1, -1]) CORNERS.push({ sx, sy, x: (sx * WH.base) / 2, y: (sy * WH.track) / 2, id: `${sx > 0 ? "f" : "r"}${sy > 0 ? "l" : "r"}` });
for (const c of CORNERS) {
  const owner = `corner.${c.id}`;
  const F = G.frameOf([c.x, c.y, WH.r], [0, c.sy, 0], [1, 0, 0], [0, 0, 1]);
  const tread = G.ribsOf(F, -16, 16, tyreRadius(16), 44, P, { fade: [0.1, 0.55], seams: true });
  turned(`tyre.${c.id}`, F, TYRE, { tone: "lo" }, { smooth: { slope: tyreSlope, radius: tyreRadius }, owner, extra: k.fadedSvg(tread, { tone: "faint" }) });
  if (c.sy > 0) {
    disc(`rim.${c.id}`, F, tyreA - 0.5, tyreA + 2.5, 44, { tone: "mid" }, {
      owner,
      extra: Ln(G.circleOf(F, tyreA + 2.5, 36, P, 72), { tone: "faint" }) + Dots(G.dotsOf(F, tyreA + 2.5, 24, 5, P, { all: true }), { size: 0.6, tone: "hi" }),
    });
    disc(`hub.${c.id}`, F, tyreA + 2.5, tyreA + 7, 14, { tone: "mid" }, { owner, extra: Ln(G.circleOf(F, tyreA + 7, 5, P, 24), { tone: "lo" }) });
  }
  const PF = G.frameOf([c.x, 0, WH.r], [0, c.sy, 0], [1, 0, 0], [0, 0, 1]);
  const inner = WH.track / 2 - WH.w / 2;
  disc(`motor.${c.id}`, PF, D.pod.y0, D.pod.y0 + 20, 17, { tone: "mid" }, { owner, inner: Ln(G.arcOf(PF, D.pod.y0 + 6, 17, P), { tone: "faint" }) });
  disc(`gearbox.${c.id}`, PF, D.pod.y0 + 20, inner, D.pod.r, { tone: "mid" }, { owner, extra: Dots(G.dotsOf(PF, D.pod.y0 + 20, 15, 4, P, { fade: [0.04, 0.42] }), { size: 0.45 }) });
  disc(`encoder.${c.id}`, PF, D.pod.y0 - 9, D.pod.y0, 12, { tone: "lo" }, { owner });
  const pivot = [c.sx * 62, c.sy * 123, 114];
  const hub = [c.x, c.sy * 123, WH.r];
  const axis = G.unit3(G.sub3(hub, pivot));
  const AF = G.frameOf(pivot, axis, [0, 1, 0], G.cross3(axis, [0, 1, 0]));
  const armLen = G.len3(G.sub3(hub, pivot)) - D.pod.r - 0.1;
  prism(`arm.${c.id}`, AF, rect(-5, 5, -6, 6), -9, armLen, { tone: "mid" }, { owner });
  box(`pivot.${c.id}`, [c.sx * 62 - 9, c.sy > 0 ? D.tub.y : -118, 104], [c.sx * 62 + 9, c.sy > 0 ? 118 : -D.tub.y, 122], { tone: "mid" }, { owner, r: 1.2, bevel: 0.4 });
  if (c.sy > 0) disc(`pin.${c.id}`, G.frameOf([pivot[0], 0, pivot[2]], [0, 1, 0], [1, 0, 0], [0, 0, 1]), 128, 131, 4.4, { tone: "hi" }, { owner });
}
const T = D.tub;
const TUB = { x: -T.x, y: -T.y, w: 2 * T.x, d: 2 * T.y, r: T.r };
{
  const face = (pts) => path3(pts.map(([x, z]) => [x, T.y + 0.05, z]), true);
  const vents = Array.from({ length: 6 }, (_, i) => face([[100 + i * 11, 118], [105 + i * 11, 118], [105 + i * 11, 150], [100 + i * 11, 150]])).join("");
  const extra = Ln(vents, { tone: "faint" });
  const W2 = D.well.rOut;
  const tubShapes = [[[W2, -T.y], [T.x, T.y]], [[-T.x, -T.y], [-W2, T.y]], [[-W2, W2], [W2, T.y]], [[-W2, -T.y], [W2, -W2]]].map(([[x0, y0], [x1, y1]]) =>
    record(A.slab({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 0.4 }, T.z0, T.z1 - T.z0, { name: "chassis.tub", owner: "chassis.tub" }, 2)));
  put("chassis.tub", [0, 0, (T.z0 + T.z1) / 2], S(k.slabOf(TUB, T.z0, T.z1 - T.z0, P, 8, 1.2), { tone: "mid", inner: Ln(k.sideSeam(TUB, 152, P, 8), { tone: "faint" }) }) + extra, tubShapes, { bias: -2 });
}
// Battery bay: the side hatch is off, so the pack shows through the opening (drawn as a window in the tub face).
{
  const O = { x0: -46, x1: 4, z0: 112, z1: 156 };
  const BACK = T.y - 16;
  const yF = T.y + 0.05;
  const open = path3([[O.x0, yF, O.z0], [O.x1, yF, O.z0], [O.x1, yF, O.z1], [O.x0, yF, O.z1]], true);
  const wallL = path3([[O.x0, yF, O.z0], [O.x0, yF, O.z1], [O.x0, BACK, O.z1], [O.x0, BACK, O.z0]], true);
  const floor = path3([[O.x0, yF, O.z0], [O.x1, yF, O.z0], [O.x1, BACK, O.z0], [O.x0, BACK, O.z0]], true);
  const pack = { x: O.x0 + 4, y: BACK - 44, w: O.x1 - O.x0 - 8, d: 44, r: 3 };
  const packSvg = S(k.slabOf(pack, O.z0, O.z1 - O.z0 - 4, P, 3, 0.6), { tone: "hi" });
  const rules = Ln([22, 14, 18].map((w, i) => path3([[pack.x + 6, BACK + 0.05, O.z1 - 14 - i * 5], [pack.x + 6 + w, BACK + 0.05, O.z1 - 14 - i * 5]])).join(""), { tone: "lo", free: true });
  const plug = S(k.slabOf({ x: pack.x + pack.w - 22, y: BACK, w: 12, d: 6, r: 1 }, O.z0 + 8, 10, P, 2), { tone: "hi" });
  const svgW = `<clipPath id="rv-bay"><path d="${open}"/></clipPath><g clip-path="url(#rv-bay)"><path class="rv-cavity" d="${open}"/>` +
    `<path class="iso-shade" data-shade="1" d="${floor}"/><path class="iso-shade" data-shade="2" d="${wallL}"/>${packSvg}${rules}${plug}</g>` +
    Ln(open, { tone: "lo" }) + Dots([[O.x0 - 4, O.z0 - 4], [O.x1 + 4, O.z0 - 4], [O.x0 - 4, O.z1 + 4], [O.x1 + 4, O.z1 + 4]].map(([x, z]) => at([x, yF, z])), { size: 0.45 });
  put("chassis.battery", [(O.x0 + O.x1) / 2, T.y + 0.1, (O.z0 + O.z1) / 2], svgW, [record(A.box([O.x0, T.y, O.z0], [O.x1, T.y + 1, O.z1], { name: "chassis.battery", owner: "chassis.tub" }))], { bias: 0.5 });
}
box("chassis.switch.plate", [12, T.y, 118], [48, T.y + 1.6, 150], { tone: "lo" }, { r: 1, steps: 2, extra: Dots([at([15, T.y + 1.6, 122]), at([45, T.y + 1.6, 146])], { size: 0.45 }) });
box("chassis.switch", [18, T.y + 1.6, 130], [26, T.y + 6, 140], { tone: "hi" }, { r: 0.8, steps: 2 });
box("chassis.xt60", [32, T.y + 1.6, 126], [42, T.y + 7, 140], { tone: "mid" }, { r: 0.8, steps: 2, extra: Dots([at([37, T.y + 7, 130]), at([37, T.y + 7, 136])], { size: 0.5, tone: "lo" }) });
put("chassis.led", [15.5, T.y + 2.4, 142], Dots([at([15.5, T.y + 2.4, 142])], { size: 0.9, tone: "hi" }), [record(A.ball([15.5, T.y + 2.4, 142], 0.8, { name: "chassis.led" }))], { bias: 0.3 });
{
  const b = D.bumper;
  box("bumper.rear", [-b.x1, -b.y, b.z0], [-b.x0, b.y, b.z1], { tone: "mid" }, { r: 3, steps: 3, bevel: 0.6, owner: "bumper" });
  box("bumper.pad.rear", [-b.x1 - 4, -b.y + 8, b.z0 + 5], [-b.x1, b.y - 8, b.z1 - 5], { tone: "lo" }, { r: 1.4, steps: 2, owner: "bumper" });
  for (const sy of [1, -1]) {
    box("bumper.strut", [-b.x0, sy * 70 - 5, 103], [-T.x, sy * 70 + 5, 113], { tone: "mid" }, { r: 1, steps: 2, owner: "bumper" });
    box("bumper.switch", [-T.x - 10, sy * 70 + (sy > 0 ? 7 : -19), 103], [-T.x, sy * 70 + (sy > 0 ? 19 : -7), 117], { tone: "hi" }, { r: 0.8, steps: 2, owner: "bumper" });
  }
}
// Self-cleaning cartridge: only its bayonet flange shows below the belly (Fig 2 shows it in section).
{
  const CR = D.cartridge;
  const F = frameZ(0, 0, 0);
  const shape = record(A.ring(F, CR.z0, CR.flangeZ1, D.well.rIn, CR.flangeR, { name: "cartridge.flange", owner: "chassis.tub" }));
  put("cartridge.flange", [0, 0, (CR.z0 + CR.flangeZ1) / 2], S(k.cylinder(0, 0, CR.flangeR, CR.z0, CR.flangeZ1 - CR.z0, P, 48, 0.4), { tone: "mid" }) +
    Dots([0, 1, 2].map((i) => at([Math.cos(i * 2.1 + 0.5) * (CR.flangeR - 4), Math.sin(i * 2.1 + 0.5) * (CR.flangeR - 4), CR.flangeZ1])), { size: 0.45 }), [shape]);
}
// Front scan beam: twin telescopic under-leaf camera arms. The left arm is drawn extended and moved live.
const SC = D.scan;
const SXC = (SC.x0 + SC.x1) / 2;
{
  const mouth = (sy) => path3([[SC.x0 + SC.wall, sy * SC.y, SC.z0 + SC.wall], [SC.x1 - SC.wall, sy * SC.y, SC.z0 + SC.wall], [SC.x1 - SC.wall, sy * SC.y, SC.z1 - SC.wall], [SC.x0 + SC.wall, sy * SC.y, SC.z1 - SC.wall]], true);
  const brush = path3([[SC.x0 + SC.wall, SC.y + 0.05, SC.z1 - SC.wall - 3], [SC.x1 - SC.wall, SC.y + 0.05, SC.z1 - SC.wall - 3]]);
  const extra = `<path class="rv-void" d="${mouth(1)}"/>` + Ln(mouth(1), { tone: "lo" }) + Ln(brush, { tone: "lo" }) +
    Dots([-150, -60, 60, 150].map((y) => at([SC.x1, y, SC.z1 - 8])), { size: 0.45 });
  const plan = { x: SC.x0, y: -SC.y, w: SC.x1 - SC.x0, d: 2 * SC.y, r: 3 };
  put("scan.beam", [SXC, 0, (SC.z0 + SC.z1) / 2], S(k.slabOf(plan, SC.z0, SC.z1 - SC.z0, P, 3, 0.6), { tone: "mid", inner: Ln(k.sideSeam(plan, SC.z1 - 10, P, 3), { tone: "faint" }) }) + extra,
    [[SC.x0, SC.x1, SC.z0, SC.z0 + SC.wall], [SC.x0, SC.x1, SC.z1 - SC.wall, SC.z1], [SC.x0, SC.x0 + SC.wall, SC.z0 + SC.wall, SC.z1 - SC.wall], [SC.x1 - SC.wall, SC.x1, SC.z0 + SC.wall, SC.z1 - SC.wall]].map(([x0, x1, z0, z1]) =>
      record(A.slab({ x: x0, y: -SC.y, w: x1 - x0, d: 2 * SC.y, r: 0.4 }, z0, z1 - z0, { name: "scan.beam" }, 2))));
}
box("scan.strip", [SC.x1, -SC.y + 15, SC.z0 + 8], [SC.x1 + SC.strip, SC.y - 15, SC.z1 - 8], { tone: "lo" }, { r: 1.2, steps: 2 });
for (const sy of [1, -1]) {
  box("scan.strut", [T.x, sy * 70 - 8, 84], [SC.x0, sy * 70 + 8, 100], { tone: "mid" }, { r: 1, steps: 2, bevel: 0.3 });
  box("scan.motor", [SXC - 13, sy * 60 - 13, SC.z1], [SXC + 13, sy * 60 + 13, SC.z1 + 20], { tone: "mid" }, {
    r: 2, steps: 3, bevel: 0.4, extra: Dots([[-9, -9], [9, -9], [-9, 9], [9, 9]].map(([u, v]) => at([SXC + u, sy * 60 + v, SC.z1 + 20])), { size: 0.4 }),
  });
}
{
  const F = frameZ(0, 0, 0);
  const shape = record(A.ring(F, T.z1, D.deck.z0, D.well.rIn, D.well.rOut, { name: "well.sleeve" }));
  put("well.sleeve", [0, 0, (T.z1 + D.deck.z0) / 2], S(k.cylinder(0, 0, D.well.rOut, T.z1, D.deck.z0 - T.z1, P, 48), { tone: "lo", inner: Ln(k.sideArc(0, 0, D.well.rOut, T.z1 + 6, P, 48), { tone: "faint" }) }), [shape]);
}
for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => [a * D.standoff.x, b * D.standoff.y])) post("standoff", x, y, D.standoff.r, T.z1, D.deck.z0, { tone: "mid" }, { steps: 6 });

// ---------------------------------------------------------------- module deck
const K = D.deck;
const DECK = { x: -K.x, y: -K.y, w: 2 * K.x, d: 2 * K.y, r: K.r };
{
  const slots = [[-185, -60], [-185, 40], [178, -60], [178, 40]].map(([x, y]) => k.planOutline({ x, y, w: 7, d: 20, r: 3.5 }, K.z1, P, 4)).join("");
  const screws = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => [a * D.standoff.x, b * D.standoff.y]);
  const grid = [];
  for (let x = -175; x <= 175; x += 25) for (let y = -100; y <= 100; y += 25) grid.push(at([x, y, K.z1]));
  const extra = Ln(k.planOutline(k.insetPlan(DECK, 6), K.z1, P, 8), { tone: "faint" }) + Ln(slots, { tone: "lo" }) + Dots(grid, { size: 0.35, tone: "lo" }) +
    Ln(screws.map(([x, y]) => k.ring(x, y, 5, K.z1, P, 20)).join(""), { tone: "lo" }) + Dots(screws.map(([x, y]) => at([x, y, K.z1])), { size: 0.55 });
  put("deck", [0, 0, (K.z0 + K.z1) / 2], S(k.slabOf(DECK, K.z0, K.z1 - K.z0, P, 8, 0.8), { tone: "mid" }) + extra, holed("deck", -K.x, -K.y, K.x, K.y, K.z0, K.z1, K.hole), { bias: -1 });
}
// ---------------------------------------------------------------- probe tower (static parts)
const TW = D.tower;
const BASE = { x: TW.base.x0, y: -TW.base.y, w: TW.base.x1 - TW.base.x0, d: 2 * TW.base.y, r: 4 };
const HOLE_R = 24;
{
  const top = TW.base.z1;
  const hole = k.ring(0, 0, HOLE_R, top, P, 48);
  const extra = `<path class="rv-void" d="${hole}"/>` + Ln(hole, { tone: "lo" }) +
    Ln([TW.rodY, -TW.rodY].map((y) => k.ring(0, y, TW.rodR + 2.4, top, P, 24)).join(""), { tone: "faint" }) +
    Dots(k.corners(BASE, 6).map(([x, y]) => at([x, y, top])), { size: 0.5 });
  put("tower.base", [(TW.base.x0 + TW.base.x1) / 2, 0, (K.z1 + top) / 2], S(k.slabOf(BASE, K.z1, top - K.z1, P, 4, 0.6), { tone: "mid" }) + extra, holed("tower.base", TW.base.x0, -TW.base.y, TW.base.x1, TW.base.y, K.z1, top, HOLE_R));
}
post("tower.bearing", TW.screwX, 0, 9, TW.base.z1, TW.base.z1 + M.BEARING_H, { tone: "mid" }, { steps: 32, extra: Dots([at([TW.screwX - 6, 0, TW.base.z1 + M.BEARING_H]), at([TW.screwX + 6, 0, TW.base.z1 + M.BEARING_H])], { size: 0.45 }) });
const COUPLER_Z0 = TW.top.z0 - 11;
post("tower.coupler", TW.screwX, 0, 10, COUPLER_Z0, TW.top.z0, { tone: "mid" }, {
  steps: 32, inner: Ln(k.sideArc(TW.screwX, 0, 10, COUPLER_Z0 + 6, P, 32), { tone: "faint" }),
  extra: Dots([at([TW.screwX + 7, 7.1, COUPLER_Z0 + 3]), at([TW.screwX + 7, 7.1, COUPLER_Z0 + 9])], { size: 0.45 }),
});
box("tower.top", [TW.base.x0, -TW.base.y, TW.top.z0], [TW.base.x1, TW.base.y, TW.top.z1], { tone: "mid" }, {
  r: 4, steps: 4, bevel: 0.6, extra: Dots(k.corners(BASE, 6).map(([x, y]) => at([x, y, TW.top.z1])), { size: 0.5 }),
});
{
  const m = TW.motor;
  const x0 = TW.screwX - m.s / 2;
  const plan = { x: x0, y: -m.s / 2, w: m.s, d: m.s, r: 3 };
  const z0 = TW.top.z1;
  box("motor.cap.low", [x0, -m.s / 2, z0], [x0 + m.s, m.s / 2, z0 + 8], { tone: "mid" }, { r: 4, steps: 3, bevel: 0.4 });
  box("motor.stack", [x0 + 1, -m.s / 2 + 1, z0 + 8], [x0 + m.s - 1, m.s / 2 - 1, z0 + m.h - 8], { tone: "lo" }, {
    r: 2, steps: 3, inner: Ln([z0 + 14, z0 + 20, z0 + 26].map((z) => k.sideSeam(k.insetPlan(plan, 1), z, P, 3)).join(""), { tone: "faint" }),
  });
  box("motor.cap.high", [x0, -m.s / 2, z0 + m.h - 8], [x0 + m.s, m.s / 2, z0 + m.h], { tone: "mid" }, {
    r: 4, steps: 3, bevel: 0.4, extra: Dots(k.corners(plan, 5).map(([x, y]) => at([x, y, z0 + m.h])), { size: 0.55 }) +
      Ln(k.ring(TW.screwX, 0, 11, z0 + m.h, P, 32), { tone: "faint" }),
  });
  box("motor.plug", [TW.screwX - 8, -m.s / 2 - 6, z0 + 3], [TW.screwX + 8, -m.s / 2, z0 + 11], { tone: "hi" }, { r: 0.8, steps: 2 });
}

// ---------------------------------------------------------------- electronics enclosure (near wall cut away)
const E = D.enclosure;
const EZ = K.z1;
const EF = EZ + E.wall;
box("enc.floor", [E.x0, -E.y, EZ], [E.x1, E.y, EF], { tone: "lo" }, { r: 4, steps: 4 });
const ETOP = EZ + E.h;
box("enc.wall.far", [E.x0, -E.y, EF], [E.x1, -E.y + E.wall, ETOP], { tone: "mid" }, { r: 1, steps: 2, extra: Ln(k.planOutline({ x: E.x0 + 3, y: -E.y + 0.8, w: E.x1 - E.x0 - 6, d: 1.4, r: 0.7 }, ETOP, P, 2), { tone: "faint" }) });
box("enc.wall.back", [E.x0, -E.y + E.wall, EF], [E.x0 + E.wall, E.y - E.wall, ETOP], { tone: "mid" }, { r: 1, steps: 2 });
const ELIP = EF + 16;
box("enc.wall.front", [E.x1 - E.wall, -E.y + E.wall, EF], [E.x1, E.y - E.wall, ELIP], { tone: "mid" }, { r: 0.6, steps: 2 });
box("enc.wall.near", [E.x0, E.y - E.wall, EF], [E.x1 - E.wall, E.y, ELIP], { tone: "mid" }, { r: 0.6, steps: 2 });
const GLANDS = { probe: [E.x0, 0, 232], stepper: [E.x0, -40, 240], gnss: [E.x0, 84, 202], lidar: [E.x1, 40, EF + 8], scan: [E.x1, -40, EF + 8] };
for (const [name, [x, y, z]] of Object.entries(GLANDS)) {
  const out = name === "lidar" || name === "scan" ? 1 : -1;
  const F = G.frameOf([x, y, z], [out, 0, 0], [0, 1, 0], [0, 0, 1]);
  disc(`gland.${name}`, F, 0, 3, 7, { tone: "mid" }, { steps: 6, owner: `gland.${name}` });
  disc(`gland.${name}.nut`, F, 3, 7, 5, { tone: "hi" }, { owner: `gland.${name}` });
}
// Boards inside, on standoffs.
const board = (name, x0, y0, x1, y1, z, style = {}) => {
  for (const [x, y] of [[x0 + 3, y0 + 3], [x1 - 3, y0 + 3], [x0 + 3, y1 - 3], [x1 - 3, y1 - 3]]) post(`${name}.standoff`, x, y, 1.6, EF, z, { tone: "lo" }, { steps: 6 });
  return box(name, [x0, y0, z], [x1, y1, z + 1.6], { tone: "lo", ...style }, { r: 1.5, steps: 2 });
};
const PZ = EF + 6;
board("pi5.pcb", 78, -88, 163, -32, PZ);
box("pi5.cooler", [92, -78, PZ + 1.6], [132, -48, PZ + 9], { tone: "mid" }, {
  r: 1, steps: 2, extra: Ln(k.ring(112, -63, 11, PZ + 9, P, 40), { tone: "lo" }) + Ln(k.ring(112, -63, 4, PZ + 9, P, 20), { tone: "faint" }),
});
box("pi5.usb", [146, -86, PZ + 1.6], [163, -72, PZ + 17.6], { tone: "mid" }, { r: 0.6, steps: 2 });
box("pi5.usb2", [146, -68, PZ + 1.6], [163, -54, PZ + 17.6], { tone: "mid" }, { r: 0.6, steps: 2 });
box("pi5.eth", [144, -50, PZ + 1.6], [163, -34, PZ + 15], { tone: "mid" }, { r: 0.6, steps: 2 });
board("mcu.carrier", 78, -24, 160, 22, PZ);
box("mcu.pico", [84, -14, PZ + 1.6], [135, 7, PZ + 4.6], { tone: "hi" }, { r: 1.2, steps: 2, extra: Dots(Array.from({ length: 10 }, (_, i) => at([87 + i * 5, -12.4, PZ + 4.6])), { size: 0.3, tone: "lo" }) });
box("mcu.tmc2209", [140, -16, PZ + 1.6], [154, 4, PZ + 12], { tone: "mid" }, { r: 0.6, steps: 2, extra: Ln([142.5, 145.5, 148.5, 151.5].map((x) => k.lineOnTop([x, -16], [x, 4], PZ + 12, P)).join(""), { tone: "faint" }) });
box("mcu.rs485", [84, 11, PZ + 1.6], [116, 19, PZ + 4], { tone: "mid" }, { r: 0.6, steps: 2 });
box("mcu.terminals", [122, 11, PZ + 1.6], [156, 19, PZ + 10], { tone: "mid" }, { r: 0.6, steps: 2, extra: Dots([126, 132, 138, 144, 150].map((x) => at([x, 15, PZ + 10])), { size: 0.45, tone: "hi" }) });
board("buck.pcb", 78, 30, 124, 62, PZ - 2);
post("buck.inductor", 92, 46, 8, PZ - 0.4, PZ + 9, { tone: "mid" }, { steps: 32, extra: Ln(k.ring(92, 46, 4, PZ + 9, P, 20), { tone: "faint" }) });
for (const [x, y] of [[112, 39], [112, 53]]) post("buck.cap", x, y, 4.4, PZ - 0.4, PZ + 12, { tone: "hi" }, { steps: 24, extra: Ln(k.lineOnTop([x - 2, y], [x + 2, y], PZ + 12, P), { tone: "lo", free: true }) });
box("fuse.base", [128, 30, EF], [163, 62, EF + 8], { tone: "mid" }, { r: 1, steps: 2 });
for (let i = 0; i < 4; i++) box("fuse.blade", [131.5 + i * 7.6, 40, EF + 8], [135.5 + i * 7.6, 52, EF + 15], { tone: "hi" }, { r: 0.6, steps: 2 });
box("enc.terminals", [E.x0 + E.wall, -70, EF], [E.x0 + E.wall + 9, 64, EF + 10], { tone: "mid" }, {
  r: 0.6, steps: 2, extra: Dots(Array.from({ length: 12 }, (_, i) => at([E.x0 + E.wall + 9, -64 + i * 11.4, EF + 6])), { size: 0.45, tone: "hi" }),
});

// ---------------------------------------------------------------- front lidar, camera, rear GNSS, e-stop, receiver
const L = D.lidar;
const LX = L.x - 8;
const MX = L.mast;
box("lidar.mast", [MX, -14, K.z1 + 3], [MX + 4, 14, L.h0 - 3], { tone: "mid" }, { r: 0.6, steps: 2, bevel: 0.3 });
box("lidar.foot", [MX - 4, -16, K.z1], [MX + 10, 16, K.z1 + 3], { tone: "lo" }, { r: 1, steps: 2, extra: Dots([at([MX + 7, -12, K.z1 + 3]), at([MX + 7, 12, K.z1 + 3])], { size: 0.45 }) });
box("lidar.shelf", [MX, -L.s / 2, L.h0 - 3], [LX + L.s / 2, L.s / 2, L.h0], { tone: "mid" }, { r: 1.5, steps: 3 });
box("lidar.body", [LX - L.s / 2, -L.s / 2, L.h0], [LX + L.s / 2, L.s / 2, L.h0 + L.body], { tone: "mid" }, { r: 5, steps: 4, bevel: 0.6, inner: Ln(k.sideSeam({ x: LX - L.s / 2, y: -L.s / 2, w: L.s, d: L.s, r: 5 }, L.h0 + 6, P, 4), { tone: "faint" }) });
post("lidar.head", LX, 0, 16, L.h0 + L.body, L.h0 + L.body + L.head, { tone: "hi" }, { steps: 48, inner: Ln(k.sideArc(LX, 0, 16, L.h0 + L.body + 5, P, 48) + k.sideArc(LX, 0, 16, L.h0 + L.body + 9, P, 48), { tone: "lo" }) });
box("camera.body", [MX + 4, -12, L.h0 - 28], [MX + 24, 12, L.h0 - 6], { tone: "mid" }, { r: 1.2, steps: 2, bevel: 0.3 });
{
  const CF = G.frameOf([MX + 24, 0, L.h0 - 17], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  disc("camera.lens", CF, 0, 4, 6, { tone: "hi" }, { extra: Ln(G.circleOf(CF, 4, 3, P, 24), { tone: "lo" }) });
}
const GN = D.gnss;
post("gnss.foot", GN.x, GN.y, 11, K.z1, K.z1 + 4, { tone: "lo" }, { steps: 32 });
post("gnss.mast", GN.x, GN.y, 6, K.z1 + 4, GN.top, { tone: "mid" }, { steps: 24, inner: Ln(k.sideArc(GN.x, GN.y, 6, K.z1 + 60, P, 24), { tone: "faint" }) });
post("gnss.antenna", GN.x, GN.y, GN.r, GN.top, GN.top + 12, { tone: "mid" }, {
  steps: 64, bevel: 0.8, extra: Ln(k.ring(GN.x, GN.y, GN.r - 6, GN.top + 12, P, 64), { tone: "faint" }) + Dots([at([GN.x, GN.y, GN.top + 12])], { size: 0.5 }),
});
const ES = D.estop;
box("estop.box", [ES.x - 20, ES.y - 20, K.z1], [ES.x + 20, ES.y + 20, K.z1 + 30], { tone: "mid" }, { r: 3, steps: 3, bevel: 0.5, extra: Dots(k.corners({ x: ES.x - 20, y: ES.y - 20, w: 40, d: 40, r: 3 }, 4).map(([x, y]) => at([x, y, K.z1 + 30])), { size: 0.45 }) });
post("estop.collar", ES.x, ES.y, 12, K.z1 + 30, K.z1 + 36, { tone: "lo" }, { steps: 40 });
{
  const DOME_H = 12;
  const domeR = (s) => 19 * Math.sqrt(Math.max(0, 1 - (s / DOME_H) ** 2));
  const domeSlope = (s) => (s >= DOME_H ? -1e3 : (-19 * (s / DOME_H ** 2)) / Math.sqrt(Math.max(1e-6, 1 - (s / DOME_H) ** 2)));
  const profile = [[0, 19], ...Array.from({ length: 20 }, (_, i) => { const s = ((i + 1) / 21) * DOME_H; return [s, domeR(s), 1]; }), [DOME_H, 0.4]];
  disc("estop.rim", frameZ(ES.x, ES.y, K.z1 + 36), 0, 3, 19, { tone: "hi" }, { owner: "estop" });
  turned("estop.head", frameZ(ES.x, ES.y, K.z1 + 39), profile, { tone: "hi" }, { smooth: { slope: domeSlope, radius: domeR }, owner: "estop" });
}
box("rx.box", [-132, -38, K.z1], [-92, 0, K.z1 + 14], { tone: "mid" }, { r: 2, steps: 3, bevel: 0.4, extra: Dots([-126, -120, -114].map((x) => at([x, -38, K.z1 + 7])), { size: 0.4, tone: "hi" }) });
for (const [x, y] of [[-128, -4], [-96, -34]]) post("rx.whip", x, y, 1.1, K.z1 + 14, K.z1 + 74, { tone: "mid" }, { steps: 12 });

// ---------------------------------------------------------------- fixed cables
const MOTOR_PLUG = [TW.screwX, -TW.motor.s / 2 - 6, TW.top.z1 + 7];
const LANE_Y = GLANDS.stepper[1];
cable("cable.stepper", [MOTOR_PLUG, [TW.screwX, LANE_Y, TW.top.z1 + 7], [40, LANE_Y, TW.top.z1 + 7], [40, LANE_Y, GLANDS.stepper[2]], [GLANDS.stepper[0] - 7, LANE_Y, GLANDS.stepper[2]]], 2.2, { bend: 8, ends: [true, false] });
{
  const F = frameZ(SXC, GLANDS.scan[1], SC.z1);
  disc("scan.gland", F, 0, 3, 6, { tone: "mid" }, { steps: 6, owner: "scan.gland" });
  disc("scan.gland.nut", F, 3, 7, 4.4, { tone: "hi" }, { owner: "scan.gland" });
}
cable("cable.scan", [[SXC, GLANDS.scan[1], SC.z1 + 7], [SXC, GLANDS.scan[1], GLANDS.scan[2]], [GLANDS.scan[0] + 7, GLANDS.scan[1], GLANDS.scan[2]]], 2.4, { bend: 8, ends: [false, false] });
cable("cable.lidar", [[LX + 8, L.s / 2, L.h0 + 8], [LX + 8, 30, L.h0 + 8], [LX + 8, 30, GLANDS.lidar[2]], [LX + 8, GLANDS.lidar[1], GLANDS.lidar[2]], [GLANDS.lidar[0] + 7, GLANDS.lidar[1], GLANDS.lidar[2]]], 2, { bend: 6, ends: [true, false] });
const GNSS_PLUG = [GN.x + 17, GN.y, GN.top];
cable("cable.gnss", [GNSS_PLUG, [GN.x + 17, GN.y, K.z1 + 6], [GN.x + 40, 88, K.z1 + 6], [E.x0 - 26, 88, K.z1 + 6], [E.x0 - 14, 84, GLANDS.gnss[2]], [GLANDS.gnss[0] - 7, GLANDS.gnss[1], GLANDS.gnss[2]]], 2, { bend: 10, touch: ["deck"], ends: [true, false] });

// ---------------------------------------------------------------- the probe (moves)
// Upper layer: everything above the tower base, drawn at `travelUp`, clipped to z above the base top
// (with the hole's near rim). Lower layer: below the sleeve, drawn at `travelLow`, clipped to z < 170.
const PR = D.probe;
const travelUp = POSE >= 0 ? POSE : 0;
const travelLow = POSE >= 0 ? POSE : M.STROKE;
function probeBody(travel, zMin, zMax, layer) {
  const root = M.NEEDLE_ROOT0 - travel;
  const headTop = root + PR.headL;
  const cz = M.CARRIAGE_Z0 - travel;
  const parts = [];
  const shapes = [];
  const clipS = (s0, s1) => [Math.max(s0, zMin), Math.min(s1, zMax)];
  const cylZ = (name, r, z0, z1, style, opt = {}) => {
    const [a, b] = clipS(z0, z1);
    if (b - a < 0.2) return;
    const F = frameZ(0, 0, 0);
    parts.push({ d: k.depthOf([0, 0, (a + b) / 2], P), svg: S(G.disc(z0, z1, r, F, P, { steps: opt.steps ?? 48 }), style) + (opt.extra ?? "") });
    shapes.push(A.disc(F, a, b, r, { name: `probe.${layer}.${name}` }));
  };
  cylZ("ext", PR.extR, headTop, cz, { tone: "hi" }, { steps: 32, extra: Ln(k.sideArc(0, 0, PR.extR, headTop + 30, P, 32), { tone: "faint" }) });
  cylZ("head", PR.headR, root, headTop - 4, { tone: "hi", lit: true }, { extra: Ln(k.sideArc(0, 0, PR.headR, root + 14, P, 48) + k.sideArc(0, 0, PR.headR, root + 30, P, 48), { tone: "lo" }) });
  cylZ("flange", PR.flangeR, headTop - 4, headTop, { tone: "hi", lit: true }, { extra: headTop <= zMax ? Dots(G.dotsOf(frameZ(0, 0, 0), headTop, PR.flangeR - 3.4, 6, P, { all: true }), { size: 0.45 }) : "" });
  const TF = PR.tof;
  const tofPlan = { x: TF.x0, y: TF.y0, w: TF.x1 - TF.x0, d: TF.y1 - TF.y0, r: 1 };
  if (root + TF.h > zMin && root < zMax) {
    const a = Math.max(root, zMin);
    const b = Math.min(root + TF.h, zMax);
    parts.push({ d: k.depthOf([(TF.x0 + TF.x1) / 2, (TF.y0 + TF.y1) / 2, (a + b) / 2], P), svg: S(k.slabOf(tofPlan, a, b - a, P, 2), { tone: "mid" }) });
    shapes.push(A.slab(tofPlan, a, b - a, { name: `probe.${layer}.tof` }, 2));
  }
  for (const x of PR.needleX) {
    const tip = root - PR.needleL;
    const [a, b] = clipS(tip, root);
    if (b - a < 0.2) continue;
    const F = frameZ(x, 0, tip);
    const profile = [[0, 0.25], [6, PR.needleR], [PR.needleL, PR.needleR]];
    parts.push({ d: k.depthOf([x, 0, (a + b) / 2], P), svg: S(G.solidOf(profile, F, P, { steps: 16 }), { tone: "hi", lit: true }) });
    shapes.push(A.solid(F, profile.map(([s, r]) => [Math.min(Math.max(s, a - tip), b - tip), r]), { name: `probe.${layer}.needle` }));
  }
  parts.sort((p, q) => p.d - q.d);
  return { svg: parts.map((p) => p.svg).join(""), shapes, root, cz };
}
function carriage(travel) {
  const cz = M.CARRIAGE_Z0 - travel;
  const C = D.carriage;
  const plan = { x: C.x0, y: -C.y, w: C.x1 - C.x0, d: 2 * C.y, r: 4 };
  const pz0 = cz + 10;
  const pz1 = cz + 18;
  const low = [];
  const high = [];
  const shapes = [];
  const clamp = { x: -13, y: -13, w: 26, d: 26, r: 2 };
  for (const y of [-TW.rodY, TW.rodY]) {
    low.push(S(k.cylinder(0, y, 9.5, cz, pz0 - cz, P, 36, 0.3), { tone: "hi" }) + Ln(k.sideArc(0, y, 9.5, cz + 4, P, 36), { tone: "faint" }));
    high.push(S(k.cylinder(0, y, 9.5, pz1, cz + C.h - pz1, P, 36, 0.4), { tone: "hi" }) + Ln(k.sideArc(0, y, 9.5, cz + C.h - 4, P, 36), { tone: "faint" }));
    shapes.push(A.ring(frameZ(0, y, 0), cz, pz0, TW.rodR, 9.5, { name: "probe.bushing" }), A.ring(frameZ(0, y, 0), pz1, cz + C.h, TW.rodR, 9.5, { name: "probe.bushing" }));
  }
  low.push(S(k.slabOf(clamp, cz, pz0 - cz, P, 3), { tone: "hi" }));
  high.push(S(k.slabOf(clamp, pz1, cz + C.h - pz1, P, 3, 0.4), { tone: "hi" }) + Dots([at([13, 0, cz + 22]), at([13, 0, cz + 25])], { size: 0.4 }));
  shapes.push(A.slab(clamp, cz, pz0 - cz, { name: "probe.clamp" }, 3), A.slab(clamp, pz1, cz + C.h - pz1, { name: "probe.clamp" }, 3));
  low.push(S(k.cylinder(TW.screwX, 0, 7, cz, pz0 - cz, P, 6), { tone: "mid" }));
  high.push(S(k.cylinder(TW.screwX, 0, 11, pz1, 4, P, 36, 0.3), { tone: "mid" }) + Dots([at([TW.screwX - 8, 0, pz1 + 4]), at([TW.screwX + 8, 0, pz1 + 4])], { size: 0.4 }));
  shapes.push(A.cylinder(TW.screwX, 0, 7, cz, pz0 - cz, { name: "probe.nut" }), A.cylinder(TW.screwX, 0, 11, pz1, 4, { name: "probe.nut" }));
  const plate = S(k.slabOf(plan, pz0, pz1 - pz0, P, 4, 0.6), { tone: "hi" }) + Dots(k.corners(plan, 5).map(([x, y]) => at([x, y, pz1])), { size: 0.5 });
  shapes.push(A.slab(plan, pz0, pz1 - pz0, { name: "probe.carriage.plate" }, 4));
  const GF = G.frameOf([C.x1, 0, cz + 14], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const gland = S(G.disc(0, 3, 3.6, GF, P, { steps: 6 }), { tone: "mid" }) + S(G.disc(3, 6, 3, GF, P, { steps: 24 }), { tone: "hi" });
  shapes.push(A.disc(GF, 0, 6, 3.6, { name: "probe.gland" }));
  return { svg: low.join("") + plate + gland + high.join(""), shapes, cz };
}
// Guide rods and lead screw, split where the carriage wraps them (rebuilt live as it moves).
const SCREW_Z0 = TW.base.z1 + M.BEARING_H;
function axisParts(travel) {
  const cz = M.CARRIAGE_Z0 - travel;
  const C = D.carriage;
  const out = [];
  for (const [id, y] of [["far", -TW.rodY], ["near", TW.rodY]]) {
    out.push({ name: `tower.rod.low.${id}`, ref: [0, y, (TW.base.z1 + cz) / 2], svg: S(k.cylinder(0, y, TW.rodR, TW.base.z1, cz - TW.base.z1, P, 28), { tone: "hi", crease: "none" }), shape: A.cylinder(0, y, TW.rodR, TW.base.z1, cz - TW.base.z1, { name: `tower.rod.low.${id}` }) });
    out.push({ name: `tower.rod.high.${id}`, ref: [0, y, (cz + C.h + TW.top.z0) / 2], svg: S(k.cylinder(0, y, TW.rodR, cz + C.h, TW.top.z0 - cz - C.h, P, 28), { tone: "hi", crease: "none" }), shape: A.cylinder(0, y, TW.rodR, cz + C.h, TW.top.z0 - cz - C.h, { name: `tower.rod.high.${id}` }) });
  }
  const screw = (name, z0, z1) => {
    const F = frameZ(TW.screwX, 0, 0);
    const thread = z1 - z0 > 6 ? k.fadedSvg(G.ribsOf(F, z0, z1, TW.screwR, 8, P, { twist: 30 * (z1 - z0) / 180, fade: [0.1, 0.55] }), { tone: "lo" }) : "";
    return { name, ref: [TW.screwX, 0, (z0 + z1) / 2], svg: S(k.cylinder(TW.screwX, 0, TW.screwR, z0, z1 - z0, P, 20), { tone: "mid" }) + thread, shape: A.cylinder(TW.screwX, 0, TW.screwR, z0, z1 - z0, { name }) };
  };
  out.push(screw("tower.screw.low", SCREW_Z0, cz));
  out.push(screw("tower.screw.high", cz + 22, COUPLER_Z0));
  return out;
}
const LOW_TOP = D.cartridge.z0; // the cartridge's bottom face: above it the probe is inside the chassis
const UP_BOTTOM = TW.base.z1;
const up = probeBody(travelUp, UP_BOTTOM, 1000, "up");
const low = probeBody(travelLow, -200, LOW_TOP, "low");
const lowFallback = low.shapes.length === 0;
if (POSE >= 0 && !lowFallback) {
  const root = M.NEEDLE_ROOT0 - POSE;
  const headTop = root + PR.headL;
  const cz = M.CARRIAGE_Z0 - POSE;
  const span = (z0, z1, r, name) => {
    const a = Math.max(z0, LOW_TOP);
    const b = Math.min(z1, UP_BOTTOM);
    if (b - a > 0.1) record(A.disc(frameZ(0, 0, 0), a, b, r, { name }));
  };
  span(root, headTop, PR.headR, "probe.hidden.head");
  span(headTop, cz, PR.extR, "probe.hidden.ext");
  for (const x of PR.needleX) {
    const z0 = Math.max(root - PR.needleL, LOW_TOP);
    const z1 = Math.min(root, UP_BOTTOM);
    if (z1 - z0 > 0.1) record(A.disc(frameZ(x, 0, 0), z0, z1, PR.needleR, { name: "probe.hidden.needle" }));
  }
}
const car = carriage(travelUp);
// Clip for the upper layer: above the chord through the hole's sides, plus the hole itself.
function upperClip() {
  const ring = Array.from({ length: 96 }, (_, i) => at([Math.cos((i / 96) * Math.PI * 2) * (HOLE_R - 0.4), Math.sin((i / 96) * Math.PI * 2) * (HOLE_R - 0.4), UP_BOTTOM]));
  let li = 0;
  let ri = 0;
  ring.forEach((p, i) => { if (p[0] < ring[li][0]) li = i; if (p[0] > ring[ri][0]) ri = i; });
  const near = [];
  for (let i = ri; ; i = (i + 1) % ring.length) {
    near.push(ring[i]);
    if (i === li) break;
    if (near.length > ring.length) break;
  }
  const lowSide = near.reduce((a, p) => a + p[1], 0) / near.length > (ring[li][1] + ring[ri][1]) / 2 ? near : (() => {
    const other = [];
    for (let i = li; ; i = (i + 1) % ring.length) { other.push(ring[i]); if (i === ri) break; }
    return other.reverse();
  })();
  const pts = [[ring[li][0], -2000], [ring[ri][0], -2000], ...lowSide];
  return `M${pts.map(([x, y]) => `${f2(x)} ${f2(y)}`).join("L")}Z`;
}
function lowerClip() {
  const y = at([0, 0, LOW_TOP])[1];
  return `M-2000 ${f2(y)}H4000V4000H-2000Z`;
}
const probeGroup = (part, svg, clipId, clipD) =>
  `<g data-part="${part}"><clipPath id="${clipId}"><path data-hold d="${clipD}"/></clipPath><g clip-path="url(#${clipId})">${svg}</g></g>`;
if (lowFallback) probeBody(travelLow, LOW_TOP, UP_BOTTOM, "low").shapes.forEach((shape) => record(shape));
const lowShapes = low.shapes;
if (!lowFallback || POSE < 0) put("probe.low", [0, 0, 30], probeGroup("probe-low", low.svg, "rv-clip-low", lowerClip()), lowShapes.map(record), { bias: 0 });
put("probe.up", [0, 0, up.root + PR.headL], probeGroup("probe-up", up.svg, "rv-clip-up", upperClip()), up.shapes.map(record), { bias: 0 });
put("probe.carriage", [-8, 0, car.cz + 14], `<g data-part="probe-carriage">${car.svg}</g>`, car.shapes.map(record), { bias: 0 });
for (const part of axisParts(travelUp)) put(part.name, part.ref, `<g data-part="${part.name}">${part.svg}</g>`, [record(part.shape)]);
// Probe cable: a service loop from the carriage gland to the enclosure, rebuilt live as the carriage moves.
const LOOP_R = 2.4;
function loopRoute(cz) {
  const g = cz + 14;
  const [ex, ey, ez] = GLANDS.probe;
  const low = Math.max(K.z1 + 18, Math.min(g, ez) - 28);
  return [[D.carriage.x1 + 6, 0, g], [D.carriage.x1 + 14, 0, g], [36, 0, low], [ex - 16, ey, ez], [ex - 7, ey, ez]];
}
const LOOP_PTS = loopRoute(car.cz);
{
  const route = G.fillet(LOOP_PTS, 9, 10, { P, tube: LOOP_R });
  R.route("cable.probe", route, LOOP_R, { limp: true, piece: "rover" });
  CABLES.push("cable.probe");
  const pieces = tubePieces(route, LOOP_R, P, { maxLength: 400 });
  put("cable.probe", G.lerp3(route[0], route[route.length - 1], 0.5), `<g data-part="probe-cable">${pieces.map((p) => tubeSvg(p, { tone: "mid" })).join("")}</g>`, pieces.map((p) => A.tube(p.points, p.radii)), { bias: 0.05 });
}
// ToF beam, shown while lowering: a ray from the sensor to the soil.
const TOF_XY = [(PR.tof.x0 + PR.tof.x1) / 2, (PR.tof.y0 + PR.tof.y1) / 2];

// Left scan arm, drawn at extension `armShare` (1 on the page; live code slides it back).
// Each stage shows only beyond the stage that holds it: the mid stage and head beyond the beam mouth,
// the inner stage beyond the mid stage's end.
const armShare = ARM >= 0 ? ARM : 1;
const MID_OFF = SC.mid.travel * armShare;
const IN_OFF = (SC.mid.travel + SC.inner.travel) * armShare;
const hullClip = (x0, x1, z0, z1, y) => {
  const pts = [];
  for (const yy of [y, y + 2000]) for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) pts.push(at([x, yy, z]));
  const h = G.hullOf(pts);
  return `M${h.map(([x, z]) => `${f2(x)} ${f2(z)}`).join("L")}Z`;
};
function armBox(name, x0, x1, y0, y1, z0, z1, yCut, tone, extra = "") {
  const a = Math.max(y0, yCut);
  if (y1 - a < 0.2) return { svg: "", shapes: [] };
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 1.2 };
  return { svg: S(k.slabOf(plan, z0, z1 - z0, P, 2, 0.4), { tone }) + extra, shapes: [A.slab({ x: x0, y: a, w: x1 - x0, d: y1 - a, r: 0.4 }, z0, z1 - z0, { name }, 2)] };
}
{
  const mouth = SC.y;
  const mid = SC.mid;
  const inn = SC.inner;
  const hd = SC.head;
  const mz0 = SC.z0 + SC.wall;
  const iz0 = mz0 + mid.wall;
  const midY = [MID_OFF, MID_OFF + mid.len];
  const inY = [IN_OFF, IN_OFF + inn.len];
  const headY = [inY[1], inY[1] + hd.l];
  const midEnd = path3([[SXC - mid.w / 2 + mid.wall, midY[1] + 0.05, iz0], [SXC + mid.w / 2 - mid.wall, midY[1] + 0.05, iz0], [SXC + mid.w / 2 - mid.wall, midY[1] + 0.05, iz0 + inn.h], [SXC - mid.w / 2 + mid.wall, midY[1] + 0.05, iz0 + inn.h]], true);
  const midSvg = S(k.slabOf({ x: SXC - mid.w / 2, y: midY[0], w: mid.w, d: mid.len, r: 1 }, mz0, mid.h, P, 2, 0.4), { tone: "mid" }) + `<path class="rv-void" d="${midEnd}"/>`;
  const midShapes = midY[1] > mouth ? [[0, mid.w, 0, mid.wall], [0, mid.w, mid.h - mid.wall, mid.h], [0, mid.wall, mid.wall, mid.h - mid.wall], [mid.w - mid.wall, mid.w, mid.wall, mid.h - mid.wall]].map(([u0, u1, v0, v1]) =>
    A.slab({ x: SXC - mid.w / 2 + u0, y: mouth, w: u1 - u0, d: midY[1] - mouth, r: 0.3 }, mz0 + v0, v1 - v0, { name: "arm.mid" }, 2)) : [];
  const inCut = Math.max(midY[1], mouth);
  const innerSvg = S(k.slabOf({ x: SXC - inn.w / 2, y: inY[0], w: inn.w, d: inn.len, r: 1 }, iz0, inn.h, P, 2, 0.4), { tone: "mid" });
  const innerShapes = inY[1] - inCut > 0.2 ? [A.slab({ x: SXC - inn.w / 2, y: inCut, w: inn.w, d: inY[1] - inCut, r: 0.4 }, iz0, inn.h, { name: "arm.inner" }, 2)] : [];
  // Head: body, window on top with an LED ring, sloped nose that slides under low leaves, side ToF.
  const bodyY1 = headY[1] - 12;
  const hplan = { x: SXC - hd.w / 2, y: headY[0], w: hd.w, d: bodyY1 - headY[0], r: 2 };
  const top = hd.z0 + hd.h;
  const wc = [SXC, (headY[0] + bodyY1) / 2];
  const leds = Array.from({ length: 10 }, (_, j) => at([wc[0] + Math.cos((j / 10) * Math.PI * 2) * 13, wc[1] + Math.sin((j / 10) * Math.PI * 2) * 13, top]));
  const NF = G.frameOf([SXC - hd.w / 2, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const nose = [[bodyY1, hd.z0], [headY[1], hd.z0], [headY[1], hd.z0 + 7], [bodyY1, top]];
  const headSvg = S(k.slabOf(hplan, hd.z0, hd.h, P, 3, 0.5), { tone: "hi", lit: true }) +
    `<path class="rv-void" d="${k.ring(wc[0], wc[1], 8.5, top, P, 40)}"/>` + Ln(k.ring(wc[0], wc[1], 8.5, top, P, 40), { tone: "lo" }) + Dots(leds, { size: 0.55, tone: "hi" }) +
    S(G.prismOf(NF, nose, 0, hd.w, P), { tone: "hi", lit: true }) +
    S(k.slabOf({ x: SXC - 4, y: headY[1] - 1, w: 8, d: 1.6, r: 0.4 }, hd.z0 + 1.5, 4, P, 1), { tone: "lo" });
  const headShapes = headY[1] > mouth
    ? [A.slab({ x: hplan.x, y: Math.max(headY[0], mouth), w: hd.w, d: Math.max(0.2, bodyY1 - Math.max(headY[0], mouth)), r: 0.4 }, hd.z0, hd.h, { name: "arm.head" }, 2), A.prism(NF, nose, 0, hd.w, { name: "arm.head.nose" })]
    : [];
  const HOUSE = hullClip(SC.x0 - 2, SC.x1 + 2, SC.z0 - 2, SC.z1 + 2, mouth);
  const MIDEND = hullClip(SXC - mid.w / 2 - 1, SXC + mid.w / 2 + 1, mz0 - 1, mz0 + mid.h + 1, midY[1]);
  const group = (part, clipId, clipD, svg) => `<g data-part="${part}"><clipPath id="${clipId}"><path data-hold d="${clipD}"/></clipPath><g clip-path="url(#${clipId})">${svg}</g></g>`;
  // Stages hidden inside the beam (or inside the mid stage) are real geometry too: record them in pose
  // audits so the arm stays supported, and use them as an item's shape when nothing of it shows.
  const midHidden = Math.min(midY[1], mouth) - midY[0];
  const midHid = midHidden > 0.2 ? [[0, mid.w, 0, mid.wall], [0, mid.w, mid.h - mid.wall, mid.h], [0, mid.wall, mid.wall, mid.h - mid.wall], [mid.w - mid.wall, mid.w, mid.wall, mid.h - mid.wall]].map(([u0, u1, v0, v1]) =>
    A.slab({ x: SXC - mid.w / 2 + u0, y: midY[0], w: u1 - u0, d: midHidden, r: 0.3 }, mz0 + v0, v1 - v0, { name: "arm.hidden.mid" }, 2)) : [];
  const inHid = Math.min(inY[1], inCut) - inY[0] > 0.2 ? [A.slab({ x: SXC - inn.w / 2, y: inY[0], w: inn.w, d: Math.min(inY[1], inCut) - inY[0], r: 0.4 }, iz0, inn.h, { name: "arm.hidden.inner" }, 2)] : [];
  const headHid = Math.min(headY[1], mouth) - headY[0] > 0.2 ? [A.slab({ x: hplan.x, y: headY[0], w: hd.w, d: Math.min(headY[1], mouth) - headY[0], r: 0.4 }, hd.z0, hd.h, { name: "arm.hidden.head" }, 2)] : [];
  // Pose audits only: hidden parts are recorded for support, and a stage that shows nothing is not drawn.
  if (ARM >= 0) [...midHid, ...inHid, ...headHid].forEach((shape) => record(shape));
  const show = (shapes) => ARM < 0 || shapes.length > 0;
  const midItem = midShapes;
  const inItem = innerShapes;
  const headItem = headShapes;
  if (show(midItem)) put("arm.mid", [SXC, (midY[0] + midY[1]) / 2, mz0 + mid.h / 2], group("arm-mid", "rv-clip-mid", HOUSE, midSvg), midItem.map(record));
  // The inner stage shows only beyond both the mid stage's end (which moves) and the beam mouth (fixed).
  if (show(inItem)) put("arm.inner", [SXC, (inY[0] + inY[1]) / 2, iz0 + inn.h / 2],
    `<g data-part="arm-inner"><clipPath id="rv-clip-inner"><path data-follow="mid" d="${MIDEND}"/></clipPath><clipPath id="rv-clip-inner2"><path data-follow="beam" d="${HOUSE}"/></clipPath>` +
    `<g clip-path="url(#rv-clip-inner)"><g clip-path="url(#rv-clip-inner2)">${innerSvg}</g></g></g>`, inItem.map(record));
  if (show(headItem)) put("arm.head", [SXC, (headY[0] + headY[1]) / 2, hd.z0 + hd.h / 2], group("arm-head", "rv-clip-head", HOUSE, headSvg), headItem.map(record));

}
put("probe.tof.beam", [TOF_XY[0], TOF_XY[1], 20], `<g data-part="tof-beam"></g>`, [record(A.box([TOF_XY[0] - 1, TOF_XY[1] - 1, 0], [TOF_XY[0] + 1, TOF_XY[1] + 1, 1], { name: "probe.tof.beam", ground: true }))], { bias: 0.1 });

// The page draws in the order settled for the rest pose. Pose audits with --rest-order reuse those keys
// (items are created in the same sequence in every build), so they check the order the page really uses.
const KEYS_FILE = join(tmpdir(), "agrisim-rover-anatomy-keys.json");
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
  if (POSE < 0 && ARM < 0) writeFileSync(KEYS_FILE, JSON.stringify(Object.fromEntries(nthNames().map((id, i) => [id, R.items[i].key]))));
}
R.items.sort((a, b) => a.key - b.key);
const MATERIAL = [[/^soil\./, "rv-soil"], [/^(tyre|bumper\.pad|drip\.tape|rx\.whip)/, "rv-rubber"]];
const materialOf = (name) => (MATERIAL.find(([re]) => re.test(name)) ?? [null, ""])[1];
const groups = R.items.map((item) => `<g class="it${materialOf(item.name) ? " " + materialOf(item.name) : ""}" data-name="${item.name}">${item.svg}</g>`).join("");

const LABEL_TEXT =
  "AgriRover v1 parked on a soil test tray with a cutaway notch. A four-wheel skid-steer chassis carries a module deck with a probe tower at its centre: a stepper turns a lead screw that drives a carriage down two guide rods, pushing a three-rod soil moisture probe through a self-cleaning cartridge in a well at the chassis centre, 60 mm into the soil. On the way back up a brush seal wipes the rods, an air-knife blows them dry, and the probe checks it reads clean air before the next sample. A front scan beam holds two telescopic under-leaf camera arms; the left arm slides out toward the row with its camera looking up and slides back past a window wiper. An electronics box with two walls cut away holds the computer, microcontroller, stepper driver, RS485 transceiver, power converter and fuses; a 2D lidar and camera sit on a mast at the front, a GNSS antenna and an emergency stop at the rear.";
const svg = k.figureSvg({ width: W, height: H, label: LABEL_TEXT, body: [...back, `<g class="rv-rover">${groups}</g>`] });

const C = M.cycle();
const DATA = {
  P,
  stroke: M.STROKE,
  tip0: PR.tip0,
  depth: PR.depth,
  carriageZ0: M.CARRIAGE_Z0,
  needleRoot0: M.NEEDLE_ROOT0,
  headR: PR.headR,
  speed: M.SPEED,
  cycle: C,
  soil: M.SOIL,
  area: PR.needleX.length * Math.PI * PR.needleR ** 2,
  perimeter: PR.needleX.length * 2 * Math.PI * PR.needleR,
  available: M.AVAILABLE_N,
  reading: 0.291,
  loop: { x1: D.carriage.x1, gland: GLANDS.probe, deckTop: K.z1, r: LOOP_R },
  arm: { mid: SC.mid.travel, inner: SC.mid.travel + SC.inner.travel, speed: SC.speed, share: armShare, dwell: 2 },
  headRest: SC.mid.len + SC.head.l / 2,
  brush: D.cartridge.brushZ,
  needleL: PR.needleL,
  clean: M.CLEAN.airMax,
  axis: { rodY: TW.rodY, rodR: TW.rodR, baseZ1: TW.base.z1, topZ0: TW.top.z0, carH: D.carriage.h, screwX: TW.screwX, screwR: TW.screwR, screwZ0: SCREW_Z0, couplerZ0: COUPLER_Z0 },
  tof: TOF_XY,
  playback: 3,
};
const strip = (rel) => readFileSync(join(SKILL, rel), "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
const latheScript = `const G = (() => {${strip("kit/lathe.mjs")}\nreturn { fillet, ribsOf, viewOf, scaleOf, frameAlong, frameOf, pointOf, disc, dot3, add3, sub3, mul3, unit3, cross3, len3, lerp3, lightOf, toneOf, pathLength, tangentAlong, pointAlong, resample, cut };})();\n`;
const tubeScript = `const TB = (() => {${strip("kit/tube.mjs")}\nreturn { tubePieces, tubeSvg };})();\n`;
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const CSS = `
.iso .rv-void { fill: var(--anatomy-shade-0); stroke: none; }
.iso .rv-soil { --anatomy-paper: #d8d2c6; --anatomy-face: #ddd7cb; --anatomy-top: #e3ddd1; --anatomy-shade-0: #b8b1a4; --anatomy-shade-1: #c2bbae; --anatomy-shade-2: #ccc5b8; --anatomy-shade-3: #d5cec1; --anatomy-lo: #988f82; --anatomy-faint: #b9b1a4; --anatomy-mid: #7c7468; }
.iso .rv-rubber { --anatomy-paper: #c9c9c9; --anatomy-face: #d2d2d2; --anatomy-top: #d6d6d6; --anatomy-shade-0: #a7a7a7; --anatomy-shade-1: #b2b2b2; --anatomy-shade-2: #bcbcbc; --anatomy-shade-3: #c5c5c5; --anatomy-lo: #8c8c8c; --anatomy-faint: #a9a9a9; }
.iso .rv-cavity { fill: var(--anatomy-shade-0); stroke: none; }
.iso[data-theme="dark"] .rv-soil, .iso:not([data-theme="light"]) .rv-soil { --anatomy-paper: #1f1b16; --anatomy-face: #25211b; --anatomy-top: #29241e; --anatomy-shade-0: #16130f; --anatomy-shade-1: #1a1712; --anatomy-shade-2: #1e1a15; --anatomy-shade-3: #221e18; --anatomy-lo: #4a4238; --anatomy-faint: #332d26; --anatomy-mid: #6c6255; }
.iso[data-theme="dark"] .rv-rubber, .iso:not([data-theme="light"]) .rv-rubber { --anatomy-paper: #0d0d0d; --anatomy-face: #111; --anatomy-top: #141414; --anatomy-shade-0: #080808; --anatomy-shade-1: #0b0b0b; --anatomy-shade-2: #0e0e0e; --anatomy-shade-3: #111; --anatomy-lo: #2e2e2e; --anatomy-faint: #222; }
.iso[data-theme="light"] .rv-soil { --anatomy-paper: #d8d2c6; --anatomy-face: #ddd7cb; --anatomy-top: #e3ddd1; --anatomy-shade-0: #b8b1a4; --anatomy-shade-1: #c2bbae; --anatomy-shade-2: #ccc5b8; --anatomy-shade-3: #d5cec1; --anatomy-lo: #988f82; --anatomy-faint: #b9b1a4; --anatomy-mid: #7c7468; }
.iso[data-theme="light"] .rv-rubber { --anatomy-paper: #c9c9c9; --anatomy-face: #d2d2d2; --anatomy-top: #d6d6d6; --anatomy-shade-0: #a7a7a7; --anatomy-shade-1: #b2b2b2; --anatomy-shade-2: #bcbcbc; --anatomy-shade-3: #c5c5c5; --anatomy-lo: #8c8c8c; --anatomy-faint: #a9a9a9; }
.iso .rv-damp { fill: var(--anatomy-shade-1); stroke: none; opacity: 0.55; }
.iso [data-part="tof-beam"] .iso-line { stroke-dasharray: 2 2; }
`;
const body =
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 1",
    title: "AgriRover v1, probe rover",
    hint: "Space: probe cycle · A: leaf arm · ↑ ↓ or hover: probe",
    readout: "parked · probe up",
    keys: [
      { mark: "lit", label: "Soil probe and under-leaf camera head: the two sensing ends" },
      { mark: "raised", label: "Probe tower: NEMA 17, T8 lead screw, carriage on two guide rods" },
      { mark: "edge", label: "Self-cleaning: brush seal and air-knife in the well; window wiper at the beam mouth" },
    ],
    caption:
      `The module bolts to a 4WD skid-steer RC chassis (300 mm wheelbase, 330 mm track, 150 mm tyres) and probes through a well at the centre of the wheelbase, where most of the rover's weight resists the push (${M.MASS_KG} kg: ${M.AVAILABLE_N.toFixed(0)} N before the rear wheels unload). A cycle lowers the probe at ${M.SPEED.approach} mm/s until the downward time-of-flight sensor sees the ground, inserts it ${PR.depth} mm at ${M.SPEED.insert} mm/s and reads for ${M.SPEED.read} s. It then cleans itself before the next spot, because soil left on the rods would bias the next reading: the rods are wiped by a brush seal as they retract, blown dry by an air-knife for ${M.SPEED.blast} s, and must read clean air (within ${M.CLEAN.airMax} m³/m³ of their baseline) or the clean repeats. ${C.t6.toFixed(1)} s in all, played here ${DATA.playback}× fast. The push follows a placeholder soil model (${M.SOIL.coneMPa} MPa, ${M.SOIL.shaftKPa} kPa): about ${M.insertionForce(PR.depth).toFixed(0)} N at full depth. The front scan beam holds two telescopic arms whose low camera heads slide ${(M.SCAN_REACH / 1000).toFixed(2)} m out from the centre line, under the leaves of the row, and are wiped as they retract. The reading shown is agrisim's first probe on seed 7 (0.291 m³/m³), a simulated value, not a field measurement. The electronics box is drawn with its near and front walls cut away.`,
    body: `<div class="iso-stage rv-stage" tabindex="0" role="slider" aria-label="AgriRover. Space runs a probe cycle with cleaning; A slides the left under-leaf camera arm out or in; up and down arrows move the probe 10 millimetres; Home retracts it; End drives it to full depth." aria-valuemin="0" aria-valuemax="${PR.depth}" aria-valuenow="0" aria-valuetext="Parked, probe up">${svg}</div>`,
  });
const page = k.pageHtml({ title: "AgriRover v1 anatomy", theme: THEME, body, script: kitScript() + latheScript + tubeScript + LIVE, width: 700 });
if (POSE < 0 && ARM < 0) {
  const name = THEME === "light" ? "rover-anatomy-light.html" : "rover-anatomy.html";
  writeFileSync(join(HERE, name), page);
  console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `${R.solids.length} shapes`, `scale ${KS.toFixed(3)}`, `${CABLES.length} lines`);
}
// The scan cable leaves a gland on the beam it is mounted to; checked at 8x (see DESIGN.md, section 9).
A.auditOrExit(R, P, { crowd: [["cable.scan", "scan.beam"]] });
