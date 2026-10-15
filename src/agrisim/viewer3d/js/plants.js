// Tomato plants: one per stem in the survey, never wider than the canopy radius the simulator
// uses for plant contact.
import * as THREE from "three";
import { at } from "./data.js";

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
  const stakes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.011, 0.011, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x8b6a43, roughness: 0.9 }), stems.length);
  const fruitCounts = stems.map(() => 3 + Math.floor(rand() * 4));
  const fruits = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshStandardMaterial({ roughness: 0.35 }), fruitCounts.reduce((a, b) => a + b, 0));
  const o = new THREE.Object3D();
  const colour = new THREE.Color();
  const greens = [0x3e7d2a, 0x4a8a30, 0x356e24, 0x548f34, 0x2f6421].map((c) => new THREE.Color(c));
  const ripeness = [0xc4271b, 0xd23a1e, 0xe0631c, 0x9fb33a, 0x6d9a2c].map((c) => new THREE.Color(c));
  let li = 0;
  let fi = 0;
  let bi = 0;
  stems.forEach(([x, y], k) => {
    const r = S.canopy[k];
    const h = 0.8 + rand() * 0.25;
    o.position.copy(at(x, y));
    o.rotation.set((rand() - 0.5) * 0.08, 0, (rand() - 0.5) * 0.08);
    o.scale.set(1, h, 1);
    o.updateMatrix();
    stemMesh.setMatrixAt(k, o.matrix);
    o.position.copy(at(x + 0.035, y + 0.025));
    o.rotation.set(0, 0, 0);
    o.scale.set(1, 1.15, 1);
    o.updateMatrix();
    stakes.setMatrixAt(k, o.matrix);
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
  for (const m of [leaves, blobs, stemMesh, stakes, fruits]) {
    m.castShadow = true;
    m.receiveShadow = true;
    view.scene.add(m);
  }
}
