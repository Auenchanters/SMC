// 3D replay of one agrisim survey. Everything shown comes from scene.json (written by
// `agrisim run --view`); the rover is built from rover-model.mjs, the hardware design's model.
// World frame: agrisim x along the rows, y across, metres. three.js: x = x, y = up, z = -y.
import * as THREE from "three";
import { OrbitControls } from "./vendor/addons/OrbitControls.js";
import { RoundedBoxGeometry } from "./vendor/addons/RoundedBoxGeometry.js";
import { Sky } from "./vendor/addons/Sky.js";
import { DIM, cycle, parts, probeAt, scanHeads } from "./rover-model.mjs";

const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const LOW = query.get("quality") === "low";

let S;
try {
  const res = await fetch(query.get("scene") ?? "run/scene.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  S = await res.json();
} catch (err) {
  $("loading").textContent = `Could not load the survey data (${err.message}). Start the viewer with: agrisim run ... --view`;
  throw err;
}

// ---------------------------------------------------------------- data ----
const F = S.field;
const LX = F.length_x;
const LY = F.width_y;
const N = S.probes.length;
const DRY = S.dry_threshold;
const INS = S.probe_time_s;
const at = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
const CENTRE = at(LX / 2, LY / 2);
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry(S.seed * 7919 + 11); // the scenery looks the same on every load

// Path: times, poses, distance driven and how far each wheel side has rolled.
const P = S.path;
const T_END = P.t[P.t.length - 1];
const TRACK = DIM.wheel.track / 1000;
const WHEEL_R = DIM.wheel.r / 1000;
const dist = new Float64Array(P.t.length);
const rollL = new Float64Array(P.t.length);
const rollR = new Float64Array(P.t.length);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
for (let i = 1; i < P.t.length; i++) {
  const dx = P.x[i] - P.x[i - 1];
  const dy = P.y[i] - P.y[i - 1];
  const dth = wrap(P.th[i] - P.th[i - 1]);
  const mid = P.th[i - 1] + dth / 2;
  const ds = dx * Math.cos(mid) + dy * Math.sin(mid); // negative when reversing
  dist[i] = dist[i - 1] + Math.hypot(dx, dy);
  rollL[i] = rollL[i - 1] + ds - (dth * TRACK) / 2;
  rollR[i] = rollR[i - 1] + ds + (dth * TRACK) / 2;
}
function pathAt(t) {
  let lo = 0;
  let hi = P.t.length - 1;
  if (t <= P.t[0]) hi = 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (P.t[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = P.t[hi] - P.t[lo];
  const f = span > 0 ? Math.min(1, Math.max(0, (t - P.t[lo]) / span)) : 0;
  const mix = (a) => a[lo] + (a[hi] - a[lo]) * f;
  return { x: mix(P.x), y: mix(P.y), th: P.th[lo] + wrap(P.th[hi] - P.th[lo]) * f, dist: mix(dist), rollL: mix(rollL), rollR: mix(rollR), index: hi };
}

// Probe stops: the rover stands still for INS seconds; the reading is final at probe.t.
// One cycle of the hardware model (27 s) is played over that window.
const CYC = cycle();
const stops = S.probes.map((p, i) => ({ ...p, i, start: p.t - INS, reveal: p.t - INS + (INS * CYC.t3) / CYC.t6 }));
function stopAt(t) {
  for (const s of stops) if (t >= s.start && t < s.t) return { stop: s, ...probeAt(((t - s.start) / INS) * CYC.t6) };
  return null;
}
const readingsBy = (t) => stops.filter((s) => s.reveal <= t).length;

// ------------------------------------------------------------ renderer ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, LOW ? 1 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
$("view").appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 6000);

const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(50), THREE.MathUtils.degToRad(145));
function makeSky() {
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2;
  u.rayleigh.value = 1.1;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.cloudCoverage.value = 0.3;
  u.sunPosition.value.copy(sunDir);
  return sky;
}
scene.add(makeSky());
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.add(makeSky());
  scene.environment = pmrem.fromScene(env).texture;
  scene.environmentIntensity = 0.5;
}
scene.fog = new THREE.Fog(0xcad7df, 80, 320);

const sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
sun.position.copy(CENTRE).addScaledVector(sunDir, 70);
sun.target.position.copy(CENTRE);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(LOW ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 10, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 2.5;
scene.add(sun, sun.target, new THREE.HemisphereLight(0xdde8ff, 0x6b5536, 0.45));

// ------------------------------------------------------------- ground ----
function speckleTexture(size, base, colours, n, rMin, rMax, repeat) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colours[Math.floor(rand() * colours.length)];
    g.globalAlpha = 0.25 + rand() * 0.55;
    const r = rMin + rand() * (rMax - rMin);
    const x = rand() * size;
    const y = rand() * size;
    const e = 0.5 + rand() * 0.6;
    const a = rand() * Math.PI;
    for (const ox of [0, -size]) for (const oy of [0, -size]) { // wrapped copies: no seams when tiled
      g.beginPath();
      g.ellipse(x + ox + (x < rMax ? size : 0), y + oy + (y < rMax ? size : 0), r, r * e, a, 0, 2 * Math.PI);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}
const MARGIN = 1.2;
{
  const grassTex = speckleTexture(512, "#5b7a37", ["#4a6a2c", "#6d8c42", "#7f9a4a", "#3e5b25", "#8a9a55"], 9000, 1, 3.5, [200, 200]);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.copy(CENTRE).setY(-0.03);
  grass.receiveShadow = true;
  scene.add(grass);

  const soilTex = speckleTexture(512, "#6c4e36", ["#57402c", "#7d5d42", "#4a3423", "#8b6b4d", "#9c8269", "#3f2c1e"], 3200, 1, 7, [(LX + 2 * MARGIN) / 1.6, (LY + 2 * MARGIN) / 1.6]);
  const soil = new THREE.Mesh(
    new THREE.PlaneGeometry(LX + 2 * MARGIN, LY + 2 * MARGIN),
    new THREE.MeshStandardMaterial({ map: soilTex, bumpMap: soilTex, bumpScale: 2.5, roughness: 0.97 }),
  );
  soil.rotation.x = -Math.PI / 2;
  soil.position.copy(CENTRE);
  soil.receiveShadow = true;
  scene.add(soil);
}

// Moisture overlay: one texel per map cell, coloured by the chosen layer.
const G = S.grid;
const overlayData = new Uint8Array(G.nx * G.ny * 4);
const overlayTex = new THREE.DataTexture(overlayData, G.nx, G.ny);
overlayTex.magFilter = overlayTex.minFilter = THREE.LinearFilter;
overlayTex.colorSpace = THREE.SRGBColorSpace;
const overlay = new THREE.Mesh(
  new THREE.PlaneGeometry(G.nx * G.res, G.ny * G.res),
  new THREE.MeshStandardMaterial({ map: overlayTex, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
);
overlay.rotation.x = -Math.PI / 2;
overlay.position.copy(at((G.nx * G.res) / 2, (G.ny * G.res) / 2, 0.004));
overlay.receiveShadow = true;
scene.add(overlay);

// Drip irrigation: a tape along every row and a main pipe along the west headland.
{
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
  const len = LX - 2 * F.headland + 0.6;
  const tape = new THREE.CylinderGeometry(0.008, 0.008, len, 8).rotateZ(Math.PI / 2);
  for (const y of S.rows_y) {
    const m = new THREE.Mesh(tape, tapeMat);
    m.position.copy(at(LX / 2, y, 0.008));
    m.receiveShadow = true;
    scene.add(m);
  }
  const main = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, LY, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1f4f8a, roughness: 0.5 }));
  main.position.copy(at(F.headland - 0.35, LY / 2, 0.025));
  main.castShadow = true;
  scene.add(main);
}

// ------------------------------------------------------------- plants ----
function mergeGeometries(list) {
  const pos = [];
  for (const g of list) pos.push(...(g.index ? g.toNonIndexed() : g).attributes.position.array);
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return out;
}
function lumpyBall() {
  // A sphere with each vertex pushed in or out a little: a leafy mass rather than a ball.
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
{
  const stems = S.stems;
  const FRONDS = LOW ? 9 : 15;
  const BLOBS = 4;
  const leafGeo = frondGeometry();
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.75 }), stems.length * FRONDS);
  const blobGeo = lumpyBall();
  const blobs = new THREE.InstancedMesh(blobGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), stems.length * BLOBS);
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
      const s = r * (0.34 + rand() * 0.12) * (1 - 0.15 * j / BLOBS);
      o.position.copy(at(x + (rand() - 0.5) * 0.06, y + (rand() - 0.5) * 0.06, 0.2 + j * (h - 0.3) / (BLOBS - 1) + rand() * 0.05));
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
    scene.add(m);
  }
}

