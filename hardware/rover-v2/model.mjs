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
  // Differential bar across the front box (not over the bay, where the probe tower stands): it rocks
  // about a fore-aft pin, and links drop to the beams 125 mm ahead of their pivots. It sits high
  // enough to rock about 19 deg each way (a 100 mm clod under one wheel) without touching the lid.
  diff: { x: 125, z: 300, len: 262, r: 8, pin: 10 },
  deck: { x0: -175, x1: -95, z0: 250, z1: 254 }, // rear deck over the battery box
  enclosure: { x0: -172, x1: -98, y: 76, h: 86 }, // electronics, behind the bay
  // Two sideways rails across the bay, resting on the side plates fore and aft of the probe axis; the
  // probe passes between them. The probe axis can sit at |y| <= 60 (bay half-width 105).
  probeRail: { y: 60, z: 250, x: 30, w: 12, h: 12 },
  sled: { x: 48, y: 36, h: 6 }, // rides the rails; carries the linear axis and hangs the cleaning station
  // Belt-driven linear axis behind a bellows, standing on the sled; stepper beside it near the top. Its
  // height z1 is not set here: it follows from the stroke (below), so the carriage never goes below the sled.
  // stop: the bellows below the carriage, fully compressed at full stroke [A] (about 1:10 of its stroke).
  tower: { x0: -40, x1: 40, y: 34, back: 4, stop: 30, cap: 10, motorX: 52 },
  carriage: { x0: -26, x1: 26, y: 30, h: 26 },
  station: { r: 34, z0: 150, z1: 205, bore: 22, hangerX: 42 }, // cleaning station: wipers, brushes, air/water ring
  probe: {
    needleR: 1.5, needleL: 70, needleX: [-12, 0, 12], // 3-rod stainless FDR probe, RS485
    headR: 18, headL: 50, extR: 8, // the head hangs from the carriage on an extension rod
    tip0: 210, // parked tips: just above the station; its nozzle ring blows up along them
    depth: 60, // insertion depth below the local surface
    groundSlack: 20, // extra stroke for a surface lower than level; deeper than this, shift on the rail or fail the reading
  },
  scan: { x0: 280, x1: 310, z0: 150, z1: 190, y: 185, headZ: 95 }, // camera beam, heads drop to 95
  lidar: { x: 150, z: 330, s: 40 }, // on the front box, ahead of the probe axis
  gnss: { x: -150, y: 0, z: 400 },
  estop: { x: -150, y: -95 },
  waterTank: { ml: 500 },
};

const P = DIM.probe;
export const STROKE = P.tip0 + P.depth + P.groundSlack;

// ---- The probe axis, from the stroke ----------------------------------------------------------
// At full stroke the carriage sits on the compressed bellows on the sled, and STROKE higher when parked; the axis
// is just tall enough for that. The extension rod is the only part that passes the cleaning station.
const RAIL_TOP = DIM.probeRail.z + DIM.probeRail.h;
export const AXIS_Z0 = RAIL_TOP + DIM.sled.h; // the axis stands on the sled
export const CARRIAGE_Z0 = AXIS_Z0 + DIM.tower.stop + STROKE; // carriage underside, parked
export const NEEDLE_ROOT0 = P.tip0 + P.needleL; // head underside, parked
export const EXT_L = CARRIAGE_Z0 - (NEEDLE_ROOT0 + P.headL); // extension rod, head to carriage
DIM.tower.z1 = CARRIAGE_Z0 + DIM.carriage.h + DIM.tower.cap;
{
  const fail = (why) => {
    throw new Error(`model.mjs, probe axis: ${why}`);
  };
  const st = DIM.station;
  const r = DIM.probeRail;
  if (CARRIAGE_Z0 - STROKE < RAIL_TOP) fail("the carriage goes below the rail top at full stroke");
  if (P.tip0 <= st.z1) fail("the parked probe tips must clear the cleaning station");
  if (P.extR >= st.bore || P.headR >= st.bore) fail("the extension rod or the probe head does not pass the station bore");
  if (r.x - r.w / 2 <= P.headR) fail("the probe head does not pass between the rails");
  if (CARRIAGE_Z0 - STROKE <= st.z1) fail("only the extension rod and the probe may pass the cleaning station");
}

export const OVERALL = {
  length: DIM.scan.x1 + DIM.wheel.r + DIM.wheel.base / 2 + 4, // beam front to rear tyre + guard
  width: DIM.wheel.track + DIM.wheel.w,
  height: Math.max(DIM.tower.z1, DIM.gnss.z + 18), // the probe axis is the highest part
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
  ["probe module (rails, sled, linear axis and bellows, stepper, carriage, probe)", 1.9, 0, 0, 400],
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
  beamTiltDeg: deg(rockerPose({ fl: 100 }).left.th),
  bodyPitchDeg: deg(rockerPose({ fl: 100 }).pitch),
  // Braking from top speed in 0.25 s: the deceleration needed to tip it over is far larger.
  tipDecelG: (DIM.wheel.base / 2 - Math.abs(CG[0])) / CG[2],
};

/** Rocker-differential pose from the ground height (mm) under each wheel: front/rear, left/right.
 *  Each beam pitches about its pivot to keep both its wheels down (nose up is positive, radians);
 *  the differential bar turns the beams equal and opposite relative to the body, so the body
 *  pitches by their mean. z is how far the body rises; roll is its tilt toward the right. */
