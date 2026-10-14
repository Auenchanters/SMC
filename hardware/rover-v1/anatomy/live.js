const D = __DATA__;
const P = D.P;
const stage = document.querySelector(".rv-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const upper = svg.querySelector('[data-part="probe-up"]');
const lower = svg.querySelector('[data-part="probe-low"]');
const carriageEl = svg.querySelector('[data-part="probe-carriage"]');
const cableEl = svg.querySelector('[data-part="probe-cable"]');
const beamEl = svg.querySelector('[data-part="tof-beam"]');
const armMid = svg.querySelector('[data-part="arm-mid"]');
const armInner = svg.querySelector('[data-part="arm-inner"]');
const armHead = svg.querySelector('[data-part="arm-head"]');
const X = D.axis;
const axisEls = ["tower.rod.low.far", "tower.rod.high.far", "tower.rod.low.near", "tower.rod.high.near", "tower.screw.low", "tower.screw.high"].map((name) => [name, svg.querySelector(`[data-part="${name}"]`)]);
function rodSvg(y, z0, z1) {
  return z1 - z0 < 0.2 ? "" : solidSvg(cylinder(0, y, X.rodR, z0, z1 - z0, P, 28), { tone: "hi", crease: "none" });
}
function screwSvg(z0, z1) {
  if (z1 - z0 < 0.2) return "";
  const F = G.frameOf([X.screwX, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const thread = z1 - z0 > 6 ? fadedSvg(G.ribsOf(F, z0, z1, X.screwR, 8, P, { twist: (30 * (z1 - z0)) / 180, fade: [0.1, 0.55] }), { tone: "lo" }) : "";
  return solidSvg(cylinder(X.screwX, 0, X.screwR, z0, z1 - z0, P, 20), { tone: "mid" }) + thread;
}
function axis(cz) {
  const html = {
    "tower.rod.low.far": rodSvg(-X.rodY, X.baseZ1, cz),
    "tower.rod.high.far": rodSvg(-X.rodY, cz + X.carH, X.topZ0),
    "tower.rod.low.near": rodSvg(X.rodY, X.baseZ1, cz),
    "tower.rod.high.near": rodSvg(X.rodY, cz + X.carH, X.topZ0),
    "tower.screw.low": screwSvg(X.screwZ0, cz),
    "tower.screw.high": screwSvg(cz + 22, X.couplerZ0),
  };
  for (const [name, el] of axisEls) el.innerHTML = html[name];
}
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const shiftOf = (t) => t.match(/-?[\d.]+/g).map(Number);

// One probe cycle, then one under-leaf scan with the left arm, then a pause (model seconds).
const { t1, t2, t3, t4, t5, t6 } = D.cycle;
const A = D.arm;
const armOut = A.inner / A.speed;
const s1 = t6 + 1;
const s2 = s1 + armOut;
const s3 = s2 + A.dwell;
const s4 = s3 + armOut;
const TOUR = s4 + 2;
function tourAt(t) {
  let probe = { travel: 0, phase: "parked" };
  if (t > 0 && t < t1) probe = { travel: t * D.speed.approach, phase: "lowering" };
  else if (t >= t1 && t < t2) probe = { travel: D.tip0 + (t - t1) * D.speed.insert, phase: "inserting" };
  else if (t >= t2 && t < t3) probe = { travel: D.stroke, phase: "reading" };
  else if (t >= t3 && t < t4) probe = { travel: D.stroke - (t - t3) * D.speed.retract, phase: "retracting" };
  else if (t >= t4 && t < t5) probe = { travel: 0, phase: "air blast" };
  else if (t >= t5 && t < t6) probe = { travel: 0, phase: "air check" };
  let ext = 0;
  let arm = "";
  if (t >= s1 && t < s2) { ext = (t - s1) * A.speed; arm = "arm out"; }
  else if (t >= s2 && t < s3) { ext = A.inner; arm = "scanning"; }
  else if (t >= s3 && t < s4) { ext = A.inner - (t - s3) * A.speed; arm = "arm in"; }
  return { ...probe, ext, arm };
}
const depthBelow = (travel) => Math.max(0, travel - D.tip0);
const forceOf = (depth) => (depth <= 0 ? 0 : D.soil.coneMPa * D.area + (D.soil.shaftKPa / 1000) * D.perimeter * depth);
// Rods are in the brush seal while any part of them is in the bristle band.
const inBrushes = (travel) => {
  const tip = D.tip0 - travel;
  return tip <= D.brush[1] && tip + D.needleL >= D.brush[0] && travel > 0.5;
};

function loopRoute(cz) {
  const g = cz + 14;
  const [ex, ey, ez] = D.loop.gland;
  const low = Math.max(D.loop.deckTop + 18, Math.min(g, ez) - 28);
  return [[D.loop.x1 + 6, 0, g], [D.loop.x1 + 14, 0, g], [36, 0, low], [ex - 16, ey, ez], [ex - 7, ey, ez]];
}

let travel = 0;
let ext = 0;
let shownTravel = -1;
let shownExt = -1;
let phase = "parked";
let arm = "";
let touring = !still.matches;
let cycling = false;
let clock = -1.4;
let manual = 0;
let manualExt = 0;
let frame = 0;
let last = 0;
let visible = false;
let idle = 0;
let said = "";

function placeProbe() {
  if (Math.abs(travel - shownTravel) < 0.01) return;
  shownTravel = travel;
  const upShift = translateAlong(P, [0, 0, -travel]);
  for (const el of [upper, carriageEl]) el.setAttribute("transform", upShift);
  holdStill(upper, shiftOf(upShift));
  const lowShift = translateAlong(P, [0, 0, D.stroke - travel]);
  lower.setAttribute("transform", lowShift);
  holdStill(lower, shiftOf(lowShift));
  axis(D.carriageZ0 - travel);
  const route = G.fillet(loopRoute(D.carriageZ0 - travel), 9, 10, { P, tube: D.loop.r });
  cableEl.innerHTML = TB.tubePieces(route, D.loop.r, P, { maxLength: 400 }).map((p) => TB.tubeSvg(p, { tone: "mid" })).join("");
}

// The arm is drawn at extension `A.share` of full travel; slide each stage back from there.
function placeArm() {
  if (Math.abs(ext - shownExt) < 0.01) return;
  shownExt = ext;
  const drawn = A.share * A.inner;
  const midShift = shiftOf(translateAlong(P, [0, (ext - drawn) * (A.mid / A.inner), 0]));
  const inShift = shiftOf(translateAlong(P, [0, ext - drawn, 0]));
  armMid.setAttribute("transform", `translate(${midShift[0]} ${midShift[1]})`);
  holdStill(armMid, midShift);
  for (const el of [armInner, armHead]) el.setAttribute("transform", `translate(${inShift[0]} ${inShift[1]})`);
  holdStill(armHead, inShift);
  // The inner stage's two clips: one rides with the mid stage, one stays with the beam.
  armInner.querySelector('[data-follow="mid"]').setAttribute("transform", `translate(${midShift[0] - inShift[0]} ${midShift[1] - inShift[1]})`);
  armInner.querySelector('[data-follow="beam"]').setAttribute("transform", `translate(${-inShift[0]} ${-inShift[1]})`);
}

function beam() {
  const root = D.needleRoot0 - travel;
  const on = phase === "lowering" && root > 1;
  const html = on ? lineSvg(segment([D.tof[0], D.tof[1], root], [D.tof[0], D.tof[1], 0], P), { tone: "lit" }) + dotsSvg([iso([D.tof[0], D.tof[1], 0], P)], { size: 0.7, tone: "lit" }) : "";
  if (beamEl.innerHTML !== html) beamEl.innerHTML = html;
}

function say() {
  const depth = depthBelow(travel);
  const reach = (D.headRest + ext) / 1000;
  let text;
  if (arm === "scanning") text = `scanning under leaves · camera up · head ${reach.toFixed(2)} m from centre`;
  else if (arm === "arm in" && ext < 70) text = "arm in · window wiped at the beam mouth";
  else if (arm) text = `${arm} · head ${reach.toFixed(2)} m from centre`;
  else if (phase === "manual" && ext > 0.5) text = `arm · head ${reach.toFixed(2)} m from centre`;
  else if (phase === "reading") text = `reading · VWC ${D.reading.toFixed(3)} m³/m³ at ${D.depth} mm`;
  else if (phase === "air blast") text = "air blast · rods blown dry in the well";
  else if (phase === "air check") text = `air check · rods in air must read clean (≤ ${D.clean.toFixed(2)})`;
  else if (depth > 0 && phase === "retracting") text = `retracting · ${depth.toFixed(0)} mm deep · brushing`;
  else if (phase === "retracting" && inBrushes(travel)) text = "retracting · rods through the brush seal";
  else if (depth > 0) text = `${phase === "manual" ? "probe" : phase} · ${depth.toFixed(0)} mm deep · push ${forceOf(depth).toFixed(0)} of ${D.available.toFixed(0)} N`;
  else if (travel > 0.5) text = `${phase === "manual" ? "probe" : phase} · tips ${(D.tip0 - travel).toFixed(0)} mm above soil`;
  else text = "parked · probe up, arms in";
  if (readout.textContent !== text) readout.textContent = text;
  const words = arm ? "Scanning under the leaves with the left arm" : phase === "reading" ? "Reading soil moisture" : phase === "air blast" || phase === "air check" || (phase === "retracting" && inBrushes(travel)) ? "Cleaning the probe" : depth > 0 ? `Probe ${depth.toFixed(0)} millimetres into the soil` : travel > 0.5 ? "Probe lowering" : "Parked";
  if (words !== said) {
    said = words;
    stage.setAttribute("aria-valuenow", String(Math.round(depth)));
    stage.setAttribute("aria-valuetext", words);
  }
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  let targetT;
  let targetE;
  if (touring || cycling) {
    clock += dt * D.playback;
    if (clock > TOUR) {
      clock = -1;
      if (cycling && !touring) cycling = false;
    }
    const s = tourAt(clock);
    targetT = s.travel;
    targetE = s.ext;
    phase = s.phase;
    arm = s.arm;
  } else {
    targetT = manual;
    targetE = manualExt;
    phase = "manual";
    arm = "";
  }
  // The tour follows the motion model exactly, so the phase word and the numbers come from one instant.
  const ease = (v, to) => (calm || phase !== "manual" ? to : v + (to - v) * (1 - Math.exp(-dt / 0.08)));
  travel = ease(travel, targetT);
  ext = ease(ext, targetE);
  if (Math.abs(targetT - travel) < 0.02) travel = targetT;
  if (Math.abs(targetE - ext) < 0.02) ext = targetE;
  placeProbe();
  placeArm();
  beam();
  say();
  const settled = !touring && !cycling && travel === targetT && ext === targetE;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
function takeOver() {
  if (touring || cycling) { manual = travel; manualExt = ext; }
  touring = false;
  cycling = false;
  clearTimeout(idle);
  idle = setTimeout(() => { if (!still.matches) { touring = true; clock = -0.5; run(); } }, 3600);
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  const share = clamp(((event.clientY - box.top) / box.height - 0.25) / 0.5, 0, 1);
  takeOver();
  manual = share * D.stroke;
  run();
});
stage.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    clearTimeout(idle);
    touring = false;
    cycling = true;
    clock = 0;
    run();
    return;
  }
  if (event.key === "a" || event.key === "A") {
    event.preventDefault();
    takeOver();
    manualExt = manualExt > A.inner / 2 ? 0 : A.inner;
    run();
    return;
  }
  let to = null;
  const from = touring || cycling ? travel : manual;
  const step = event.shiftKey ? 40 : 10;
  if (event.key === "ArrowDown") to = from + step;
  if (event.key === "ArrowUp") to = from - step;
  if (event.key === "Home" || event.key === "Escape") to = 0;
  if (event.key === "End") to = D.stroke;
  if (to === null) return;
  event.preventDefault();
  takeOver();
  manual = clamp(to, 0, D.stroke);
  run();
});
placeProbe();
placeArm();
say();
