// AgriRover v2 parametric model: the single source of every dimension, mass, force, power and
// maintenance number in DESIGN.md, CALCULATIONS.md and the drawings. Units: mm, kg, N, s, W, Wh.
// Frame: x forward, y left, z up; origin on the ground under the probe axis (the rocker pivots).
// Numbers marked [A] are assumptions or vendor-class figures to confirm on the bench.
//
// What changed from v1 and why (details in DESIGN.md):
// - Rocker-differential chassis: two side walking beams pivot on the body, a differential bar
//   keeps the body level between them. All four wheels stay loaded on ridges and ruts, and the
//   probe pushes straight down over the pivot line, so its reaction is shared by all four wheels.
// - Open tool bay between the side walls, not a well through a closed tub: the probe module is a
//   drop-in cartridge reached from above, mud falls to the ground, nothing wet sits near the
//   electronics. The probe can shift sideways on a rail to dodge a stone or sample the bed edge.
// - 216 mm pneumatic hub-motor wheels and 150 mm belly clearance (v1: 150 mm wheels, 100 mm belly,
//   56 mm motor pods). Hub motors put the heaviest parts at axle height: a low centre of mass.
// - LiFePO4 12S battery with a designed BMS (v1: unspecified Li-ion 3S pack).
// - Fully autonomous probe cleaning with escalation and a dock; a person only refills and replaces
//   wear parts on a schedule.

export const DIM = {
  wheel: { r: 108, w: 60, base: 300, track: 335 }, // [A] 8.5" pneumatic off-road hub motors
  hub: { r: 62, w: 52 }, // motor body inside the rim
  beam: { h: 70, w: 20, y: 123, z0: 165, overhang: 40 }, // side rocker beams (aluminium box), outboard of the body
  axleDrop: { w: 20 }, // bracket from the beam down to the hub axle
  pivot: { z: 200, r: 12 }, // rocker pivot stub shafts on the body side plates, at x = 0
  body: { x: 175, yIn: 105, yOut: 108, z0: 150, z1: 250 }, // 3 mm side plates joined by front and rear boxes
  bay: { x: 95 }, // open tool bay: |x| < 95, |y| < yIn, open below and above
  cross: { x: 175, w: 50 }, // front and rear cross boxes (battery in the rear one)
  diff: { z: 268, len: 290, r: 8 }, // differential bar across the top, pivoted at the body centre
  deck: { x0: -175, x1: -95, z0: 250, z1: 254 }, // rear deck over the battery box
  enclosure: { x0: -172, x1: -98, y: 76, h: 86 }, // electronics, behind the bay
  probeRail: { y: 60, z: 252 }, // sideways rail over the bay: probe axis can sit at |y| <= 60 (bay half-width 105)
  tower: { x0: -40, x1: 40, y: 34, z1: 400, motorX: 52 }, // linear axis; stepper beside, belt drive
  carriage: { x0: -26, x1: 26, y: 30, h: 26 },
  station: { r: 34, z0: 150, z1: 205 }, // cleaning station at the bay floor (wipers, air/water ring)
  probe: {
    needleR: 1.5, needleL: 70, needleX: [-12, 0, 12], // 3-rod stainless FDR probe, RS485
    headR: 18, headL: 50, extR: 8,
    tip0: 210, // parked tips: above the wipers, inside the air ring
    depth: 60, // insertion depth below the local surface
    groundSlack: 60, // extra stroke when the surface under the probe is lower (rut, hollow)
  },
  scan: { x0: 280, x1: 310, z0: 150, z1: 190, y: 185, headZ: 95 }, // camera beam, heads drop to 95
  lidar: { x: 150, z: 330, s: 40 }, // on the front box, ahead of the probe axis
  gnss: { x: -150, y: 0, z: 400 },
  estop: { x: -150, y: -95 },
  waterTank: { ml: 500 },
};

const P = DIM.probe;
export const STROKE = P.tip0 + P.depth + P.groundSlack;
export const OVERALL = {
  length: DIM.scan.x1 + DIM.wheel.r + DIM.wheel.base / 2 + 4, // beam front to rear tyre + guard
  width: DIM.wheel.track + DIM.wheel.w,
  height: DIM.gnss.z + 18, // the GNSS antenna is the highest part
  belly: DIM.body.z0,
  beamClearance: DIM.beam.z0,
  wheelbase: DIM.wheel.base,
};

