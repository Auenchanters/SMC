// Camera modes: follow the robot, a drone circling high above it, the whole field from above, or
// free look (orbit controls). Changing mode flies the camera there, or jumps when the viewer
// asks for reduced motion.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const FOLLOW_OFFSET = new THREE.Vector3(-2.3, 1.45, 0.3); // behind the robot along the lane, above the plants
const DRONE = { radius: 5.2, height: 4.4, turn: 0.07 }; // m, m, rad per second of wall time
const still = matchMedia("(prefers-reduced-motion: reduce)");

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
  let droneAngle = -2.4;
  const droneOffset = () => new THREE.Vector3(Math.cos(droneAngle) * DRONE.radius, DRONE.height, Math.sin(droneAngle) * DRONE.radius);
  const tracking = () => mode === "follow" || mode === "drone"; // the camera rides with the robot
  const flyTo = (position, target, seconds = 1.4) => {
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: position, t1: target, start: performance.now(), ms: still.matches ? 0 : seconds * 1000 };
  };
  const cams = document.getElementById("cams");
  function set(m) {
    mode = m;
    for (const b of cams.children) b.setAttribute("aria-pressed", String(b.dataset.mode === m));
    if (m === "overhead") flyTo(D.CENTRE.clone().add(new THREE.Vector3(0, 30, 13)), D.CENTRE.clone());
    if (m === "follow") flyTo(focus.clone().add(FOLLOW_OFFSET), focus.clone());
    if (m === "drone") flyTo(focus.clone().add(droneOffset()), focus.clone(), 1.8);
  }
  for (const [m, label, key] of [["follow", "Follow", "F"], ["drone", "Drone", "D"], ["overhead", "Whole field", "O"], ["free", "Free look", ""]]) {
    const b = document.createElement("button");
    b.dataset.mode = m;
    b.textContent = label;
    if (key) b.title = `Key ${key}`;
    b.onclick = () => set(m);
    cams.appendChild(b);
  }
  controls.addEventListener("start", () => {
    flight = null; // the user took the camera
    if (mode === "drone") set("follow"); // keep riding with the robot, at the user's angle
    flight = null;
  });

  return {
    controls,
    set,
    get mode() {
      return mode;
    },
    /** Start behind the robot without a flight. */
    jumpTo(roverPosition) {
      focus.copy(roverPosition);
      focus.y += 0.25;
      camera.position.copy(focus).add(FOLLOW_OFFSET);
      controls.target.copy(focus);
      set("follow");
      flight = null;
    },
    distance: () => camera.position.distanceTo(controls.target),
    update(now, roverPosition, dt) {
      focus.copy(roverPosition);
      focus.y += 0.25;
      if (mode === "drone" && !still.matches) droneAngle += DRONE.turn * dt;
      if (flight) {
        const f = flight.ms ? Math.min(1, (now - flight.start) / flight.ms) : 1;
        const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
        const target = tracking() ? focus : flight.t1;
        const dest = mode === "drone" ? focus.clone().add(droneOffset()) : tracking() ? focus.clone().add(flight.p1.clone().sub(flight.t1)) : flight.p1;
        camera.position.lerpVectors(flight.p0, dest, e);
        controls.target.lerpVectors(flight.t0, target, e);
        if (f >= 1) flight = null;
      } else if (mode === "drone") {
        controls.target.copy(focus);
        camera.position.copy(focus).add(droneOffset());
      } else if (mode === "follow") {
        const shift = focus.clone().sub(controls.target);
        controls.target.add(shift);
        camera.position.add(shift);
      }
      controls.update();
    },
  };
}
