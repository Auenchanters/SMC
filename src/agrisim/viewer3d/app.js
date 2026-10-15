// 3D replay of one agrisim survey. Everything shown comes from scene.json (written by
// `agrisim run --view`); the rover is built from rover-model.mjs, the hardware design's model.
// This file wires the modules in js/ together and runs the frame loop.
import { createCamera } from "./js/camera.js";
import { loadSurvey } from "./js/data.js";
import { buildField, buildTrees } from "./js/field.js";
import { createHud } from "./js/hud.js";
import { createLayers, moistureColour } from "./js/layers.js";
import { buildMarkers } from "./js/markers.js";
import { createPlayback } from "./js/playback.js";
import { createRain } from "./js/rain.js";
import { buildPlants } from "./js/plants.js";
import { QUALITY, createView } from "./js/render.js";
import { buildRover } from "./js/rover.js";
import { buildScatter } from "./js/scatter.js";
import * as THREE from "three";

const query = new URLSearchParams(location.search);
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
  D = await loadSurvey(query.get("scene") ?? "run/scene.json");
} catch (err) {
  document.getElementById("loading").textContent = `Could not load the survey data (${err.message}). Start the viewer with: agrisim run ... --view`;
  throw err;
}

const view = await createView(D, startQuality);
const field = buildField(view, D, { low }); // also sets D.ground(x, y), used by everything below
buildPlants(view, D, { low });
const scatter = buildScatter(view, D, { low });
buildTrees(view, D);
const rover = buildRover(view);
const marks = buildMarkers(view, D);
const layers = createLayers(D, field);
const rain = createRain(view, D, field);
marks.colour(moistureColour);
const cam = createCamera(view, D);
const hud = createHud(D, view, marks);
const play = createPlayback(D, { playing: !query.has("paused") });

const setLayer = (i) => layers.set(i, D.readingsBy(play.t));
layers.onPick = setLayer;

// Auto: watch real frame times for a few seconds and step the quality down (or up) once or twice.
const autoQuality = { frames: 0, sum: 0, checks: 0 };
const qualityPicker = document.getElementById("quality");
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
  if (e.target instanceof HTMLSelectElement || (e.target instanceof HTMLInputElement && e.target.type !== "range")) return;
  if (e.key === " ") {
    e.preventDefault();
    play.setPlaying(!play.playing);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    play.jump(1);
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    play.jump(-1);
  } else if (/^[1-5]$/.test(e.key)) setLayer(Number(e.key) - 1);
  else if (e.key === "f" || e.key === "F") cam.set("follow");
  else if (e.key === "o" || e.key === "O") cam.set("overhead");
  else if (e.key === "?") hud.openHelp(true);
  else if (e.key === "Escape") hud.openHelp(false);
});

let lastNow = performance.now();
let frameWas = lastNow;
let firstFrame = true;
function frame(now) {
  tuneQuality(now - lastNow);
  play.step(Math.min(0.1, (now - lastNow) / 1000));
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
  layers.paint(k);
  hud.status(t, state, here, k);
  play.show();
  cam.update(now, rover.root.position);
  hud.tags(rover.root.position);
  view.aimShadows(cam.controls.target, camDist);
  view.render();
  if (firstFrame) {
    firstFrame = false;
    document.getElementById("loading").remove();
  }
  requestAnimationFrame(frame);
}

rover.pose(D.pathAt(0), 0, D.ground);
cam.jumpTo(rover.root.position);
setLayer(0);
// Hooks for scripted demos, look-dev captures and tests.
window.viewer = {
  setTime: play.setTime,
  setPlaying: play.setPlaying,
  setSpeed: play.setSpeed,
  setLayer,
  setCam: cam.set,
  get t() {
    return play.t;
  },
  T_END: D.T_END,
  stops: D.stops,
  scene: view.scene,
  camera: view.camera,
  controls: cam.controls,
  setQuality: view.setQuality,
};
requestAnimationFrame(frame);