// ---- Mass budget: [name, kg, x, y, z of the part's centre of mass] [A] ------------------------
export const MASS = [
  ["hub-motor wheels, 4", 9.6, 0, 0, DIM.wheel.r],
  ["rocker beams and axle brackets, 2", 1.3, 0, 0, DIM.beam.z0 + DIM.beam.h / 2],
  ["body: side plates, front and rear boxes", 2.2, 0, 0, 200],
  ["differential bar, links, pivots", 0.6, 0, 0, 250],
  ["battery 12S LiFePO4 6 Ah with BMS, in the rear cross box", 2.4, -150, 0, 200],
  ["2 dual BLDC controllers, front cross box", 0.7, 150, 0, 200],
  ["probe module (axis, stepper, carriage, probe, rail)", 1.6, 0, 0, 300],
  ["cleaning: station, pump, valves, water tank (full)", 1.0, 120, 0, 205],
  ["electronics enclosure, Pi 5, MCU, DC-DC", 0.9, -135, 0, 295],
  ["lidar, cameras, GNSS, e-stop", 0.5, 0, 0, 370],
  ["scan beam, arms and camera heads", 0.8, 295, 0, 170],
  ["cables, connectors, fasteners", 0.5, 0, 0, 230],
];
export const TOTAL_KG = MASS.reduce((s, m) => s + m[1], 0);
export const CG = ["x", "y", "z"].map((_, i) => MASS.reduce((s, m) => s + m[1] * m[2 + i], 0) / TOTAL_KG);
export const G = 9.81;
export const WEIGHT_N = TOTAL_KG * G;

// ---- Static stability ----------------------------------------------------------------------
// The rocker-differential leaves the body supported by both side beams across the full track,
// and each beam by its two wheels, so the support polygon is the wheel rectangle.
const deg = (r) => (r * 180) / Math.PI;
export const STABILITY = {
  rollDeg: deg(Math.atan(DIM.wheel.track / 2 / CG[2])), // side slope before tipping, static
  pitchDeg: deg(Math.atan((DIM.wheel.base / 2 - Math.abs(CG[0])) / CG[2])),
  // A step under one wheel tilts that beam, and the differential tilts the body by half of it.
  stepMm: 100,
  beamTiltDeg: deg(Math.atan(100 / DIM.wheel.base)),
  bodyPitchDeg: deg(Math.atan(100 / DIM.wheel.base)) / 2,
  // Braking from top speed in 0.25 s: the deceleration needed to tip it over is far larger.
  tipDecelG: (DIM.wheel.base / 2 - Math.abs(CG[0])) / CG[2],
};

// ---- Soil, traction and climbing --------------------------------------------------------------
export const SOIL = {
  coneMPa: { moist: 1.2, dry: 3.0 }, // [A] penetration resistance: irrigated loam vs dry crust
  shaftKPa: { moist: 10, dry: 25 }, // [A] sleeve friction
  mu: 0.55, // [A] tyre-soil traction coefficient on tilled loam
  crr: 0.1, // [A] rolling resistance on soft tilled soil
};
const needleArea = P.needleX.length * Math.PI * P.needleR ** 2;
const needlePerimeter = P.needleX.length * 2 * Math.PI * P.needleR;
export const insertionForce = (state, depth = P.depth) =>
  SOIL.coneMPa[state] * needleArea + (SOIL.shaftKPa[state] / 1000) * needlePerimeter * depth;
/** The most the probe can push, at sideways offset y on the rail, before a wheel pair unloads.
 *  Fore-aft: the push is at the pivot line, so only the centre of mass offset matters. */
export function availableForce(y = 0) {
  const T = DIM.wheel.track;
  const L = DIM.wheel.base;
  const fore = 1 - (2 * Math.abs(CG[0])) / L;
  const side = 1 / (1 + (2 * Math.abs(y)) / T);
  return WEIGHT_N * Math.min(fore, side);
}
export const PUSH_SAFETY = 0.8; // never use more than 80% of the lift-off force
export const tyrePressureKPa = 60; // [A] run soft for flotation; ground pressure ~ inflation + carcass
export const TRACTION = {
  drawbarN: SOIL.mu * WEIGHT_N,
  rollingN: SOIL.crr * WEIGHT_N,
  // Rule of thumb for 4WD on soil: a step of about half the wheel radius climbs reliably [A].
  stepMm: 0.5 * DIM.wheel.r,
  maxGradeDeg: deg(Math.atan(SOIL.mu - SOIL.crr)),
};

