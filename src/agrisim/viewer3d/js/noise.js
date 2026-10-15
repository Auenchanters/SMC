// Seeded 2D value noise and fractal noise, for terrain and scattering. Same seed, same field.
import { mulberry } from "./data.js";

export function makeNoise(seed) {
  const rand = mulberry(seed);
  const perm = new Uint16Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rand() * 2 - 1;
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const lattice = (ix, iy) => vals[perm[(ix & 255) + perm[iy & 255]]];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  /** Smooth noise in [-1, 1] with features about 1 unit apart. */
  function value2(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fade(fx);
    const v = fade(fy);
    const a = lattice(ix, iy);
    const b = lattice(ix + 1, iy);
    const c = lattice(ix, iy + 1);
    const d = lattice(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  /** Sum of `octaves` layers of value noise, each twice as fine and half as strong. */
  function fbm(x, y, octaves = 4) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += value2(x, y) * amp;
      norm += amp;
      x = x * 2.03 + 17.1;
      y = y * 2.03 - 9.7;
      amp *= 0.5;
    }
    return sum / norm;
  }
  return { value2, fbm, rand };
}
