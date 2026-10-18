// 3D replay of one agrisim survey. Everything shown comes from scene.json (written by
// `agrisim run --view`); the rover is built from rover-model.mjs, the hardware design's model.
// This file wires the modules in js/ together and runs the frame loop.
import { createCamera } from "./js/camera.js";
import { loadSurvey } from "./js/data.js";
import { buildField, buildTrees } from "./js/field.js";
import { createHud } from "./js/hud.js";
import { createLayers, moistureColour } from "./js/layers.js";
import { buildMarkers } from "./js/markers.js";
import { createMinimap } from "./js/minimap.js";
import { createPlayback } from "./js/playback.js";
import { createRain } from "./js/rain.js";
import { buildPlants } from "./js/plants.js";
import { QUALITY, createView } from "./js/render.js";
import { buildRover } from "./js/rover.js";
import { buildScatter } from "./js/scatter.js";
import * as THREE from "three";

const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
// A frame, or 60 ms in a background tab (which gets no frames), so loading never stalls.
const nextFrame = () => new Promise((ok) => (requestAnimationFrame(ok), setTimeout(ok, 60)));
// The loading screen ticks off each real step; the browser gets a frame to show it.
async function stage(name, work) {
  const li = document.querySelector(`#loadSteps [data-step="${name}"]`);
  li.className = "now";
  await nextFrame();
  const out = await work();
  li.className = "done";
  return out;
}
// Graphics: ?quality=low|medium|high|auto, else the viewer's last choice, else auto.
const saved = (() => {
  try {
    return localStorage.getItem("agrisim.quality");
  } catch {
    return null;
  }
})();
let qualityChoice = query.get("quality") ?? saved ?? "auto";
const startQuality = qualityChoice === "auto" ? "medium" : qualityChoice;
const low = startQuality === "low";

let D;
try {
  D = await stage("data", () => loadSurvey(query.get("scene") ?? "run/scene.json"));
} catch (err) {
  const box = $("loadError");
  box.hidden = false;
  box.innerHTML = `<p>Could not load the survey data (${err.message}). Make a survey with a 3D replay, then open it:</p><code>uv run agrisim run --config configs/demo.yaml --seed 7 --view</code><div class="row"><button id="retry">Try again</button></div>`;
  $("retry").onclick = () => location.reload();
  document.querySelector('#loadSteps [data-step="data"]').className = "";
  throw err;
}

const view = await stage("sky", () => createView(D, startQuality));
const { field, scatter, layers, rain } = await stage("field", () => {
  const field = buildField(view, D, { low }); // also sets D.ground(x, y), used by everything below
  buildPlants(view, D, { low });
  const scatter = buildScatter(view, D, { low });
  buildTrees(view, D);
  return { field, scatter, layers: createLayers(D, field), rain: createRain(view, D, field) };
});
const { rover, marks } = await stage("rover", () => ({ rover: buildRover(view), marks: buildMarkers(view, D) }));
marks.colour(moistureColour);
const cam = createCamera(view, D);
const hud = createHud(D, view, marks);
const play = createPlayback(D, { playing: !query.has("paused") });
play.onPreview = hud.preview;

// One selected reading, shared by the 3D view and the mini-map.
let selected = null;
function select(i) {
  selected = i;
  marks.select(i);
  map.select(i);
}
const map = createMinimap(D, {
  onPick(i) {
    select(i);
    if (i != null) play.goTo(i);
  },
  onHover: hud.showTip,
});
hud.onSelect = select;

const setLayer = (i) => layers.set(i, D.readingsBy(play.t));
layers.onPick = setLayer;

// Phone layout: one panel at a time above the playback bar.
function setSheet(name) {
  document.body.dataset.sheet = name;
  for (const b of $("sheetTabs").children) b.setAttribute("aria-pressed", String(b.dataset.sheet === name));
}
for (const b of $("sheetTabs").children) b.onclick = () => setSheet(b.dataset.sheet);
// The side columns end just above the playback bar, however tall it wraps.
new ResizeObserver(([e]) => document.documentElement.style.setProperty("--play-h", `${Math.ceil(e.borderBoxSize[0].blockSize)}px`)).observe($("play"));