// ---- Probe cycle, with cleaning --------------------------------------------------------------
export const SPEED = { approach: 40, insert: 6, retract: 40, read: 2, blast: 3, check: 1 }; // mm/s, s
export const CLEAN = {
  airMax: 0.02, // [A] parked reading in air within 0.02 of the clean-air baseline = clean
  wetMl: 2, // [A] water per wet clean
  wetS: 1, dryS: 8, // spray, then dry with air
  wetShare: 0.1, // [A] share of cycles that need a wet clean (heavy or wet soil)
  dryRetries: 1, wetRetries: 2,
  referenceTolerance: 0.015, // [A] VWC tolerance on the dock's reference block
};
export function cycle() {
  const t1 = P.tip0 / SPEED.approach;
  const t2 = t1 + P.depth / SPEED.insert;
  const t3 = t2 + SPEED.read;
  const t4 = t3 + (P.tip0 + P.depth) / SPEED.retract;
  const t5 = t4 + SPEED.blast;
  const t6 = t5 + SPEED.check;
  return { t1, t2, t3, t4, t5, t6 };
}
export const WET_CLEAN_S = CLEAN.wetS + CLEAN.dryS + SPEED.check;

// ---- Power, battery and BMS --------------------------------------------------------------------
export const CELL = { chem: "LiFePO4", vNom: 3.2, vMax: 3.65, vChargeTo: 3.55, vMin: 2.5, vCutSoft: 2.9, ah: 6, kg: 0.145 }; // [A] 32700 class
export const PACK = { s: 12, p: 1 };
export const BATTERY = {
  vNom: CELL.vNom * PACK.s,
  vMax: CELL.vChargeTo * PACK.s,
  vMin: CELL.vCutSoft * PACK.s,
  wh: CELL.vNom * PACK.s * CELL.ah * PACK.p,
  usableShare: 0.8, // stop at 10% and charge to about 90-95%: kinder to the cells
};
export const BMS = {
  ovCell: 3.65, uvCell: 2.5, softCutCell: 2.9, // V
  ocContinuousA: 25, ocPeakA: 50, ocPeakMs: 1000, scA: 120, scUs: 200,
  chargeTempC: [0, 45], dischargeTempC: [-20, 60], // LiFePO4 must not be charged below 0 C
  balanceMv: 30, balanceMa: 60, // passive balancing when cells differ by > 30 mV, at the top of charge
  ntc: 3, // two on the cells, one on the MOSFETs
  chargeA: 3, // 0.5 C at the dock
  returnToDockSoc: 0.3, // leave enough for the longest drive back plus a margin
  storageSoc: 0.55,
};
/** Energy for a survey (Wh): drive, turns, always-on electronics, probe axis, cleaning. */
export function surveyEnergy({ metres = 466, probes = 60, turns = 32, speed = 500 } = {}) {
  const driveS = (metres * 1000) / speed;
  const driveW = (TRACTION.rollingN * speed) / 1000 / 0.55; // [A] 55% motor+controller at light load
  const turnWh = turns * ((180 * 3) / 3600); // [A] 180 W of tyre scrub for 3 s per turn in place
  const c = cycle();
  const missionS = driveS + probes * (c.t6 + CLEAN.wetShare * WET_CLEAN_S) + turns * 3;
  const parts = {
    drive: (driveW * driveS) / 3600,
    turns: turnWh,
    electronics: (14 * missionS) / 3600, // [A] Pi 5, MCU, lidar, GNSS, sensors
    probeAxis: (probes * 12 * c.t4) / 3600, // [A] stepper while moving
    cleaning: (probes * (8 * SPEED.blast + CLEAN.wetShare * 8 * (CLEAN.wetS + CLEAN.dryS))) / 3600,
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { parts, total, missionS, driveW };
}
export const POWER = {
  motorLimitW: 200, // [A] per-wheel controller limit; a turn in place needs about 6 N m at 2 rad/s
  peakA: (4 * 200) / BATTERY.vNom,
  rails: [
    ["Drive", "battery 30-43 V, through the e-stop contactor", "2 dual BLDC FOC controllers, current-limited"],
    ["24 V, 3 A", "isolated DC-DC", "probe stepper, Y-rail stepper, scan-arm steppers"],
    ["12 V, 3 A", "DC-DC", "air pump, water pump, solenoid valves, lidar"],
    ["5.1 V, 5 A", "DC-DC with hold-up", "Raspberry Pi 5 and USB cameras"],
    ["Probe, 12 V, 0.2 A", "isolated DC-DC and isolated RS485", "the soil probe: no current path through wet soil"],
  ],
};

// ---- Wear parts and service (all [A] until measured) -----------------------------------------
export const SERVICE = [
  ["Wiper plate (polyurethane)", 5000, "probe cycles", "swap, 2 screws"],
  ["Strip brushes", 10000, "probe cycles", "swap, slide out"],
  ["Pump inlet filter", 20000, "probe cycles", "rinse or swap"],
  ["Belt and lead nut (behind a bellows)", 50000, "probe cycles", "inspect yearly"],
  ["Probe (rods, seal)", 30000, "probe cycles", "or when the reference check drifts"],
  ["Tyres", 300, "km", "sealant top-up each season"],
  ["Battery (LiFePO4)", 2000, "full cycles to 80% capacity", "about 5 years at one charge a day"],
  ["Dock water reservoir (10 L)", 5, "days of 3 surveys", "refill"],
];
export const CYCLES_PER_DAY = 3 * 60;

// ---- Primitive parts for the orthographic drawings -------------------------------------------
const box = (name, group, a, b, bom) => ({ kind: "box", name, group, a, b, bom });
const cyl = (name, group, c, axis, r, len, bom) => ({ kind: "cyl", name, group, c, axis, r, len, bom });

export function parts(travel = 0) {
  const d = DIM;
  const out = [];
  const { r: wr, w: ww, base, track } = d.wheel;
  for (const sy of [1, -1]) {
    const yw = (sy * track) / 2;
    for (const sx of [1, -1]) {
      const x = (sx * base) / 2;
      out.push(cyl("wheel", "chassis", [x, yw, wr], "y", wr, ww, 1));
      out.push(cyl("hub motor", "chassis", [x, yw, wr], "y", d.hub.r, d.hub.w, 1));
      const yb = sy * d.beam.y;
      out.push(box("axle bracket", "chassis", [x - 14, yb - d.axleDrop.w / 2, wr - 14], [x + 14, yb + d.axleDrop.w / 2, d.beam.z0], 2));
    }
    const yb = sy * d.beam.y;
    const bx = base / 2 + d.beam.overhang;
    out.push(box("rocker beam", "chassis", [-bx, yb - d.beam.w / 2, d.beam.z0], [bx, yb + d.beam.w / 2, d.beam.z0 + d.beam.h], 2));
    const b = d.body;
    out.push(cyl("rocker pivot", "chassis", [0, sy * (b.yOut + d.beam.y - d.beam.w / 2) / 2, d.pivot.z], "y", d.pivot.r, d.beam.y - d.beam.w / 2 - b.yOut, 3));
    out.push(box("body side plate", "chassis", [-b.x, sy > 0 ? b.yIn : -b.yOut, b.z0], [b.x, sy > 0 ? b.yOut : -b.yIn, b.z1], 4));
  }
  const b = d.body;
  for (const sx of [1, -1]) {
    const x0 = sx > 0 ? d.bay.x : -b.x;
    const x1 = sx > 0 ? b.x : -d.bay.x;
    out.push(box(sx > 0 ? "front cross box" : "rear cross box (battery)", "chassis", [x0, -b.yIn, b.z0], [x1, b.yIn, b.z1], sx > 0 ? 5 : 6));
  }
  out.push(cyl("differential bar", "chassis", [0, 0, d.diff.z], "y", d.diff.r, d.diff.len, 3));
  for (const sy of [1, -1]) out.push(box("diff link", "chassis", [-5, sy * (d.diff.len / 2) - 5, d.beam.z0 + d.beam.h], [5, sy * (d.diff.len / 2) + 5, d.diff.z], 3));
  out.push(box("rear deck", "module", [d.deck.x0, -b.yOut, d.deck.z0], [d.deck.x1, b.yOut, d.deck.z1], 7));
  const e = d.enclosure;
  out.push(box("electronics enclosure", "module", [e.x0, -e.y, d.deck.z1], [e.x1, e.y, d.deck.z1 + e.h], 8));
  // Probe module: rail across the bay, tower on the rail, cleaning station at the bay floor.
  const r = d.probeRail;
  out.push(box("Y rail", "probe", [-12, -b.yIn, r.z], [12, b.yIn, r.z + 14], 9));
  const tw = d.tower;
  out.push(box("linear axis", "probe", [tw.x0, -tw.y, r.z + 14], [tw.x1, tw.y, tw.z1], 9));
  out.push(box("stepper (belt drive)", "probe", [tw.x1, -21, tw.z1 - 50], [tw.x1 + 42, 21, tw.z1 - 8], 9));
  const st = d.station;
  out.push(cyl("cleaning station", "probe", [0, 0, (st.z0 + st.z1) / 2], "z", st.r, st.z1 - st.z0, 10));
  const p = d.probe;
  const root = p.tip0 + p.needleL - travel;
  const cz = tw.z1 - 30 - travel;
  out.push(box("carriage", "probe", [d.carriage.x0, -d.carriage.y, cz], [d.carriage.x1, d.carriage.y, cz + d.carriage.h], 9));
  out.push(cyl("probe extension", "probe", [0, 0, (root + p.headL + cz) / 2], "z", p.extR, Math.max(1, cz - root - p.headL), 11));
  out.push(cyl("soil probe head", "probe", [0, 0, root + p.headL / 2], "z", p.headR, p.headL, 11));
  for (const x of p.needleX) out.push(cyl("needle", "probe", [x, 0, root - p.needleL / 2], "z", p.needleR, p.needleL, 11));
  const sc = d.scan;
  out.push(box("scan beam", "module", [sc.x0, -sc.y, sc.z0], [sc.x1, sc.y, sc.z1], 12));
  for (const sy of [1, -1]) out.push(box("beam strut", "module", [b.x, sy * 70 - 8, 170], [sc.x0, sy * 70 + 8, 186], 12));
  const l = d.lidar;
  out.push(box("lidar mast", "module", [l.x - 2, -12, b.z1], [l.x + 2, 12, l.z], 13));
  out.push(cyl("2D lidar", "module", [l.x, 0, l.z + 15], "z", l.s / 2, 30, 13));
  out.push(cyl("gnss mast", "module", [d.gnss.x, d.gnss.y, (d.deck.z1 + d.enclosure.h + d.gnss.z) / 2], "z", 6, d.gnss.z - d.deck.z1 - d.enclosure.h, 14));
  out.push(cyl("gnss antenna", "module", [d.gnss.x, d.gnss.y, d.gnss.z + 9], "z", 30, 18, 14));
  out.push(cyl("e-stop", "module", [d.estop.x, d.estop.y, d.deck.z1 + 20], "z", 20, 40, 15));
  return out;
}

export const BOM = [
  [1, "Hub-motor wheels 8.5 in pneumatic, BLDC with halls, 4 (sealant-filled tyres)", "buy"],
  [2, "Side rocker beams 30 x 70 aluminium box, with axle drop brackets, 2", "make"],
  [3, "Rocker pivots (stainless stub shafts, sealed bearings) and differential bar with rod-end links", "make + buy"],
  [4, "Body side plates, 3 mm aluminium, carrying the rocker pivots; cables and air/water lines run along them", "make"],
  [5, "Front cross box: 2 dual-channel BLDC FOC controllers with current sensing (CAN)", "make + buy"],
  [6, "Rear cross box: 12S LiFePO4 6 Ah pack, BMS, main fuse, e-stop contactor, precharge", "make + buy"],
  [7, "Rear deck plate, 3 mm aluminium", "make"],
  [8, "IP65 electronics enclosure: Pi 5, MCU, DC-DC rails, isolated RS485, Gore vent", "buy + make"],
  [9, "Probe module: Y rail, belt linear axis behind a bellows, 24 V stepper with stall detection", "make + buy"],
  [10, "Cleaning station: PU wiper plate, strip brushes, air/water ring; pump, tank 0.5 L, valves", "make + buy"],
  [11, "Soil probe: 3-rod stainless FDR, RS485, VWC + temperature + EC, electropolished rods", "buy"],
  [12, "Front scan beam with drop-down under-leaf camera heads (v1 arms, raised)", "make"],
  [13, "2D lidar on a front mast", "buy"],
  [14, "GNSS antenna (RTK-ready)", "buy"],
  [15, "E-stop, latching, cuts the drive contactor", "buy"],
  [16, "Dock: charging contacts, probe wash cup with brush, reference block, 10 L water reservoir", "make + buy"],
];
