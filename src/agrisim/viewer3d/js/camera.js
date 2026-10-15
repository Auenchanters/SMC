// Camera modes: follow the robot, the whole field from above, or free look (orbit controls).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const FOLLOW_OFFSET = new THREE.Vector3(-2.3, 1.45, 0.3); // behind the robot along the lane, above the plants

export function createCamera(view, D) {
  const { camera, renderer } = view;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(87);
  controls.minDistance = 0.6;
  controls.maxDistance = 140;
  const focus = new THREE.Vector3();
  let mode = "follow";
  let flight = null;
  const flyTo = (position, target, seconds = 1.4) => {
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: position, t1: target, start: performance.now(), ms: seconds * 1000 };
  };
  const cams = document.getElementById("cams");
  function set(m) {
    mode = m;
    for (const b of cams.children) b.setAttribute("aria-pressed", String(b.dataset.mode === m));
    if (m === "overhead") flyTo(D.CENTRE.clone().add(new THREE.Vector3(0, 30, 13)), D.CENTRE.clone());
    if (m === "follow") flyTo(focus.clone().add(FOLLOW_OFFSET), focus.clone());
  }
  for (const [m, label] of [["follow", "Follow robot"], ["overhead", "Whole field"], ["free", "Free look"]]) {
    const b = document.createElement("button");
    b.dataset.mode = m;
    b.textContent = label;
    b.onclick = () => set(m);
    cams.appendChild(b);
  }
  controls.addEventListener("start", () => {
    flight = null; // the user took the camera
  });

  return {
    controls,
    set,
    /** Start behind the robot without a flight. */
    jumpTo(roverPosition) {
      focus.copy(roverPosition).setY(0.25);
      camera.position.copy(focus).add(FOLLOW_OFFSET);
      controls.target.copy(focus);
      set("follow");
      flight = null;
    },
    distance: () => camera.position.distanceTo(controls.target),
    update(now, roverPosition) {
      focus.copy(roverPosition).setY(0.25);
      if (flight) {
        const f = Math.min(1, (now - flight.start) / flight.ms);
        const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
        const target = mode === "follow" ? focus : flight.t1;
        const dest = mode === "follow" ? focus.clone().add(flight.p1.clone().sub(flight.t1)) : flight.p1;
        camera.position.lerpVectors(flight.p0, dest, e);
        controls.target.lerpVectors(flight.t0, target, e);
        if (f >= 1) flight = null;
      } else if (mode === "follow") {
        const shift = focus.clone().sub(controls.target);
        controls.target.add(shift);
        camera.position.add(shift);
      }
      controls.update();
    },
  };
}