// Trees around the field, for scale.
{
  const TREES = 46;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 1, 7).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 }), TREES);
  const crowns = new THREE.InstancedMesh(lumpyBall(), new THREE.MeshStandardMaterial({ roughness: 0.9 }), TREES * 2);
  const o = new THREE.Object3D();
  const colour = new THREE.Color();
  for (let i = 0; i < TREES; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.max(LX, LY) / 2 + 9 + rand() * 45;
    const x = LX / 2 + Math.cos(a) * d * 1.15;
    const y = LY / 2 + Math.sin(a) * d;
    const h = 3 + rand() * 4;
    o.position.copy(at(x, y));
    o.rotation.set(0, 0, 0);
    o.scale.set(1, h * 0.55, 1);
    o.updateMatrix();
    trunks.setMatrixAt(i, o.matrix);
    for (let j = 0; j < 2; j++) {
      const s = h * (0.32 + rand() * 0.12);
      o.position.copy(at(x + (rand() - 0.5) * 0.8, y + (rand() - 0.5) * 0.8, h * (0.62 + j * 0.2)));
      o.rotation.set(rand(), rand(), rand());
      o.scale.set(s, s * 0.9, s);
      o.updateMatrix();
      crowns.setMatrixAt(i * 2 + j, o.matrix);
      crowns.setColorAt(i * 2 + j, colour.setHSL(0.24 + rand() * 0.06, 0.45, 0.22 + rand() * 0.08));
    }
  }
  for (const m of [trunks, crowns]) {
    m.castShadow = true;
    scene.add(m);
  }
}

// -------------------------------------------------------------- rover ----
// Built from the hardware model's parts list (mm, x forward, y left, z up).
const MM = 0.001;
const mat = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
const M = {
  body: mat(0x2c3136, 0.25, 0.55), dark: mat(0x1e2124, 0.3, 0.5), alu: mat(0xc3c9cf, 0.85, 0.38), blue: mat(0x2f62a8, 0.6, 0.38),
  chrome: mat(0xe6e9eb, 1, 0.14), brass: mat(0xb38f55, 1, 0.35), orange: mat(0xe07b22, 0.2, 0.5), white: mat(0xeceae4, 0.05, 0.5),
  yellow: mat(0xf0c22e, 0.1, 0.5), red: mat(0xd42a20, 0.1, 0.4), black: mat(0x151617, 0.2, 0.45), rim: mat(0xaab0b6, 0.8, 0.35),
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
const tyreMat = (() => {
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
})();
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
function wheelAssembly(p) {
  // Tyre, rim and hub, spun about the axle (local z after the turn below).
  const spin = new THREE.Group();
  const r = p.r * MM;
  const w = p.len * MM;
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 40, 1, true), tyreMat);
  const side = new THREE.Mesh(new THREE.RingGeometry(r * 0.62, r, 40), M.black);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 0.92, 24, 1, true), M.rim);
  M.rim.side = THREE.DoubleSide;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.18, w * 1.04, 12), M.dark);
  for (const m of [tyre, rim, hub]) m.rotation.x = Math.PI / 2;
  for (const s of [1, -1]) {
    const face = side.clone();
    face.position.z = (s * w) / 2;
    if (s < 0) face.rotation.y = Math.PI;
    spin.add(face);
  }
  for (const m of [tyre, rim, hub, ...spin.children]) { m.castShadow = true; m.receiveShadow = true; }
  spin.add(tyre, rim, hub);
  // Five spokes so the spin is visible.
  for (let k = 0; k < 5; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(r * 0.08, r * 1.08, w * 0.94), M.dark);
    spoke.rotation.z = (k * 2 * Math.PI) / 5;
    spin.add(spoke);
  }
  spin.position.copy(v3(...p.c));
  spin.userData.left = p.c[1] > 0;
  return spin;
}
const rover = new THREE.Group();
const probeGroup = new THREE.Group();
const wheels = [];
for (const p of [...parts(0), ...scanHeads(0)]) {
  if (p.name === "wheel") {
    const w = wheelAssembly(p);
    wheels.push(w);
    rover.add(w);
  } else (p.group === "probe" ? probeGroup : rover).add(partMesh(p));
}
rover.add(probeGroup);
scene.add(rover);

