// The ground: a height field shaped like a hand-worked tomato field, and its soil shader.
//
// Shape (from reference photos of smallholder tomato fields in India and West Africa): plants on
// raised ridges with uneven shoulders, a lower furrow between ridges where the rover drives, wheel
// ruts in the furrows, clods and lumps everywhere, scattered pits, a field that is not level,
// and a grassy bund around the edge. The rover's furrow is kept wide enough for its wheels, and
// every ridge stays inside the plant rows the simulator uses: the shape is visual only.
//
// Soil: two photographed CC0 soils (assets/soil/), dry tilled soil and darker damp mud, blended by
// how low the ground is, by the soils' own height maps and by the simulated moisture: wetter soil
// is darker and glossier. The data colours (robot's map, error, ...) are mixed into the soil colour.
import * as THREE from "three";
import { makeNoise } from "./noise.js";

export const RIDGE = { top: 0.14, base: 0.36, height: 0.1 }; // m: half-width of the flat top, of the base; height
const RUT_Y = 0.165; // m: wheel tracks either side of the lane centre (half the rover's track)
const TILE = 1.6; // m covered by one repeat of the soil photos
const MARGIN = 3; // m of shaped ground around the field

export function createTerrain(D, { low = false } = {}) {
  const { S, F, LX, LY } = D;
  const n = makeNoise(S.seed * 31 + 7);
  const rows = S.rows_y;
  const lanes = S.lanes_y;
  const ridgeX0 = F.headland - 0.45;
  const ridgeX1 = LX - F.headland + 0.45;

  // Pits and small craters: hoof prints, dug holes, washouts. Kept off the ridge tops.
  const pits = [];
  const bucket = new Map();
  const key = (x, y) => `${Math.floor(x)},${Math.floor(y)}`;
  const count = Math.round((LX + 2) * (LY + 2) * 0.45);
  for (let i = 0; i < count; i++) {
    const x = -1 + n.rand() * (LX + 2);
    const y = -1 + n.rand() * (LY + 2);
    const big = n.rand() < 0.15;
    const p = { x, y, r: big ? 0.18 + n.rand() * 0.2 : 0.05 + n.rand() * 0.1, d: big ? 0.03 + n.rand() * 0.035 : 0.012 + n.rand() * 0.025 };
    if (nearestRow(y) < RIDGE.top) continue;
    pits.push(p);
    for (let bx = Math.floor(x - p.r); bx <= Math.floor(x + p.r); bx++)
      for (let by = Math.floor(y - p.r); by <= Math.floor(y + p.r); by++) {
        const k = `${bx},${by}`;
        if (!bucket.has(k)) bucket.set(k, []);
        bucket.get(k).push(p);
      }
  }

  function nearestRow(y) {
    let d = Infinity;
    for (const r of rows) d = Math.min(d, Math.abs(y - r));
    return d;
  }
  function nearestLane(y) {
    let d = Infinity;
    for (const l of lanes) d = Math.min(d, Math.abs(y - l));
    return d;
  }
  const smooth = (a, b, v) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  /** 1 on a ridge top, 0 in a furrow or headland. */
  function ridge(x, y) {
    const wobble = n.value2(x * 0.8, y * 0.8 + 31) * 0.035;
    const across = 1 - smooth(RIDGE.top + wobble, RIDGE.base + wobble * 0.6, nearestRow(y));
    const along = smooth(ridgeX0, ridgeX0 + 0.6, x) * (1 - smooth(ridgeX1 - 0.6, ridgeX1, x));
    return across * along;
  }
  /** Ground height in metres at field point (x, y). */
  function height(x, y) {
    const r = ridge(x, y);
    const out = Math.max(-x, x - LX, -y, y - LY);
    const edge = 1 - smooth(1.5, MARGIN, out); // fades to the flat grass beyond the margin
    let h = n.fbm(x * 0.09, y * 0.09, 2) * 0.07 * edge; // the field is not level
    h += RIDGE.height * (0.8 + 0.4 * (n.value2(x * 0.45, y * 2.2 + 7) * 0.5 + 0.5)) * r;
    h += n.fbm(x * 5.5, y * 5.5, 3) * (0.012 + 0.012 * r); // lumps
    h += Math.max(0, n.fbm(x * 18 + 3, y * 18, 2)) * 0.012; // clods
    if (x > 0.3 && x < LX - 0.3 && r < 0.5) {
      // wheel ruts along the lanes
      const dl = nearestLane(y);
      h -= 0.014 * Math.exp(-(((dl - RUT_Y) / 0.035) ** 2)) * (1 - 2 * r);
    }
    for (const p of bucket.get(key(x, y)) ?? []) {
      const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d2 < p.r * p.r) h -= p.d * (1 - d2 / (p.r * p.r)) ** 2;
    }
    // A low grassy bund around the field, settling to the level of the grass beyond.
    if (out > 0.4) h += 0.18 * smooth(0.4, 1.4, out) - 0.13 * smooth(1.4, MARGIN, out);
    return h;
  }

  // Mesh: a regular grid over the field and its margin.
  const step = low ? 0.1 : 0.05;
  const nx = Math.round((LX + 2 * MARGIN) / step) + 1;
  const ny = Math.round((LY + 2 * MARGIN) / step) + 1;
  const pos = new Float32Array(nx * ny * 3);
  const furrow = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = -MARGIN + j * step;
    for (let i = 0; i < nx; i++) {
      const x = -MARGIN + i * step;
      const k = j * nx + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = height(x, y);
      pos[k * 3 + 2] = -y;
      const out = Math.max(-x, x - LX, -y, y - LY);
      furrow[k] = out > 0.4 ? 2 : 1 - ridge(x, y); // 2 marks the grassy margin
    }
  }
  const index = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let q = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      index.set([a, b, c, b, d, c], q);
      q += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("furrow", new THREE.BufferAttribute(furrow, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  return { height, ridge, geometry: geo, MARGIN };
}

/** The soil shader: photographed soils, wetness from the simulated moisture, data colours. */
export function soilMaterial(D, renderer) {
  const load = new THREE.TextureLoader();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (name, srgb) => {
    const t = load.load(`assets/soil/${name}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const G = D.S.grid;
  // Simulated true moisture per map cell, for how wet the soil looks (VWC / 0.5 in one byte).
  const moist = new Uint8Array(G.nx * G.ny);
  D.S.truth.forEach((v, i) => (moist[i] = Math.min(255, Math.round(((v ?? 250) / 1000 / 0.5) * 255))));
  const moistTex = new THREE.DataTexture(moist, G.nx, G.ny, THREE.RedFormat);
  moistTex.magFilter = moistTex.minFilter = THREE.LinearFilter;
  moistTex.needsUpdate = true;
  // The data colours, painted by layers.js (RGB + strength in alpha).
  const tintData = new Uint8Array(G.nx * G.ny * 4);
  const tintTex = new THREE.DataTexture(tintData, G.nx, G.ny);
  tintTex.magFilter = tintTex.minFilter = THREE.LinearFilter;
  tintTex.colorSpace = THREE.SRGBColorSpace;

  const uniforms = {
    uColA: { value: tex("farm_soil_color", true) },
    uNorA: { value: tex("farm_soil_normal", false) },
    uArhA: { value: tex("farm_soil_arh", false) },
    uColB: { value: tex("brown_mud_02_color", true) },
    uNorB: { value: tex("brown_mud_02_normal", false) },
    uArhB: { value: tex("brown_mud_02_arh", false) },
    uMoist: { value: moistTex },
    uTint: { value: tintTex },
    uTintAmount: { value: 1 },
    uGridSize: { value: new THREE.Vector2(G.nx * G.res, G.ny * G.res) },
    uDryTint: { value: new THREE.Color(1.18, 0.98, 0.8) }, // the warm ochre of sun-dried topsoil
    uGrass: { value: new THREE.Color(0.32, 0.36, 0.17) },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float furrow;
        varying float vFurrow;
        varying vec3 vWPos;
        varying vec3 vWNormal;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vFurrow = furrow;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uColA, uNorA, uArhA, uColB, uNorB, uArhB, uMoist, uTint;
        uniform float uTintAmount;
        uniform vec2 uGridSize;
        uniform vec3 uDryTint, uGrass;
        varying float vFurrow;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        float sHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float sNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(sHash(i), sHash(i + vec2(1, 0)), u.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), u.x), u.y);
        }
        // Two lookups of a photo at different turns and scales, mixed by noise: no visible repeat.
        const mat2 sTurn = mat2(0.8, -0.6, 0.6, 0.8);
        float sMixK(vec2 uv) { return smoothstep(0.3, 0.7, sNoise(uv * 0.37)); }
        vec4 sTex(sampler2D t, vec2 uv) {
          return mix(texture2D(t, uv), texture2D(t, sTurn * uv * 0.83 + vec2(0.37, 0.11)), sMixK(uv));
        }
        vec3 sNormal(sampler2D t, vec2 uv) {
          vec3 a = texture2D(t, uv).xyz * 2.0 - 1.0;
          vec3 b = texture2D(t, sTurn * uv * 0.83 + vec2(0.37, 0.11)).xyz * 2.0 - 1.0;
          b.xy = transpose(sTurn) * b.xy; // undo the turn
          return normalize(mix(a, b, sMixK(uv)));
        }`,
      )
      .replace(
        "#include <map_fragment>",
        `vec2 sUv = vec2(vWPos.x, -vWPos.z) / ${TILE.toFixed(2)};
        vec2 fUv = vec2(vWPos.x, -vWPos.z) / uGridSize;
        float inside = step(0.0, fUv.x) * step(fUv.x, 1.0) * step(0.0, fUv.y) * step(fUv.y, 1.0);
        float margin = step(1.5, vFurrow);
        float low = min(vFurrow, 1.0);
        vec4 arhA = sTex(uArhA, sUv);
        vec4 arhB = sTex(uArhB, sUv * 1.3);
        float macro = sNoise(sUv * 0.21) * 0.6 + sNoise(sUv * 0.9) * 0.4;
        float vwc = texture2D(uMoist, clamp(fUv, 0.0, 1.0)).r * 0.5;
        float wet = smoothstep(0.24, 0.42, vwc) * (0.3 + 0.7 * low) * inside;
        float mudMix = smoothstep(0.38, 0.62, clamp(low * 0.75 - 0.35 + (arhB.b - arhA.b) * 0.9 + (macro - 0.5) * 0.7 + wet * 0.9, 0.0, 1.0));
        vec3 albedo = mix(sTex(uColA, sUv).rgb * uDryTint, sTex(uColB, sUv * 1.3).rgb, mudMix);
        albedo *= mix(0.86, 1.1, macro);
        albedo = mix(albedo, albedo * uGrass * 2.4, margin * smoothstep(0.35, 0.6, macro));
        albedo *= 1.0 - 0.4 * wet; // wet soil is darker
        vec4 tint = texture2D(uTint, clamp(fUv, 0.0, 1.0));
        // Colour the soil rather than paint over it: keep its light and dark detail.
        float lum = dot(albedo, vec3(0.3, 0.59, 0.11));
        vec3 tinted = tint.rgb * clamp(lum / 0.16, 0.55, 1.5);
        albedo = mix(albedo, tinted, tint.a * uTintAmount * inside);
        diffuseColor.rgb = albedo;
        float sRough = mix(arhA.g, arhB.g, mudMix);
        float sAO = mix(arhA.r, arhB.r, mudMix);`,
      )
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = clamp(sRough * mix(1.0, 0.5, wet), 0.08, 1.0);")
      .replace(
        "#include <normal_fragment_maps>",
        `{
          vec3 tn = normalize(mix(sNormal(uNorA, sUv), sNormal(uNorB, sUv * 1.3), mudMix));
          tn.xy *= 1.4;
          vec3 gN = normalize(vWNormal);
          vec3 T = normalize(vec3(1.0, 0.0, 0.0) - gN * gN.x);
          vec3 B = cross(gN, T); // field +y on flat ground
          normal = normalize((viewMatrix * vec4(normalize(T * tn.x + B * tn.y + gN * tn.z), 0.0)).xyz);
        }`,
      )
      .replace(
        "#include <aomap_fragment>",
        `reflectedLight.indirectDiffuse *= mix(1.0, sAO, 0.85);
        reflectedLight.directDiffuse *= mix(1.0, sAO, 0.35);
        reflectedLight.indirectSpecular *= mix(1.0, sAO, 0.85);`,
      );
  };
  return { material, tintData, tintTex, uniforms };
}
