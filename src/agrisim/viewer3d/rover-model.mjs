// AgriRover v1 parametric model. Single source of dimensions for the orthographic drawings,
// the anatomy figure and DESIGN.md. Units: mm. Frame: x forward, y left, z up; origin on the
// ground under the centre of the wheelbase (matches agrisim: x along the row, rover at lane centre).
// Numbers marked [A] are design targets to confirm against the chassis actually bought.

export const DIM = {
  wheel: { r: 75, w: 65, base: 300, track: 330 }, // [A] 150 mm tyres, 300 wheelbase, 330 track
  pod: { r: 19, y0: 92 }, // corner gear-motor pod, from y0 out to the wheel's inner face
  tub: { x: 190, y: 112, z0: 100, z1: 165, r: 12 }, // chassis body: belly at 100 mm
  bumper: { x0: 212, x1: 224, y: 120, z0: 92, z1: 122 }, // rear only; the scan beam is the front bumper
  well: { rIn: 30, rOut: 33, flange: 42 }, // probe well through the chassis centre
  // Self-cleaning cartridge in the bottom of the well (drops out from below for washing):
  // a brush seal at the mouth wipes the rods on every pass, an air-knife ring blasts them dry.
  cartridge: { r: 33, flangeR: 40, z0: 92, z1: 132, flangeZ1: 100, brushZ: [94, 106], airZ: 118, nozzles: 6 },
  // Front scan beam (replaces the front bumper) with two telescopic under-leaf camera arms,
  // one per row. Each arm: a middle and an inner stage; the camera head rides on the inner stage.
  scan: {
    x0: 230, x1: 272, z0: 72, z1: 112, y: 185, wall: 3, strip: 4,
    head: { w: 34, l: 64, h: 22, z0: 81 },
    mid: { w: 36, h: 34, wall: 2, len: 121, travel: 128 }, // hollow; rides on the beam's inner walls (ball slides)
    inner: { w: 32, h: 30, len: 121, travel: 70 }, // rides inside the mid stage; the head bolts to its end
    speed: 60, // mm/s [A]
  },
  standoff: { x: 150, y: 85, r: 6 },
  deck: { x: 200, y: 125, z0: 180, z1: 184, r: 10, hole: 24 },
  tower: {
    base: { x0: -58, x1: 32, y: 48, z1: 194 }, // front edge clears the 24 mm probe hole
    rodY: 34, rodR: 5, screwX: -34, screwR: 4, // bearing clears the 22 mm probe flange
    top: { z0: 400, z1: 408 },
    motor: { s: 42, h: 40 }, // NEMA 17
  },
  carriage: { x0: -48, x1: 18, y: 46, h: 28 },
  probe: {
    needleR: 1.5, needleL: 70, needleX: [-12, 0, 12], // 3 stainless rods, FDR/RS485 soil probe
    headR: 18, headL: 50, flangeR: 22, extR: 8,
    tip0: 107, // parked needle tips: just above the brush seal, inside the air-knife zone
    tof: { x0: 16.6, x1: 24, y0: -14, y1: -6, h: 10 }, // ground ToF block, inside the 30 mm bore
    depth: 60, // insertion depth below the surface
  },
  enclosure: { x0: 60, x1: 168, y: 95, h: 70, wall: 3 },
  lidar: { x: 200, s: 40, h0: 230, body: 22, head: 13, mast: 176 }, // mast x0; lidar centre x - 8
  gnss: { x: -170, y: 95, top: 300, r: 30 },
  estop: { x: -165, y: -90 },
};

const P = DIM.probe;
// Probe stroke: from retracted to tips `depth` below ground.
export const STROKE = P.tip0 + P.depth;
// Carriage at rest (retracted): at full stroke its bottom clears the 4 mm lead-screw bearing on the base by 1 mm.
export const BEARING_H = 4;
export const CARRIAGE_Z0 = DIM.tower.base.z1 + BEARING_H + 1 + STROKE;
export const NEEDLE_ROOT0 = P.tip0 + P.needleL;
export const HEAD_TOP0 = NEEDLE_ROOT0 + P.headL;
export const EXT_LEN = CARRIAGE_Z0 - HEAD_TOP0;
export const SCAN_REACH = DIM.scan.head.l / 2 + DIM.scan.mid.len + DIM.scan.mid.travel + DIM.scan.inner.travel; // head centre, from the rover centre line
export const OVERALL = {
  length: DIM.scan.x1 + DIM.scan.strip + DIM.bumper.x1,
  width: DIM.wheel.track + DIM.wheel.w,
  height: DIM.tower.top.z1 + DIM.tower.motor.h,
  wheelbase: DIM.wheel.base,
  bellyClearance: DIM.tub.z0,
  podClearance: DIM.wheel.r - DIM.pod.r,
};

