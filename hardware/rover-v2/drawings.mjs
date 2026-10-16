// Orthographic general-arrangement sheet (third-angle, A3, 1:5) generated from model.mjs.
// Run: node hardware/rover-v2/drawings.mjs   -> hardware/rover-v2/drawings/rover-v2-views.svg
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOM, DIM, OVERALL, STROKE, parts } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCALE = 1 / 5;
const f = (v) => Math.round(v * 100) / 100;

// View definitions: screen u (right), v (up), depth (toward the viewer).
const VIEWS = {
  side: { title: "LEFT SIDE ELEVATION (from +y)", u: (p) => -p[0], v: (p) => p[2], d: (p) => p[1], ox: 235, oy: 238 },
  front: { title: "FRONT ELEVATION (from +x)", u: (p) => p[1], v: (p) => p[2], d: (p) => p[0], ox: 92, oy: 238 },
  plan: { title: "PLAN (from above)", u: (p) => -p[0], v: (p) => -p[1], d: (p) => p[2], ox: 235, oy: 66 },
};

function corners(part) {
  if (part.kind === "box") {
    const [a, b] = [part.a, part.b];
    return [a[0], b[0]].flatMap((x) => [a[1], b[1]].flatMap((y) => [a[2], b[2]].map((z) => [x, y, z])));
  }
  const { c, axis, r, len } = part;
  const ax = { x: 0, y: 1, z: 2 }[axis];
  const pts = [];
  for (const s of [-len / 2, len / 2]) for (const du of [-r, r]) for (const dv of [-r, r]) {
    const p = [...c];
    p[ax] += s;
    const others = [0, 1, 2].filter((i) => i !== ax);
    p[others[0]] += du;
    p[others[1]] += dv;
    pts.push(p);
  }
  return pts;
}

function shapeOf(part, view, style) {
  const pts = corners(part);
  const us = pts.map(view.u);
  const vs = pts.map(view.v);
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const X = (u) => f(view.ox + u * SCALE);
  const Y = (v) => f(view.oy - v * SCALE);
  if (part.kind === "cyl") {
    const along = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[part.axis];
    const facing = Math.abs(view.d(along)) > 0.5;
    if (facing) {
      const cu = view.u(part.c);
      const cv = view.v(part.c);
      return `<circle cx="${X(cu)}" cy="${Y(cv)}" r="${f(part.r * SCALE)}" ${style}/>`;
    }
  }
  const r = part.name === "wheel" ? 0 : part.kind === "box" ? 0.6 : 0;
  return `<rect x="${X(u0)}" y="${Y(v1)}" width="${f((u1 - u0) * SCALE)}" height="${f((v1 - v0) * SCALE)}" rx="${r}" ${style}/>`;
}

function drawView(view, travel, phantom = false, list = parts(travel).filter((p) => !phantom || p.group === "probe")) {
  const depthOf = (p) => Math.max(...corners(p).map(view.d));
  list.sort((a, b) => depthOf(a) - depthOf(b));
  const style = phantom ? 'class="phantom"' : 'class="solid"';
  return list.map((p) => shapeOf(p, view, style)).join("\n");
}

const X = (view, u) => f(view.ox + u * SCALE);
const Y = (view, v) => f(view.oy - v * SCALE);

