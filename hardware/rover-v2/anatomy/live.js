const D = __DATA__;
const P = D.P;
const DIM = D.dim;
// The model's own rocker kinematics, carried over as source so the page and the model cannot disagree.
const rockerPose = new Function("DIM", `return (${D.rockerPose});`)(DIM);
const K = { solidSvg, lineSvg, dotsSvg, iso, pathOf };
const stage = document.querySelector(".rv-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const ridesOf = (ride) => [...svg.querySelectorAll(`[data-ride="${ride}"]`)];
const BODY = ridesOf("body");
const MODULE = ridesOf("module");
const WHEELS = D.wheels.map((w) => ({ ...w, els: ridesOf(`wheel.${w.id}`) }));
const PADS = D.pads.map((p) => ({ ...p, els: ridesOf(`pad.${p.id}`), ram: svg.querySelector(`[data-part="ram-${p.id}"]`) }));
const partEl = {};
svg.querySelectorAll("[data-part]").forEach((el) => (partEl[el.dataset.part] = el));
const PROBE = ["probe-top", "probe-mid", "probe-low"].map((name) => partEl[name]);
const SOIL = svg.querySelector("[data-soil]");
const SOIL_ITEM = SOIL.closest("[data-ride]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deg = (r) => (r * 180) / Math.PI;
const shiftOf = (t) => t.match(/-?[\d.]+/g).map(Number);
const move = (els, by) => {
  const t = translateAlong(P, by);
  for (const el of els) el.setAttribute("transform", t);
  return t;
};
const usableAt = (y) => D.usable[clamp(Math.round(Math.abs(y)), 0, D.railMax)];
const forceOf = (depth) => (depth <= 0 ? 0 : D.soil.coneMPa.dry * D.area + (D.soil.shaftKPa.dry / 1000) * D.perimeter * depth);

// ---- the chain coil on the magazine's near cheek: its outer turn shrinks as the chain pays out
function coilSvg(travel) {
  const C = D.chain;
  const stored = (Math.PI * (C.drumR ** 2 - C.hub ** 2)) / C.strand;
  const rOut = Math.sqrt(C.hub ** 2 + (Math.max(0, stored - travel) * C.strand) / Math.PI);
  const turns = (rOut - C.hub) / C.strand;
  const n = Math.max(2, Math.round(turns * 48));
  const at = (x, z) => iso([x, C.width / 2 + 0.05, z], P);
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    const a = -u * turns * Math.PI * 2;
    const r = C.hub + u * (rOut - C.hub);
    return at(C.drumX + Math.cos(a) * r, C.drumZ + Math.sin(a) * r);
  });
  // The chain's free end runs out to the rim, where it leaves for the guides.
  const rim = C.drumR - 1.5;
  const aEnd = -turns * Math.PI * 2;
  pts.push(at(C.drumX + Math.cos(aEnd) * rim, C.drumZ + Math.sin(aEnd) * rim));
  const circle = (r) => pathOf(Array.from({ length: 49 }, (_, i) => at(C.drumX + Math.cos((i / 48) * Math.PI * 2) * r, C.drumZ + Math.sin((i / 48) * Math.PI * 2) * r)), true);
  return lineSvg(pathOf(pts), { tone: "lo" }) + lineSvg(circle(C.hub), { tone: "mid" }) + lineSvg(circle(rim), { tone: "faint" });
}
// Behind the notch the soil hides the rods below its surface (the line where it meets the probe's plane).
function soilClip(y) {
  if (y > D.notchY0 - D.needleR - 0.5) return "M-2000 -2000H4000V4000H-2000Z";
  const a = iso([-1000, y, 0], P);
  const b = iso([1000, y, 0], P);
  return `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}L${b[0].toFixed(2)} -2000L${a[0].toFixed(2)} -2000Z`;
}