// --------------------------------------------------------- pins, rings ----
// A round mark on the ground at every reading, coloured by the value measured (grey: probe failed).
const markGeo = new THREE.CircleGeometry(0.085, 32).rotateX(-Math.PI / 2);
const edgeGeo = new THREE.RingGeometry(0.085, 0.105, 32).rotateX(-Math.PI / 2);
const holeGeo = new THREE.CircleGeometry(0.022, 16).rotateX(-Math.PI / 2);
const pins = stops.map((s) => {
  const g = new THREE.Group();
  const head = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ toneMapped: false, color: s.v == null ? 0x8a8f94 : 0xffffff, polygonOffset: true, polygonOffsetFactor: -4 }));
  const edge = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -4 }));
  const hole = new THREE.Mesh(holeGeo, new THREE.MeshBasicMaterial({ color: 0x1c120a, polygonOffset: true, polygonOffsetFactor: -6 }));
  head.position.y = edge.position.y = 0.008;
  hole.position.y = 0.009;
  head.userData.stop = s;
  g.add(head, edge, hole);
  g.position.copy(at(s.x, s.y));
  g.visible = false;
  scene.add(g);
  return { group: g, head };
});
const nextRing = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.18, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8fe3a8, transparent: true, opacity: 0.9, depthWrite: false }));
scene.add(nextRing);
const dust = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.06, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7a5a3e, transparent: true, depthWrite: false }));
scene.add(dust);
// The route driven so far.
const trailGeo = new THREE.BufferGeometry().setFromPoints(P.x.map((x, i) => at(x, P.y[i], 0.012)));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
scene.add(trail);

