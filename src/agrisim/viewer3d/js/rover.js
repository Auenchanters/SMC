// The rover, built from the hardware model's parts list (mm, x forward, y left, z up).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { DIM, parts, scanHeads } from "../rover-model.mjs";
import { at } from "./data.js";

const MM = 0.001;
const WHEEL_R = DIM.wheel.r * MM;
const mat = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
const M = {
  body: mat(0x2c3136, 0.25, 0.55), dark: mat(0x1e2124, 0.3, 0.5), alu: mat(0xc3c9cf, 0.85, 0.38), blue: mat(0x2f62a8, 0.6, 0.38),
  chrome: mat(0xe6e9eb, 1, 0.14), brass: mat(0xb38f55, 1, 0.35), orange: mat(0xe07b22, 0.2, 0.5), white: mat(0xeceae4, 0.05, 0.5),
  yellow: mat(0xf0c22e, 0.1, 0.5), red: mat(0xd42a20, 0.1, 0.4), black: mat(0x151617, 0.2, 0.45), rim: mat(0xaab0b6, 0.8, 0.35, { side: THREE.DoubleSide }),
};
function partMaterial(name) {
  if (/e-stop head/.test(name)) return M.red;
  if (/stepper|receiver|head$|lidar|camera|motor pod/.test(name)) return /scan head/.test(name) ? M.dark : M.black;
  if (/rod|lead screw|needle|extension/.test(name)) return M.chrome;
  if (/standoff/.test(name)) return M.brass;
  if (/tower|carriage/.test(name)) return M.blue;
  if (/deck|scan beam|inner stage|bumper|strut/.test(name)) return M.alu;
  if (/cartridge/.test(name)) return M.orange;
  if (/enclosure|gnss antenna/.test(name)) return M.white;
  if (/contact strip|e-stop housing/.test(name)) return M.yellow;
  if (/flange/.test(name)) return M.dark;
  return M.body;
}
function tyreMaterial() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#191919";
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#2c2c2c";
  for (let i = 0; i < 16; i++) {
    g.beginPath();
    g.moveTo(i * 16, 4);
    g.lineTo(i * 16 + 9, 32);
    g.lineTo(i * 16, 60);
    g.lineTo(i * 16 + 5, 60);
    g.lineTo(i * 16 + 14, 32);
    g.lineTo(i * 16 + 5, 4);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 3, roughness: 0.92 });
}
const v3 = (x, y, z) => new THREE.Vector3(x * MM, z * MM, -y * MM);
function partMesh(p) {
  let mesh;
  if (p.kind === "box") {
    const [x0, y0, z0] = p.a;
    const [x1, y1, z1] = p.b;
    const size = [(x1 - x0) * MM, (z1 - z0) * MM, (y1 - y0) * MM];
    const radius = Math.min(0.004, Math.min(...size) * 0.22);
    mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 2, radius), partMaterial(p.name));
    mesh.position.copy(v3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  } else {
    const geo = new THREE.CylinderGeometry(p.r * MM, p.r * MM, p.len * MM, p.r > 10 ? 32 : 12);
    if (p.axis === "y") geo.rotateX(Math.PI / 2);
    if (p.axis === "x") geo.rotateZ(Math.PI / 2);
    mesh = new THREE.Mesh(geo, partMaterial(p.name));
    mesh.position.copy(v3(...p.c));
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
function wheelAssembly(p, tyreMat) {
  // Tyre, rim and hub, spun about the axle (local z after the turn below).
  const spin = new THREE.Group();
  const r = p.r * MM;
  const w = p.len * MM;
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 40, 1, true), tyreMat);
  const side = new THREE.Mesh(new THREE.RingGeometry(r * 0.62, r, 40), M.black);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 0.92, 24, 1, true), M.rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.18, w * 1.04, 12), M.dark);
  for (const m of [tyre, rim, hub]) m.rotation.x = Math.PI / 2;
  for (const s of [1, -1]) {
    const face = side.clone();
    face.position.z = (s * w) / 2;
    if (s < 0) face.rotation.y = Math.PI;
    spin.add(face);
  }
  for (const m of [tyre, rim, hub, ...spin.children]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  spin.add(tyre, rim, hub);
  for (let k = 0; k < 5; k++) { // five spokes so the spin is visible
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(r * 0.08, r * 1.08, w * 0.94), M.dark);
    spoke.rotation.z = (k * 2 * Math.PI) / 5;
    spin.add(spoke);
  }
  spin.position.copy(v3(...p.c));
  spin.userData.left = p.c[1] > 0;
  return spin;
}

export function buildRover(view) {
  const root = new THREE.Group();
  const probe = new THREE.Group();
  const wheels = [];
  const tyreMat = tyreMaterial();
  for (const p of [...parts(0), ...scanHeads(0)]) {
    if (p.name === "wheel") {
      const w = wheelAssembly(p, tyreMat);
      wheels.push(w);
      root.add(w);
    } else (p.group === "probe" ? probe : root).add(partMesh(p));
  }
  root.add(probe);
  view.scene.add(root);
  return {
    root,
    /** Place the rover at a path sample; `travel` is the probe's travel in mm (0 = parked). */
    pose(here, travel) {
      root.position.copy(at(here.x, here.y));
      root.rotation.y = here.th;
      for (const w of wheels) w.rotation.z = -(w.userData.left ? here.rollL : here.rollR) / WHEEL_R;
      probe.position.y = -travel * MM;
    },
  };
}