// Probe insertion model (placeholders until measured in the target field's soil).
export const SOIL = {
  coneMPa: 1.2, // [A] penetration resistance of moist irrigated loam; dry or compacted soil reaches 2-3 MPa
  shaftKPa: 10, // [A] sleeve friction along the needles
};
export const MASS_KG = 6.9; // [A] see DESIGN.md mass budget
export const CG_FORWARD = 30; // mm the centre of mass sits ahead of the probe (scan beam at the front) [A]
export const G = 9.81;
const needleArea = P.needleX.length * Math.PI * P.needleR ** 2; // mm^2
const needlePerimeter = P.needleX.length * 2 * Math.PI * P.needleR; // mm
/** Push needed at a given depth (mm) in N: tip resistance plus sleeve friction. */
export const insertionForce = (depth) =>
  depth <= 0 ? 0 : SOIL.coneMPa * needleArea + (SOIL.shaftKPa / 1000) * needlePerimeter * depth;
/** The most the probe can push before a wheel pair lifts: with the probe at the wheelbase centre and
 *  the centre of mass `CG_FORWARD` ahead of it, the rear wheels unload first, at W(1 - 2e/L). */
export const AVAILABLE_N = MASS_KG * G * (1 - (2 * CG_FORWARD) / DIM.wheel.base);

// Motion profile of one probe cycle (s): approach fast, insert slowly, read, retract through the
// brush seal, blast the parked rods with air, then check the probe reads clean air before moving on.
export const SPEED = { approach: 25, insert: 6, retract: 25, read: 2, blast: 3, check: 1 }; // mm/s, s
export const CLEAN = { airMax: 0.02, retries: 2 }; // [A] clean if the in-air reading is within 0.02 of its baseline
export function cycle() {
  const toGround = P.tip0; // tips reach the surface after this much travel
  const t1 = toGround / SPEED.approach;
  const t2 = t1 + P.depth / SPEED.insert;
  const t3 = t2 + SPEED.read;
  const t4 = t3 + STROKE / SPEED.retract;
  const t5 = t4 + SPEED.blast;
  const t6 = t5 + SPEED.check;
  return { t1, t2, t3, t4, t5, t6 };
}
/** Probe travel (mm, 0 = retracted, STROKE = full depth) and phase at time t of one cycle. */
export function probeAt(t) {
  const { t1, t2, t3, t4, t5, t6 } = cycle();
  if (t <= 0) return { travel: 0, phase: "parked" };
  if (t < t1) return { travel: t * SPEED.approach, phase: "lowering" };
  if (t < t2) return { travel: P.tip0 + (t - t1) * SPEED.insert, phase: "inserting" };
  if (t < t3) return { travel: STROKE, phase: "reading" };
  if (t < t4) return { travel: STROKE - (t - t3) * SPEED.retract, phase: "retracting" };
  if (t < t5) return { travel: 0, phase: "air blast" };
  if (t < t6) return { travel: 0, phase: "air check" };
  return { travel: 0, phase: "parked" };
}

// ---- Primitive parts for the orthographic drawings and the BOM ----------------------------
// box: axis-aligned [x0,y0,z0]-[x1,y1,z1]; cyl: centre, axis "x"|"y"|"z", radius, length.
const box = (name, group, a, b, bom) => ({ kind: "box", name, group, a, b, bom });
const cyl = (name, group, c, axis, r, len, bom) => ({ kind: "cyl", name, group, c, axis, r, len, bom });

