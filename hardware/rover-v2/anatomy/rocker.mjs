// The rocker-differential's moving parts for Fig 1, shared by the build (which records their shapes
// for the audit) and the page (which rebuilds them every frame of the twist). Pure: it takes the
// kit (k, G), the projection, the model's DIM, rockerPose and the twist, and returns drawn items.
// The page inlines this file with its export removed, so it must not import anything.

/** Where everything is for a diagonal twist: front-left and rear-right wheels raised by `lift` mm. */
export function rockerState(D, rockerPose, lift) {
  const pose = rockerPose({ fl: lift, rr: lift });
  const drop = D.pivot.z - D.wheel.r;
  const half = D.wheel.base / 2;
  const side = (sy, th) => {
    // Axle centres in the beam's frame, turned by the beam's pitch about its pivot (x stays put).
    const axle = (u) => [u * Math.cos(th) + drop * Math.sin(th), D.pivot.z + pose.z + u * Math.sin(th) - drop * Math.cos(th)];
    return { sy, th, front: axle(half), rear: axle(-half) };
  };
  const near = side(1, pose.left.th);
  const far = side(-1, pose.right.th);
  // The links meet the beams ahead of and above the pivots; the bar rocks on its pin to follow.
  const linkAt = (s) => {
    const u = D.diff.x;
    const w = D.beam.z0 + D.beam.h - D.pivot.z;
    return [u * Math.cos(s.th) - w * Math.sin(s.th), s.sy * D.beam.y, D.pivot.z + pose.z + u * Math.sin(s.th) + w * Math.cos(s.th)];
  };
  const footNear = linkAt(near);
  const footFar = linkAt(far);
  const bar = Math.asin((footNear[2] - footFar[2]) / (2 * D.beam.y));
  return { lift, pose, bodyZ: pose.z, near, far, bar, feet: [footNear, footFar] };
}

/** Drawn items of the moving rocker parts at state S: beams with their axle brackets and pivot bosses,
 *  the differential bar and its two links. Each is { name, at, svg, shapes } (shapes only with A). */
