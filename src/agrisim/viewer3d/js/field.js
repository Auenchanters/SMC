// The field: shaped ground (terrain.js), the grass beyond it, irrigation and the trees around.
import * as THREE from "three";
import { at } from "./data.js";
import { lumpyBall } from "./plants.js";
import { createTerrain, soilMaterial } from "./terrain.js";

function speckleTexture(renderer, rand, size, base, colours, n, rMin, rMax, repeat) {
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

/** Ground, grass and irrigation. Sets D.ground(x, y), the ground height every other module uses. */
export function buildField(view, D, { low = false } = {}) {
  const { scene, renderer } = view;
  const { S, F, LX, LY, rand } = D;
  const terrain = createTerrain(D, { low });
  D.ground = terrain.height;
  D.ridge = terrain.ridge;

  const soil = soilMaterial(D, renderer);
  const ground = new THREE.Mesh(terrain.geometry, soil.material);
  ground.receiveShadow = true;
  ground.castShadow = true; // ridges and clods shade each other when the sun is low
  scene.add(ground);

  const grassTex = speckleTexture(renderer, rand, 512, "#5b7a37", ["#4a6a2c", "#6d8c42", "#7f9a4a", "#3e5b25", "#8a9a55"], 9000, 1, 3.5, [0.25, 0.25]); // one repeat per 4 m
  // Grass beyond the shaped ground: a big square with a hole where the terrain mesh is (it
  // overlaps the terrain's outer 0.3 m, where both are at grass level).
  const ring = new THREE.Shape([[-400, -400], [400, -400], [400, 400], [-400, 400]].map(([a, b]) => new THREE.Vector2(a, b)));
  const m = terrain.MARGIN - 0.3;
  ring.holes.push(new THREE.Path([[-m, -m], [-m, LY + m], [LX + m, LY + m], [LX + m, -m]].map(([a, b]) => new THREE.Vector2(a, b))));
  const grass = new THREE.Mesh(new THREE.ShapeGeometry(ring), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2; // shape x, y -> world x, -z: field x, y
  grass.position.y = 0.05;
  grass.receiveShadow = true;
  scene.add(grass);

  // Drip tape lying along the top of every ridge, and a main pipe along the west headland.
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55 });
  const x0 = F.headland - 0.3;
  const x1 = LX - F.headland + 0.3;
  for (const y of S.rows_y) {
    const pts = [];
    for (let x = x0; x <= x1 + 1e-6; x += 0.25) {
      const yy = y + Math.sin(x * 1.7 + y) * 0.03; // tape never lies perfectly straight
      pts.push(at(x, yy, D.ground(x, yy) + 0.008));
    }
    const tape = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.008, 6), tapeMat);
    tape.receiveShadow = true;
    scene.add(tape);
  }
  const mainPts = [];
  for (let y = -0.3; y <= LY + 0.3; y += 0.5) mainPts.push(at(F.headland - 0.55, y, D.ground(F.headland - 0.55, y) + 0.025));
  const main = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mainPts), mainPts.length * 2, 0.025, 10), new THREE.MeshStandardMaterial({ color: 0x1f4f8a, roughness: 0.5 }));
  main.castShadow = true;
  scene.add(main);

  return { tintData: soil.tintData, tintTex: soil.tintTex, soilUniforms: soil.uniforms };
}

/** Trees around the field, for scale. */
export function buildTrees(view, D) {
  const { LX, LY, rand } = D;
  const TREES = 46;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 1, 7).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 }), TREES);
  const crowns = new THREE.InstancedMesh(lumpyBall(rand), new THREE.MeshStandardMaterial({ roughness: 0.9 }), TREES * 2);
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
    view.scene.add(m);
  }
}