// ---- place everything for one state: twist lift, rail offset, probe travel
const shown = { lift: -1, rail: null, travel: -1 };
let S = rockerState(DIM, rockerPose, 0);
function place(lift, rail, travel) {
  const liftMoved = Math.abs(lift - shown.lift) >= 0.02;
  if (liftMoved) S = rockerState(DIM, rockerPose, lift);
  const bz = S.bodyZ - D.rest.bodyZ;
  if (liftMoved) {
    move(BODY, [0, 0, bz]);
    for (const w of WHEELS) {
      const side = w.sy > 0 ? "near" : "far";
      const end = w.sx > 0 ? "front" : "rear";
      const [x0, z0] = D.rest[side][end];
      const [x1, z1] = S[side][end];
      move(w.els, [x1 - x0, 0, z1 - z0]);
    }
    for (const pad of PADS) {
      const t = move(pad.els, [0, 0, lift]);
      for (const el of pad.els) holdStill(el, shiftOf(t));
      pad.ram.innerHTML = lift - D.padT > 0.4 ? solidSvg(cylinder(pad.x, pad.y, 16, -D.padT, lift, P, 40), { tone: "hi" }) : "";
    }
    for (const item of rockerItems({ k: K, G, A: null }, P, DIM, S)) if (partEl[item.name]) partEl[item.name].innerHTML = item.svg;
  }
  if (liftMoved || shown.rail === null || Math.abs(rail - shown.rail) >= 0.01) {
    const t = move(MODULE, [0, rail, bz]);
    holdStill(SOIL_ITEM, shiftOf(t));
    SOIL.setAttribute("d", soilClip(rail));
  }
  if (Math.abs(travel - shown.travel) >= 0.01) {
    const t = translateAlong(P, [0, 0, -travel]);
    for (const el of PROBE) el.setAttribute("transform", t);
    partEl.coil.innerHTML = coilSvg(travel);
  }
  shown.lift = lift;
  shown.rail = rail;
  shown.travel = travel;
}

// ---- tour (model seconds): a probe cycle, a shift along the rail and back, a twist up and down
const { t1, t2, t3, t4, t5, t6 } = D.cycle;
const SP = D.speed;
const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(u, 0, 1));
const R0 = t6 + 1;
const RAIL = { out: 3, hold: 3 };
const W0 = R0 + 2 * RAIL.out + RAIL.hold + 1;
const TWIST = { up: 6, hold: 4 };
const TOUR = W0 + 2 * TWIST.up + TWIST.hold + 3;
function tourAt(t) {
  const s = { travel: 0, rail: 0, lift: 0, phase: "parked" };
  if (t > 0 && t < t1) return { ...s, travel: t * SP.approach, phase: "lowering" };
  if (t >= t1 && t < t2) return { ...s, travel: D.tip0 + (t - t1) * SP.insert, phase: "inserting" };
  if (t >= t2 && t < t3) return { ...s, travel: D.full, phase: "reading" };
  if (t >= t3 && t < t4) return { ...s, travel: D.full - (t - t3) * SP.retract, phase: "retracting" };
  if (t >= t4 && t < t5) return { ...s, phase: "air blast" };
  if (t >= t5 && t < t6) return { ...s, phase: "air check" };
  const r = t - R0;
  if (r >= 0 && r < 2 * RAIL.out + RAIL.hold) {
    const u = r < RAIL.out ? ease(r / RAIL.out) : r < RAIL.out + RAIL.hold ? 1 : 1 - ease((r - RAIL.out - RAIL.hold) / RAIL.out);
    return { ...s, rail: -D.railMax * u, phase: "rail" };
  }
  const w = t - W0;
  if (w >= 0 && w < 2 * TWIST.up + TWIST.hold) {
    const u = w < TWIST.up ? ease(w / TWIST.up) : w < TWIST.up + TWIST.hold ? 1 : 1 - ease((w - TWIST.up - TWIST.hold) / TWIST.up);
    return { ...s, lift: D.maxLift * u, phase: "twist" };
  }
  return s;
}

let state = { travel: 0, rail: 0, lift: 0, phase: "parked" };
const now3 = { travel: 0, rail: 0, lift: 0 };
let touring = !still.matches;
let cycling = false;
let clock = -1.2;
let manual = { travel: 0, rail: 0, lift: 0 };
let frame = 0;
let last = 0;
let visible = false;
let idle = 0;
let said = "";

