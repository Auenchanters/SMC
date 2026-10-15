// Renderer, camera, light and image quality.
//
// A photographed sky (CC0, assets/sky/) is both the visible sky and the light: its soft light comes
// from the image itself (image-based lighting) and its sun becomes a directional light with
// shadows, aimed where the sun is in the photo. On Medium and High a post-processing chain adds
// ground-contact ambient occlusion (GTAO: the soft darkening where leaves overlap and where things
// meet the soil), multisample anti-aliasing and AgX tone mapping.
import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// A camera-like finish on the final image (display colours): a touch more contrast and
// colour, and a soft vignette.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uContrast: { value: 1.06 }, uSaturation: { value: 1.06 }, uVignette: { value: 0.28 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uContrast, uSaturation, uVignette; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = mix(vec3(l), c.rgb, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * dot(d, d) * 1.6;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

const SKY = "assets/sky/kloofendal_48d_partly_cloudy_puresky_2k.hdr";
const SKY_TURN = THREE.MathUtils.degToRad(-35); // turns the sky so the sun lights the rows from an angle
const SUN_CAP = 40; // sky pixels brighter than this are the sun disc: they become the directional light

export const QUALITY = {
  low: { label: "Low", pixelRatio: 1, shadowMap: 2048, post: false },
  medium: { label: "Medium", pixelRatio: 1.5, shadowMap: 4096, post: true, aoSamples: 8 },
  high: { label: "High", pixelRatio: 2, shadowMap: 4096, post: true, aoSamples: 16 },
};

/** Sun direction (in the photo's frame) and horizon colour, read from the sky's pixels. */
function readSky(image) {
  const { data, width: w, height: h } = image;
  let best = -1;
  let bi = 0;
  const horizon = [0, 0, 0];
  let hn = 0;
  for (let row = 0; row < h / 2; row++) {
    const elevation = 90 - ((row + 0.5) / h) * 180;
    for (let x = 0; x < w; x++) {
      const i = (row * w + x) * 4;
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (lum > best) {
        best = lum;
        bi = row * w + x;
      }
      if (elevation < 4) {
        horizon[0] += data[i];
        horizon[1] += data[i + 1];
        horizon[2] += data[i + 2];
        hn++;
      }
    }
  }
  // three.js equirect lookup: u = atan2(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5; row 0 is the top.
  const u = ((bi % w) + 0.5) / w;
  const v = 1 - (Math.floor(bi / w) + 0.5) / h;
  const phi = (u - 0.5) * 2 * Math.PI;
  const el = (v - 0.5) * Math.PI;
  const sun = new THREE.Vector3(Math.cos(el) * Math.cos(phi), Math.sin(el), Math.cos(el) * Math.sin(phi));
  return { sun, horizon: new THREE.Color(horizon[0] / hn, horizon[1] / hn, horizon[2] / hn) };
}

/** The sky for lighting: the sun disc removed (the directional light carries it) and the lower
 *  half replaced by soil-coloured bounce light, so plants are not lit blue from below. */
function lightingSky(image, horizon) {
  const { data, width: w, height: h } = image;
  const out = new Float32Array(data);
  const ground = [0.42, 0.33, 0.24].map((c, i) => c * [horizon.r, horizon.g, horizon.b][i] * 0.6);
  for (let row = 0; row < h; row++) {
    for (let x = 0; x < w; x++) {
      const i = (row * w + x) * 4;
      if (row >= h / 2) {
        out[i] = ground[0];
        out[i + 1] = ground[1];
        out[i + 2] = ground[2];
        continue;
      }
      const lum = 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
      if (lum > SUN_CAP) for (let c = 0; c < 3; c++) out[i + c] *= SUN_CAP / lum;
    }
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

// Look-dev overrides, e.g. ?sun=4&sky=0.7&exposure=1.1 (for tuning only; the defaults are the look).
const tune = new URLSearchParams(location.search);
const knob = (name, value) => (tune.has(name) ? Number(tune.get(name)) : value);

export async function createView(D, qualityName = "medium") {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = knob("exposure", 0.92);
  document.getElementById("view").appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 6000);

  // Sky and image-based light.
  const hdr = await new HDRLoader().setDataType(THREE.FloatType).loadAsync(SKY);
  const { sun: sunInPhoto, horizon } = readSky(hdr.image);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  scene.backgroundRotation.set(0, SKY_TURN, 0);
  scene.environmentRotation.set(0, SKY_TURN, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const lightSky = lightingSky(hdr.image, horizon);
  scene.environment = pmrem.fromEquirectangular(lightSky).texture;
  lightSky.dispose();
  pmrem.dispose();
  scene.environmentIntensity = knob("sky", 0.6);
  scene.fog = new THREE.Fog(horizon.clone().multiplyScalar(0.9), 70, 420);

  // The sky turned by SKY_TURN is looked up as R * direction, so the sun's world direction is R^-1 * sun.
  const sunDir = sunInPhoto.clone().applyEuler(new THREE.Euler(0, -SKY_TURN, 0)).normalize();
  const sun = new THREE.DirectionalLight(0xfff3e2, knob("sun", 8));
  sun.castShadow = true;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.015;
  sun.shadow.radius = 2;
  Object.assign(sun.shadow.camera, { near: 1, far: 140 });
  scene.add(sun, sun.target);

  // Post-processing (Medium and High).
  const target = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.blendIntensity = 1.0;
  composer.addPass(gtao);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GradeShader));

  let q = QUALITY[qualityName] ?? QUALITY.medium;
  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    const ratio = Math.min(devicePixelRatio, q.pixelRatio);
    renderer.setPixelRatio(ratio);
    renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(ratio);
    composer.setSize(innerWidth, innerHeight);
  };
  function setQuality(name) {
    q = QUALITY[name] ?? q;
    if (sun.shadow.mapSize.x !== q.shadowMap) {
      sun.shadow.mapSize.setScalar(q.shadowMap);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    if (q.post) {
      gtao.updateGtaoMaterial({ radius: 0.22, distanceExponent: 1.3, thickness: 1.2, scale: 1.0, samples: q.aoSamples });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    }
    resize();
  }
  addEventListener("resize", resize);
  setQuality(qualityName);

  // Shadows: one map that covers what the camera is looking at, tighter (sharper) the closer the
  // camera is. Its size moves in steps and its centre snaps to whole texels, so shadows do not shimmer.
  const light = new THREE.Matrix4();
  const lightInv = new THREE.Matrix4();
  const p = new THREE.Vector3();
  function aimShadows(focus, distance) {
    const half = 3 * 1.25 ** Math.round(Math.log(THREE.MathUtils.clamp(distance * 1.1, 3, 30) / 3) / Math.log(1.25));
    const cam = sun.shadow.camera;
    if (cam.right !== half) {
      Object.assign(cam, { left: -half, right: half, top: half, bottom: -half });
      cam.updateProjectionMatrix();
    }
    light.lookAt(sunDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    lightInv.copy(light).invert();
    const texel = (2 * half) / sun.shadow.mapSize.x;
    p.copy(focus).applyMatrix4(lightInv);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(light);
    sun.target.position.copy(p);
    sun.position.copy(p).addScaledVector(sunDir, 70);
  }

  return {
    renderer,
    scene,
    camera,
    sunDir,
    setQuality,
    get quality() {
      return q;
    },
    aimShadows,
    render() {
      if (q.post) composer.render();
      else renderer.render(scene, camera);
    },
  };
}
