// What the ground colour shows: the robot's map, the real moisture, the map error, the
// uncertainty, or nothing. Paints the overlay texture and the legend. When a new reading
// arrives the map fades from the old picture to the new one, so you can see what changed.
import * as THREE from "three";
import { pct } from "./data.js";

const $ = (id) => document.getElementById(id);
// Red-brown = dry, yellow = the "too dry" line, blue = wetter. No green: it would blend with the plants.
const MOIST = [[0.05, "#7c2a0a"], [0.12, "#d0612a"], [0.18, "#f0b84a"], [0.24, "#b9d3e3"], [0.3, "#6aa6dc"], [0.37, "#2f6cb8"], [0.45, "#173c82"]];
const ERR = [[0, "#fff7ec"], [0.025, "#fdd49e"], [0.05, "#fc8d59"], [0.1, "#b30000"]];
const UNC = [[0, "#f2f0f7"], [0.02, "#cbc9e2"], [0.04, "#9e9ac8"], [0.07, "#54278f"]];
for (const list of [MOIST, ERR, UNC]) for (const s of list) s[2] = new THREE.Color(s[1]);

export function ramp(stops, v, out) {
  const n = stops.length;
  if (v <= stops[0][0]) return out.copy(stops[0][2]);
  for (let i = 1; i < n; i++) {
    if (v <= stops[i][0]) return out.copy(stops[i - 1][2]).lerp(stops[i][2], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  }
  return out.copy(stops[n - 1][2]);
}
export const moistureColour = (v, out) => ramp(MOIST, v, out);
const tmpSwatch = new THREE.Color();
/** CSS colour of a reading (grey: the probe failed). */
export const swatch = (v) => (v == null ? "#8a8f94" : `#${moistureColour(v, tmpSwatch).getHexString()}`);
const FADE_MS = 650;
const still = matchMedia("(prefers-reduced-motion: reduce)");

export function createLayers(D, field) {
  const { S, DRY } = D;
  const milli = (v) => (v == null ? null : v / 1000);
  const moistTicks = () => [[0.05, "5% dry"], [DRY, `${pct(DRY)} dry line`, true], [0.3, "30%"], [0.45, "45% wet"]];
  const LAYERS = [
    { label: "Robot's map", stops: MOIST, alpha: 0.62, value: (i, k) => milli(S.estimate[k][i]), ticks: moistTicks,
      text: "What the robot thinks the soil moisture is everywhere, worked out from its marks so far. Watch it sharpen with every reading." },
    { label: "Real moisture", stops: MOIST, alpha: 0.62, value: (i, k) => milli(D.truthAt(k)[i]), ticks: moistTicks,
      text: "The true moisture in this simulated field (it changes when it rains). The robot never sees it; it is here so you can check the robot's map against it." },
    { label: "Map error", stops: ERR, alpha: 0.8, value: (i, k) => (S.estimate[k][i] == null ? null : Math.abs(S.estimate[k][i] - D.truthAt(k)[i]) / 1000),
      ticks: () => [[0, "spot on"], [0.025, "2.5"], [0.05, "5"], [0.1, "10+ % points"]],
      text: "How far the robot's map is from the truth at each spot. Pale = about right, dark red = wrong by 10 % points or more." },
    { label: "Uncertainty", stops: UNC, alpha: 0.8, value: (i, k) => milli(S.sd[k][i]),
      ticks: () => [[0, "sure"], [0.035, "somewhat"], [0.07, "unsure"]],
      text: "How unsure the robot is about each spot. It is sure near its marks and unsure far from them; that is where it would help to measure next." },
    { label: "Plain soil", stops: null, ticks: () => [], text: "No colours: just the field as it looks." },
  ];
  const cells = S.grid.nx * S.grid.ny;
  const tmp = new THREE.Color();
  let layer = 0;
  let shownKey = "";

  const from = new Float32Array(cells * 4);
  const to = new Float32Array(cells * 4);
  let fadeStart = -1;
  /** Fill `to` with the picture for layer `layer` after k readings. */
  function target(k) {
    const L = LAYERS[layer];
    to.fill(0);
    if (!L.stops) return; // plain soil: no colour
    for (let i = 0; i < cells; i++) {
      const v = L.value(i, k);
      if (v == null) continue;
      ramp(L.stops, v, tmp);
      const o = i * 4;
      to[o] = tmp.r * 255;
      to[o + 1] = tmp.g * 255;
      to[o + 2] = tmp.b * 255;
      to[o + 3] = L.alpha * 255;
    }
  }
  function paint(k, now = performance.now()) {
    const data = field.tintData;
    const key = `${layer}/${k}`;
    if (key !== shownKey) {
      // Fade only for the next reading during play; anything else (a jump, a new layer) snaps.
      const fade = !still.matches && shownKey === `${layer}/${k - 1}`;
      shownKey = key;
      for (let i = 0; i < from.length; i++) from[i] = data[i];
      target(k);
      fadeStart = fade ? now : -1;
      if (!fade) {
        data.set(to);
        field.tintTex.needsUpdate = true;
        return;
      }
    }
    if (fadeStart < 0) return;
    const f = Math.min(1, (now - fadeStart) / FADE_MS);
    const e = 1 - (1 - f) ** 3;
    for (let i = 0; i < data.length; i++) data[i] = from[i] + (to[i] - from[i]) * e;
    field.tintTex.needsUpdate = true;
    if (f >= 1) fadeStart = -1;
  }
  function showInfo() {
    const L = LAYERS[layer];
    $("layerText").textContent = L.text;
    for (const [i, b] of [...$("layerButtons").children].entries()) b.setAttribute("aria-pressed", String(i === layer));
    const bar = $("legendBar");
    const ticks = $("legendTicks");
    bar.style.display = ticks.style.display = L.stops ? "" : "none";
    if (!L.stops) return;
    const lo = L.stops[0][0];
    const hi = L.stops[L.stops.length - 1][0];
    const x = (v) => ((v - lo) / (hi - lo)) * 100;
    bar.style.background = `linear-gradient(90deg, ${L.stops.map((s) => `${s[1]} ${x(s[0])}%`).join(", ")})`;
    ticks.innerHTML = L.ticks().map(([v, label, mark]) => `<span class="${mark ? "mark" : ""}" style="left:${Math.min(92, Math.max(8, x(v)))}%">${label}</span>`).join("");
  }
  const api = {
    count: LAYERS.length,
    paint,
    set(i, k) {
      layer = i;
      shownKey = "";
      showInfo();
      paint(k);
    },
  };
  LAYERS.forEach((L, i) => {
    const b = document.createElement("button");
    b.textContent = L.label;
    b.title = `Key ${i + 1}`;
    b.onclick = () => api.onPick?.(i);
    $("layerButtons").appendChild(b);
  });
  return api;
}
