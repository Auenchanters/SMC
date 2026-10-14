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

const { t1, t2, t3, t4 } = D.cycle;
function probeAt(t) {
  if (t <= 0) return { travel: 0, phase: "parked" };
  if (t < t1) return { travel: t * D.speed.approach, phase: "lowering" };
  if (t < t2) return { travel: D.tip0 + (t - t1) * D.speed.insert, phase: "inserting" };
  if (t < t3) return { travel: D.stroke, phase: "reading" };
  if (t < t4) return { travel: D.stroke - (t - t3) * D.speed.retract, phase: "retracting" };
  return { travel: 0, phase: "parked" };
}
const depthBelow = (travel) => Math.max(0, travel - D.tip0);
const forceOf = (depth) => (depth <= 0 ? 0 : D.soil.coneMPa * D.area + (D.soil.shaftKPa / 1000) * D.perimeter * depth);

function loopRoute(cz) {
  const g = cz + 14;
  const [ex, ey, ez] = D.loop.gland;
  const low = Math.max(D.loop.deckTop + 18, Math.min(g, ez) - 28);
  return [[D.loop.x1 + 6, 0, g], [D.loop.x1 + 14, 0, g], [36, 0, low], [ex - 16, ey, ez], [ex - 7, ey, ez]];
}

let travel = 0;
let shown = -1;
let phase = "parked";
let touring = !still.matches;
let cycling = false;
let clock = -1.4;
let manual = 0;
let frame = 0;
let last = 0;
let visible = false;
let idle = 0;
let said = "";

function place() {
  if (Math.abs(travel - shown) < 0.01) return;
  shown = travel;
  const upShift = translateAlong(P, [0, 0, -travel]);
  for (const el of [upper, carriageEl]) el.setAttribute("transform", upShift);
  const [ux, uy] = upShift.match(/-?[\d.]+/g).map(Number);
  holdStill(upper, [ux, uy]);
  const lowShift = translateAlong(P, [0, 0, D.stroke - travel]);
  lower.setAttribute("transform", lowShift);
  const [lx, ly] = lowShift.match(/-?[\d.]+/g).map(Number);
  holdStill(lower, [lx, ly]);
  axis(D.carriageZ0 - travel);
  const route = G.fillet(loopRoute(D.carriageZ0 - travel), 9, 10, { P, tube: D.loop.r });
  cableEl.innerHTML = TB.tubePieces(route, D.loop.r, P, { maxLength: 400 }).map((p) => TB.tubeSvg(p, { tone: "mid" })).join("");
}

function beam() {
  const root = D.needleRoot0 - travel;
  const on = phase === "lowering" && root > 1;
  const html = on ? lineSvg(segment([D.tof[0], D.tof[1], root], [D.tof[0], D.tof[1], 0], P), { tone: "lit" }) + dotsSvg([iso([D.tof[0], D.tof[1], 0], P)], { size: 0.7, tone: "lit" }) : "";
  if (beamEl.innerHTML !== html) beamEl.innerHTML = html;
}

function say() {
  const depth = depthBelow(travel);
  let text;
  if (phase === "reading") text = `reading · VWC ${D.reading.toFixed(3)} m³/m³ at ${D.depth} mm`;
  else if (depth > 0 && phase === "retracting") text = `retracting · ${depth.toFixed(0)} mm deep`;
  else if (depth > 0) text = `${phase === "manual" ? "probe" : phase} · ${depth.toFixed(0)} mm deep · push ${forceOf(depth).toFixed(0)} of ${D.available.toFixed(0)} N`;
  else if (travel > 0.5) text = `${phase === "manual" ? "probe" : phase} · tips ${(D.tip0 - travel).toFixed(0)} mm above soil`;
  else text = "parked · probe up";
  if (readout.textContent !== text) readout.textContent = text;
  const words = phase === "reading" ? "Reading soil moisture" : depth > 0 ? `Probe ${depth.toFixed(0)} millimetres into the soil` : travel > 0.5 ? "Probe lowering" : "Parked, probe up";
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
    if (clock > t4 + 2 * D.playback) {
      clock = -1;
      if (cycling && !touring) cycling = false;
    }
    const s = probeAt(clock);
    target = s.travel;
    phase = s.phase;
  } else {
    target = manual;
    phase = "manual";
  }
  // The tour follows the motion model exactly, so the phase word and the depth come from one instant.
  travel = calm || phase !== "manual" ? target : travel + (target - travel) * (1 - Math.exp(-dt / 0.06));
  if (Math.abs(target - travel) < 0.02) travel = target;
  place();
  beam();
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
place();
say();
