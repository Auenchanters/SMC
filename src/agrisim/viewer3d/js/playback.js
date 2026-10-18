// Mission time: play, pause, speed, jumping between stops, and the time bar. The bar shows the
// whole mission at once: a tick for every reading (coloured like its flag), rain as blue
// stretches and any plant contact as a red line; pointing at it previews that moment.
import { clock, pct } from "./data.js";
import { swatch } from "./layers.js";

const $ = (id) => document.getElementById(id);
const SPEEDS = [1, 5, 20, 60, 200];
const AT_STOPS = 4; // the most "Slow at stops" allows while the probe works
const ICON = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2v12l10-6z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h4v12H3zM9 2h4v12H9z"/></svg>',
};

export function createPlayback(D, { playing = true, speed = 20 } = {}) {
  const slider = $("time");
  slider.max = String(D.T_END);
  const at = (t) => `${(t / D.T_END) * 100}%`;

  // The time bar's marks.
  const track = $("tlTrack");
  for (const r of D.S.rain ?? []) {
    const band = document.createElement("div");
    band.className = "rain";
    band.style.left = at(r.start_s);
    band.style.width = at(Math.min(r.duration_s, D.T_END - r.start_s));
    track.appendChild(band);
  }
  const ticks = D.stops.map((s) => {
    const tick = document.createElement("div");
    tick.className = s.v == null ? "tick fail" : "tick";
    tick.style.left = at(s.reveal);
    if (s.v != null) tick.style.background = swatch(s.v);
    track.appendChild(tick);
    return tick;
  });
  for (const c of D.S.contacts) {
    const line = document.createElement("div");
    line.className = "touch";
    line.style.left = at(c.t);
    track.appendChild(line);
  }
  let seen = -1;

  const p = {
    t: 0,
    playing,
    speed,
    onPreview: null, // (text | null, x, y) => void, set by app.js
    setTime(v) {
      p.t = Math.min(D.T_END, Math.max(0, v));
    },
    setPlaying(on) {
      if (on && p.t >= D.T_END) p.t = 0;
      p.playing = on;
      $("playBtn").innerHTML = `${on ? ICON.pause : ICON.play}<span>${on ? "Pause" : "Play"}</span>`;
      $("playBtn").setAttribute("aria-label", on ? "Pause" : "Play");
    },
    setSpeed(s) {
      p.speed = s;
      for (const b of $("speeds").children) b.setAttribute("aria-pressed", String(b.dataset.speed === String(s)));
    },
    jump(dir) {
      const starts = D.stops.map((s) => s.start);
      const target = dir > 0 ? starts.find((s) => s > p.t + 0.01) : [...starts].reverse().find((s) => s < p.t - 0.5);
      if (target !== undefined) p.setTime(target);
    },
    /** Go to stop i, just before its probe comes down. */
    goTo(i) {
      p.setTime(D.stops[i].start + 0.01);
    },
    /** Advance by dt seconds of wall time. */
    step(dt) {
      if (!p.playing) return;
      const slow = $("slow").checked && D.stopAt(p.t);
      p.t = Math.min(D.T_END, p.t + dt * (slow ? Math.min(p.speed, AT_STOPS) : p.speed));
      if (p.t >= D.T_END) p.setPlaying(false);
    },
    show(k) {
      slider.value = String(p.t);
      slider.setAttribute("aria-valuetext", `${clock(p.t)} of ${clock(D.T_END)}, ${k} readings taken`);
      $("tlFill").style.width = at(p.t);
      $("clock").textContent = `${clock(p.t)} / ${clock(D.T_END)}`;
      if (k !== seen) {
        ticks.forEach((tick, i) => tick.classList.toggle("seen", i < k));
        seen = k;
      }
    },
  };
  for (const s of SPEEDS) {
    const b = document.createElement("button");
    b.textContent = `${s}×`;
    b.dataset.speed = String(s);
    b.title = `Play at ${s} times real speed`;
    b.onclick = () => p.setSpeed(s);
    $("speeds").appendChild(b);
  }
  $("playBtn").onclick = () => p.setPlaying(!p.playing);
  $("prevStop").onclick = () => p.jump(-1);
  $("nextStop").onclick = () => p.jump(1);
  slider.oninput = () => p.setTime(Number(slider.value));

  // Point at the bar: which moment and which reading is there.
  slider.addEventListener("pointermove", (e) => {
    const r = slider.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left - 9) / (r.width - 18))) * D.T_END;
    const near = D.stops.reduce((best, s) => (Math.abs(s.reveal - t) < Math.abs((best?.reveal ?? Infinity) - t) ? s : best), null);
    const close = near && Math.abs(near.reveal - t) < D.T_END / 120;
    const what = close ? `<b>Stop ${near.i + 1}</b><br>${near.v == null ? "probe failed" : `${pct(near.v)} water`}` : "";
    const rain = D.rainAt(t) ? "<br><span class=\"dim\">raining</span>" : "";
    p.onPreview?.(`${what}${what ? "<br>" : ""}<span class="dim">${clock(t)} into the mission</span>${rain}`, e.clientX, r.top - 70);
  });
  slider.addEventListener("pointerleave", () => p.onPreview?.(null));
  p.setSpeed(speed);
  p.setPlaying(playing);
  return p;
}
