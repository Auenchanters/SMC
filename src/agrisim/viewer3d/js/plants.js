// Tomato plants: one per stem in the survey, never wider than the canopy radius the simulator
// uses for plant contact.
import * as THREE from "three";
import { at as atField } from "./data.js";

function mergeGeometries(list) {
  const pos = [];
  for (const g of list) pos.push(...(g.index ? g.toNonIndexed() : g).attributes.position.array);
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return out;
}

/** A sphere with each vertex pushed in or out a little: a leafy mass rather than a ball. */
export function lumpyBall(rand) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  const bump = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!bump.has(key)) bump.set(key, 0.78 + rand() * 0.38);
    const f = bump.get(key);
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
  }
  geo.computeVertexNormals();
  return geo;
}

function frondGeometry() {
  // A compound tomato leaf: a rib with seven leaflets, 1 unit long along +x, lying flat, drooping.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.12, 0.42, 0.7, 0.36, 1, 0);
  shape.bezierCurveTo(0.7, -0.36, 0.12, -0.42, 0, 0);
  const leaflet = new THREE.ShapeGeometry(shape, 4).rotateX(-Math.PI / 2);
  const pieces = [new THREE.BoxGeometry(1, 0.014, 0.014).translate(0.5, 0, 0)];
  pieces.push(leaflet.clone().scale(0.5, 0.5, 0.5).translate(0.52, 0, 0));
  for (const [along, size] of [[0.78, 0.44], [0.55, 0.4], [0.3, 0.32]]) {
    for (const side of [1, -1]) pieces.push(leaflet.clone().scale(size, size, size).rotateY(side * 0.95).translate(along, 0, 0));
  }
  const geo = mergeGeometries(pieces);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    p.setY(i, p.getY(i) - 0.32 * x * x - 0.3 * z * z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildPlants(view, D, { low = false } = {}) {
  const { S, rand } = D;
  const stems = S.stems;
  const FRONDS = low ? 9 : 15;
  const BLOBS = 4;
  const leaves = new THREE.InstancedMesh(frondGeometry(), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.75 }), stems.length * FRONDS);
  const blobs = new THREE.InstancedMesh(lumpyBall(rand), new THREE.MeshStandardMaterial({ roughness: 0.9 }), stems.length * BLOBS);
  const stemMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.013, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x4d7a2a, roughness: 0.8 }), stems.length);
  // Stakes: rough poles of wood or bamboo, not at every plant, uneven in height and leaning a little.
  const stakeGeo = new THREE.CylinderGeometry(0.009, 0.013, 1, 7, 4).translate(0, 0.5, 0);
  {
    const p = stakeGeo.attributes.position; // a slight crook along the pole
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.sin(p.getY(i) * 5.3) * 0.012);
    stakeGeo.computeVertexNormals();
  }
  const stakes = new THREE.InstancedMesh(stakeGeo, new THREE.MeshStandardMaterial({ roughness: 0.92 }), stems.length);
  const woods = [0x8a6a45, 0x7a5c3c, 0x9a8a62, 0xb59e6a, 0x6b5a48].map((c) => new THREE.Color(c));
  const tops = new Map(); // row y -> [[x, top height], ...] for the string lines
  const fruitCounts = stems.map(() => 3 + Math.floor(rand() * 4));
  const fruits = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshStandardMaterial({ roughness: 0.35 }), fruitCounts.reduce((a, b) => a + b, 0));
  const o = new THREE.Object3D();
  const colour = new THREE.Color();
  const greens = [0x3e7d2a, 0x4a8a30, 0x356e24, 0x548f34, 0x2f6421].map((c) => new THREE.Color(c));
  const ripeness = [0xc4271b, 0xd23a1e, 0xe0631c, 0x9fb33a, 0x6d9a2c].map((c) => new THREE.Color(c));
  let li = 0;
  let fi = 0;
  let bi = 0;
  let nStakes = 0;
  stems.forEach(([x, y], k) => {
    const r = S.canopy[k];
    const h = 0.8 + rand() * 0.25;
    const g0 = D.ground(x, y);
    const at = (px, py, ph = 0) => atField(px, py, g0 + ph); // everything on this plant starts at its ground
    o.position.copy(at(x, y));
    o.rotation.set((rand() - 0.5) * 0.08, 0, (rand() - 0.5) * 0.08);
    o.scale.set(1, h, 1);
    o.updateMatrix();
    stemMesh.setMatrixAt(k, o.matrix);
    if (rand() < 0.55) {
      const sh = 1.05 + rand() * 0.6;
      const sx = x + 0.04;
      const sy = y + (rand() - 0.5) * 0.06;
      o.position.copy(at(sx, sy, -0.05));
      o.rotation.set((rand() - 0.5) * 0.14, rand() * 6.3, (rand() - 0.5) * 0.14);
      const thick = 0.8 + rand() * 0.6;
      o.scale.set(thick, sh, thick);
      o.updateMatrix();
      stakes.setMatrixAt(nStakes, o.matrix);
      stakes.setColorAt(nStakes++, woods[Math.floor(rand() * woods.length)]);
      const row = Math.round(y * 100);
      if (!tops.has(row)) tops.set(row, []);
      tops.get(row).push([sx, sy, g0]);
    }
    for (let j = 0; j < FRONDS; j++) {
      const f = j / (FRONDS - 1);
      o.position.copy(at(x, y, 0.12 + (h - 0.1) * f));
      o.rotation.set((rand() - 0.5) * 1.3, j * 2.4 + rand() * 0.7, -0.15 + rand() * 0.75, "YZX");
      const reach = r * (1.0 - 0.35 * f) * (0.86 + rand() * 0.1); // never past the canopy circle the simulator uses
      o.scale.setScalar(reach);
      o.updateMatrix();
      leaves.setMatrixAt(li, o.matrix);
      leaves.setColorAt(li++, colour.copy(greens[Math.floor(rand() * greens.length)]).offsetHSL(0, 0, (rand() - 0.5) * 0.05));
    }
    for (let j = 0; j < BLOBS; j++) { // leafy mass around the stem
      const s = r * (0.34 + rand() * 0.12) * (1 - (0.15 * j) / BLOBS);
      o.position.copy(at(x + (rand() - 0.5) * 0.06, y + (rand() - 0.5) * 0.06, 0.2 + (j * (h - 0.3)) / (BLOBS - 1) + rand() * 0.05));
      o.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      o.scale.set(s, s * 0.8, s);
      o.updateMatrix();
      blobs.setMatrixAt(bi, o.matrix);
      blobs.setColorAt(bi++, colour.copy(greens[Math.floor(rand() * greens.length)]).offsetHSL(0, 0, -0.04));
    }
    for (let j = 0; j < fruitCounts[k]; j++) {
      const a = rand() * Math.PI * 2;
      const d = r * (0.45 + rand() * 0.25); // hanging at the edge of the leafy core
      const s = 0.026 + rand() * 0.014;
      o.position.copy(at(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.18 + rand() * 0.38));
      o.rotation.set(0, 0, 0);
      o.scale.set(s, s * 0.85, s);
      o.updateMatrix();
      fruits.setMatrixAt(fi, o.matrix);
      fruits.setColorAt(fi++, ripeness[Math.floor(rand() * ripeness.length)]);
    }
  });
  stakes.count = nStakes;

  // String lines along each row, tied to the stakes at two heights, sagging between them.
  const segs = [];
  for (const list of tops.values()) {
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < list.length; i++) {
      const [ax, ay, ag] = list[i - 1];
      const [bx, by, bg] = list[i];
      for (const hgt of [0.45, 0.85]) {
        const sag = 0.015 + 0.01 * (bx - ax);
        const a = atField(ax, ay, ag + hgt);
        const b = atField(bx, by, bg + hgt);
        const m = a.clone().lerp(b, 0.5);
        m.y -= sag;
        segs.push([a, m], [m, b]);
      }
    }
  }
  const twine = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0012, 0.0012, 1, 3).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xcfc2a0, roughness: 0.9 }), segs.length);
  const up = new THREE.Vector3(0, 1, 0);
  segs.forEach(([a, b], i) => {
    const d = b.clone().sub(a);
    o.position.copy(a);
    o.quaternion.setFromUnitVectors(up, d.clone().normalize());
    o.scale.set(1, d.length(), 1);
    o.updateMatrix();
    twine.setMatrixAt(i, o.matrix);
  });
  o.quaternion.identity();
  view.scene.add(twine);

  for (const m of [leaves, blobs, stemMesh, stakes, fruits]) {
    m.castShadow = true;
    m.receiveShadow = true;
    view.scene.add(m);
  }
}
