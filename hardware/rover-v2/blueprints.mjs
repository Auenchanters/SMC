// Blueprint set (A3 sheets, white line on blue) generated from model.mjs: general arrangement,
// chassis structure, probe module, electrical, and the rover in the crop lane with the parts list.
// Run: node hardware/rover-v2/blueprints.mjs
//   -> hardware/rover-v2/blueprints/sheet-1..5.svg and blueprints/index.html (print it to PDF)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BATTERY, BMS, BOM, CG, CLEAN, DIM, MASS, OVERALL, PACK, CELL, POWER, PUSH_SAFETY, SERVICE, SOIL, STABILITY,
  STROKE, TOTAL_KG, TRACTION, WEIGHT_N, WET_CLEAN_S, availableForce, cycle, insertionForce, parts, surveyEnergy,
} from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "blueprints");
const DATE = "2026-11-11";
const f = (v) => Math.round(v * 100) / 100;
const n1 = (v) => v.toFixed(1);
const n0 = (v) => v.toFixed(0);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// ---- projection (third angle). A view maps model mm to sheet mm at its scale. ------------------
const PROJ = {
  side: { u: (p) => -p[0], v: (p) => p[2], d: (p) => p[1] }, // left side, seen from +y
  front: { u: (p) => p[1], v: (p) => p[2], d: (p) => p[0] }, // seen from the front (+x)
  plan: { u: (p) => -p[0], v: (p) => -p[1], d: (p) => p[2] }, // from above
};
const view = (kind, ox, oy, scale) => ({ ...PROJ[kind], ox, oy, s: scale, X: (u) => f(ox + u * scale), Y: (v) => f(oy - v * scale) });