// -------------------------------------------------------- colour layers ----
const hex = (h) => new THREE.Color(h);
// Red-brown = dry, yellow = the "too dry" line, blue = wetter. No green: it would blend with the plants.
const MOIST = [[0.05, "#7c2a0a"], [0.12, "#d0612a"], [0.18, "#f0b84a"], [0.24, "#b9d3e3"], [0.3, "#6aa6dc"], [0.37, "#2f6cb8"], [0.45, "#173c82"]];
const ERR = [[0, "#fff7ec"], [0.025, "#fdd49e"], [0.05, "#fc8d59"], [0.1, "#b30000"]];
const UNC = [[0, "#f2f0f7"], [0.02, "#cbc9e2"], [0.04, "#9e9ac8"], [0.07, "#54278f"]];
for (const stops_ of [MOIST, ERR, UNC]) for (const s of stops_) s[2] = hex(s[1]);
function ramp(stopsList, v, out) {
  const n = stopsList.length;
  if (v <= stopsList[0][0]) return out.copy(stopsList[0][2]);
  for (let i = 1; i < n; i++) {
    if (v <= stopsList[i][0]) return out.copy(stopsList[i - 1][2]).lerp(stopsList[i][2], (v - stopsList[i - 1][0]) / (stopsList[i][0] - stopsList[i - 1][0]));
  }
  return out.copy(stopsList[n - 1][2]);
}
const milli = (v) => (v == null ? null : v / 1000);
const LAYERS = [
  { label: "Robot's map", stops: MOIST, alpha: 0.7, value: (i, k) => milli(S.estimate[k][i]),
    text: "What the robot thinks the soil moisture is everywhere, worked out from its marks so far. Watch it sharpen with every reading.",
    ticks: () => [[0.05, "5% dry"], [DRY, `${pct(DRY)} too dry below`, true], [0.3, "30%"], [0.45, "45% wet"]] },
  { label: "Real moisture", stops: MOIST, alpha: 0.7, value: (i) => milli(S.truth[i]),
    text: "The true moisture in this simulated field. The robot never sees it; it is here so you can check the robot's map against it.",
    ticks: () => [[0.05, "5% dry"], [DRY, `${pct(DRY)} too dry below`, true], [0.3, "30%"], [0.45, "45% wet"]] },
  { label: "Map error", stops: ERR, alpha: 0.8, value: (i, k) => (S.estimate[k][i] == null ? null : Math.abs(S.estimate[k][i] - S.truth[i]) / 1000),
    text: "How far the robot's map is from the truth at each spot. Pale = about right, dark red = wrong by 10 % points or more.",
    ticks: () => [[0, "spot on"], [0.025, "2.5"], [0.05, "5"], [0.1, "10+ % points"]] },
  { label: "Uncertainty", stops: UNC, alpha: 0.8, value: (i, k) => milli(S.sd[k][i]),
    text: "How unsure the robot is about each spot. It is sure near its marks and unsure far from them; that is where it would help to measure next.",
    ticks: () => [[0, "sure"], [0.035, "somewhat"], [0.07, "unsure"]] },
  { label: "Plain soil", stops: null, text: "No colours: just the field as it looks.", ticks: () => [] },
];
let layer = 0;
let shownKey = "";
const tmpColour = new THREE.Color();
function paintOverlay(k) {
  const key = `${layer}/${k}`;
  if (key === shownKey) return;
  shownKey = key;
  const L = LAYERS[layer];
  overlay.visible = !!L.stops;
  if (!L.stops) return;
  for (let i = 0; i < G.nx * G.ny; i++) {
    const v = L.value(i, k);
    const o = i * 4;
    if (v == null) {
      overlayData[o + 3] = 0;
      continue;
    }
    ramp(L.stops, v, tmpColour);
    overlayData[o] = tmpColour.r * 255;
    overlayData[o + 1] = tmpColour.g * 255;
    overlayData[o + 2] = tmpColour.b * 255;
    overlayData[o + 3] = L.alpha * 255;
  }
  overlayTex.needsUpdate = true;
}
function showLayerInfo() {
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
function setLayer(i) {
  layer = i;
  showLayerInfo();
  paintOverlay(readingsBy(t));
}
LAYERS.forEach((L, i) => {
  const b = document.createElement("button");
  b.textContent = L.label;
  b.title = `Key ${i + 1}`;
  b.onclick = () => setLayer(i);
  $("layerButtons").appendChild(b);
});
for (const s of stops) if (s.v != null) pins[s.i].head.material.color.copy(ramp(MOIST, s.v, new THREE.Color()));

// ------------------------------------------------------------- camera ----
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = THREE.MathUtils.degToRad(87);
controls.minDistance = 0.6;
controls.maxDistance = 140;
let camMode = "follow";
let flight = null;
const roverFocus = new THREE.Vector3();
function flyTo(position, target, seconds = 1.4) {
  flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: position, t1: target, start: performance.now(), ms: seconds * 1000 };
}
function setCam(mode) {
  camMode = mode;
  for (const b of $("cams").children) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  if (mode === "overhead") flyTo(CENTRE.clone().add(new THREE.Vector3(0, 30, 13)), CENTRE.clone());
  if (mode === "follow") flyTo(roverFocus.clone().add(new THREE.Vector3(-2.3, 1.45, 0.3)), roverFocus.clone());
}
for (const [mode, label] of [["follow", "Follow robot"], ["overhead", "Whole field"], ["free", "Free look"]]) {
  const b = document.createElement("button");
  b.dataset.mode = mode;
  b.textContent = label;
  b.onclick = () => setCam(mode);
  $("cams").appendChild(b);
}
controls.addEventListener("start", () => {
  flight = null; // the user took the camera
});

// ----------------------------------------------------------- playback ----
let t = 0;
let playing = !query.has("paused");
let speed = 20;
const SPEEDS = [1, 5, 20, 60, 200];
for (const s of SPEEDS) {
  const b = document.createElement("button");
  b.textContent = `${s}×`;
  b.title = `Play at ${s} times real speed`;
  b.onclick = () => setSpeed(s);
  $("speeds").appendChild(b);
}
function setSpeed(s) {
  speed = s;
  for (const b of $("speeds").children) b.setAttribute("aria-pressed", String(b.textContent === `${s}×`));
}
function setPlaying(on) {
  if (on && t >= T_END) t = 0;
  playing = on;
  $("playBtn").textContent = on ? "❚❚ Pause" : "▶ Play";
}
function setTime(v) {
  t = Math.min(T_END, Math.max(0, v));
}
$("playBtn").onclick = () => setPlaying(!playing);
const slider = $("time");
slider.max = String(T_END);
slider.oninput = () => setTime(Number(slider.value));
const jump = (dir) => {
  const list = stops.map((s) => s.start);
  const target = dir > 0 ? list.find((s) => s > t + 0.01) : [...list].reverse().find((s) => s < t - 0.5);
  if (target !== undefined) setTime(target);
};

