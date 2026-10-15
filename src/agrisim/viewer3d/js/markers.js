// What a reading leaves in the field: the probe's hole and a wire survey flag beside it, coloured
// by the moisture measured (grey: the probe failed). Plus the next-stop ring, the dust while the
// probe goes in, and the route driven so far. Everything sits on the ground.
import * as THREE from "three";
import { DIM } from "../rover-model.mjs";
import { at } from "./data.js";

const FLAG_SIDE = 0.235; // m beside the probe hole: just outside the rover's tyres (track/2 + tyre/2 = 0.198)

export function buildMarkers(view, D) {
  const { scene } = view;
  const g = (x, y) => D.ground(x, y);
  const wire = new THREE.CylinderGeometry(0.0022, 0.0022, 0.42, 5).translate(0, 0.21, 0);
  const cloth = new THREE.PlaneGeometry(0.085, 0.06, 6, 1).translate(0.0445, 0.37, 0);
  {
    const p = cloth.attributes.position; // a slight wave in the cloth
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 55) * 0.006 * (p.getX(i) / 0.09));
    cloth.computeVertexNormals();
  }
  const holeGeo = new THREE.CircleGeometry(0.02, 14).rotateX(-Math.PI / 2);
  // From far away a flag is too thin to see, so a flat coloured dot fades in on the ground.
  const dotGeo = new THREE.CircleGeometry(0.09, 24).rotateX(-Math.PI / 2);
  const dotEdge = new THREE.RingGeometry(0.09, 0.11, 24).rotateX(-Math.PI / 2);
  const spoilGeo = new THREE.RingGeometry(0.02, 0.055, 18).rotateX(-Math.PI / 2);
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.4 });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x140d07, polygonOffset: true, polygonOffsetFactor: -6 });
  const spoilMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 1, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
  const pins = D.stops.map((s) => {
    const group = new THREE.Group();
    const flag = new THREE.Group();
    const stake = new THREE.Mesh(wire, wireMat);
    const head = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ color: s.v == null ? 0x8a8f94 : 0xffffff, roughness: 0.6, side: THREE.DoubleSide }));
    stake.castShadow = head.castShadow = true;
    head.userData.stop = s;
    flag.add(stake, head);
    flag.position.copy(at(s.x, s.y + FLAG_SIDE, g(s.x, s.y + FLAG_SIDE)));
    flag.rotation.set((D.rand() - 0.5) * 0.12, 0.6, (D.rand() - 0.5) * 0.12);
    const hole = new THREE.Mesh(holeGeo, holeMat);
    const spoil = new THREE.Mesh(spoilGeo, spoilMat);
    hole.position.copy(at(s.x, s.y, g(s.x, s.y) + 0.004));
    spoil.position.copy(hole.position).setY(hole.position.y - 0.001);
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: s.v == null ? 0x8a8f94 : 0xffffff, transparent: true, depthWrite: false }));
    const ring = new THREE.Mesh(dotEdge, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    dot.add(ring);
    dot.position.copy(at(s.x, s.y, g(s.x, s.y) + 0.035));
    dot.userData.stop = s;
    group.add(flag, hole, spoil, dot);
    group.visible = false;
    scene.add(group);
    return { group, flag, head, dot };
  });
  const nextRing = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.18, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8fe3a8, transparent: true, opacity: 0.9, depthWrite: false }));
  const dust = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.06, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7a5a3e, transparent: true, depthWrite: false }));
  const P = D.path;
  const trail = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(P.x.map((x, i) => at(x, P.y[i], g(x, P.y[i]) + 0.02))),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
  );
  scene.add(nextRing, dust, trail);

  return {
    pins,
    nextRing,
    /** Colour the flags (call once the colour scale exists). */
    colour(fn) {
      for (const s of D.stops) {
        if (s.v == null) continue;
        fn(s.v, pins[s.i].head.material.color);
        fn(s.v, pins[s.i].dot.material.color);
      }
    },
    update({ t, now, state, k, here, markScale }) {
      const far = Math.min(1, Math.max(0, (markScale - 1.3) / 1.2)); // 0 close up, 1 from far away
      pins.forEach((p, i) => {
        p.group.visible = D.stops[i].reveal <= t;
        p.flag.scale.setScalar(Math.min(markScale, 1.6));
        p.dot.visible = far > 0;
        p.dot.scale.setScalar(markScale);
        p.dot.material.opacity = far;
        p.dot.children[0].material.opacity = far;
      });
      const next = !state && k < D.N ? D.stops[k] : null;
      nextRing.visible = !!next;
      if (next) {
        nextRing.position.copy(at(next.x, next.y, g(next.x, next.y) + 0.03));
        nextRing.scale.setScalar(1 + 0.12 * Math.sin(now / 250));
      }
      dust.visible = !!state && state.phase === "inserting";
      if (dust.visible) {
        const f = (state.travel - DIM.probe.tip0) / DIM.probe.depth;
        dust.position.copy(at(state.stop.x, state.stop.y, g(state.stop.x, state.stop.y) + 0.01));
        dust.scale.setScalar(1 + 3 * f);
        dust.material.opacity = 0.7 * (1 - f);
      }
      trail.geometry.setDrawRange(0, here.index);
    },
  };
}
