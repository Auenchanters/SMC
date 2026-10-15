// Marks on the ground at every reading, the next-stop ring, the dust ring while the probe goes in,
// and the route driven so far.
import * as THREE from "three";
import { DIM } from "../rover-model.mjs";
import { at } from "./data.js";

export function buildMarkers(view, D) {
  const { scene } = view;
  const markGeo = new THREE.CircleGeometry(0.085, 32).rotateX(-Math.PI / 2);
  const edgeGeo = new THREE.RingGeometry(0.085, 0.105, 32).rotateX(-Math.PI / 2);
  const holeGeo = new THREE.CircleGeometry(0.022, 16).rotateX(-Math.PI / 2);
  // One round mark per reading, coloured by the value measured (grey: probe failed).
  const pins = D.stops.map((s) => {
    const g = new THREE.Group();
    const head = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ toneMapped: false, color: s.v == null ? 0x8a8f94 : 0xffffff, polygonOffset: true, polygonOffsetFactor: -4 }));
    const edge = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -4 }));
    const hole = new THREE.Mesh(holeGeo, new THREE.MeshBasicMaterial({ color: 0x1c120a, polygonOffset: true, polygonOffsetFactor: -6 }));
    head.position.y = edge.position.y = 0.008;
    hole.position.y = 0.009;
    head.userData.stop = s;
    g.add(head, edge, hole);
    g.position.copy(at(s.x, s.y));
    g.visible = false;
    scene.add(g);
    return { group: g, head };
  });
  const nextRing = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.18, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8fe3a8, transparent: true, opacity: 0.9, depthWrite: false }));
  const dust = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.06, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7a5a3e, transparent: true, depthWrite: false }));
  const P = D.path;
  const trail = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(P.x.map((x, i) => at(x, P.y[i], 0.012))),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
  );
  scene.add(nextRing, dust, trail);

  return {
    pins,
    nextRing,
    /** Colour the reading marks (call once the colour scale exists). */
    colour(fn) {
      for (const s of D.stops) if (s.v != null) fn(s.v, pins[s.i].head.material.color);
    },
    update({ t, now, state, k, here, markScale }) {
      pins.forEach((p, i) => {
        p.group.visible = D.stops[i].reveal <= t;
        p.group.scale.setScalar(markScale);
      });
      const next = !state && k < D.N ? D.stops[k] : null;
      nextRing.visible = !!next;
      if (next) {
        nextRing.position.copy(at(next.x, next.y, 0.01));
        nextRing.scale.setScalar(1 + 0.12 * Math.sin(now / 250));
      }
      dust.visible = !!state && state.phase === "inserting";
      if (dust.visible) {
        const f = (state.travel - DIM.probe.tip0) / DIM.probe.depth;
        dust.position.copy(at(state.stop.x, state.stop.y, 0.01));
        dust.scale.setScalar(1 + 3 * f);
        dust.material.opacity = 0.7 * (1 - f);
      }
      trail.geometry.setDrawRange(0, here.index);
    },
  };
}