// ----------------------------------------------------------- HUD text ----
const PHASE = {
  lowering: "Lowering the probe to the ground",
  inserting: "Pushing the probe into the soil",
  reading: "Measuring the soil moisture",
  retracting: "Pulling the probe out; brushes wipe the soil off",
  "air blast": "Blowing the probe dry with air",
  "air check": "Checking the probe is clean",
  parked: "Probe parked",
};
const verdict = (v) => (v == null ? "the probe failed here, no reading" : `${pct(v)} water, ${v < DRY ? "too dry" : "OK"}`);
let lastText = "";
function updateHud(state, here, k) {
  const valid = stops.filter((s) => s.reveal <= t && s.v != null).length;
  const failed = k - valid;
  let status;
  let sub;
  let reading = "";
  if (state) {
    const s = state.stop;
    status = PHASE[state.phase] ?? state.phase;
    sub = `Stop ${s.i + 1} of ${N}`;
    if (t >= s.reveal) reading = `Reading: ${verdict(s.v)}`;
  } else if (k < N) {
    const next = stops[k];
    status = k === 0 ? "Driving to the first stop" : `Driving to stop ${next.i + 1} of ${N}`;
    sub = `${Math.max(0, Math.hypot(next.x - here.x, next.y - here.y)).toFixed(1)} m away in a straight line`;
    if (k > 0) reading = `Last reading: ${verdict(stops[k - 1].v)}`;
  } else if (t < T_END - 0.05) {
    status = "All readings taken";
    sub = "Driving the rest of the route";
  } else {
    status = "Survey complete";
    sub = `${valid} readings, ${dist[dist.length - 1].toFixed(0)} m driven, ${clock(T_END)} of mission time`;
  }
  const contacts = S.contacts.filter((c) => c.t <= t).length;
  const err = S.rmse[k];
  const text = [status, sub, reading, k, failed, here.dist.toFixed(0), contacts, err].join("|");
  if (text === lastText) return;
  lastText = text;
  $("status").textContent = status;
  $("substatus").textContent = sub;
  $("reading").textContent = reading;
  const shownStop = state && t >= state.stop.reveal ? state.stop : !state && k > 0 ? stops[k - 1] : null;
  $("reading").style.color = shownStop && (shownStop.v == null || shownStop.v < DRY) ? "var(--warn)" : "var(--text)";
  $("sReadings").textContent = `${k} of ${N}${failed ? ` (${failed} failed)` : ""}`;
  $("sDistance").textContent = `${here.dist.toFixed(0)} m`;
  $("sContacts").textContent = String(contacts);
  $("sContacts").style.color = contacts ? "var(--bad)" : "var(--accent)";
  $("sError").textContent = err == null ? "no map yet" : `±${(err * 100).toFixed(1)} % points`;
}

// --------------------------------------------------------- 3D labels ----
const tagRobot = $("tagRobot");
const tagNext = $("tagNext");
const projected = new THREE.Vector3();
function placeTag(el, world, show) {
  projected.copy(world).project(camera);
  const visible = show && projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05;
  el.style.display = visible ? "block" : "none";
  if (visible) {
    el.style.left = `${((projected.x + 1) / 2) * innerWidth}px`;
    el.style.top = `${((1 - projected.y) / 2) * innerHeight}px`;
  }
}
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener("pointermove", (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pins.filter((p) => p.group.visible).map((p) => p.head))[0];
  const tip = $("tip");
  if (!hit) {
    tip.style.display = "none";
    return;
  }
  const s = hit.object.userData.stop;
  tip.innerHTML = `<b>Stop ${s.i + 1}</b><br>${verdict(s.v)}<br><span class="dim">measured at ${clock(s.t)} into the mission</span>`;
  tip.style.display = "block";
  tip.style.left = `${e.clientX + 14}px`;
  tip.style.top = `${e.clientY + 14}px`;
});

