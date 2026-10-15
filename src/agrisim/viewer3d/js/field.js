// The ground, the moisture overlay surface, irrigation and the trees around the field.
import * as THREE from "three";
import { at } from "./data.js";
import { lumpyBall } from "./plants.js";

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

/** Ground and irrigation. Returns the overlay mesh and its RGBA data (one texel per map cell). */
export function buildField(view, D) {
  const { scene, renderer } = view;
  const { S, F, LX, LY, CENTRE, rand } = D;
  const MARGIN = 1.2;
  const grassTex = speckleTexture(renderer, rand, 512, "#5b7a37", ["#4a6a2c", "#6d8c42", "#7f9a4a", "#3e5b25", "#8a9a55"], 9000, 1, 3.5, [200, 200]);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.copy(CENTRE).setY(-0.03);
  grass.receiveShadow = true;
  scene.add(grass);

  const soilTex = speckleTexture(renderer, rand, 512, "#6c4e36", ["#57402c", "#7d5d42", "#4a3423", "#8b6b4d", "#9c8269", "#3f2c1e"], 3200, 1, 7, [(LX + 2 * MARGIN) / 1.6, (LY + 2 * MARGIN) / 1.6]);
  const soil = new THREE.Mesh(
    new THREE.PlaneGeometry(LX + 2 * MARGIN, LY + 2 * MARGIN),
    new THREE.MeshStandardMaterial({ map: soilTex, bumpMap: soilTex, bumpScale: 2.5, roughness: 0.97 }),
  );
  soil.rotation.x = -Math.PI / 2;
  soil.position.copy(CENTRE);
  soil.receiveShadow = true;
  scene.add(soil);

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
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
  const tape = new THREE.CylinderGeometry(0.008, 0.008, LX - 2 * F.headland + 0.6, 8).rotateZ(Math.PI / 2);
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

  return { overlay, overlayData, overlayTex };
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
