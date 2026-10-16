const D = __DATA__;
const P = D.P;
const stage = document.querySelector(".cl-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const probeEl = svg.querySelector('[data-part="probe"]');
const crumbEl = svg.querySelector('[data-part="crumbs"]');
const fallenEl = svg.querySelector('[data-part="fallen"]');
const jetEl = svg.querySelector('[data-part="jets"]');
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const shiftOf = (t) => t.match(/-?[\d.]+/g).map(Number);

// One stubborn sample, escalating: the model's cycle (level 0 wipe while retracting, level 1 blast and
// check), then level 2 (a second stroke through the wipers, blast, check), then level 3 (water, dry, check).
const S = D.speed;
const { t1, t2, t3, t4, t5, t6 } = D.cycle;
const FULL = D.tip0 + D.depth;
const RESTROKE = D.root0 - (D.brush.z0 + 2); // the rods pass the wiper plate up past the soil line; the head stops in the brushes
const L2 = { down: t6, up: t6 + RESTROKE / S.approach, blast: t6 + RESTROKE / S.approach + RESTROKE / S.retract };
L2.check = L2.blast + S.blast;
L2.end = L2.check + S.check;
const L3 = { spray: L2.end, dry: L2.end + D.clean.wetS };
L3.check = L3.dry + D.clean.dryS;
L3.end = L3.check + S.check;
const TOUR = L3.end + 3;
function cycleAt(t) {
  if (t > 0 && t < t1) return { travel: t * S.approach, phase: "lowering" };
  if (t >= t1 && t < t2) return { travel: D.tip0 + (t - t1) * S.insert, phase: "inserting" };
  if (t >= t2 && t < t3) return { travel: FULL, phase: "reading" };
  if (t >= t3 && t < t4) return { travel: FULL - (t - t3) * S.retract, phase: "retracting" };
  if (t >= t4 && t < t5) return { travel: 0, phase: "blast", level: 1 };
  if (t >= t5 && t < t6) return { travel: 0, phase: "check", level: 1, reading: D.checks[0] };
  if (t >= L2.down && t < L2.up) return { travel: (t - L2.down) * S.approach, phase: "restroke", level: 2 };
  if (t >= L2.up && t < L2.blast) return { travel: RESTROKE - (t - L2.up) * S.retract, phase: "restroke", level: 2 };
  if (t >= L2.blast && t < L2.check) return { travel: 0, phase: "blast", level: 2 };
  if (t >= L2.check && t < L2.end) return { travel: 0, phase: "check", level: 2, reading: D.checks[1] };
  if (t >= L3.spray && t < L3.dry) return { travel: 0, phase: "spray", level: 3 };
  if (t >= L3.dry && t < L3.check) return { travel: 0, phase: "dry", level: 3 };
  if (t >= L3.check && t < L3.end) return { travel: 0, phase: "check", level: 3, reading: D.checks[2] };
  return { travel: 0, phase: t > 0 ? "done" : "parked" };
}
// Each crumb sticks when its spot on the rod enters the soil. It comes off where its spot crosses the
// wiper plate: on the first retract (sticky 0), on the second stroke's way down (sticky 1), or in the
// water spray (sticky 2). Then it falls to the soil (g = 9.81 m/s^2) and stays.
const tipAt = (t) => D.tip0 - cycleAt(t).travel;
function offAt(c) {
  if (c.sticky === 0) return t3 + (D.leaf.z0 - c.s + D.depth) / S.retract;
  if (c.sticky === 1) return L2.down + (D.tip0 + c.s - D.leaf.z1) / S.approach;
  return L3.spray + 0.15 + (c.s % 7) * 0.1;
}
function crumbAt(c, t) {
  const tIn = t1 + c.s / S.insert;
  if (t < tIn) return null;
  const off = offAt(c);
  const y = -D.needleR - c.r;
  if (t < off) return { at: [c.x, y, tipAt(t) + c.s], fallen: false };
  const from = c.sticky === 2 ? D.tip0 + c.s : D.leaf.z0;
  const fall = Math.sqrt((2 * from) / 9810);
  const dt = t - off;
  if (dt < fall) return { at: [c.x, y - dt * 6, from - 0.5 * 9810 * dt * dt], fallen: false };
  return { at: [c.x, y - fall * 6, c.r], fallen: true };
}

let travel = 0;
let shown = -1;
let state = { phase: "parked" };
let touring = !still.matches;
let cycling = false;
let clock = -1.2;
let manual = 0;
let frame = 0;
let last = 0;
let visible = false;
let idle = 0;
let said = "";

function jetLines(water) {
  let out = "";
  for (const a of D.nozzles) {
    const from = [Math.cos(a) * (D.bore - 2), Math.sin(a) * (D.bore - 2), D.ringZ];
    const rodX = D.needleX.reduce((best, x) => (Math.abs(x - from[0]) < Math.abs(best - from[0]) ? x : best), D.needleX[0]);
    out += lineSvg(segment(from, [rodX, -D.needleR, D.ringZ + 24], P), { tone: water ? "hi" : "lit" });
  }
  return water ? `<g class="cl-water">${out}</g>` : out;
}

function place() {
  if (Math.abs(travel - shown) >= 0.01) {
    shown = travel;
    const shift = translateAlong(P, [0, 0, -travel]);
    probeEl.setAttribute("transform", shift);
    holdStill(probeEl, shiftOf(shift));
  }
  let onRods = "";
  let fallen = "";
  if ((touring || cycling) && clock > 0) {
    for (const c of D.crumbs) {
      const s = crumbAt(c, clock);
      if (!s) continue;
      const [x, y] = iso(s.at, P);
      const circle = `<circle class="cl-crumb" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(c.r * 0.9 * D.scale).toFixed(2)}"/>`;
      if (s.fallen) fallen += circle;
      else onRods += circle;
    }
  }
  if (crumbEl.innerHTML !== onRods) crumbEl.innerHTML = onRods;
  if (fallenEl.innerHTML !== fallen) fallenEl.innerHTML = fallen;
  const p = state.phase;
  const jets = p === "blast" || p === "dry" ? jetLines(false) : p === "spray" ? jetLines(true) : "";
  if (jetEl.innerHTML !== jets) jetEl.innerHTML = jets;
}

function say() {
  const depth = Math.max(0, travel - D.tip0);
  const tip = D.tip0 - travel;
  const p = state.phase;
  const L = state.level;
  let text;
  if (p === "reading") text = `reading · ${D.depth} mm into the soil`;
  else if (p === "retracting" && tip + D.needleL >= D.leaf.z0 && tip <= D.brush.z1) text = "level 0 · wiper plate and brushes scrape the rods";
  else if (p === "retracting") text = `retracting · ${depth.toFixed(0)} mm deep`;
  else if (p === "blast") text = `level ${L} · air knife, ${S.blast} s`;
  else if (p === "check") text = `level ${L} · air check +${state.reading.toFixed(3)} · ${state.reading <= D.clean.airMax ? "clean" : "fail"}`;
  else if (p === "restroke") text = "level 2 · second stroke through the wipers";
  else if (p === "spray") text = `level 3 · water spray, ${D.clean.wetMl} mL`;
  else if (p === "dry") text = `level 3 · drying with air, ${D.clean.dryS} s`;
  else if (depth > 0) text = `${p === "manual" ? "probe" : p} · ${depth.toFixed(0)} mm deep`;
  else if (travel > 0.5) text = `${p === "manual" ? "probe" : p} · tips ${tip.toFixed(0)} mm above soil`;
  else text = p === "done" ? "parked · rods proved clean" : "parked · rods clean";
  if (readout.textContent !== text) readout.textContent = text;
  const words = L ? `Cleaning, level ${L}` : depth > 0 ? `Probe ${depth.toFixed(0)} millimetres into the soil` : "Parked";
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
  let target;
  if (touring || cycling) {
    clock += dt * D.playback;
    if (clock > TOUR) {
      clock = -0.5;
      if (cycling && !touring) cycling = false;
    }
    state = cycleAt(clock);
    target = state.travel;
  } else {
    target = manual;
    state = { phase: "manual" };
  }
  travel = calm || touring || cycling ? target : travel + (target - travel) * (1 - Math.exp(-dt / 0.08));
  if (Math.abs(target - travel) < 0.02) travel = target;
  place();
  say();
  const settled = !touring && !cycling && travel === target;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
function takeOver() {
  if (touring || cycling) manual = travel;
  touring = false;
  cycling = false;
  clearTimeout(idle);
  idle = setTimeout(() => { if (!still.matches) { touring = true; clock = -0.5; run(); } }, 3600);
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  takeOver();
  manual = clamp(((event.clientY - box.top) / box.height - 0.25) / 0.5, 0, 1) * FULL;
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
  let to = null;
  const from = touring || cycling ? travel : manual;
  if (event.key === "ArrowDown") to = from + (event.shiftKey ? 40 : 10);
  if (event.key === "ArrowUp") to = from - (event.shiftKey ? 40 : 10);
  if (event.key === "Home" || event.key === "Escape") to = 0;
  if (event.key === "End") to = FULL;
  if (to === null) return;
  event.preventDefault();
  takeOver();
  manual = clamp(to, 0, FULL);
  run();
});
place();
say();
