// Weather from the simulator: rain streaks around the camera while it rains (the sun dims behind
// the clouds), and the soil looks wetter or drier as the simulated moisture changes.
import * as THREE from "three";
import { mulberry } from "./data.js";
import { setWetness } from "./terrain.js";

const DROPS = 7000;
const BOX = 22; // m around the camera target
const TOP = 9; // m
const FALL = 8; // m/s
const STREAK = 0.25; // m

export function createRain(view, D, field) {
  const pos = new Float32Array(DROPS * 6);
  const rand = mulberry(7);
  for (let i = 0; i < DROPS; i++) {
    const x = (rand() - 0.5) * BOX;
    const y = rand() * TOP;
    const z = (rand() - 0.5) * BOX;
    pos.set([x, y, z, x + 0.03, y + STREAK, z], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8d2dc, transparent: true, opacity: 0.32, depthWrite: false }));
  rain.frustumCulled = false;
  rain.visible = false;
  view.scene.add(rain);
  const sunFull = view.sun.intensity;
  const skyFull = view.scene.environmentIntensity;
  let cloud = 0; // 0 clear .. 1 heavy rain, eased so the light changes gently
  let shownK = -1;

  return {
    update(t, k, centre, seconds) {
      const rate = D.rainAt(t); // mm/h
      cloud += (Math.min(1, rate / 20) - cloud) * Math.min(1, seconds * 2);
      view.sun.intensity = sunFull * (1 - 0.8 * cloud);
      view.scene.environmentIntensity = skyFull * (1 - 0.35 * cloud);
      rain.visible = rate > 0;
      if (rain.visible) {
        geo.setDrawRange(0, Math.round(DROPS * Math.min(1, 0.25 + rate / 25)) * 2);
        const drop = FALL * seconds;
        for (let i = 0; i < DROPS; i++) {
          const o = i * 6 + 1;
          pos[o] -= drop;
          pos[o + 3] -= drop;
          if (pos[o] < 0) {
            pos[o] += TOP;
            pos[o + 3] += TOP;
          }
        }
        geo.attributes.position.needsUpdate = true;
        rain.position.set(centre.x, 0, centre.z);
      }
      if (D.S.truth_k && k !== shownK) {
        shownK = k;
        setWetness(field.soilUniforms.uMoist.value, D.truthAt(k));
      }
    },
  };
}