function say() {
  const { travel, rail, lift } = now3;
  const phase = state.phase;
  const depth = Math.max(0, travel - D.tip0);
  const tip = D.tip0 - travel;
  const side = Math.abs(rail) < 0.5 ? "centred" : `${Math.abs(rail).toFixed(0)} mm ${rail < 0 ? "right" : "left"}`;
  const inStation = tip + D.needleL >= D.station.z0 && tip <= D.station.z1;
  let text;
  if (lift > 0.5) text = `twist ${lift.toFixed(0)} mm · beams ±${Math.abs(deg(S.near.th)).toFixed(1)}° · body level +${(S.bodyZ - D.rest.bodyZ).toFixed(0)} mm`;
  else if (phase === "rail" || (phase === "manual" && Math.abs(rail) > 0.5 && travel < 0.5)) text = `rail · probe ${side} · ${usableAt(rail).toFixed(0)} N usable`;
  else if (phase === "reading") text = `reading · ${D.depth} mm deep`;
  else if (phase === "retracting" && depth <= 0 && inStation) text = "retracting · wipers scrape the rods";
  else if (phase === "air blast") text = `air knife · ${SP.blast} s`;
  else if (phase === "air check") text = `air check · within ${D.clean} of clean air`;
  else if (depth > 0) text = `${phase === "manual" ? "probe" : phase} · ${depth.toFixed(0)} mm · dry push ${forceOf(depth).toFixed(0)}/${usableAt(rail).toFixed(0)} N`;
  else if (travel > 0.5) text = `${phase === "manual" ? "probe" : phase} · tips ${tip.toFixed(0)} mm above soil`;
  else text = "parked · probe up";
  if (readout.textContent !== text) readout.textContent = text;
  const words = lift > 0.5 ? `Twist of ${lift.toFixed(0)} millimetres, body level` : phase === "rail" ? `Probe shifted ${side} on its rail` : depth > 0 ? `Probe ${depth.toFixed(0)} millimetres into the soil` : travel > 0.5 ? "Probe moving" : "Parked";
  if (words !== said) {
    said = words;
    stage.setAttribute("aria-valuenow", String(Math.round(depth)));
    stage.setAttribute("aria-valuetext", words);
  }
}

function tick(time) {
  const dt = last ? Math.min((time - last) / 1000, 1 / 30) : 1 / 60;
  last = time;
  const calm = still.matches;
  let target;
  if (touring || cycling) {
    clock += dt * D.playback;
    if (clock > TOUR) {
      clock = -1;
      if (cycling && !touring) cycling = false;
    }
    state = tourAt(clock);
    target = state;
  } else {
    state = { ...manual, phase: "manual" };
    target = manual;
  }
  // The tour follows the motion model exactly; manual moves ease toward the pointer or key.
  for (const key of ["travel", "rail", "lift"]) {
    const v = calm || touring || cycling ? target[key] : now3[key] + (target[key] - now3[key]) * (1 - Math.exp(-dt / 0.12));
    now3[key] = Math.abs(target[key] - v) < 0.02 ? target[key] : v;
  }
  place(now3.lift, now3.rail, now3.travel);
  say();
  const settled = !touring && !cycling && ["travel", "rail", "lift"].every((key) => now3[key] === target[key]);
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
function takeOver() {
  if (touring || cycling) manual = { ...now3 };
  touring = false;
  cycling = false;
  clearTimeout(idle);
  idle = setTimeout(() => { if (!still.matches) { touring = true; clock = -0.5; run(); } }, 3600);
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  takeOver();
  manual.travel = clamp(((event.clientY - box.top) / box.height - 0.25) / 0.5, 0, 1) * D.full;
  run();
});
stage.addEventListener("keydown", (event) => {
  const key = event.key;
  if (key === " " || key === "Enter") {
    event.preventDefault();
    clearTimeout(idle);
    touring = false;
    cycling = true;
    clock = 0;
    run();
    return;
  }
  if (key === "r" || key === "R" || key === "t" || key === "T") {
    event.preventDefault();
    takeOver();
    if (key === "r" || key === "R") manual.rail = manual.rail < -D.railMax / 2 ? 0 : -D.railMax;
    else manual.lift = manual.lift > D.maxLift / 2 ? 0 : D.maxLift;
    run();
    return;
  }
  let to = null;
  const from = touring || cycling ? now3.travel : manual.travel;
  const step = event.shiftKey ? 40 : 10;
  if (key === "ArrowDown") to = from + step;
  if (key === "ArrowUp") to = from - step;
  if (key === "Home" || key === "Escape") to = 0;
  if (key === "End") to = D.full;
  if (to === null) return;
  event.preventDefault();
  takeOver();
  manual.travel = clamp(to, 0, D.full);
  run();
});
place(0, 0, 0);
say();
