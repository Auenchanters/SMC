// The field from above, next to the 3D view: the robot's map so far, the plant rows, the route
// driven, every reading and the rover. Selection is shared with the 3D view: clicking a reading
// here or there selects it in both. Arrow keys step through the readings when it has focus.
import { swatch } from "./layers.js";

const PAD = 6; // px around the field
const REDRAW_MS = 100;

export function createMinimap(D, { onPick, onHover }) {
  const { S, LX, LY, stops } = D;
  const canvas = document.getElementById("mapCanvas");
  const g = canvas.getContext("2d");
  const G = S.grid;
  const heat = document.createElement("canvas"); // the map, one pixel per cell
  heat.width = G.nx;
  heat.height = G.ny;
  const hg = heat.getContext("2d");
  const img = hg.createImageData(G.nx, G.ny);
  let W = 0;
  let H = 0;
  let scale = 1;
  let heatK = -1;
  let last = { at: -Infinity, key: "" };
  let selected = null;

  const toPx = (x, y) => [PAD + x * scale, H - PAD - y * scale];
  function size() {
    const css = canvas.clientWidth || 300;
    const ratio = Math.min(devicePixelRatio, 2);
    scale = (css - 2 * PAD) / LX;
    W = css;
    H = Math.round(LY * scale + 2 * PAD);
    canvas.style.height = `${H}px`;
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    last.key = "";
  }
  function paintHeat(k) {
    if (k === heatK) return;
    heatK = k;
    const est = S.estimate[k];
    for (let iy = 0; iy < G.ny; iy++) {
      for (let ix = 0; ix < G.nx; ix++) {
        const v = est[iy * G.nx + ix];
        const o = ((G.ny - 1 - iy) * G.nx + ix) * 4; // canvas rows run north to south
        if (v == null) {
          img.data[o + 3] = 0;
          continue;
        }
        const hex = swatch(v / 1000);
        img.data[o] = parseInt(hex.slice(1, 3), 16);
        img.data[o + 1] = parseInt(hex.slice(3, 5), 16);
        img.data[o + 2] = parseInt(hex.slice(5, 7), 16);
        img.data[o + 3] = 200;
      }
    }
    hg.putImageData(img, 0, 0);
  }
  const visible = (t) => stops.filter((s) => s.reveal <= t);
  const nearest = (mx, my, t) => {
    let best = null;
    let bd = 12; // px
    for (const s of visible(t)) {
      const [x, y] = toPx(s.x, s.y);
      const d = Math.hypot(x - mx, y - my);
      if (d < bd) [best, bd] = [s, d];
    }
    return best;
  };

  let now = 0;
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener("click", (e) => onPick(nearest(...local(e), now)?.i ?? null));
  canvas.addEventListener("pointermove", (e) => {
    const s = nearest(...local(e), now);
    canvas.style.cursor = s ? "pointer" : "default";
    onHover(s, e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerleave", () => onHover(null));
  canvas.addEventListener("keydown", (e) => {
    const seen = visible(now);
    if (!seen.length || !["ArrowLeft", "ArrowRight", "Enter"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation(); // the page's own arrow keys jump the time instead
    const at = seen.findIndex((s) => s.i === selected);
    const next = e.key === "Enter" ? Math.max(0, at) : e.key === "ArrowRight" ? Math.min(seen.length - 1, at + 1) : Math.max(0, at - 1);
    onPick(seen[next].i);
  });
  addEventListener("resize", size);
  size();

  return {
    /** Where reading i is on screen (for scripted demos). */
    pointOf(i) {
      const r = canvas.getBoundingClientRect();
      const [x, y] = toPx(stops[i].x, stops[i].y);
      return [r.left + x, r.top + y];
    },
    select(i) {
      selected = i;
      last.key = "";
    },
    draw(t, k, here, wallNow) {
      now = t;
      if (!canvas.clientWidth) return; // hidden: draw once it shows
      if (Math.abs(canvas.clientWidth - W) > 1) size();
      const key = `${k}/${here.index}/${selected}/${W}`;
      if (key === last.key || wallNow - last.at < REDRAW_MS) return;
      last = { at: wallNow, key };
      paintHeat(k);
      g.clearRect(0, 0, W, H);
      // soil, the map so far, the plant rows
      g.fillStyle = "#2b241d";
      g.fillRect(PAD, PAD, LX * scale, LY * scale);
      g.imageSmoothingEnabled = true;
      g.drawImage(heat, PAD, PAD, G.nx * G.res * scale, G.ny * G.res * scale);
      g.strokeStyle = "rgba(60, 120, 50, 0.9)";
      g.lineWidth = 1.5;
      const x0 = D.F.headland;
      for (const y of S.rows_y) {
        g.beginPath();
        g.moveTo(...toPx(x0, y));
        g.lineTo(...toPx(LX - x0, y));
        g.stroke();
      }
      // the route so far
      const P = D.path;
      g.strokeStyle = "rgba(255, 255, 255, 0.75)";
      g.lineWidth = 1.25;
      g.beginPath();
      for (let i = 0; i <= here.index; i += 2) g.lineTo(...toPx(P.x[i], P.y[i]));
      g.lineTo(...toPx(here.x, here.y));
      g.stroke();
      // readings, the next stop, the selection
      for (const s of visible(t)) {
        const [x, y] = toPx(s.x, s.y);
        g.beginPath();
        g.arc(x, y, 3.6, 0, 2 * Math.PI);
        g.fillStyle = swatch(s.v);
        g.fill();
        g.lineWidth = 1.2;
        g.strokeStyle = "#0d1114";
        g.stroke();
      }
      if (k < stops.length) {
        const [x, y] = toPx(stops[k].x, stops[k].y);
        g.beginPath();
        g.arc(x, y, 5, 0, 2 * Math.PI);
        g.setLineDash([2, 2]);
        g.strokeStyle = "#fff";
        g.stroke();
        g.setLineDash([]);
      }
      if (selected != null && stops[selected].reveal <= t) {
        const [x, y] = toPx(stops[selected].x, stops[selected].y);
        g.beginPath();
        g.arc(x, y, 7, 0, 2 * Math.PI);
        g.lineWidth = 2;
        g.strokeStyle = "#fff";
        g.stroke();
      }
      // the rover: an arrow pointing where it faces
      const [rx, ry] = toPx(here.x, here.y);
      g.save();
      g.translate(rx, ry);
      g.rotate(-here.th);
      g.beginPath();
      g.moveTo(7, 0);
      g.lineTo(-5, 4.5);
      g.lineTo(-3, 0);
      g.lineTo(-5, -4.5);
      g.closePath();
      g.fillStyle = "#fff";
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = "#0d1114";
      g.stroke();
      g.restore();
    },
  };
}