// --------------------------------------------------------------- frame ----
let lastNow = performance.now();
let firstFrame = true;
function frame(now) {
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  if (playing) {
    const slow = $("slow").checked && stopAt(t);
    t = Math.min(T_END, t + dt * (slow ? Math.min(speed, 4) : speed));
    if (t >= T_END) setPlaying(false);
  }
  const here = pathAt(t);
  const state = stopAt(t);
  const k = readingsBy(t);

  rover.position.copy(at(here.x, here.y));
  rover.rotation.y = here.th;
  for (const w of wheels) w.rotation.z = -(w.userData.left ? here.rollL : here.rollR) / WHEEL_R;
  probeGroup.position.y = -(state ? state.travel : 0) * MM;

  const camDist = camera.position.distanceTo(controls.target);
  const markScale = THREE.MathUtils.clamp(camDist / 7, 1, 3.5); // readable when zoomed out
  overlay.material.opacity = THREE.MathUtils.clamp(camDist / 10, 0.4, 1); // real soil up close, clear map from afar
  pins.forEach((p, i) => {
    p.group.visible = stops[i].reveal <= t;
    p.group.scale.setScalar(markScale);
  });
  const next = !state && k < N ? stops[k] : null;
  nextRing.visible = !!next;
  if (next) {
    nextRing.position.copy(at(next.x, next.y, 0.01));
    nextRing.scale.setScalar(1 + 0.12 * Math.sin(now / 250));
  }
  dust.visible = !!state && state.phase === "inserting";
  if (dust.visible) {
    const f = (state.travel - DIM.probe.tip0) / DIM.probe.depth;
    dust.position.copy(at(state.stop.x, state.stop.y, 0.01));
    dust.scale.setScalar(1 + 3 * f);
    dust.material.opacity = 0.7 * (1 - f);
  }
  trail.geometry.setDrawRange(0, here.index);
  paintOverlay(k);
  updateHud(state, here, k);
  slider.value = String(t);
  $("clock").textContent = `${clock(t)} / ${clock(T_END)}`;

  roverFocus.copy(rover.position).setY(0.25);
  if (flight) {
    const f = Math.min(1, (now - flight.start) / flight.ms);
    const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
    const target = camMode === "follow" ? roverFocus : flight.t1;
    const dest = camMode === "follow" ? roverFocus.clone().add(flight.p1.clone().sub(flight.t1)) : flight.p1;
    camera.position.lerpVectors(flight.p0, dest, e);
    controls.target.lerpVectors(flight.t0, target, e);
    if (f >= 1) flight = null;
  } else if (camMode === "follow") {
    const shift = roverFocus.clone().sub(controls.target);
    controls.target.add(shift);
    camera.position.add(shift);
  }
  controls.update();
  placeTag(tagRobot, rover.position.clone().setY(0.62), true);
  placeTag(tagNext, nextRing.position.clone().setY(0.32), nextRing.visible);
  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    $("loading").remove();
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ wiring ----
$("runInfo").textContent = `Replay of a real simulator run: seed ${S.seed}, ${S.policy.replaceAll("_", " ")} strategy, ${N} stops, ${clock(T_END)} of mission time.`;
$("helpDry").textContent = pct(DRY);
const openHelp = (on) => ($("help").style.display = on ? "grid" : "none");
$("helpBtn").onclick = () => openHelp(true);
$("closeHelp").onclick = () => openHelp(false);
$("help").onclick = (e) => e.target === $("help") && openHelp(false);
const showIntro = (on) => {
  $("intro").style.display = on ? "" : "none";
  $("introSmall").style.display = on ? "none" : "block";
};
$("hideIntro").onclick = () => showIntro(false);
$("introSmall").onclick = () => showIntro(true);
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
  if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === "ArrowRight") { e.preventDefault(); jump(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); jump(-1); }
  else if (/^[1-5]$/.test(e.key)) setLayer(Number(e.key) - 1);
  else if (e.key === "f" || e.key === "F") setCam("follow");
  else if (e.key === "o" || e.key === "O") setCam("overhead");
  else if (e.key === "?") openHelp(true);
  else if (e.key === "Escape") openHelp(false);
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const start = pathAt(0);
roverFocus.copy(at(start.x, start.y, 0.25));
camera.position.copy(roverFocus).add(new THREE.Vector3(-2.3, 1.45, 0.3));
controls.target.copy(roverFocus);
setCam("follow");
flight = null;
setSpeed(speed);
setPlaying(playing);
setLayer(0);
// Hooks for scripted demos and tests.
window.viewer = { setTime, setPlaying, setLayer, setCam, setSpeed, get t() { return t; }, T_END, stops, scene, camera };
requestAnimationFrame(frame);