export function parts(travel = 0) {
  const d = DIM;
  const out = [];
  const { r: wr, w: ww, base, track } = d.wheel;
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const x = (sx * base) / 2;
    const y = (sy * track) / 2;
    out.push(cyl("wheel", "chassis", [x, y, wr], "y", wr, ww, 1));
    const inner = track / 2 - ww / 2;
    out.push(cyl("motor pod", "chassis", [x, sy * (d.pod.y0 + inner) / 2, wr], "y", d.pod.r, inner - d.pod.y0, 2));
    out.push(box("trailing arm", "chassis", [Math.min(sx * 62, x), sy > 0 ? 113 : -123, 70], [Math.max(sx * 62, x), sy > 0 ? 123 : -113, 112], 3));
  }
  const t = d.tub;
  out.push(box("chassis tub", "chassis", [-t.x, -t.y, t.z0], [t.x, t.y, t.z1], 4));
  {
    const b = d.bumper;
    out.push(box("rear bumper", "chassis", [-b.x1, -b.y, b.z0], [-b.x0, b.y, b.z1], 5));
    for (const sy of [1, -1]) out.push(box("bumper strut", "chassis", [-b.x0, sy * 70 - 6, 102], [-t.x, sy * 70 + 6, 114], 5));
  }
  const cr = d.cartridge;
  out.push(cyl("cleaning cartridge flange", "chassis", [0, 0, (cr.z0 + cr.flangeZ1) / 2], "z", cr.flangeR, cr.flangeZ1 - cr.z0, 6));
  const sc = d.scan;
  out.push(box("scan beam", "module", [sc.x0, -sc.y, sc.z0], [sc.x1, sc.y, sc.z1], 22));
  out.push(box("contact strip", "module", [sc.x1, -sc.y + 15, sc.z0 + 8], [sc.x1 + sc.strip, sc.y - 15, sc.z1 - 8], 22));
  for (const sy of [1, -1]) out.push(box("beam strut", "module", [t.x, sy * 70 - 8, 84], [sc.x0, sy * 70 + 8, 100], 22));
  for (const sx of [1, -1]) for (const sy of [1, -1]) out.push(cyl("standoff", "module", [sx * d.standoff.x, sy * d.standoff.y, (t.z1 + d.deck.z0) / 2], "z", d.standoff.r, d.deck.z0 - t.z1, 7));
  const k = d.deck;
  out.push(box("deck plate", "module", [-k.x, -k.y, k.z0], [k.x, k.y, k.z1], 8));
  const tw = d.tower;
  out.push(box("tower base", "module", [tw.base.x0, -tw.base.y, k.z1], [tw.base.x1, tw.base.y, tw.base.z1], 9));
  for (const sy of [1, -1]) out.push(cyl("guide rod", "module", [0, sy * tw.rodY, (tw.base.z1 + tw.top.z0) / 2], "z", tw.rodR, tw.top.z0 - tw.base.z1, 10));
  out.push(cyl("lead screw", "module", [tw.screwX, 0, (tw.base.z1 + tw.top.z0) / 2], "z", tw.screwR, tw.top.z0 - tw.base.z1, 11));
  out.push(box("tower top plate", "module", [tw.base.x0, -tw.base.y, tw.top.z0], [tw.base.x1, tw.base.y, tw.top.z1], 9));
  const m = tw.motor;
  out.push(box("NEMA 17 stepper", "module", [tw.screwX - m.s / 2, -m.s / 2, tw.top.z1], [tw.screwX + m.s / 2, m.s / 2, tw.top.z1 + m.h], 12));
  const c = d.carriage;
  const cz = CARRIAGE_Z0 - travel;
  out.push(box("carriage", "probe", [c.x0, -c.y, cz], [c.x1, c.y, cz + c.h], 13));
  const p = d.probe;
  const root = NEEDLE_ROOT0 - travel;
  out.push(cyl("probe extension", "probe", [0, 0, (root + p.headL + cz) / 2], "z", p.extR, cz - root - p.headL, 14));
  out.push(cyl("soil probe head", "probe", [0, 0, root + p.headL / 2], "z", p.headR, p.headL, 15));
  out.push(cyl("probe flange", "probe", [0, 0, root + p.headL - 2], "z", p.flangeR, 4, 15));
  for (const x of p.needleX) out.push(cyl("needle", "probe", [x, 0, root - p.needleL / 2], "z", p.needleR, p.needleL, 15));
  const e = d.enclosure;
  out.push(box("electronics enclosure", "module", [e.x0, -e.y, k.z1], [e.x1, e.y, k.z1 + e.h], 16));
  const l = d.lidar;
  out.push(box("lidar mast", "module", [l.mast, -14, k.z1], [l.mast + 4, 14, l.h0], 17));
  out.push(box("2D lidar", "module", [l.x - l.s / 2 - 8, -l.s / 2, l.h0], [l.x + l.s / 2 - 8, l.s / 2, l.h0 + l.body], 17));
  out.push(cyl("lidar head", "module", [l.x - 8, 0, l.h0 + l.body + l.head / 2], "z", 17, l.head, 17));
  out.push(box("front camera", "module", [l.mast + 4, -12, l.h0 - 28], [l.mast + 24, 12, l.h0 - 6], 18));
  const g = d.gnss;
  out.push(cyl("gnss mast", "module", [g.x, g.y, (k.z1 + g.top) / 2], "z", 6, g.top - k.z1, 19));
  out.push(cyl("gnss antenna", "module", [g.x, g.y, g.top + 9], "z", g.r, 18, 19));
  const s = d.estop;
  out.push(box("e-stop housing", "module", [s.x - 20, s.y - 20, k.z1], [s.x + 20, s.y + 20, k.z1 + 32], 20));
  out.push(cyl("e-stop head", "module", [s.x, s.y, k.z1 + 40], "z", 20, 16, 20));
  out.push(box("rc receiver", "module", [-130, -35, k.z1], [-90, 5, k.z1 + 16], 21));
  return out;
}

