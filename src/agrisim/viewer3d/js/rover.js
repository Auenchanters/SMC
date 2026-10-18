// The rover (AgriRover v2), built from the hardware model's parts list (mm, x forward, y left, z up).
// Each side's wheels hang from a rocker beam that pitches about its pivot on the body; the
// differential bar across the top turns the beams equal and opposite, so the body takes their mean.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { DIM, parts, rockerPose } from "../rover-model.mjs";
import { at } from "./data.js";

const MM = 0.001;
const WHEEL_R = DIM.wheel.r * MM;
const HALF_BASE = (DIM.wheel.base / 2) * MM;
const HALF_TRACK = (DIM.wheel.track / 2) * MM;
const mat = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
// Painted and moulded panels get a thin clear coat, so the sky reads in them as on the real thing.
const coat = (color, metalness, roughness, clearcoat, clearcoatRoughness) => new THREE.MeshPhysicalMaterial({ color, metalness, roughness, clearcoat, clearcoatRoughness });
const M = {
  body: coat(0x2c3136, 0.25, 0.5, 0.35, 0.4), dark: mat(0x1e2124, 0.3, 0.5), alu: mat(0xc3c9cf, 0.85, 0.34), blue: coat(0x2f62a8, 0.55, 0.34, 0.3, 0.25),
  chrome: mat(0xe6e9eb, 1, 0.14), brass: mat(0xb38f55, 1, 0.35), orange: coat(0xe07b22, 0.15, 0.45, 0.4, 0.3), white: coat(0xeceae4, 0.05, 0.42, 0.6, 0.28),
  yellow: mat(0xf0c22e, 0.1, 0.5), red: mat(0xd42a20, 0.1, 0.4), black: mat(0x151617, 0.2, 0.45), rim: mat(0xaab0b6, 0.8, 0.35, { side: THREE.DoubleSide }),
};
function partMaterial(name) {
  if (/e-stop/.test(name)) return M.red;
  if (/stepper|lidar$|probe head/.test(name)) return M.black;
  if (/pivot|differential bar|extension|needle/.test(name)) return M.chrome;
  if (/linear axis|axis top plate|carriage/.test(name)) return M.blue;
  if (/rocker beam|axle bracket|diff link|diff pivot|deck|rail|sled|hanger|scan beam|strut|mast/.test(name)) return M.alu;
  if (/cleaning station/.test(name)) return M.orange;
  if (/enclosure|gnss antenna/.test(name)) return M.white;
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
  // Tyre on a hub motor (the motor's outer shell is the rim), spun about the axle (local z after the turn below).
  const spin = new THREE.Group();
  const r = p.r * MM;
  const w = p.len * MM;
  const hr = DIM.hub.r * MM;
  const hw = DIM.hub.w * MM;
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 40, 1, true), tyreMat);
  const side = new THREE.Mesh(new THREE.RingGeometry(hr, r, 40), M.black);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, hw, 32), M.rim);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(hr * 0.3, hr * 0.3, hw * 1.08, 16), M.dark);
  for (const m of [tyre, hub, cap]) m.rotation.x = Math.PI / 2;
  for (const s of [1, -1]) {
    const face = side.clone();
    face.position.z = (s * w) / 2;
    if (s < 0) face.rotation.y = Math.PI;
    spin.add(face);
    for (let k = 0; k < 5; k++) { // bolt heads on both faces of the motor, so the spin is visible
      const a = (k * 2 * Math.PI) / 5;
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(hr * 0.09, hr * 0.09, hw * 0.06, 8), M.dark);
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(Math.cos(a) * hr * 0.65, Math.sin(a) * hr * 0.65, (s * hw) / 2);
      spin.add(bolt);
    }
  }
  spin.add(tyre, hub, cap);
  for (const m of spin.children) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  spin.position.copy(v3(...p.c));
  spin.userData.left = p.c[1] > 0;
  return spin;
}

const BEAM = /^(wheel|hub motor|axle bracket|rocker beam)$/;
const DIFF = /^(differential bar|diff link)$/; // the bar rocks on its pin; the links ride with it
const MOVING = /^(carriage|probe extension|soil probe head|needle)$/; // what the probe stroke moves
// The diff links meet the beams this far ahead of and above their pivots.
const LINK_X = DIM.diff.x;
const LINK_H = DIM.beam.z0 + DIM.beam.h - DIM.pivot.z;

export function buildRover(view) {
  const root = new THREE.Group();
  const probe = new THREE.Group();
  const diff = new THREE.Group();
  const beams = { left: new THREE.Group(), right: new THREE.Group() };
  const wheels = [];
  const tyreMat = tyreMaterial();
  diff.position.copy(v3(DIM.diff.x, 0, DIM.diff.z));
  for (const [side, sy] of [["left", 1], ["right", -1]]) beams[side].position.copy(v3(0, sy * DIM.beam.y, DIM.pivot.z));
  // Children of a pivoting group are placed relative to its pivot.
  const into = (group, mesh) => {
    mesh.position.sub(group.position);
    group.add(mesh);
  };
  for (const p of parts(0)) {
    const at3 = p.kind === "box" ? p.a : p.c;
    if (BEAM.test(p.name)) {
      const beam = at3[1] > 0 ? beams.left : beams.right;
      if (p.name === "hub motor") continue; // part of the wheel assembly
      if (p.name === "wheel") {
        const w = wheelAssembly(p, tyreMat);
        wheels.push(w);
        into(beam, w);
      } else into(beam, partMesh(p));
    } else if (DIFF.test(p.name)) into(diff, partMesh(p));
    else (MOVING.test(p.name) ? probe : root).add(partMesh(p));
  }
  root.add(probe, diff, beams.left, beams.right);
  view.scene.add(root);
  const lift = new THREE.Vector3();
  return {
    root,
    /** Place the rover at a path sample on the ground; `travel` is the probe's travel in mm.
     *  The rocker beams follow the ground under their two tyres and the body takes their mean. */
    pose(here, travel, ground) {
      const c = Math.cos(here.th);
      const s = Math.sin(here.th);
      const tyre = (u, v) => {
        // highest of three points along the tyre's footprint: a tyre rests on lumps, not in pits
        let h = -Infinity;
        for (const du of [-0.04, 0, 0.04]) h = Math.max(h, ground(here.x + c * (u + du) - s * v, here.y + s * (u + du) + c * v));
        return h / MM;
      };
      const r = rockerPose({ fl: tyre(HALF_BASE, HALF_TRACK), fr: tyre(HALF_BASE, -HALF_TRACK), rl: tyre(-HALF_BASE, HALF_TRACK), rr: tyre(-HALF_BASE, -HALF_TRACK) });
      root.rotation.set(r.roll, here.th, r.pitch, "YZX");
      // The pivot line's centre is where the beams put it; the body's origin is below it, on the body's own axis.
      lift.set(0, DIM.pivot.z * MM, 0).applyEuler(root.rotation);
      root.position.copy(at(here.x, here.y, (r.z + DIM.pivot.z) * MM)).sub(lift);
      beams.left.rotation.z = r.left.rel;
      beams.right.rotation.z = r.right.rel;
      // The left link's foot rises as the left beam noses up; the bar rocks so its end follows.
      const rise = LINK_X * Math.sin(r.left.rel) + LINK_H * (Math.cos(r.left.rel) - 1);
      diff.rotation.x = Math.asin(rise / DIM.beam.y);
      for (const w of wheels) w.rotation.z = -(w.userData.left ? here.rollL : here.rollR) / WHEEL_R;
      probe.position.y = -travel * MM;
    },
  };
}