function corners(part) {
  if (part.kind === "box") {
    const [a, b] = [part.a, part.b];
    return [a[0], b[0]].flatMap((x) => [a[1], b[1]].flatMap((y) => [a[2], b[2]].map((z) => [x, y, z])));
  }
  const { c, axis, r, len } = part;
  const ax = { x: 0, y: 1, z: 2 }[axis];
  const others = [0, 1, 2].filter((i) => i !== ax);
  const pts = [];
  for (const s of [-len / 2, len / 2]) for (const du of [-r, r]) for (const dv of [-r, r]) {
    const p = [...c];
    p[ax] += s;
    p[others[0]] += du;
    p[others[1]] += dv;
    pts.push(p);
  }
  return pts;
}
function shape(part, V, cls) {
  const pts = corners(part);
  const us = pts.map(V.u);
  const vs = pts.map(V.v);
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  if (part.kind === "cyl") {
    const along = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[part.axis];
    if (Math.abs(V.d(along)) > 0.5) return `<circle cx="${V.X(V.u(part.c))}" cy="${V.Y(V.v(part.c))}" r="${f(part.r * V.s)}" class="${cls}"/>`;
  }
  return `<rect x="${V.X(u0)}" y="${V.Y(v1)}" width="${f((u1 - u0) * V.s)}" height="${f((v1 - v0) * V.s)}" class="${cls}"/>`;
}
function draw(V, list, cls = "part") {
  const depth = (p) => Math.max(...corners(p).map(V.d));
  return [...list].sort((a, b) => depth(a) - depth(b)).map((p) => shape(p, V, cls)).join("\n");
}
// A dimension between two view points (u, v in model mm); `off` in sheet mm, below or to the left.
function dim(V, a, b, off, text, vertical = false) {
  const [x1, y1, x2, y2] = [V.X(a[0]), V.Y(a[1]), V.X(b[0]), V.Y(b[1])];
  if (!vertical) {
    const y = f(Math.max(y1, y2) + off);
    return `<g class="dim"><line x1="${x1}" y1="${y1 + 1}" x2="${x1}" y2="${y + 1.5}"/><line x1="${x2}" y1="${y2 + 1}" x2="${x2}" y2="${y + 1.5}"/>` +
      `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" marker-start="url(#arr)" marker-end="url(#arr)"/><text x="${f((x1 + x2) / 2)}" y="${f(y - 1)}" text-anchor="middle">${text}</text></g>`;
  }
  const x = f(Math.min(x1, x2) - off);
  const ty = f((y1 + y2) / 2);
  return `<g class="dim"><line x1="${x1 - 1}" y1="${y1}" x2="${x - 1.5}" y2="${y1}"/><line x1="${x2 - 1}" y1="${y2}" x2="${x - 1.5}" y2="${y2}"/>` +
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" marker-start="url(#arr)" marker-end="url(#arr)"/><text x="${f(x - 1.2)}" y="${ty}" text-anchor="middle" transform="rotate(-90 ${f(x - 1.2)} ${ty})">${text}</text></g>`;
}
function balloon(V, at, n, dx, dy) {
  const [x, y] = [V.X(at[0]), V.Y(at[1])];
  const [bx, by] = [f(x + dx), f(y + dy)];
  return `<g class="balloon"><circle cx="${x}" cy="${y}" r="0.5" class="dot"/><line x1="${x}" y1="${y}" x2="${bx}" y2="${by}"/><circle cx="${bx}" cy="${by}" r="3.2"/><text x="${bx}" y="${f(by + 1.1)}" text-anchor="middle">${n}</text></g>`;
}
const ground = (V, span, depth = 80) =>
  `<rect class="soil" x="${V.X(-span)}" y="${V.Y(0)}" width="${f(2 * span * V.s)}" height="${f(depth * V.s)}"/><line class="ground" x1="${V.X(-span)}" y1="${V.Y(0)}" x2="${V.X(span)}" y2="${V.Y(0)}"/>`;
const centre = (x1, y1, x2, y2) => `<line class="centre" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
const label = (x, y, text, cls = "vtitle", anchor = "middle") => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(text)}</text>`;

// A table: rows of cells, column x offsets in sheet mm. The first row is the header.
function table(x, y, cols, rows, lead = 4.6, title = "") {
  const out = [];
  if (title) out.push(label(x, y - 5.6, title, "ttitle", "start"));
  const w = cols[cols.length - 1];
  rows.forEach((row, i) => {
    const yy = f(y + i * lead);
    if (i === 0) out.push(`<line class="rule" x1="${x}" y1="${f(yy + 1.6)}" x2="${x + w}" y2="${f(yy + 1.6)}"/>`);
    row.slice(0, cols.length - 1).forEach((cell, j) => out.push(`<text class="${i === 0 ? "th" : "td"}" x="${f(x + cols[j] + 1)}" y="${yy}">${esc(cell)}</text>`));
  });
  const h = rows.length * lead;
  out.push(`<rect class="box" x="${x}" y="${f(y - 4)}" width="${w}" height="${f(h + 2.5)}"/>`);
  return out.join("\n");
}
const note = (x, y, lines, lead = 4.4) => lines.map((t, i) => `<text class="td" x="${x}" y="${f(y + i * lead)}">${esc(t)}</text>`).join("\n");

function sheet(no, title, scale, body) {
  const total = 5;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 297" width="420mm" height="297mm" font-family="'Courier New', Courier, monospace">
<title>AgriRover v2 blueprint, sheet ${no}: ${esc(title)}</title>
<defs>
  <marker id="arr" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L6 3L0 6Z" fill="#dfeaff"/></marker>
  <marker id="flow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#ffffff"/></marker>
  <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#3a67a8" stroke-width="0.12"/></pattern>
  <pattern id="hatch" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2.4" stroke="#8fb2e6" stroke-width="0.25"/></pattern>
</defs>
<style>
  .part { fill: #1f4f95; stroke: #ffffff; stroke-width: 0.26; }
  .hi { fill: #2b65b8; stroke: #ffffff; stroke-width: 0.34; }
  .phantom { fill: none; stroke: #b9d0f5; stroke-width: 0.2; stroke-dasharray: 3 1 0.6 1; }
  .ground { stroke: #ffffff; stroke-width: 0.4; } .soil { fill: url(#hatch); stroke: none; }
  .centre { stroke: #9dbcec; stroke-width: 0.15; stroke-dasharray: 5 1.2 1 1.2; }
  .dim line { stroke: #dfeaff; stroke-width: 0.16; } .dim text { font-size: 2.7px; fill: #ffffff; }
  .balloon line { stroke: #dfeaff; stroke-width: 0.16; } .balloon circle { fill: #1a478a; stroke: #ffffff; stroke-width: 0.22; }
  .balloon .dot { fill: #ffffff; } .balloon text { font-size: 2.8px; fill: #ffffff; font-weight: bold; }
  text { font-size: 2.5px; fill: #eaf2ff; }
  .vtitle { font-size: 3.2px; font-weight: bold; letter-spacing: 0.3px; fill: #ffffff; }
  .ttitle { font-size: 3px; font-weight: bold; fill: #ffffff; letter-spacing: 0.3px; }
  .th { font-size: 2.5px; font-weight: bold; fill: #ffffff; } .td { font-size: 2.45px; fill: #eaf2ff; }
  .rule { stroke: #dfeaff; stroke-width: 0.2; } .box { fill: none; stroke: #dfeaff; stroke-width: 0.2; }
  .frame { fill: none; stroke: #ffffff; stroke-width: 0.5; } .frame2 { fill: none; stroke: #ffffff; stroke-width: 0.2; }
  .big { font-size: 5px; font-weight: bold; fill: #ffffff; letter-spacing: 0.5px; }
  .node { fill: #1f4f95; stroke: #ffffff; stroke-width: 0.3; } .nodeh { fill: #2b65b8; stroke: #ffffff; stroke-width: 0.4; }
  .wire { stroke: #ffffff; stroke-width: 0.3; fill: none; } .bus { stroke: #9dd5ff; stroke-width: 0.3; fill: none; stroke-dasharray: 1.6 0.8; }
  .plant { fill: #2d6e63; fill-opacity: 0.55; stroke: #bff0d8; stroke-width: 0.25; } .stem { stroke: #bff0d8; stroke-width: 0.5; }
  .ntxt { font-size: 2.5px; fill: #ffffff; } .nsub { font-size: 2.1px; fill: #cfe0fb; }
</style>
<rect width="420" height="297" fill="#17407f"/>
<rect x="8" y="8" width="404" height="281" fill="url(#grid)"/>
<rect class="frame" x="8" y="8" width="404" height="281"/>
<rect class="frame2" x="10" y="10" width="400" height="277"/>
${body}
<g>
  <rect class="frame" x="282" y="257" width="130" height="32" fill="#17407f"/>
  <line class="rule" x1="282" y1="268" x2="412" y2="268"/><line class="rule" x1="282" y1="278.5" x2="412" y2="278.5"/>
  <line class="rule" x1="364" y1="268" x2="364" y2="289"/><line class="rule" x1="327" y1="278.5" x2="327" y2="289"/>
  <text class="big" x="285" y="265">AGRIROVER v2</text>
  <text class="th" x="345" y="262.5">SOIL-MOISTURE SURVEY ROVER</text><text class="td" x="345" y="266">design targets, not as-built</text>
  <text class="td" x="285" y="272">TITLE</text><text class="th" x="285" y="276.3">${esc(title.toUpperCase())}</text>
  <text class="td" x="366" y="272">SHEET</text><text class="th" x="366" y="276.3">${no} OF ${total}</text>
  <text class="td" x="285" y="282">SCALE · UNITS · PROJECTION</text><text class="th" x="285" y="286.3">${esc(scale)} · mm · 3rd angle</text>
  <text class="td" x="329" y="282">SOURCE</text><text class="th" x="329" y="286.3">model.mjs</text>
  <text class="td" x="366" y="282">TEAM · DATE</text><text class="th" x="366" y="286.3">Auenchanters · ${DATE}</text>
</g>
</svg>
`;
}

const W = DIM.wheel;
const all = parts(0);
const full = DIM.probe.tip0 + DIM.probe.depth;
const sheets = [];

// ---- Sheet 1: general arrangement ----------------------------------------------------------------
{
  const S = 1 / 5;
  const side = view("side", 210, 240, S);
  const front = view("front", 78, 240, S);
  const plan = view("plan", 210, 60, S);
  const b = [];
  for (const [name, V] of [["side", side], ["front", front], ["plan", plan]]) {
    if (name !== "plan") b.push(ground(V, name === "side" ? 330 : 250, 60));
    b.push(draw(V, all));
    if (name !== "plan") b.push(draw(V, parts(full).filter((p) => p.group === "probe"), "phantom"));
  }
  b.push(label(210, 281, "LEFT SIDE ELEVATION"), label(78, 281, "FRONT ELEVATION"), label(210, 16.5, "PLAN"));
  for (const x of [W.base / 2, -W.base / 2]) b.push(centre(side.X(-x), side.Y(W.r + 30), side.X(-x), side.Y(-14)));
  b.push(centre(side.X(0), side.Y(OVERALL.height + 20), side.X(0), side.Y(-90)), centre(front.X(0), front.Y(OVERALL.height + 20), front.X(0), front.Y(-90)));
  b.push(centre(plan.X(-330), plan.Y(0), plan.X(330), plan.Y(0)), centre(plan.X(0), plan.Y(-230), plan.X(0), plan.Y(230)));
  const rear = -(W.base / 2 + W.r + 4);
  b.push(dim(side, [-(rear + OVERALL.length), 0], [-rear, 0], 24, `${OVERALL.length} overall length`));
  b.push(dim(side, [-W.base / 2, 0], [W.base / 2, 0], 13, `${W.base} wheelbase`));
  b.push(dim(side, [278, 0], [278, DIM.body.z0], -3, `${DIM.body.z0} clearance`, true));
  b.push(dim(side, [-48, 0], [-48, -DIM.probe.depth], 0, `${DIM.probe.depth} deep`, true));
  b.push(dim(front, [-OVERALL.width / 2, 0], [-OVERALL.width / 2, OVERALL.height], 10, `${n0(OVERALL.height)} overall height`, true));
  b.push(dim(front, [-OVERALL.width / 2, 0], [OVERALL.width / 2, 0], 24, `${OVERALL.width} overall width`));
  b.push(dim(front, [-W.track / 2, 0], [W.track / 2, 0], 13, `${W.track} track`));
  b.push(dim(front, [W.track / 2 + 46, 0], [W.track / 2 + 46, 2 * W.r], -4, `${2 * W.r} wheel dia.`, true));
  b.push(dim(plan, [-DIM.bay.x, -DIM.body.yIn], [DIM.bay.x, -DIM.body.yIn], 5, `${2 * DIM.bay.x} open tool bay`));
  b.push(dim(plan, [-DIM.body.x - 30, -DIM.body.yIn], [-DIM.body.x - 30, DIM.body.yIn], -18, `${2 * DIM.body.yIn} bay width`, true));
  const B = [
    [[150, 40], 1, 8, 15], [[60, 200], 2, 9, 22], [[0, 268], 3, 15, -24], [[-135, 215], 6, -8, 24], [[135, 215], 5, 16, 22],
    [[135, 300], 8, 17, -22], [[0, 420], 9, 24, -8], [[0, 180], 10, 26, 12], [[6, 250], 11, 27, 0], [[-295, 170], 12, -8, 17],
    [[-150, 345], 13, -14, -12], [[150, 410], 14, 17, -8],
  ];
  for (const [at, n, dx, dy] of B) b.push(balloon(side, at, n, dx, dy));
  b.push(table(296, 34, [0, 9, 108], [["REF", "ITEM"], ...BOM.map(([n, item]) => [n, item.length > 66 ? `${item.slice(0, 64)}…` : item])], 4.5, "PARTS LIST"));
  b.push(note(296, 118, [
    `Mass ${n1(TOTAL_KG)} kg · weight ${n0(WEIGHT_N)} N`,
    `Centre of mass ${n1(Math.abs(CG[0]))} mm from the probe axis, ${n0(CG[2])} mm above ground`,
    `Phantom lines: probe at ${DIM.probe.depth} mm depth (stroke ${STROKE} mm)`,
    "Open tool bay between the axles: the whole weight resists the push",
  ]));
  b.push(note(20, 22, ["GENERAL ARRANGEMENT", "Rocker-differential chassis on four hub-motor wheels."], 4.4).replace('class="td"', 'class="ttitle"'));
  sheets.push([1, "General arrangement", "1:5", b.join("\n")]);
}

// ---- Sheet 2: chassis structure -------------------------------------------------------------------
{
  const S = 1 / 5;
  const chassis = all.filter((p) => p.group === "chassis");
  const side = view("side", 120, 228, S);
  const plan = view("plan", 120, 78, S);
  const b = [ground(side, 300, 60), draw(side, chassis), draw(plan, chassis)];
  b.push(label(120, 262, "CHASSIS, LEFT SIDE"), label(120, 24, "CHASSIS, PLAN"));
  b.push(centre(side.X(0), side.Y(330), side.X(0), side.Y(-40)), centre(plan.X(-290), plan.Y(0), plan.X(290), plan.Y(0)));
  b.push(dim(side, [-W.base / 2, 0], [W.base / 2, 0], 12, `${W.base} wheelbase`));
  b.push(dim(side, [W.base / 2 + W.r + 12, 0], [W.base / 2 + W.r + 12, DIM.pivot.z], -4, `${DIM.pivot.z} rocker pivot`, true));
  b.push(dim(side, [-(W.base / 2 + W.r + 14), 0], [-(W.base / 2 + W.r + 14), DIM.beam.z0], 2, `${DIM.beam.z0} under beam`, true));
  b.push(dim(side, [60, 0], [60, DIM.body.z0], 0, `${DIM.body.z0} belly`, true));
  b.push(dim(side, [-(W.base / 2 + DIM.beam.overhang), DIM.beam.z0 + DIM.beam.h], [W.base / 2 + DIM.beam.overhang, DIM.beam.z0 + DIM.beam.h], -22, `${W.base + 2 * DIM.beam.overhang} rocker beam, ${DIM.beam.h} x ${DIM.beam.w} box`));
  b.push(dim(plan, [-W.base / 2, -(W.track / 2 + W.w / 2)], [W.base / 2, -(W.track / 2 + W.w / 2)], 8, `${W.base}`));
  b.push(dim(plan, [-(W.base / 2 + W.r + 14), -W.track / 2], [-(W.base / 2 + W.r + 14), W.track / 2], 0, `${W.track} track`, true));
  b.push(dim(plan, [-DIM.bay.x, DIM.body.yIn], [DIM.bay.x, DIM.body.yIn], -22, `${2 * DIM.bay.x} bay`));
  b.push(balloon(side, [0, DIM.pivot.z], "A", 18, -26), balloon(side, [-DIM.diff.x, DIM.diff.z], "B", -16, -18), balloon(plan, [-DIM.diff.x, 60], "B", -22, -14));
  b.push(note(232, 26, [
    "HOW THE ROCKER-DIFFERENTIAL WORKS",
    "A  Each side's two wheels hang from one rocker beam that pivots on the body.",
    "B  A differential bar across the front box links the beams: when one rises the",
    "   other falls, and the body takes the average of their angles.",
    "No springs: all four wheels stay loaded, and the body does not rise when the",
    "probe pushes down, so the push and the depth repeat.",
  ]).replace('class="td"', 'class="ttitle"'));
  b.push(table(232, 64, [0, 78, 104, 150], [
    ["STABILITY AND TERRAIN", "VALUE", "NOTE"],
    ["Side slope before tipping (static)", `${n0(STABILITY.rollDeg)} deg`, "track / CG height"],
    ["Fore-aft slope before tipping", `${n0(STABILITY.pitchDeg)} deg`, ""],
    [`${STABILITY.stepMm} mm clod under one wheel: beam tilt`, `${n0(STABILITY.beamTiltDeg)} deg`, "body about half"],
    ["Body pitch on that clod", `${n0(STABILITY.bodyPitchDeg)} deg`, ""],
    ["Braking needed to tip forward", `${STABILITY.tipDecelG.toFixed(2)} g`, "stop is 0.2 g"],
    ["Step climbed reliably", `${n0(TRACTION.stepMm)} mm`, "half wheel radius [A]"],
    ["Steepest grade", `${n0(TRACTION.maxGradeDeg)} deg`, "mu 0.55 [A]"],
    ["Pull available / rolling drag", `${n0(TRACTION.drawbarN)} / ${n0(TRACTION.rollingN)} N`, "soft tilled soil"],
  ]));
  b.push(table(232, 118, [0, 96, 108, 120, 132, 168], [
    ["MASS BUDGET [A]", "kg", "x", "z", ""],
    ...MASS.map(([name, kg, x, , z]) => [name.length > 56 ? `${name.slice(0, 54)}…` : name, n1(kg), n0(x), n0(z), ""]),
    ["TOTAL", n1(TOTAL_KG), n1(CG[0]), n0(CG[2]), "= centre of mass"],
  ], 4.4));
  b.push(note(232, 186, [
    "MATERIALS",
    "Rocker beams: aluminium box section with welded axle drop brackets.",
    "Body: two 3 mm aluminium side plates joined by the front and rear cross boxes.",
    "Pivots: stainless stub shafts in sealed bearings. Links: rod ends.",
    "Wheels: 8.5 in pneumatic hub motors at about 60 kPa, sealant-filled.",
    "[A] = assumption or vendor-class figure, to confirm on the bench.",
  ]).replace('class="td"', 'class="ttitle"'));
  sheets.push([2, "Chassis structure", "1:5", b.join("\n")]);
}

// ---- Sheet 3: probe module and cleaning station ----------------------------------------------------
{
  const S = 1 / 3;
  const probe = (t) => parts(t).filter((p) => p.group === "probe");
  const front = view("front", 72, 252, S);
  const side = view("side", 168, 252, S);
  const b = [];
  for (const V of [front, side]) {
    b.push(ground(V, 115, 75), draw(V, probe(0)), draw(V, probe(full), "phantom"));
    b.push(centre(V.X(0), V.Y(OVERALL.height + 12), V.X(0), V.Y(-70)));
  }
  b.push(label(72, 30, "PROBE MODULE, FRONT"), label(168, 30, "PROBE MODULE, SIDE"));
  const c = cycle();
  b.push(dim(front, [-95, 0], [-95, DIM.probe.tip0], 0, `${DIM.probe.tip0} parked tips`, true));
  b.push(dim(front, [-78, 0], [-78, -DIM.probe.depth], 0, `${DIM.probe.depth} depth`, true));
  b.push(dim(front, [95, DIM.station.z0], [95, DIM.station.z1], -6, `station ${DIM.station.z1 - DIM.station.z0}`, true));
  b.push(dim(front, [-DIM.probeRail.y, DIM.probeRail.z + 30], [DIM.probeRail.y, DIM.probeRail.z + 30], -24, `± ${DIM.probeRail.y} rail travel`));
  b.push(dim(side, [105, 0], [105, OVERALL.height], -6, `${n0(OVERALL.height)} axis top`, true));
  b.push(dim(side, [-100, DIM.probe.tip0 + DIM.probe.needleL], [-100, DIM.probe.tip0 + DIM.probe.needleL + STROKE], 2, `${STROKE} stroke`, true));
  b.push(balloon(front, [0, (DIM.station.z0 + DIM.station.z1) / 2], 10, 34, 8), balloon(front, [0, DIM.probe.tip0 + 100], 11, 34, -4), balloon(side, [10, 560], 9, 30, -6));
  const X0 = 232;
  b.push(table(X0, 28, [0, 68, 98, 128, 172], [
    ["PROBE FORCE", "MOIST SOIL", "DRY CRUST", ""],
    ["Push needed [A]", `${n0(insertionForce("moist"))} N`, `${n0(insertionForce("dry"))} N`, `cone ${SOIL.coneMPa.moist} / ${SOIL.coneMPa.dry} MPa`],
    ["Push available, probe centred", `${n0(availableForce(0) * PUSH_SAFETY)} N`, `${n0(availableForce(0) * PUSH_SAFETY)} N`, `${PUSH_SAFETY * 100}% of lift-off`],
    [`Push available, ${DIM.probeRail.y} mm off centre`, `${n0(availableForce(DIM.probeRail.y) * PUSH_SAFETY)} N`, `${n0(availableForce(DIM.probeRail.y) * PUSH_SAFETY)} N`, ""],
    ["Margin over dry crust, centred", "", `${(availableForce(0) * PUSH_SAFETY / insertionForce("dry")).toFixed(1)} x`, ""],
  ]));
  b.push(table(X0, 66, [0, 16, 86, 108, 172], [
    ["t, s", "PROBE CYCLE (one reading)", "SPEED", ""],
    [`0 to ${n1(c.t1)}`, "Lower to the surface", "40 mm/s", ""],
    [`to ${n1(c.t2)}`, `Insert ${DIM.probe.depth} mm`, "6 mm/s", ""],
    [`to ${n1(c.t3)}`, "Read (VWC, temperature, EC)", "2 s", ""],
    [`to ${n1(c.t4)}`, "Retract through wiper plate and brushes", "40 mm/s", ""],
    [`to ${n1(c.t5)}`, "Air knife", "3 s", ""],
    [`to ${n1(c.t6)}`, "Air check: reads clean-air baseline", "1 s", `within ${CLEAN.airMax}`],
    ["+ " + n0(WET_CLEAN_S), "Wet clean when the air check fails twice", `${CLEAN.wetMl} mL`, `about ${CLEAN.wetShare * 100}% of cycles [A]`],
  ]));
  b.push(table(X0, 118, [0, 12, 44, 172], [
    ["LEVEL", "WHEN", "CLEANING, NO PERSON NEEDED", ""],
    ["0", "every cycle", "PU wiper plate with three rod slots, then two strip brushes", ""],
    ["1", "every cycle", "3 s air knife, then the air check", ""],
    ["2", "check fails", "stroke through the wipers again, blast, check", ""],
    ["3", "still failing", "1 s water spray, 8 s of air, check", ""],
    ["4", "after 2 wet cleans", "reading marked invalid; survey goes on; rover rechecks later", ""],
    ["5", "at the dock", "wash cup with brush, rinse, dry; reference block within " + CLEAN.referenceTolerance, ""],
  ]));
  b.push(note(X0, 166, [
    "DROP-IN MODULE",
    "Two sideways rails, a sled, a belt-driven linear axis behind a bellows with its",
    "stepper beside it, the cleaning station hanging under the sled, and the probe.",
    "Held by two thumb screws, one M12 connector and one push-fit air/water line.",
    "The rail shifts the probe 5 cm to step round a stone, without driving.",
    "Probe: 3-rod stainless FDR, RS485, galvanically isolated from the rover.",
    "Phantom lines: full stroke on level ground.",
  ]).replace('class="td"', 'class="ttitle"'));
  sheets.push([3, "Probe module and cleaning", "1:3", b.join("\n")]);
}

// ---- Sheet 4: electrical and power -----------------------------------------------------------------
{
  const b = [];
  const node = (x, y, w, h, title, sub = [], cls = "node") => {
    const lines = [title, ...sub];
    const y0 = y + h / 2 - ((lines.length - 1) * 3.3) / 2 + 0.9;
    return `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="1"/>` +
      lines.map((t, i) => `<text class="${i ? "nsub" : "ntxt"}" x="${f(x + w / 2)}" y="${f(y0 + i * 3.3)}" text-anchor="middle">${esc(t)}</text>`).join("");
  };
  const wire = (pts, cls = "wire") => `<polyline class="${cls}" points="${pts.map((p) => p.join(",")).join(" ")}" marker-end="url(#flow)"/>`;
  const e = surveyEnergy();
  b.push(label(20, 22, "POWER AND SIGNAL BLOCK DIAGRAM", "ttitle", "start"));
  b.push(node(20, 60, 40, 22, "BATTERY + BMS", [`${PACK.s}S LiFePO4, ${CELL.ah} Ah`, `${n1(BATTERY.vNom)} V, ${n0(BATTERY.wh)} Wh`], "nodeh"));
  b.push(node(72, 64, 24, 14, "MAIN FUSE", ["30 A"]));
  b.push(wire([[60, 71], [72, 71]]));
  const bus = 104;
  b.push(`<line class="wire" x1="96" y1="71" x2="${bus}" y2="71"/><line class="wire" x1="${bus}" y1="36" x2="${bus}" y2="152"/>`);
  const rows = [
    [36, "DRIVE CONTACTOR", ["e-stop chain, precharge"], "2 DUAL BLDC FOC", [`${POWER.motorLimitW} W per wheel, CAN`], "4 HUB MOTORS", ["hall sensors"]],
    [65, "24 V ISOLATED DC-DC", ["3 A"], "STEPPER DRIVERS", ["stall detection"], "PROBE, RAIL, ARM AXES", []],
    [94, "12 V DC-DC", ["3 A"], "PUMPS AND VALVES", ["air, water"], "2D LIDAR", []],
    [123, "ISOLATED 12 V", ["0.2 A"], "ISOLATED RS485", [], "SOIL PROBE", ["no current path", "through wet soil"]],
    [152, "5.1 V DC-DC", ["5 A, hold-up"], "RASPBERRY PI 5", ["mission, mapping"], "CAMERAS, GNSS", ["USB"]],
  ];
  for (const [y, a, as, c, cs, d, ds] of rows) {
    b.push(wire([[bus, y], [114, y]]));
    b.push(node(114, y - 9, 40, 18, a, as), wire([[154, y], [166, y]]), node(166, y - 9, 40, 18, c, cs), wire([[206, y], [218, y]]), node(218, y - 9, 40, 18, d, ds));
  }
  b.push(node(166, 176, 40, 20, "REAL-TIME MCU", ["watchdog, encoders,", "steppers, safety"], "nodeh"));
  b.push(wire([[186, 161], [186, 176]], "bus"), label(188, 170, "USB", "nsub", "start"));
  b.push(wire([[166, 186], [160, 186], [160, 41], [166, 41]], "bus"), label(158, 192, "CAN to drives", "nsub", "end"));
  b.push(wire([[176, 196], [176, 206], [40, 206], [40, 82]], "bus"), label(60, 204, "CAN / I2C: cell voltages, current, temperatures", "nsub", "start"));
  b.push(wire([[206, 186], [212, 186], [212, 21], [134, 21], [134, 27]], "bus"), label(214, 192, "opens the drive contactor", "nsub", "start"));
  b.push(note(20, 226, [
    "SAFETY DOES NOT DEPEND ON SOFTWARE",
    "The e-stop and the RC kill switch open the drive contactor directly.",
    "The MCU stops the motors if the Pi's heartbeat is missing for 200 ms.",
    "The motor controllers stop if the MCU's CAN messages stop.",
    "IP65 enclosure, M12/M8 IP67 connectors, membrane vent, conformal-coated boards.",
    "Solid line: power. Dashed line: signal.",
  ]).replace('class="td"', 'class="ttitle"'));
  const X0 = 282;
  b.push(table(X0, 28, [0, 62, 122], [
    ["BMS LIMITS", "SETTING", ""],
    ["Cell over / under voltage", `${BMS.ovCell} / ${BMS.uvCell} V`, ""],
    ["Soft cut-off (rover returns to dock)", `${BMS.softCutCell} V per cell`, ""],
    ["Continuous / peak current", `${BMS.ocContinuousA} / ${BMS.ocPeakA} A`, ""],
    ["Short circuit", `${BMS.scA} A in ${BMS.scUs} us`, ""],
    ["Charge temperature", `${BMS.chargeTempC[0]} to ${BMS.chargeTempC[1]} C`, ""],
    ["Discharge temperature", `${BMS.dischargeTempC[0]} to ${BMS.dischargeTempC[1]} C`, ""],
    ["Balancing", `> ${BMS.balanceMv} mV, ${BMS.balanceMa} mA`, ""],
    ["Charge current at the dock", `${BMS.chargeA} A (0.5 C)`, ""],
    ["Return to dock at", `${BMS.returnToDockSoc * 100}% charge`, ""],
  ]));
  b.push(table(X0, 88, [0, 62, 122], [
    ["ENERGY FOR ONE SURVEY", "Wh", ""],
    ["Driving 466 m", n1(e.parts.drive), ""],
    ["32 turns in place", n1(e.parts.turns), ""],
    ["Electronics, always on", n1(e.parts.electronics), ""],
    ["Probe axis, 60 readings", n1(e.parts.probeAxis), ""],
    ["Cleaning", n1(e.parts.cleaning), ""],
    ["TOTAL", n1(e.total), ""],
    ["Usable in the pack (80%)", n0(BATTERY.wh * BATTERY.usableShare), ""],
    ["Surveys per charge", n1((BATTERY.wh * BATTERY.usableShare) / e.total), ""],
    ["Mission time", `${n0(e.missionS / 60)} min`, ""],
  ]));
  b.push(table(X0, 148, [0, 34, 122], [["SUPPLY RAIL", "FEEDS", ""], ...POWER.rails.map(([rail, , feeds]) => [rail, feeds.length > 54 ? `${feeds.slice(0, 52)}…` : feeds, ""])]));
  b.push(note(X0, 186, [
    "WHY LiFePO4",
    "Far harder to push into thermal runaway than nickel-rich",
    "Li-ion, about 2,000 cycles [A], and its extra weight sits",
    "low and over the probe, where it adds push.",
  ]).replace('class="td"', 'class="ttitle"'));
  sheets.push([4, "Electrical and power", "NTS", b.join("\n")]);
}

// ---- Sheet 5: the rover in the crop lane, service schedule ----------------------------------------
{
  const S = 1 / 7;
  const V = view("front", 145, 196, S);
  const ROW = 1200; // mm between plant rows (configs/demo.yaml, PLACEHOLDER)
  const CANOPY = 300; // largest canopy radius
  const b = [ground(V, 820, 110), draw(V, all), draw(V, parts(full).filter((p) => p.group === "probe"), "phantom")];
  for (const sx of [-1, 1]) {
    const x = (sx * ROW) / 2;
    b.push(`<line class="stem" x1="${V.X(x)}" y1="${V.Y(0)}" x2="${V.X(x)}" y2="${V.Y(720)}"/>`);
    for (const [h, r] of [[260, 230], [450, 300], [640, 220]]) b.push(`<ellipse class="plant" cx="${V.X(x)}" cy="${V.Y(h)}" rx="${f(r * S)}" ry="${f(115 * S)}"/>`);
    b.push(`<path class="phantom" d="M${V.X(x - 150)} ${V.Y(0)} Q${V.X(x)} ${V.Y(-150)} ${V.X(x + 150)} ${V.Y(0)}"/>`);
    b.push(`<circle cx="${V.X(x)}" cy="${V.Y(8)}" r="1.1" fill="#9dd5ff" stroke="#fff" stroke-width="0.2"/>`);
  }
  b.push(label(145, 24, "ROVER IN THE CROP LANE, SEEN FROM THE FRONT"));
  b.push(dim(V, [-ROW / 2, -60], [ROW / 2, -60], 22, `${ROW} row spacing [placeholder]`));
  b.push(dim(V, [-ROW / 2 + CANOPY, 450], [ROW / 2 - CANOPY, 450], -62, `${ROW - 2 * CANOPY} clear between canopies`));
  b.push(dim(V, [-OVERALL.width / 2, 0], [OVERALL.width / 2, 0], 9, `${OVERALL.width} rover`));
  b.push(dim(V, [OVERALL.width / 2, 250], [ROW / 2 - CANOPY, 250], -30, `${n0((ROW - 2 * CANOPY - OVERALL.width) / 2)} each side`));
  b.push(note(22, 244, [
    "WHAT THE PROBE CAN AND CANNOT SEE",
    "The rover drives the lane centre and probes there, 600 mm from each drip line (blue dot).",
    "The wetted strip under a drip line (dashed) is about 150 mm to each side: the probe's",
    `± ${DIM.probeRail.y} mm rail does not reach it. A reach of 300 mm would cover half of it.`,
    "Simulated with the new soil physics: a drip run during the survey raises the map error,",
    "because the water lands where lane-centre probes never go (docs/CALIBRATION.md).",
    "Open design question: a longer side reach, or a second probe on an arm.",
  ]).replace('class="td"', 'class="ttitle"'));
  const X0 = 282;
  b.push(table(X0, 28, [0, 62, 90, 122], [["WEAR PART", "LIFE", "UNIT", ""], ...SERVICE.map(([part, life, unit]) => [part.length > 36 ? `${part.slice(0, 34)}…` : part, life.toLocaleString("en"), unit.length > 18 ? `${unit.slice(0, 17)}…` : unit, ""])], 4.6, "SERVICE SCHEDULE [A]"));
  b.push(table(X0, 84, [0, 9, 122], [["REF", "BUY OR MAKE", ""], ...BOM.map(([n, , how]) => [n, how, ""])], 4.4, "SOURCING"));
  b.push(note(X0, 166, [
    "OPEN QUESTIONS BEFORE BUILDING",
    "1  Soil strength on the target farms (sets the push).",
    "2  How often each cleaning level is needed in local clay.",
    "3  The reference block for the bias check.",
    "4  Position along the row without RTK.",
    "5  Rocker stiffness and canopy clearance in a real lane.",
    "6  Side reach toward the drip line (this sheet).",
  ]).replace('class="td"', 'class="ttitle"'));
  sheets.push([5, "Field envelope and service", "1:7", b.join("\n")]);
}

mkdirSync(OUT, { recursive: true });
const files = [];
for (const [no, title, scale, body] of sheets) {
  const svg = sheet(no, title, scale, body);
  const name = `sheet-${no}.svg`;
  writeFileSync(join(OUT, name), svg);
  files.push([name, title, svg]);
}
// One page per sheet; print this page to PDF (A3 landscape, no margins) for the full set.
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>AgriRover v2 blueprints</title>
<style>@page { size: 420mm 297mm; margin: 0; } html, body { margin: 0; background: #0d2a57; }
svg { display: block; width: 420mm; height: 297mm; page-break-after: always; break-after: page; }
@media screen { svg { width: 100%; height: auto; margin: 0 auto 12px; max-width: 1500px; } }</style></head>
<body>
${files.map(([, , svg]) => svg).join("\n")}
</body></html>
`;
writeFileSync(join(OUT, "index.html"), html);
console.log("wrote", files.length, "sheets and index.html to", OUT);