// A linear dimension between two screen points, offset perpendicular by `off` (sheet mm).
function dim(view, a, b, off, text, vertical = false) {
  const [x1, y1, x2, y2] = [X(view, a[0]), Y(view, a[1]), X(view, b[0]), Y(view, b[1])];
  if (!vertical) {
    const y = f(Math.max(y1, y2) + off);
    return `<g class="dim"><line x1="${x1}" y1="${y1 + 1}" x2="${x1}" y2="${y + 1.5}"/><line x1="${x2}" y1="${y2 + 1}" x2="${x2}" y2="${y + 1.5}"/>` +
      `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" marker-start="url(#arr)" marker-end="url(#arr)"/>` +
      `<text x="${f((x1 + x2) / 2)}" y="${f(y - 1)}" text-anchor="middle">${text}</text></g>`;
  }
  const x = f(Math.min(x1, x2) - off);
  return `<g class="dim"><line x1="${x1 - 1}" y1="${y1}" x2="${x - 1.5}" y2="${y1}"/><line x1="${x2 - 1}" y1="${y2}" x2="${x - 1.5}" y2="${y2}"/>` +
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" marker-start="url(#arr)" marker-end="url(#arr)"/>` +
    `<text x="${f(x - 1.2)}" y="${f((y1 + y2) / 2)}" text-anchor="middle" transform="rotate(-90 ${f(x - 1.2)} ${f((y1 + y2) / 2)})">${text}</text></g>`;
}

function balloon(view, at, n, dx, dy) {
  const [x, y] = [X(view, at[0]), Y(view, at[1])];
  const [bx, by] = [f(x + dx), f(y + dy)];
  return `<g class="balloon"><circle cx="${x}" cy="${y}" r="0.5"/><line x1="${x}" y1="${y}" x2="${bx}" y2="${by}"/><circle cx="${bx}" cy="${by}" r="3"/><text x="${bx}" y="${f(by + 1.2)}" text-anchor="middle">${n}</text></g>`;
}

const side = VIEWS.side;
const front = VIEWS.front;
const plan = VIEWS.plan;
const W = DIM.wheel;
const out = [];
for (const [name, view] of Object.entries(VIEWS)) {
  out.push(`<g data-view="${name}">`);
  if (name !== "plan") {
    const span = name === "side" ? 330 : 260;
    out.push(`<line class="ground" x1="${X(view, -span)}" y1="${Y(view, 0)}" x2="${X(view, span)}" y2="${Y(view, 0)}"/>`);
    out.push(`<rect class="soil" x="${X(view, -span)}" y="${Y(view, 0)}" width="${f(2 * span * SCALE)}" height="${f(80 * SCALE)}"/>`);
  }
  out.push(drawView(view, 0));
  if (name !== "plan") out.push(drawView(view, DIM.probe.tip0 + DIM.probe.depth, true));
  out.push(`<text class="vtitle" x="${view.ox}" y="${name === "plan" ? 20 : 272}" text-anchor="middle">${view.title}</text>`);
  out.push("</g>");
}
// Centre lines: wheel axles and the probe axis.
for (const x of [W.base / 2, -W.base / 2]) out.push(`<line class="centre" x1="${X(side, -x)}" y1="${Y(side, W.r + 24)}" x2="${X(side, -x)}" y2="${Y(side, -10)}"/>`);
out.push(`<line class="centre" x1="${X(side, 0)}" y1="${Y(side, 450)}" x2="${X(side, 0)}" y2="${Y(side, -80)}"/>`);
out.push(`<line class="centre" x1="${X(front, 0)}" y1="${Y(front, 450)}" x2="${X(front, 0)}" y2="${Y(front, -80)}"/>`);
out.push(`<line class="centre" x1="${X(plan, -300)}" y1="${Y(plan, 0)}" x2="${X(plan, 300)}" y2="${Y(plan, 0)}"/>`);

// Dimensions.
const rear = -(DIM.wheel.base / 2 + DIM.wheel.r + 4);
out.push(dim(side, [-(rear + OVERALL.length), 0], [-rear, 0], 26, `${OVERALL.length} overall`));
out.push(dim(side, [-W.base / 2, 0], [W.base / 2, 0], 14, `${W.base} wheelbase`));
out.push(dim(front, [-OVERALL.width / 2, 0], [-OVERALL.width / 2, OVERALL.height], 10, `${OVERALL.height} overall`, true));
out.push(dim(side, [60, 0], [60, DIM.body.z0], 0, `${DIM.body.z0} belly`, true));
out.push(dim(side, [-20, 0], [-20, -DIM.probe.depth], 0, `${DIM.probe.depth} deep`, true));
out.push(dim(front, [-OVERALL.width / 2, 0], [OVERALL.width / 2, 0], 26, `${OVERALL.width} overall`));
out.push(dim(front, [-W.track / 2, 0], [W.track / 2, 0], 14, `${W.track} track`));
out.push(dim(front, [W.track / 2 + 50, 0], [W.track / 2 + 50, 2 * W.r], -4, `${2 * W.r} wheel`, true));
out.push(dim(plan, [-DIM.bay.x, -DIM.body.yIn], [DIM.bay.x, -DIM.body.yIn], 4, `${2 * DIM.bay.x} open tool bay`));

// Balloons on the side elevation (refs into the BOM table).
const B = [
  [[150, 40], 1, 6, 16], [[60, 200], 2, 10, 24], [[0, 268], 3, 14, -26], [[135, 230], 6, 14, 22],
  [[-135, 230], 5, -6, 24], [[135, 300], 8, 16, -24], [[0, 360], 9, 20, -10], [[0, 180], 10, 24, 14],
  [[8, 250], 11, 24, 2], [[-295, 170], 12, -6, 18], [[-150, 345], 13, -12, -14], [[150, 410], 14, 16, -8],
];
for (const [at, n, dx, dy] of B) out.push(balloon(side, at, n, dx, dy));

// Parts list and title block.
const table = [];
const tx = 302;
let ty = 120;
table.push(`<text class="th" x="${tx}" y="${ty}">REF</text><text class="th" x="${tx + 10}" y="${ty}">ITEM</text>`);
for (const [n, item] of BOM) {
  ty += 4.4;
  table.push(`<text x="${tx + 2}" y="${ty}">${n}</text><text x="${tx + 10}" y="${ty}">${item.length > 52 ? item.slice(0, 50) + "…" : item}</text>`);
}
const title = [
  `<rect class="frame" x="300" y="256" width="112" height="32"/>`,
  `<text class="tt" x="303" y="263">AgriRover v2: rocker-differential chassis, open probe bay</text>`,
  `<text x="303" y="269">General arrangement · third-angle projection · scale 1:5 · units mm</text>`,
  `<text x="303" y="274">Phantom: probe at ${DIM.probe.depth} mm depth on level ground (stroke ${STROKE} mm)</text>`,
  `<text x="303" y="279">Design targets, not as-built. Calculations: CALCULATIONS.md</text>`,
  `<text x="303" y="284">Team: Auenchanters · 2026-10-15</text>`,
];

const note = [
  `<text class="vtitle" x="20" y="40">AgriRover v2</text>`,
    `<text x="20" y="52">Design notes, BOM and calculations: hardware/rover-v2/DESIGN.md</text>`,
  `<text x="20" y="57">Generated from model.mjs: change a dimension there and rebuild.</text>`,
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 297" width="420mm" height="297mm" font-family="Helvetica, Arial, sans-serif">
<title>AgriRover v2 general arrangement</title>
<defs><marker id="arr" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L6 3L0 6Z" fill="#222"/></marker></defs>
<style>
  .solid { fill: #fff; stroke: #1b1b19; stroke-width: 0.22; }
  .phantom { fill: none; stroke: #6b6b66; stroke-width: 0.18; stroke-dasharray: 3 1 0.6 1 0.6 1; }
  .ground { stroke: #1b1b19; stroke-width: 0.35; }
  .soil { fill: #eeece6; stroke: none; }
  .centre { stroke: #8a8a84; stroke-width: 0.14; stroke-dasharray: 4 1 1 1; }
  .dim line { stroke: #222; stroke-width: 0.15; } .dim text { font-size: 2.6px; fill: #222; }
  .balloon line { stroke: #444; stroke-width: 0.15; } .balloon circle { fill: #fff; stroke: #444; stroke-width: 0.18; }
  .balloon text { font-size: 2.6px; fill: #222; }
  text { font-size: 2.4px; fill: #333; } .th { font-weight: bold; } .tt { font-size: 3px; font-weight: bold; }
  .vtitle { font-size: 3px; font-weight: bold; letter-spacing: 0.2px; }
  .frame { fill: none; stroke: #1b1b19; stroke-width: 0.35; }
</style>
<rect width="420" height="297" fill="#fff"/>
<rect class="frame" x="5" y="5" width="410" height="287"/>
${out.join("\n")}
${table.join("\n")}
${title.join("\n")}
${note.join("\n")}
</svg>
`;
const file = join(HERE, "drawings", "rover-v2-views.svg");
writeFileSync(file, svg);
console.log("wrote", file, `${(svg.length / 1024).toFixed(0)} KB`, `${parts().length} parts`);
