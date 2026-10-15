// Small things on the ground that make a field read as real: clods and pale stones, fallen
// tomatoes, straw, and grass and weeds at the edges, on the headlands and along the furrows.
// None of it is in the rover's wheel tracks, so the robot never seems to drive through it.
import * as THREE from "three";
import { at } from "./data.js";
import { makeNoise } from "./noise.js";
import { RIDGE } from "./terrain.js";

/** A tuft of curved, tapering grass blades, 1 unit tall; vertex colours run dark to light. */
function tuftGeometry(rand, blades) {
  const pos = [];
  const col = [];
  const base = new THREE.Color(0x2f3d17);
  const tip = new THREE.Color(0x9aa45a);
  const c = new THREE.Color();
  for (let b = 0; b < blades; b++) {
    const a = rand() * Math.PI * 2;
    const lean = 0.25 + rand() * 0.45;
    const w = 0.035 + rand() * 0.025;
    const h = 0.6 + rand() * 0.4;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz;
    const pz = dx;
    const pt = (t, side) => {
      const bend = lean * t * t;
      const half = w * (1 - t) * 0.5;
      return [dx * bend + px * half * side, h * t, dz * bend + pz * half * side];
    };
    const steps = 3;
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      const quad = [pt(t0, -1), pt(t0, 1), pt(t1, 1), pt(t0, -1), pt(t1, 1), pt(t1, -1)];
      for (const v of quad) {
        pos.push(...v);
        c.copy(base).lerp(tip, v[1] / h);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A small irregular lump (stone or clod). */
function lumpGeometry(rand) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  const bump = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!bump.has(k)) bump.set(k, 0.7 + rand() * 0.5);
    const f = bump.get(k);
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.6, p.getZ(i) * f);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildScatter(view, D, { low = false } = {}) {
  const { S, F, LX, LY } = D;
  const n = makeNoise(S.seed * 13 + 5);
  const rand = n.rand;
  const density = low ? 0.35 : 1;
  const o = new THREE.Object3D();
  const colour = new THREE.Color();
  const nearest = (list, y) => list.reduce((d, v) => Math.min(d, Math.abs(y - v)), Infinity);
  const inTrack = (x, y) =>
    // the rover's path: along the lanes, and its turning strips on the headlands
    (x > 0.2 && x < LX - 0.2 && nearest(S.lanes_y, y) < 0.27) || Math.abs(x - F.headland / 2) < 0.45 || Math.abs(x - (LX - F.headland / 2)) < 0.45;
  const g = (x, y) => D.ground(x, y);
  const added = [];
  const add = (mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    view.scene.add(mesh);
    added.push(mesh);
  };

  // Clods and pale stones: most along the furrow edges and the ridge shoulders.
  {
    const want = Math.round(LX * LY * 14 * density);
    const lumps = new THREE.InstancedMesh(lumpGeometry(rand), new THREE.MeshStandardMaterial({ roughness: 0.95 }), want);
    const pale = [0xcfc3ad, 0xbdb19a, 0xd8cfbd, 0xa89a82].map((c) => new THREE.Color(c));
    const brown = [0x6a4a32, 0x5a3e2a, 0x7a5a3e, 0x4e3626].map((c) => new THREE.Color(c));
    let i = 0;
    for (let tries = 0; i < want && tries < want * 6; tries++) {
      const x = 0.3 + rand() * (LX - 0.6);
      const y = 0.3 + rand() * (LY - 0.6);
      const dr = nearest(S.rows_y, y);
      const shoulder = dr > RIDGE.top - 0.05 && dr < RIDGE.base + 0.08;
      if (inTrack(x, y) || rand() > (shoulder ? 1 : 0.25)) continue;
      const stone = rand() < 0.35;
      const s = stone ? 0.008 + rand() * 0.02 : 0.012 + rand() * 0.03;
      o.position.copy(at(x, y, g(x, y) + s * 0.2));
      o.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      o.scale.set(s, s, s);
      o.updateMatrix();
      lumps.setMatrixAt(i, o.matrix);
      const list = stone ? pale : brown;
      lumps.setColorAt(i++, colour.copy(list[Math.floor(rand() * list.length)]));
    }
    lumps.count = i;
    add(lumps);
  }

  // Fallen tomatoes on the ridge shoulders, some split and soft.
  {
    const want = Math.round(S.stems.length * 0.35);
    const fallen = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ roughness: 0.4 }), want);
    const tones = [0xb0261a, 0xc8401c, 0xd8701e, 0x8f2a18, 0x9da33a].map((c) => new THREE.Color(c));
    for (let i = 0; i < want; i++) {
      const [sx, sy] = S.stems[Math.floor(rand() * S.stems.length)];
      const side = rand() < 0.5 ? -1 : 1;
      const x = sx + (rand() - 0.5) * 0.4;
      const y = sy + side * (RIDGE.top + rand() * 0.12);
      const s = 0.022 + rand() * 0.014;
      const squash = 0.55 + rand() * 0.35;
      o.position.copy(at(x, y, g(x, y) + s * squash * 0.8));
      o.rotation.set(0, rand() * 3, 0);
      o.scale.set(s, s * squash, s);
      o.updateMatrix();
      fallen.setMatrixAt(i, o.matrix);
      fallen.setColorAt(i, colour.copy(tones[Math.floor(rand() * tones.length)]).offsetHSL(0, -0.1 * rand(), -0.12 * rand()));
    }
    add(fallen);
  }

  // Straw and dry stems on the ground.
  {
    const want = Math.round(LX * LY * 3 * density);
    const straw = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0025, 0.0025, 1, 3).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc2ad7c, roughness: 0.95 }), want);
    let i = 0;
    for (let tries = 0; i < want && tries < want * 4; tries++) {
      const x = rand() * LX;
      const y = rand() * LY;
      if (inTrack(x, y)) continue;
      o.position.copy(at(x, y, g(x, y) + 0.004));
      o.rotation.set(0, rand() * 6.3, (rand() - 0.5) * 0.2);
      o.scale.set(0.06 + rand() * 0.16, 1, 1);
      o.updateMatrix();
      straw.setMatrixAt(i++, o.matrix);
    }
    straw.count = i;
    add(straw);
  }

  // Grass and weeds, swaying a little in the breeze.
  const wind = { value: 0 };
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 wp = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
          float sway = sin(uTime * 1.6 + wp.x * 0.7 + wp.y * 0.9) + 0.4 * sin(uTime * 3.7 + wp.x * 2.1);
          transformed.x += sway * 0.05 * transformed.y * transformed.y;
        #endif`,
      );
  };
  {
    const spots = [];
    const tryAdd = (x, y, scale) => {
      if (!inTrack(x, y)) spots.push([x, y, scale]);
    };
    // the grassy margin and bund around the field, thickest away from the soil
    const outer = 6;
    const marginArea = (LX + 2 * outer) * (LY + 2 * outer) - LX * LY;
    for (let i = 0; i < marginArea * 26 * density; i++) {
      const x = -outer + rand() * (LX + 2 * outer);
      const y = -outer + rand() * (LY + 2 * outer);
      const out = Math.max(-x, x - LX, -y, y - LY);
      if (out < 0.15 || rand() > Math.min(1, out / 1.2)) continue;
      tryAdd(x, y, 0.16 + rand() * 0.22 + 0.1 * Math.min(1, out / 3));
    }
    // weeds on the headlands and along the furrow shoulders
    for (let i = 0; i < LX * LY * 9 * density; i++) {
      const x = rand() * LX;
      const y = rand() * LY;
      const headland = x < F.headland || x > LX - F.headland;
      const dr = nearest(S.rows_y, y);
      const shoulder = dr > RIDGE.base - 0.08 && dr < RIDGE.base + 0.06;
      const clump = n.value2(x * 0.6, y * 0.6) > 0.15; // weeds grow in patches
      if ((headland && clump && rand() < 0.5) || (shoulder && clump && rand() < 0.35)) tryAdd(x, y, 0.07 + rand() * 0.12);
    }
    const tufts = new THREE.InstancedMesh(tuftGeometry(rand, low ? 4 : 6), grassMat, spots.length);
    const greens = [0xffffff, 0xe8f0c8, 0xd8c890, 0xf0f0d0, 0xc8d8a0].map((c) => new THREE.Color(c));
    spots.forEach(([x, y, s], i) => {
      const out = Math.max(-x, x - LX, -y, y - LY);
      const h = out > 3 ? 0.05 : g(x, y);
      o.position.copy(at(x, y, h - 0.01));
      o.rotation.set(0, rand() * 6.3, 0);
      o.scale.set(s * 1.1, s, s * 1.1);
      o.updateMatrix();
      tufts.setMatrixAt(i, o.matrix);
      tufts.setColorAt(i, greens[Math.floor(rand() * greens.length)]); // dry and green tufts mixed
    });
    add(tufts);
  }
  return {
    update(seconds) {
      wind.value = seconds;
    },
  };
}
