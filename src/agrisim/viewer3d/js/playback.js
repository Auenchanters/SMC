// Mission time: play, pause, speed, the time bar, jumping between stops.
import { clock } from "./data.js";

const $ = (id) => document.getElementById(id);
const SPEEDS = [1, 5, 20, 60, 200];
const AT_STOPS = 4; // the most "Slow down at stops" allows while the probe works

export function createPlayback(D, { playing = true, speed = 20 } = {}) {
  const slider = $("time");
  slider.max = String(D.T_END);
  const p = {
    t: 0,
    playing,
    speed,
    setTime(v) {
      p.t = Math.min(D.T_END, Math.max(0, v));
    },
    setPlaying(on) {
      if (on && p.t >= D.T_END) p.t = 0;
      p.playing = on;
      $("playBtn").textContent = on ? "❚❚ Pause" : "▶ Play";
    },
    setSpeed(s) {
      p.speed = s;
      for (const b of $("speeds").children) b.setAttribute("aria-pressed", String(b.textContent === `${s}×`));
    },
    jump(dir) {
      const starts = D.stops.map((s) => s.start);
      const target = dir > 0 ? starts.find((s) => s > p.t + 0.01) : [...starts].reverse().find((s) => s < p.t - 0.5);
      if (target !== undefined) p.setTime(target);
    },
    /** Advance by dt seconds of wall time. */
    step(dt) {
      if (!p.playing) return;
      const slow = $("slow").checked && D.stopAt(p.t);
      p.t = Math.min(D.T_END, p.t + dt * (slow ? Math.min(p.speed, AT_STOPS) : p.speed));
      if (p.t >= D.T_END) p.setPlaying(false);
    },
    show() {
      slider.value = String(p.t);
      $("clock").textContent = `${clock(p.t)} / ${clock(D.T_END)}`;
    },
  };
  for (const s of SPEEDS) {
    const b = document.createElement("button");
    b.textContent = `${s}×`;
    b.title = `Play at ${s} times real speed`;
    b.onclick = () => p.setSpeed(s);
    $("speeds").appendChild(b);
  }
  $("playBtn").onclick = () => p.setPlaying(!p.playing);
  slider.oninput = () => p.setTime(Number(slider.value));
  p.setSpeed(speed);
  p.setPlaying(playing);
  return p;
}
