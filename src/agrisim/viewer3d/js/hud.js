// The plain-language panels: what is happening now, the numbers, labels in the scene, the
// reading tooltip, the intro and the help dialog.
import * as THREE from "three";
import { clock, pct } from "./data.js";

const $ = (id) => document.getElementById(id);
const LIFT_ROBOT = new THREE.Vector3(0, 0.62, 0); // label heights above the ground
const LIFT_NEXT = new THREE.Vector3(0, 0.3, 0);
const PHASE = {
  lowering: "Lowering the probe to the ground",
  inserting: "Pushing the probe into the soil",
  reading: "Measuring the soil moisture",
  retracting: "Pulling the probe out; a wiper plate and brushes scrape the soil off",
  "air blast": "Blowing the probe dry with air",
  "air check": "Checking the probe is clean",
  parked: "Probe parked",
};

export function createHud(D, view, marks) {
  const { S, N, DRY, stops } = D;
  const verdict = (v) => (v == null ? "the probe failed here, no reading" : `${pct(v)} water, ${v < DRY ? "too dry" : "OK"}`);
  let lastText = "";

  $("runInfo").textContent = `Replay of a real simulator run: seed ${S.seed}, ${S.policy.replaceAll("_", " ")} strategy, ${N} stops, ${clock(D.T_END)} of mission time.`;
  $("helpDry").textContent = pct(DRY);
  const openHelp = (on) => ($("help").style.display = on ? "grid" : "none");
  $("helpBtn").onclick = () => openHelp(true);
  $("closeHelp").onclick = () => openHelp(false);
  $("help").onclick = (e) => e.target === $("help") && openHelp(false);
  const showIntro = (on) => {
    $("intro").style.display = on ? "" : "none";
    $("introSmall").style.display = on ? "none" : "block";
  };
  $("hideIntro").onclick = () => showIntro(false);
  $("introSmall").onclick = () => showIntro(true);

  // Point at a reading mark to see its value.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  view.renderer.domElement.addEventListener("pointermove", (e) => {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, view.camera);
    const hit = raycaster.intersectObjects(marks.pins.filter((p) => p.group.visible).flatMap((p) => (p.dot.visible ? [p.head, p.dot] : [p.head])))[0];
    const tip = $("tip");
    if (!hit) {
      tip.style.display = "none";
      return;
    }
    const s = hit.object.userData.stop;
    tip.innerHTML = `<b>Stop ${s.i + 1}</b><br>${verdict(s.v)}<br><span class="dim">measured at ${clock(s.t)} into the mission</span>`;
    tip.style.display = "block";
    tip.style.left = `${e.clientX + 14}px`;
    tip.style.top = `${e.clientY + 14}px`;
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

  return {
    openHelp,
    tags(roverPosition) {
      placeTag($("tagRobot"), roverPosition.clone().add(LIFT_ROBOT), true);
      placeTag($("tagNext"), marks.nextRing.position.clone().add(LIFT_NEXT), marks.nextRing.visible);
    },
    status(t, state, here, k) {
      const valid = stops.filter((s) => s.reveal <= t && s.v != null).length;
      const failed = k - valid;
      let status;
      let sub;
      let reading = "";
      if (state) {
        const s = state.stop;
        status = PHASE[state.phase] ?? state.phase;
        sub = `Stop ${s.i + 1} of ${N}`;
        if (s.again === "rain") sub += ": checking again, it has rained since the first reading here";
        if (s.again === "check") sub += ": checking again, the first reading here did not fit its neighbours";
        if (t >= s.reveal) reading = `Reading: ${verdict(s.v)}`;
      } else if (k < N) {
        const next = stops[k];
        status = k === 0 ? "Driving to the first stop" : `Driving to stop ${next.i + 1} of ${N}`;
        sub = `${Math.max(0, Math.hypot(next.x - here.x, next.y - here.y)).toFixed(1)} m away in a straight line`;
        if (k > 0) reading = `Last reading: ${verdict(stops[k - 1].v)}`;
      } else if (t < D.T_END - 0.05) {
        status = "All readings taken";
        sub = "Driving the rest of the route";
      } else {
        status = "Survey complete";
        sub = `${valid} readings, ${D.dist[D.dist.length - 1].toFixed(0)} m driven, ${clock(D.T_END)} of mission time`;
      }
      const contacts = S.contacts.filter((c) => c.t <= t).length;
      const err = S.rmse[k];
      const rain = D.rainAt(t);
      const weather = rain ? `Raining ${rain} mm an hour: the soil is getting wetter, so earlier readings go out of date.` : S.truth_k ? "Not raining. Sun and plants slowly dry the soil." : "";
      const text = [status, sub, reading, weather, k, failed, here.dist.toFixed(0), contacts, err].join("|");
      if (text === lastText) return;
      lastText = text;
      $("status").textContent = status;
      $("substatus").textContent = sub;
      $("reading").textContent = reading;
      $("weather").textContent = weather;
      const shown = state && t >= state.stop.reveal ? state.stop : !state && k > 0 ? stops[k - 1] : null;
      $("reading").style.color = shown && (shown.v == null || shown.v < DRY) ? "var(--warn)" : "var(--text)";
      $("sReadings").textContent = `${k} of ${N}${failed ? ` (${failed} failed)` : ""}`;
      $("sDistance").textContent = `${here.dist.toFixed(0)} m`;
      $("sContacts").textContent = String(contacts);
      $("sContacts").style.color = contacts ? "var(--bad)" : "var(--accent)";
      $("sError").textContent = err == null ? "no map yet" : `±${(err * 100).toFixed(1)} % points`;
    },
  };
}
