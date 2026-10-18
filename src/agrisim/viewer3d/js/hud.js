// The plain-language panels: what is happening now (with the probe cycle and the map-error
// trend), the numbers, labels in the scene, the reading tooltip, event toasts, the intro and
// the help dialog. Every number shown comes from scene.json.
import * as THREE from "three";
import { clock, pct } from "./data.js";
import { swatch } from "./layers.js";

const $ = (id) => document.getElementById(id);
const LIFT_ROBOT = new THREE.Vector3(0, 0.62, 0); // label heights above the ground
const LIFT_NEXT = new THREE.Vector3(0, 0.3, 0);
const PHASES = ["lowering", "inserting", "reading", "retracting", "air blast", "air check"];
const PHASE = {
  lowering: "Lowering the probe to the ground",
  inserting: "Pushing the probe into the soil",
  reading: "Measuring the soil moisture",
  retracting: "Pulling the probe out; brushes scrape the soil off",
  "air blast": "Blowing the probe dry with air",
  "air check": "Checking the probe is clean",
  parked: "Probe parked",
};
const SVG = "http://www.w3.org/2000/svg";

export function createHud(D, view, marks) {
  const { S, N, DRY, stops } = D;
  const verdict = (v) => (v == null ? "the probe failed here, no reading" : `${pct(v)} water, ${v < DRY ? "too dry" : "OK"}`);
  let lastText = "";

  $("runInfo").textContent = `Replay of a real simulator run: seed ${S.seed}, ${S.policy.replaceAll("_", " ")} strategy, ${N} stops, ${clock(D.T_END)} of mission time.`;
  $("helpDry").textContent = pct(DRY);

  // Help: a native modal dialog (focus moves in, Escape closes, focus returns to the opener).
  const help = $("help");
  const openHelp = (on) => (on ? !help.open && help.showModal() : help.close());
  for (const id of ["helpBtn", "helpBtn2"]) $(id).onclick = () => openHelp(true);
  $("closeHelp").onclick = () => openHelp(false);
  help.addEventListener("click", (e) => e.target === help && openHelp(false)); // click on the backdrop

  const showIntro = (on) => {
    $("intro").hidden = !on;
    $("introSmall").hidden = on;
    try {
      localStorage.setItem("agrisim.intro", on ? "1" : "0");
    } catch {
      // storage blocked: the choice is just not remembered
    }
  };
  $("hideIntro").onclick = () => showIntro(false);
  $("introSmall").onclick = () => showIntro(true);
  try {
    if (localStorage.getItem("agrisim.intro") === "0") showIntro(false);
  } catch {
    // storage blocked
  }

  // Map-error trend: the error after each reading, the whole run faint, the part so far solid.
  const trend = $("trendSvg");
  const errs = S.rmse.map((e) => (e == null ? null : e * 100)); // % points
  const top = Math.max(...errs.filter((e) => e != null)) * 1.08 || 1;
  const W = 300;
  const H = 64;
  trend.setAttribute("viewBox", `0 0 ${W} ${H}`);
  trend.setAttribute("preserveAspectRatio", "none");
  const px = (k) => (k / Math.max(1, N)) * W;
  const py = (e) => H - (e / top) * (H - 6);
  const pts = (upTo) => errs.slice(0, upTo + 1).map((e, k) => (e == null ? null : `${px(k).toFixed(1)},${py(e).toFixed(1)}`)).filter(Boolean).join(" ");
  const el = (name, attrs) => {
    const n = document.createElementNS(SVG, name);
    for (const [a, v] of Object.entries(attrs)) n.setAttribute(a, v);
    trend.appendChild(n);
    return n;
  };
  el("line", { class: "axis", x1: 0, x2: W, y1: H, y2: H });
  el("polyline", { class: "all", points: pts(N), "vector-effect": "non-scaling-stroke" });
  const sofar = el("polyline", { class: "sofar", points: "", "vector-effect": "non-scaling-stroke" });
  const dot = el("circle", { class: "dot", r: 3 });
  let trendK = -1;
  function drawTrend(k) {
    if (k === trendK) return;
    trendK = k;
    sofar.setAttribute("points", pts(k));
    const e = errs[k];
    dot.style.display = e == null ? "none" : "";
    if (e != null) {
      dot.setAttribute("cx", px(k));
      dot.setAttribute("cy", py(e));
    }
    $("trendNow").textContent = e == null ? "" : `now ±${e.toFixed(1)} % points`;
  }

  // Toasts: short notes when something happens during playback (rain, a failed probe, a recheck,
  // a plant touched, the end). Only on normal forward play, not when jumping around.
  const events = [];
  for (const r of S.rain ?? []) {
    events.push({ t: r.start_s, kind: "info", text: `Rain started: ${r.rate_mm_per_h} mm an hour. Earlier readings go out of date.` });
    events.push({ t: r.start_s + r.duration_s, kind: "info", text: "Rain stopped. The soil is wetter now." });
  }
  for (const s of stops) {
    if (s.v == null) events.push({ t: s.reveal, kind: "warn", text: `Stop ${s.i + 1}: the probe failed, no reading.` });
    if (s.again) events.push({ t: s.start, kind: "info", text: `Stop ${s.i + 1}: checking a spot again, ${s.again === "rain" ? "it has rained since the first reading" : "the first reading did not fit its neighbours"}.` });
  }
  for (const c of S.contacts) events.push({ t: c.t, kind: "bad", text: "A plant was touched." });
  events.push({ t: D.T_END - 0.01, kind: "ok", text: `Survey complete: ${N} stops, ${S.contacts.length} plants touched.` });
  events.sort((a, b) => a.t - b.t);
  const toasts = $("toasts");
  function toast(kind, text) {
    const n = document.createElement("div");
    n.className = `toast ${kind}`;
    n.textContent = text;
    toasts.prepend(n);
    while (toasts.children.length > 3) toasts.lastChild.remove();
    setTimeout(() => {
      n.classList.add("out");
      setTimeout(() => n.remove(), 400);
    }, 4200);
  }
  let lastT = 0;
  function fireEvents(t) {
    const step = t - lastT;
    if (step > 0 && step < 30) for (const e of events) if (e.t > lastT && e.t <= t) toast(e.kind, e.text);
    lastT = t;
  }

  // Point at a reading mark to see its value; click it to select it.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const canvas = view.renderer.domElement;
  const tip = $("tip");
  const hit = (e) => {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, view.camera);
    const shown = marks.pins.filter((p) => p.group.visible).flatMap((p) => (p.dot.visible ? [p.head, p.dot] : [p.head]));
    return raycaster.intersectObjects(shown)[0]?.object.userData.stop ?? null;
  };
  const tipFor = (s) => `<b>Stop ${s.i + 1}</b><br>${verdict(s.v)}<br><span class="dim">measured ${clock(s.t)} into the mission</span>`;
  function showTip(s, x, y) {
    preview(s && tipFor(s), x, y);
  }
  /** Show `html` (trusted, built here from scene numbers) near x, y; null hides it. */
  function preview(html, x, y) {
    if (!html) {
      tip.style.display = "none";
      return;
    }
    tip.innerHTML = html;
    tip.style.display = "block";
    tip.style.left = `${Math.min(x + 14, innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(y + 14, innerHeight - tip.offsetHeight - 8)}px`;
  }
  let down = null;
  canvas.addEventListener("pointermove", (e) => {
    const s = hit(e);
    canvas.style.cursor = s ? "pointer" : "";
    showTip(s, e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerleave", () => showTip(null));
  canvas.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; // a drag, not a click
    api.onSelect?.(hit(e)?.i ?? null);
  });

  const projected = new THREE.Vector3();
  function placeTag(el, world, show) {
    projected.copy(world).project(view.camera);
    const visible = show && projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05;
    el.style.display = visible ? "block" : "none";
    if (visible) {
      el.style.left = `${((projected.x + 1) / 2) * innerWidth}px`;
      el.style.top = `${((1 - projected.y) / 2) * innerHeight}px`;
    }
  }

  const phaseBars = [...$("phases").children];
  const api = {
    openHelp,
    showTip,
    preview,
    tipFor,
    toast,
    tags(roverPosition) {
      const robot = $("tagRobot");
      const next = $("tagNext");
      placeTag(robot, roverPosition.clone().add(LIFT_ROBOT), true);
      placeTag(next, marks.nextRing.position.clone().add(LIFT_NEXT), marks.nextRing.visible);
      // Almost there: the two labels would overlap, so only the robot's stays.
      const near = Math.hypot(parseFloat(robot.style.left) - parseFloat(next.style.left), parseFloat(robot.style.top) - parseFloat(next.style.top)) < 70;
      if (near && robot.style.display === "block") next.style.display = "none";
    },
    status(t, state, here, k) {
      fireEvents(t);
      drawTrend(k);
      const valid = stops.filter((s) => s.reveal <= t && s.v != null).length;
      const failed = k - valid;
      let status;
      let sub;
      let shown = null; // the reading on show, if any
      let prefix = "";
      if (state) {
        const s = state.stop;
        status = PHASE[state.phase] ?? state.phase;
        sub = `Stop ${s.i + 1} of ${N}`;
        if (s.again === "rain") sub += ": checking again, it has rained since the first reading here";
        if (s.again === "check") sub += ": checking again, the first reading here did not fit its neighbours";
        if (t >= s.reveal) [shown, prefix] = [s, "Reading"];
      } else if (k < N) {
        const next = stops[k];
        status = k === 0 ? "Driving to the first stop" : `Driving to stop ${next.i + 1} of ${N}`;
        sub = `${Math.max(0, Math.hypot(next.x - here.x, next.y - here.y)).toFixed(1)} m away in a straight line`;
        if (k > 0) [shown, prefix] = [stops[k - 1], "Last reading"];
      } else if (t < D.T_END - 0.05) {
        status = "All readings taken";
        sub = "Driving the rest of the route";
      } else {
        status = "Survey complete";
        sub = `${valid} readings, ${D.dist[D.dist.length - 1].toFixed(0)} m driven, ${clock(D.T_END)} of mission time`;
      }
      const phase = state ? PHASES.indexOf(state.phase) : -1;
      const contacts = S.contacts.filter((c) => c.t <= t).length;
      const err = S.rmse[k];
      const rain = D.rainAt(t);
      const weather = rain ? `Raining ${rain} mm an hour: the soil is getting wetter, so earlier readings go out of date.` : "";
      const text = [status, sub, shown?.i, prefix, weather, k, failed, here.dist.toFixed(0), contacts, err, phase].join("|");
      if (text === lastText) return;
      lastText = text;
      $("status").textContent = status;
      $("substatus").textContent = sub;
      const reading = $("reading");
      reading.textContent = "";
      reading.className = shown && (shown.v == null || shown.v < DRY) ? "warn" : "";
      if (shown) {
        const sw = document.createElement("span");
        sw.className = "sw";
        sw.style.background = swatch(shown.v);
        reading.append(sw, `${prefix}: ${verdict(shown.v)}`);
      }
      $("weather").textContent = weather;
      phaseBars.forEach((b, i) => (b.className = phase < 0 ? "" : i < phase ? "done" : i === phase ? "now" : ""));
      $("sReadings").textContent = `${k} of ${N}${failed ? ` (${failed} failed)` : ""}`;
      $("sReadingsBar").style.width = `${(k / N) * 100}%`;
      $("sDistance").textContent = `${here.dist.toFixed(0)} m`;
      $("sContacts").textContent = String(contacts);
      $("sContacts").className = contacts ? "bad" : "ok";
      $("sError").textContent = err == null ? "no map yet" : `±${(err * 100).toFixed(1)} % points`;
    },
  };
  return api;
}