/** The two scan-arm heads (and their inner stages) at an extension share 0..1, for the drawings. */
export function scanHeads(share = 0) {
  const sc = DIM.scan;
  const out = [];
  const reach = (sc.mid.travel + sc.inner.travel) * share;
  const xc = (sc.x0 + sc.x1) / 2;
  for (const sy of [1, -1]) {
    const y0 = sc.mid.len + reach;
    const hy = [y0, y0 + sc.head.l].map((v) => sy * v);
    out.push(box("scan head", "scan", [xc - sc.head.w / 2, Math.min(...hy), sc.head.z0], [xc + sc.head.w / 2, Math.max(...hy), sc.head.z0 + sc.head.h], 22));
    const iy = [reach, reach + sc.inner.len].map((v) => sy * v);
    const iz0 = sc.z0 + sc.wall + sc.mid.wall;
    out.push(box("scan inner stage", "scan", [xc - sc.inner.w / 2, Math.min(...iy), iz0], [xc + sc.inner.w / 2, Math.max(...iy), iz0 + sc.inner.h], 22));
  }
  return out;
}

// Bill of materials: ref -> item. Class-level choices; exact parts are picked at purchase.
export const BOM = [
  [1, "Wheels, 150 mm pneumatic or foam-filled tyres, 4", "chassis kit"],
  [2, "Corner gear-motors 12 V with hall encoders, 4", "chassis kit"],
  [3, "Independent trailing-arm suspension, 4", "chassis kit"],
  [4, "4WD skid-steer chassis tub with centre probe well, Li-ion 3S pack and dual motor driver inside", "chassis kit + cut"],
  [5, "Rear spring bumper with microswitches; front contact strip on the scan beam", "module"],
  [6, "Self-cleaning probe cartridge: brush seal, air-knife ring, drop-out bayonet; 12 V air pump in the chassis", "module"],
  [7, "Standoffs M5, 15 mm, 4 (universal mounting pattern 300 x 170)", "module"],
  [8, "Module deck, 3 mm aluminium, 400 x 250", "module"],
  [9, "Probe tower base and top plate", "module"],
  [10, "Guide rods 10 mm with LM10UU bushings, 2", "module"],
  [11, "Lead screw T8 x 8 mm lead with brass nut", "module"],
  [12, "NEMA 17 stepper, driven by a TMC2209 (StallGuard detects hard soil)", "module"],
  [13, "Carriage plate with cable gland", "module"],
  [14, "Probe extension tube 16 mm", "module"],
  [15, "Soil probe: 3-rod stainless FDR, RS485 Modbus, VWC + temperature + EC, with a downward ToF ground sensor", "module"],
  [16, "IP54 electronics enclosure: Raspberry Pi 5, Pico 2 MCU, TMC2209, RS485 transceiver, 5 V 5 A buck, fuse block", "module"],
  [17, "2D LiDAR (360 deg, DTOF) on a front mast, for row following and stem detection", "module"],
  [18, "Front camera (Pi Camera Module 3 Wide), logging and future row vision", "module"],
  [19, "GNSS antenna on a mast (standard GNSS; RTK upgrade path)", "module"],
  [20, "E-stop mushroom button, cuts motor power", "module"],
  [21, "RC receiver for manual drive and kill switch", "module"],
  [22, "Front scan beam with twin telescopic under-leaf camera arms (upward camera, ring light, window wiper)", "module"],
];