export function rockerItems({ k, G, A }, P, D, S) {
  const S3 = (paths, style) => k.solidSvg(paths, style);
  const Ln = (d, style) => k.lineSvg(d, style);
  const Dots = (points, style) => k.dotsSvg(points, style);
  const at = (p) => k.iso(p, P);
  const items = [];
  const beamFrame = (s, o) => {
    const c = Math.cos(s.th);
    const n = Math.sin(s.th);
    // a across the beam (toward the viewer for the near beam), u along it, v up it.
    return G.frameOf(o, [0, -s.sy, 0], [c, 0, n], [-n, 0, c]);
  };
  const B = D.beam;
  const half = D.wheel.base / 2;
  const len = half + B.overhang;
  const w0 = B.z0 - D.pivot.z;
  const w1 = w0 + B.h;
  const drop = D.pivot.z - D.wheel.r;
  for (const s of [S.far, S.near]) {
    const id = s.sy > 0 ? "near" : "far";
    const o = [0, 0, D.pivot.z + S.bodyZ];
    const F = beamFrame(s, o);
    const pt = (u, v, a) => G.add3(G.add3(G.add3(o, G.mul3(F.u, u)), G.mul3(F.v, v)), G.mul3(F.a, a));
    const a0 = -(B.y + B.w / 2);
    const a1 = -(B.y - B.w / 2);
    // Axle brackets: a plate from the beam's underside down to the axle boss.
    for (const u of [half, -half]) {
      const poly = [[u - 14, w0 + 0.01], [u + 14, w0 + 0.01], [u + 14, -drop], [u - 14, -drop]];
      const paths = G.prismOf(F, poly, a0 + 2, a1 - 2, P);
      const boss = G.frameOf(pt(u, -drop, 0), [0, -s.sy, 0], [1, 0, 0], [0, 0, 1]);
      const bossPaths = G.disc(a0 + 2, a1 - 2, 14, boss, P, { steps: 40 });
      const end = a0 + 2;
      const bolts = s.sy > 0 ? Dots([pt(u - 8, w0 - 8, end), pt(u + 8, w0 - 8, end)].map(at), { size: 0.45 }) : "";
      items.push({
        name: `beam.${id}.bracket`,
        at: pt(u, (w0 - drop) / 2, (a0 + a1) / 2),
        svg: S3(paths, { tone: "mid" }) + S3(bossPaths, { tone: "mid" }) + bolts,
        shapes: A ? [A.prism(F, poly, a0 + 2, a1 - 2, { name: `beam.${id}.bracket`, owner: `beam.${id}` }), A.disc(boss, a0 + 2, a1 - 2, 14, { name: `beam.${id}.bracket`, owner: `beam.${id}` })] : [],
      });
    }
    // The beam: an aluminium box with end caps, a rivet line and the pivot boss on its outer face.
    const poly = [[-len, w0], [len, w0], [len, w1], [-len, w1]];
    const paths = G.prismOf(F, poly, a0, a1, P);
    const outer = a0; // the beam's outboard face, for both sides
    const rivets = [];
    for (let u = -len + 12; u <= len - 12; u += 24) if (Math.abs(u) > 30) rivets.push(at(pt(u, w1 - 7, outer)), at(pt(u, w0 + 7, outer)));
    const seam = (u) => k.pathOf([at(pt(u, w0, outer)), at(pt(u, w1, outer))]);
    const top = (u) => k.pathOf([at(pt(u, w1, a0)), at(pt(u, w1, a1))]);
    const caps = Ln(seam(-len + 6) + seam(len - 6) + top(-len + 6) + top(len - 6), { tone: "faint" });
    const bossF = G.frameOf(pt(0, 0, outer), [0, s.sy, 0], [1, 0, 0], [0, 0, 1]);
    const boss = s.sy > 0
      ? S3(G.disc(0, 4, 20, bossF, P, { steps: 48 }), { tone: "mid" }) + Dots(G.dotsOf(bossF, 4, 15, 6, P, { all: true, phase: s.th }), { size: 0.45 }) +
        S3(G.disc(4, 9, 8, bossF, P, { steps: 6 }), { tone: "hi" })
      : "";
    items.push({
      name: `beam.${id}`,
      at: pt(0, (w0 + w1) / 2, (a0 + a1) / 2),
      svg: S3(paths, { tone: "mid", inner: caps }) + (s.sy > 0 ? Dots(rivets, { size: 0.4, tone: "lo" }) : "") + boss,
      shapes: A ? [A.prism(F, poly, a0, a1, { name: `beam.${id}` }), ...(s.sy > 0 ? [A.disc(bossF, 0, 9, 20, { name: `beam.${id}.boss`, owner: `beam.${id}` })] : [])] : [],
    });
  }
  // Differential bar: rocks on a fore-aft pin above the front box; rod-end links drop to the beams.
  const DF = D.diff;
  const cz = DF.z + S.bodyZ;
  const barF = G.frameOf([DF.x, 0, cz], [0, Math.cos(S.bar), Math.sin(S.bar)], [1, 0, 0], [0, -Math.sin(S.bar), Math.cos(S.bar)]);
  // The links hang from the bar a little outboard of the beams, so a rocked bar's end clears the body.
  const endOf = (sy) => G.add3([DF.x, 0, cz], G.mul3(barF.a, sy * (DF.len / 2 - 2)));
  const half2 = DF.len / 2;
  items.push({
    name: "diff.bar",
    at: [DF.x, 0, cz],
    svg: S3(G.disc(-half2, half2, DF.r, barF, P, { steps: 28 }), { tone: "hi", inner: Ln(G.arcOf(barF, -14, DF.r, P) + G.arcOf(barF, 14, DF.r, P), { tone: "faint" }) }),
    shapes: A ? [A.disc(barF, -half2, half2, DF.r, { name: "diff.bar", owner: "diff" })] : [],
  });
  S.feet.forEach((foot, i) => {
    const side = i === 0 ? S.near : S.far;
    const name = `diff.link.${i === 0 ? "near" : "far"}`;
    // Rod-end balls: one sits on the beam's top face, one under the bar, each along that surface's normal.
    const from = G.add3(foot, G.mul3([-Math.sin(side.th), 0, Math.cos(side.th)], 4));
    const to = G.sub3(endOf(side.sy), G.mul3(barF.v, DF.r + 4.4));
    const axis = G.unit3(G.sub3(to, from));
    const LF = G.frameAlong(from, axis);
    const L = G.len3(G.sub3(to, from));
    const ball = (p, r) => S3(G.sphereOf(p, r, P, { steps: 32 }), { tone: "hi" });
    items.push({
      name,
      at: G.lerp3(from, to, 0.5),
      svg: ball(from, 4) + S3(G.disc(0, L, 3, LF, P, { steps: 20 }), { tone: "mid" }) + ball(to, 4.4),
      shapes: A ? [A.ball(from, 4, { name, owner: name }), A.disc(LF, 0, L, 3, { name, owner: name }), A.ball(to, 4.4, { name, owner: name })] : [],
    });
  });
  return items;
}