// Auto: watch real frame times for a few seconds and step the quality down (or up) once or twice.
const autoQuality = { frames: 0, sum: 0, checks: 0 };
const qualityPicker = $("quality");
qualityPicker.value = qualityChoice;
qualityPicker.onchange = () => {
  qualityChoice = qualityPicker.value;
  try {
    localStorage.setItem("agrisim.quality", qualityChoice);
  } catch {
    // private window or blocked storage: the choice just is not remembered
  }
  autoQuality.checks = 0;
  if (qualityChoice !== "auto") view.setQuality(qualityChoice);
};
function tuneQuality(ms) {
  if (qualityChoice !== "auto" || autoQuality.checks >= 3) return;
  autoQuality.frames++;
  if (autoQuality.frames <= 30) return; // skip start-up frames (shader compiles)
  autoQuality.sum += ms;
  if (autoQuality.frames < 150) return;
  const avg = autoQuality.sum / (autoQuality.frames - 30);
  const names = Object.keys(QUALITY);
  const now = names.indexOf(Object.keys(QUALITY).find((n) => QUALITY[n] === view.quality));
  const next = avg > 33 ? now - 1 : avg < 14 ? now + 1 : now;
  if (next !== now && next >= 0 && next < names.length) view.setQuality(names[next]);
  Object.assign(autoQuality, { frames: 0, sum: 0, checks: autoQuality.checks + 1 });
}

addEventListener("keydown", (e) => {
  if ($("help").open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof HTMLSelectElement || (e.target instanceof HTMLInputElement && e.target.type !== "range")) return;
  const key = e.key.toLowerCase();
  if (e.key === " ") {
    e.preventDefault();
    play.setPlaying(!play.playing);
  } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    play.jump(e.key === "ArrowRight" ? 1 : -1);
  } else if (/^[1-5]$/.test(e.key)) setLayer(Number(e.key) - 1);
  else if (key === "f") cam.set("follow");
  else if (key === "d") cam.set("drone");
  else if (key === "o") cam.set("overhead");
  else if (e.key === "?") hud.openHelp(true);
  else if (e.key === "Escape") select(null);
});

let lastNow = performance.now();
let frameWas = lastNow;
let firstFrame = true;
function frame(now) {
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  tuneQuality(now - lastNow);
  play.step(dt);
  lastNow = now;
  const t = play.t;
  const here = D.pathAt(t);
  const state = D.stopAt(t);
  const k = D.readingsBy(t);

  rover.pose(here, state ? state.travel : 0, D.ground);
  rain.update(t, k, cam.controls.target, Math.min(0.1, (now - frameWas) / 1000));
  frameWas = now;
  const camDist = cam.distance();
  field.soilUniforms.uTintAmount.value = THREE.MathUtils.clamp(camDist / 10, 0.35, 1); // real soil up close, clear map from afar
  scatter.update(now / 1000);
  marks.update({ t, now, state, k, here, markScale: THREE.MathUtils.clamp(camDist / 7, 1, 3.5) });
  layers.paint(k, now);
  hud.status(t, state, here, k);
  play.show(k);
  map.draw(t, k, here, now);
  cam.update(now, rover.root.position, dt);
  hud.tags(rover.root.position);
  view.aimShadows(cam.controls.target, camDist);
  view.render();
  if (firstFrame) {
    firstFrame = false;
    document.querySelector('#loadSteps [data-step="first"]').className = "done";
    $("loading").classList.add("done");
    setTimeout(() => $("loading").remove(), 600);
  }
  requestAnimationFrame(frame);
}

rover.pose(D.pathAt(0), 0, D.ground);
cam.jumpTo(rover.root.position);
setLayer(0);
document.querySelector('#loadSteps [data-step="first"]').className = "now";
// Hooks for scripted demos, look-dev captures and tests.
window.viewer = {
  setTime: play.setTime,
  setPlaying: play.setPlaying,
  setSpeed: play.setSpeed,
  setLayer,
  setCam: cam.set,
  select,
  mapPoint: map.pointOf,
  setSheet,
  openHelp: hud.openHelp,
  get t() {
    return play.t;
  },
  get selected() {
    return selected;
  },
  T_END: D.T_END,
  stops: D.stops,
  scene: view.scene,
  camera: view.camera,
  controls: cam.controls,
  setQuality: view.setQuality,
};
requestAnimationFrame(frame);