export function rockerPose({ fl = 0, rl = 0, fr = 0, rr = 0 } = {}) {
  const drop = DIM.pivot.z - DIM.wheel.r; // pivot above the axle line
  const side = (f, r) => {
    const th = Math.asin(Math.max(-1, Math.min(1, (f - r) / DIM.wheel.base))); // the axles stay a wheelbase apart
    return { th, pivotZ: DIM.wheel.r + (f + r) / 2 + drop * Math.cos(th) };
  };
  const left = side(fl, rl);
  const right = side(fr, rr);
  const pitch = (left.th + right.th) / 2;
  return {
    left: { ...left, rel: left.th - pitch },
    right: { ...right, rel: right.th - pitch },
    pitch,
    roll: Math.atan2(left.pivotZ - right.pivotZ, 2 * DIM.beam.y),
    z: (left.pivotZ + right.pivotZ) / 2 - DIM.pivot.z,
  };
}

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
/** Probe travel (mm, 0 = parked, tip0 + depth = full depth on level ground) and phase at time t of one cycle. */
export function probeAt(t) {
  const { t1, t2, t3, t4, t5, t6 } = cycle();
  const full = P.tip0 + P.depth;
  if (t <= 0) return { travel: 0, phase: "parked" };
  if (t < t1) return { travel: t * SPEED.approach, phase: "lowering" };
  if (t < t2) return { travel: P.tip0 + (t - t1) * SPEED.insert, phase: "inserting" };
  if (t < t3) return { travel: full, phase: "reading" };
  if (t < t4) return { travel: full - (t - t3) * SPEED.retract, phase: "retracting" };
  if (t < t5) return { travel: 0, phase: "air blast" };
  if (t < t6) return { travel: 0, phase: "air check" };
  return { travel: 0, phase: "parked" };
}

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
  ["Belt and carriage bearings (behind a bellows)", 50000, "probe cycles", "inspect yearly"],
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
  const df = d.diff;
  out.push(box("diff pivot", "chassis", [df.x - df.pin, -df.pin, b.z1], [df.x + df.pin, df.pin, df.z - df.r], 3));
  out.push(cyl("differential bar", "chassis", [df.x, 0, df.z], "y", df.r, df.len, 3));
  for (const sy of [1, -1]) out.push(box("diff link", "chassis", [df.x - 5, sy * d.beam.y - 5, d.beam.z0 + d.beam.h], [df.x + 5, sy * d.beam.y + 5, df.z - df.r], 3));
  out.push(box("rear deck", "module", [d.deck.x0, -b.yOut, d.deck.z0], [d.deck.x1, b.yOut, d.deck.z1], 7));
  const e = d.enclosure;
  out.push(box("electronics enclosure", "module", [e.x0, -e.y, d.deck.z1], [e.x1, e.y, d.deck.z1 + e.h], 8));
  // Probe module: two rails across the bay, a sled on them carrying the linear axis, the cleaning
  // station hanging under the sled, and the carriage with the probe on its extension rod.
  const r = d.probeRail;
  for (const sx of [1, -1]) out.push(box("Y rail", "probe", [sx * r.x - r.w / 2, -b.yOut, r.z], [sx * r.x + r.w / 2, b.yOut, r.z + r.h], 9));
  const sz = r.z + r.h;
  out.push(box("sled", "probe", [-d.sled.x, -d.sled.y, sz], [d.sled.x, d.sled.y, sz + d.sled.h], 9));
  const tw = d.tower;
  out.push(box("linear axis", "probe", [tw.x0, -tw.y, AXIS_Z0], [tw.x1, -tw.y + tw.back, tw.z1 - tw.cap], 9));
  out.push(box("axis top plate", "probe", [tw.x0, -tw.y, tw.z1 - tw.cap], [tw.x1, tw.y, tw.z1], 9));
  out.push(box("stepper (belt drive)", "probe", [tw.x1, -21, tw.z1 - 50], [tw.x1 + 42, 21, tw.z1 - 8], 9));
  const st = d.station;
  out.push(cyl("cleaning station", "probe", [0, 0, (st.z0 + st.z1) / 2], "z", st.r, st.z1 - st.z0, 10));
  for (const sx of [1, -1]) out.push(box("station hanger", "probe", [sx * st.hangerX - 4, -6, st.z1], [sx * st.hangerX + 4, 6, sz], 10));
  const p = d.probe;
  const root = NEEDLE_ROOT0 - travel;
  const cz = CARRIAGE_Z0 - travel;
  const ca = d.carriage;
  out.push(box("carriage", "probe", [ca.x0, -tw.y + tw.back, cz], [ca.x1, ca.y, cz + ca.h], 9));
  out.push(cyl("probe extension", "probe", [0, 0, (root + p.headL + cz) / 2], "z", p.extR, EXT_L, 11));
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
  [9, "Probe module: two Y rails and a sled; belt linear axis behind a bellows; 24 V stepper with stall detection", "make + buy"],
  [10, "Cleaning station: PU wiper plate, strip brushes, air/water ring; pump, tank 0.5 L, valves", "make + buy"],
  [11, "Soil probe: 3-rod stainless FDR, RS485, VWC + temperature + EC, electropolished rods", "buy"],
  [12, "Front scan beam with drop-down under-leaf camera heads (v1 arms, raised)", "make"],
  [13, "2D lidar on a front mast", "buy"],
  [14, "GNSS antenna (RTK-ready)", "buy"],
  [15, "E-stop, latching, cuts the drive contactor", "buy"],
  [16, "Dock: charging contacts, probe wash cup with brush, reference block, 10 L water reservoir", "make + buy"],
];
