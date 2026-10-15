// The survey being replayed: scene.json (written by `agrisim run --view`) plus everything derived
// from it that the other modules share. Nothing here draws.
// World frame: agrisim x along the rows, y across, metres. three.js: x = x, y = up, z = -y.
import * as THREE from "three";
import { DIM, cycle, probeAt } from "../rover-model.mjs";

export const at = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
export const pct = (v) => `${(v * 100).toFixed(1)}%`;
export const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** A seeded random stream, so the scenery looks the same on every load. */
export function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function loadSurvey(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const S = await res.json();
  const F = S.field;

  // Path: times, poses, distance driven and how far each wheel side has rolled.
  const P = S.path;
  const track = DIM.wheel.track / 1000;
  const dist = new Float64Array(P.t.length);
  const rollL = new Float64Array(P.t.length);
  const rollR = new Float64Array(P.t.length);
  for (let i = 1; i < P.t.length; i++) {
    const dx = P.x[i] - P.x[i - 1];
    const dy = P.y[i] - P.y[i - 1];
    const dth = wrap(P.th[i] - P.th[i - 1]);
    const mid = P.th[i - 1] + dth / 2;
    const ds = dx * Math.cos(mid) + dy * Math.sin(mid); // negative when reversing
    dist[i] = dist[i - 1] + Math.hypot(dx, dy);
    rollL[i] = rollL[i - 1] + ds - (dth * track) / 2;
    rollR[i] = rollR[i - 1] + ds + (dth * track) / 2;
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

  // Probe stops: the rover stands still for `ins` seconds and the reading is final at probe.t.
  // One cycle of the hardware model (27 s) is played over that window.
  const ins = S.probe_time_s;
  const C = cycle();
  const stops = S.probes.map((p, i) => ({ ...p, i, start: p.t - ins, reveal: p.t - ins + (ins * C.t3) / C.t6 }));
  function stopAt(t) {
    for (const s of stops) if (t >= s.start && t < s.t) return { stop: s, ...probeAt(((t - s.start) / ins) * C.t6) };
    return null;
  }

  return {
    S,
    F,
    LX: F.length_x,
    LY: F.width_y,
    N: S.probes.length,
    DRY: S.dry_threshold,
    T_END: P.t[P.t.length - 1],
    CENTRE: at(F.length_x / 2, F.width_y / 2),
    path: P,
    dist,
    pathAt,
    stops,
    stopAt,
    readingsBy: (t) => stops.filter((s) => s.reveal <= t).length,
    // With weather the real moisture changes: truthAt(k) is the field when reading k was taken.
    truthAt: (k) => (S.truth_k ? S.truth_k[k] : S.truth),
    rainAt: (t) => (S.rain ?? []).reduce((r, e) => r + (t >= e.start_s && t < e.start_s + e.duration_s ? e.rate_mm_per_h : 0), 0),
    rand: mulberry(S.seed * 7919 + 11),
  };
}
