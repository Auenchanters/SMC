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

const { t1, t2, t3, t4, t5, t6 } = D.cycle;
const TOUR = t6 + 2.5;
function cycleAt(t) {
  if (t > 0 && t < t1) return { travel: t * D.speed.approach, phase: "lowering" };
  if (t >= t1 && t < t2) return { travel: D.tip0 + (t - t1) * D.speed.insert, phase: "inserting" };
  if (t >= t2 && t < t3) return { travel: D.stroke, phase: "reading" };
  if (t >= t3 && t < t4) return { travel: D.stroke - (t - t3) * D.speed.retract, phase: "retracting" };
  if (t >= t4 && t < t5) return { travel: 0, phase: "air blast" };
  if (t >= t5 && t < t6) return { travel: 0, phase: "air check" };
  return { travel: 0, phase: "parked" };
}
// Each crumb sticks when its spot on the rod enters the soil, and is scraped off when it reaches the
// bottom of the brush band on the way up; then it falls to the soil (g = 9.81 m/s^2) and stays.
const FALL = Math.sqrt((2 * D.brush[0]) / 9810);
function crumbAt(c, t) {
  const tIn = t1 + c.s / D.speed.insert;
  const brushedAt = t3 + (D.stroke - (D.tip0 - D.brush[0]) - c.s) / D.speed.retract;
  const y = -D.needleR - c.r;
  if (t < tIn) return null;
  if (t < brushedAt) {
    const tip = D.tip0 - cycleAt(t).travel;
    return { at: [c.x, y, tip + c.s], fallen: false };
  }
  const dt = t - brushedAt;
  if (dt < FALL) return { at: [c.x, y - dt * 6, D.brush[0] - 0.5 * 9810 * dt * dt], fallen: false };
  return { at: [c.x, y - FALL * 6, c.r], fallen: true };
}

let travel = 0;
let shown = -1;
let phase = "parked";
let touring = !still.matches;
let cycling = false;
let clock = -1.2;
let manual = 0;
let frame = 0;
let last = 0;
let visible = false;
let idle = 0;
let said = "";

function place() {
  if (Math.abs(travel - shown) >= 0.01) {
    shown = travel;
    const shift = translateAlong(P, [0, 0, -travel]);
    probeEl.setAttribute("transform", shift);
    holdStill(probeEl, shiftOf(shift));
  }
  const live = touring || cycling;
  let onRods = "";
  let fallen = "";
  if (live && clock > 0) {
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
  let jets = "";
  if (phase === "air blast") {
    for (const a of D.nozzles) {
      const from = [Math.cos(a) * (D.rIn - 2), Math.sin(a) * (D.rIn - 2), D.airZ];
      const rodX = D.needleX.reduce((best, x) => (Math.abs(x - from[0]) < Math.abs(best - from[0]) ? x : best), D.needleX[0]);
      const to = [rodX, -D.needleR, D.airZ - 10];
      jets += lineSvg(segment(from, to, P), { tone: "lit" });
    }
  }
  if (jetEl.innerHTML !== jets) jetEl.innerHTML = jets;
}

function say() {
  const depth = Math.max(0, travel - D.tip0);
  const tip = D.tip0 - travel;
  let text;
  if (phase === "reading") text = `reading · ${D.depth} mm into the soil`;
  else if (phase === "retracting" && tip + 70 >= D.brush[0] && tip <= D.brush[1]) text = "retracting · bristles scrape the rods";
  else if (phase === "retracting") text = `retracting · ${depth.toFixed(0)} mm deep`;
  else if (phase === "air blast") text = "air blast · nozzles blow the parked rods dry";
  else if (phase === "air check") text = `air check · must read within ${D.clean.toFixed(2)} of clean air`;
  else if (depth > 0) text = `${phase === "manual" ? "probe" : phase} · ${depth.toFixed(0)} mm deep`;
  else if (travel > 0.5) text = `${phase === "manual" ? "probe" : phase} · tips ${tip.toFixed(0)} mm above soil`;
  else text = "parked · rods clean";
  if (readout.textContent !== text) readout.textContent = text;
  const words = phase === "air blast" || phase === "air check" || (phase === "retracting" && tip <= D.brush[1]) ? "Cleaning the probe" : depth > 0 ? `Probe ${depth.toFixed(0)} millimetres into the soil` : "Parked";
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
    const s = cycleAt(clock);
    target = s.travel;
    phase = s.phase;
  } else {
    target = manual;
    phase = "manual";
  }
  travel = calm || phase !== "manual" ? target : travel + (target - travel) * (1 - Math.exp(-dt / 0.08));
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
  manual = clamp(((event.clientY - box.top) / box.height - 0.25) / 0.5, 0, 1) * D.stroke;
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
  if (event.key === "End") to = D.stroke;
  if (to === null) return;
  event.preventDefault();
  takeOver();
  manual = clamp(to, 0, D.stroke);
  run();
});
place();
say();
