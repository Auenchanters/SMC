// Videos, step 2: drive each part of the app in headless Chrome and capture it frame by frame.
// Needs Node 22+, Chrome or Edge and `prepare.py` already run (see README.md). The 3D replay is
// served by a small static server started here. Run from the repository root:
//   node scripts/demo_video/record.mjs explainer   every segment of the explainer video
//   node scripts/demo_video/record.mjs demo        every segment of the live demo video
//   node scripts/demo_video/record.mjs d-view      only this segment
// Each segment is driven beat by beat (narration.json): a beat lasts as long as its voice.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK = join(REPO, "runs", "demo_video");
const url = (path) => pathToFileURL(path).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fwd = (p) => p.split("\\").join("/");

const FRAME_MS = 1000 / 30;
// Replaces the page's clock: time moves only when the recorder calls __vt.step(ms).
// With timers, setTimeout runs on the same clock (for pages that wait before acting).
const virtualClock = (timers) => `(() => {
  let now = 0;
  const queue = [];
  const due = [];
  let next = 0;
  window.__vt = { step(ms) {
    now += ms;
    due.sort((a, b) => a.at - b.at);
    while (due.length && due[0].at <= now) { const t = due.shift(); t.fn(...t.args); }
    for (const cb of queue.splice(0)) cb(now);
  } };
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => queue.push(cb);
  window.cancelAnimationFrame = () => {};
  if (${timers}) {
    window.setTimeout = (fn, ms = 0, ...args) => { due.push({ id: ++next, at: now + ms, fn, args }); return next; };
    window.clearTimeout = (id) => { const i = due.findIndex((t) => t.id === id); if (i >= 0) due.splice(i, 1); };
  }
})();`;
// [name, CSS width, CSS height, touch device], from Responsively App's device list.
const DEVICES = [
  ["iphone-12-pro", 390, 844, true],
  ["pixel-7", 412, 915, true],
  ["ipad-air", 820, 1180, true],
  ["ipad-air-landscape", 1180, 820, true],
  ["macbook-pro", 1440, 900, false],
  ["desktop-1080p", 1920, 1080, false],
];
const scrollToCard = "(() => { const c = document.querySelector('.iso-plate') ?? document.querySelector('svg'); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 12); const r = document.querySelector('.iso-stage svg').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()";

// ---- the explainer and the live demo -------------------------------------------------------
const HD = { width: 1920, height: 1080 };
const VIEWER = join(REPO, "src", "agrisim", "viewer3d");
const SCRIPT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "narration.json"), "utf-8"));
const beatsFile = () => JSON.parse(readFileSync(join(WORK, "beats.json"), "utf-8"));
// The viewer's files at /, and runs/demo_video/ at /work/ (its scenes: ?scene=/work/<run>/scene.json).
function serveViewer() {
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png" };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const [root, rest] = path.startsWith("/work/") ? [WORK, path.slice(6)] : [VIEWER, path.slice(1) || "index.html"];
    const file = normalize(join(root, rest));
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}
const viewerUrl = (srv, run, quality = "high") => `${srv.url}?paused&quality=${quality}&scene=/work/${run}/scene.json`;
const loaded = `window.viewer && !document.getElementById("loading")`;
// Explainer footage: no panels, a large title over a dark scrim at the bottom left.
const cleanHud = `(() => { const s = document.createElement("style"); s.textContent = "#left,#right,#play,#sheetTabs,.tag,#toasts,#tip{display:none!important}"; document.head.appendChild(s); })()`;
const titleCard = (title, sub = "") => `(() => {
  let c = document.getElementById("__card");
  if (!c) {
    c = document.createElement("div"); c.id = "__card"; document.body.appendChild(c);
    const g = document.createElement("div");
    g.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:52%;background:linear-gradient(rgba(8,11,13,0),rgba(8,11,13,.82));pointer-events:none;z-index:2147483646";
    document.body.appendChild(g);
  }
  c.style.cssText = "position:fixed;z-index:2147483647;left:112px;bottom:104px;max-width:1300px;color:#eef2f4;pointer-events:none";
  const t = document.createElement("div");
  t.style.cssText = "font:650 76px/1.05 'Segoe UI',sans-serif;letter-spacing:-.02em";
  t.textContent = ${JSON.stringify(title)};
  c.replaceChildren(t);
  if (${JSON.stringify(sub)}) {
    const s = document.createElement("div");
    s.style.cssText = "font:400 32px/1.35 'Segoe UI',sans-serif;color:#d3dbe0;margin-top:14px;max-width:1150px";
    s.textContent = ${JSON.stringify(sub)};
    c.appendChild(s);
  }
})()`;
// Demo captions: a lower third above the playback bar, clear of the panels and the toasts.
const lowerThird = (title, sub = "", bottom = 128) => `(() => {
  let c = document.getElementById("__cap");
  if (!c) { c = document.createElement("div"); c.id = "__cap"; document.body.appendChild(c); }
  c.style.cssText = "position:fixed;z-index:2147483647;left:50%;bottom:${bottom}px;transform:translateX(-50%);max-width:960px;width:max-content;padding:14px 24px;border-radius:12px;background:#15191e;border:1px solid #3d4852;color:#eef2f4;font:600 27px/1.3 'Segoe UI',sans-serif;text-align:center;pointer-events:none;box-shadow:0 10px 30px rgba(0,0,0,.35)";
  const t = document.createElement("div");
  t.textContent = ${JSON.stringify(title)};
  c.replaceChildren(t);
  if (${JSON.stringify(sub)}) {
    const s = document.createElement("div");
    s.style.cssText = "font-weight:400;font-size:20px;color:#aab5bd;margin-top:4px";
    s.textContent = ${JSON.stringify(sub)};
    c.appendChild(s);
  }
})()`;
// Caption for a centred figure: in the empty margin on its left.
const sideCard = (title, sub = "") => `(() => {
  const c = document.createElement("div");
  c.style.cssText = "position:fixed;z-index:2147483647;left:56px;top:50%;transform:translateY(-50%);width:330px;color:#eef2f4;pointer-events:none;zoom:${1 / 1.45}";
  const t = document.createElement("div");
  t.style.cssText = "font:650 52px/1.08 'Segoe UI',sans-serif;letter-spacing:-.02em";
  t.textContent = ${JSON.stringify(title)};
  const s = document.createElement("div");
  s.style.cssText = "font:400 26px/1.35 'Segoe UI',sans-serif;color:#aab5bd;margin-top:14px";
  s.textContent = ${JSON.stringify(sub)};
  c.append(t, s);
  document.body.appendChild(c);
})()`;
const slideSeg = (id) => ({
  ...HD,
  virtual: "timers",
  async run(a) {
    await a.go(`${url(join(WORK, "explainer.html"))}?scene=${id}`);
    await a.until("window.ready === true");
    await a.wait(100); // fonts settle
    await a.eval("window.__start()");
    await a.start();
    await a.beat(id);
    await a.stop();
  },
});
const termSeg = (id) => ({
  ...HD,
  virtual: "timers",
  async run(a) {
    await a.go(url(join(WORK, `term_${id}.html`)));
    await a.start();
    await a.beat(id, () => a.waitUntil("window.done === true", 900000));
    await a.stop();
  },
});
const viewerSeg = (run) => ({ ...HD, virtual: "timers", gpu: true, viewer: run });
const SLIDES = ["e-problem", "e-gaps", "e-research", "e-built", "e-decision", "e-results", "e-compare", "e-honest", "e-outro", "d-title", "d-end"];
const VIDEO_SEGMENTS = {
  ...Object.fromEntries(SLIDES.map((id) => [id, slideSeg(id)])),
  "d-run": termSeg("d-run"),
  "d-bench": termSeg("d-bench"),
  "e-hook": {
    ...viewerSeg("view_demo"),
    async run(a, srv) {
      const V = "window.viewer";
      await a.go(viewerUrl(srv, "view_demo"));
      await a.until(loaded, 180000);
      await a.eval(cleanHud);
      await a.eval(`${V}.setTime(${V}.stops[44].start - 3); ${V}.setSpeed(20); ${V}.setCam("drone")`);
      await a.wait(2500); // the drone flight settles
      await a.eval(`${V}.setPlaying(true)`);
      await a.eval(titleCard(a.b("e-hook").title));
      await a.start();
      await a.beat("e-hook", async () => {
        await a.wait(a.b("e-hook").dur * 300);
        await a.eval(`${V}.setCam("overhead")`); // rise to the whole field and its map
      });
      await a.stop();
    },
  },
  "e-safe": {
    ...viewerSeg("view_demo"),
    async run(a, srv) {
      const V = "window.viewer";
      await a.go(viewerUrl(srv, "view_demo"));
      await a.until(loaded, 180000);
      await a.eval(cleanHud);
      await a.eval(`${V}.setLayer(4); ${V}.setTime(${V}.stops[6].start - 14); ${V}.setSpeed(5); ${V}.setCam("follow")`);
      await a.wait(1600);
      await a.eval(`${V}.setPlaying(true)`);
      const b = a.b("e-safe");
      await a.eval(titleCard(b.title, b.sub));
      await a.start();
      await a.beat("e-safe");
      await a.stop();
    },
  },
  "e-map": {
    ...viewerSeg("view_demo"),
    async run(a, srv) {
      const V = "window.viewer";
      await a.go(viewerUrl(srv, "view_demo"));
      await a.until(loaded, 180000);
      await a.eval(cleanHud);
      await a.eval(`${V}.setTime(${V}.stops[20].start); ${V}.setSpeed(60); ${V}.setCam("overhead")`);
      await a.wait(1800);
      await a.eval(`${V}.setPlaying(true)`);
      const b = a.b("e-map");
      await a.eval(titleCard(b.title));
      await a.start();
      await a.beat("e-map", async () => {
        await a.wait(b.dur * 550);
        await a.eval(`${V}.setLayer(1)`);
        await a.eval(titleCard("And the real moisture", "which the robot never sees"));
      });
      await a.stop();
    },
  },
  "e-rover": {
    ...HD,
    virtual: "timers", // smooth however slow the SVG renders
    async run(a) {
      await a.go(url(join(REPO, "hardware", "rover-v2", "anatomy", "rover-anatomy.html")));
      // Fill the frame's height with the figure; the caption goes in the margin beside it.
      await a.eval(`(() => { document.documentElement.style.zoom = "1.45"; const c = document.querySelector(".iso-plate") ?? document.querySelector("svg"); scrollTo(0, 0); scrollTo(0, c.getBoundingClientRect().top - 18); })()`);
      await a.move(1880, 1060, 10);
      const b = a.b("e-rover");
      await a.eval(sideCard(b.title, b.sub));
      await a.jsKey(".iso-stage", " ");
      await a.start();
      await a.beat("e-rover");
      await a.stop();
    },
  },
  "d-view": {
    ...viewerSeg("view_demo"),
    async run(a, srv) {
      const V = "window.viewer";
      const cap = (id) => { const b = a.b(id); return a.eval(lowerThird(b.title, b.sub)); };
      await a.go(viewerUrl(srv, "view_demo", "medium"));
      await a.start(); // the loading screen is part of the demo
      await a.beat("d-open", async () => {
        await a.waitUntil(loaded, 180000);
        await cap("d-open");
      });
      await a.eval(`document.getElementById("hideIntro").click(); ${V}.setTime(${V}.stops[3].start - 9); ${V}.setSpeed(20); ${V}.setPlaying(true)`);
      await a.beat("d-probe", () => cap("d-probe"));
      await a.beat("d-reading", () => cap("d-reading"));
      await a.beat("d-drone", async () => {
        await cap("d-drone");
        await a.press("d");
      });
      await a.beat("d-timeline", async () => {
        await cap("d-timeline");
        const [x, y, w] = await a.eval(`(() => { const r = document.getElementById("time").getBoundingClientRect(); return [r.left, r.top + r.height / 2, r.width]; })()`);
        await a.move(x + w * 0.3, y, 900);
        await a.move(x + w * 0.62, y, 2200);
        await a.wait(600);
        await a.move(x + w * 0.5, y - 260, 500);
        await a.press("ArrowRight");
        await a.wait(1400);
        await a.press("ArrowRight");
      });
      await a.beat("d-layers", async () => {
        await cap("d-layers");
        await a.press("o");
        const step = (a.b("d-layers").dur * 1000) / 5;
        await a.wait(step);
        for (const n of [2, 3, 4]) {
          await a.clickSel(`#layerButtons button:nth-child(${n})`);
          await a.wait(step - 400);
        }
        await a.clickSel("#layerButtons button:nth-child(1)");
      });
      await a.beat("d-minimap", async () => {
        await cap("d-minimap");
        await a.eval(`${V}.setPlaying(false)`);
        const k = await a.eval(`${V}.stops.filter((s) => s.reveal <= ${V}.t).length`);
        const [x, y] = await a.eval(`${V}.mapPoint(${Math.max(0, Math.floor(k * 0.35))})`);
        await a.click(x, y);
        await a.press("f");
        await a.eval(`${V}.setPlaying(true)`);
      });
      await a.stop();
    },
  },
  "d-rain": {
    ...viewerSeg("view_rain"),
    async run(a, srv) {
      const V = "window.viewer";
      await a.go(viewerUrl(srv, "view_rain", "medium"));
      await a.until(loaded, 180000);
      const rain = await a.eval(`fetch("/work/view_rain/scene.json").then((r) => r.json()).then((s) => s.rain[0].start_s)`);
      await a.eval(`document.getElementById("hideIntro").click(); ${V}.setTime(${rain} - 50); ${V}.setSpeed(20); ${V}.setCam("drone")`);
      await a.wait(2000);
      await a.eval(`${V}.setPlaying(true)`);
      const b = a.b("d-rain");
      await a.eval(lowerThird(b.title, b.sub));
      await a.start();
      await a.beat("d-rain");
      await a.stop();
    },
  },
  "d-phone": {
    width: 390,
    height: 844,
    scale: 1.25,
    mobile: true,
    virtual: "timers",
    gpu: true,
    viewer: "view_demo",
    async run(a, srv) {
      const V = "window.viewer";
      await a.go(viewerUrl(srv, "view_demo", "medium"));
      await a.until(loaded, 180000);
      await a.eval(`${V}.setTime(${V}.stops[9].start - 6); ${V}.setSpeed(20); ${V}.setPlaying(true)`);
      await a.wait(1200);
      await a.start();
      await a.beat("d-phone", async () => {
        const step = (a.b("d-phone").dur * 1000) / 4;
        await a.wait(step);
        await a.clickSel('#sheetTabs [data-sheet="map"]');
        await a.wait(step);
        await a.clickSel('#sheetTabs [data-sheet="ground"]');
        await a.wait(step);
        await a.clickSel('#sheetTabs [data-sheet="now"]');
      });
      await a.stop();
    },
  },
};

const SEGMENTS = {
  ...VIDEO_SEGMENTS,
  // README screenshots of the 3D replay (no video): docs/img/viewer3d*.jpg
  stills: {
    virtual: "timers",
    video: false,
    gpu: true,
    viewer: "view_demo",
    async run(a, srv) {
      const V = "window.viewer";
      await a.go(viewerUrl(srv, "view_demo"));
      await a.until(loaded, 180000);
      await a.eval(`document.getElementById("hideIntro").click(); ${V}.setTime(${V}.stops[4].start + 3.2)`);
      await a.wait(1500);
      await a.shot(join(REPO, "docs", "img", "viewer3d.jpg"));
      await a.eval(`${V}.setCam("overhead"); ${V}.setTime(${V}.stops[32].start + 3.2); ${V}.select(20)`);
      await a.wait(2500);
      await a.shot(join(REPO, "docs", "img", "viewer3d-field.jpg"));
    },
  },
  // Fixed-camera screenshots of the 3D replay for before/after comparisons (no video):
  // runs/lookdev/<LOOKDEV label>-<view>.jpg. Needs `agrisim view runs/dev3d --no-browser --port 8766`.
  lookdev: {
    virtual: true,
    video: false,
    async run(a) {
      const V = "window.viewer";
      const label = process.env.LOOKDEV ?? "now";
      const dir = join(REPO, "runs", "lookdev");
      mkdirSync(dir, { recursive: true });
      await a.go(`http://127.0.0.1:8766/?paused&quality=high&${process.env.LOOKDEV_QUERY ?? ""}`);
      await a.until(`${V} && !document.getElementById("loading")`, 120000);
      await a.eval(`document.getElementById("hideIntro").click(); ${V}.setTime(${V}.stops[4].start + 3.2)`);
      await a.wait(1500);
      await a.shot(join(dir, `${label}-1-follow.jpg`));
      // Eye level in the lane, looking along the rows at the parked robot.
      await a.eval(`${V}.setCam("free"); ${V}.camera.position.set(${V}.camera.position.x - 1.2, 0.55, ${V}.camera.position.z)`);
      await a.wait(800);
      await a.shot(join(dir, `${label}-2-eye.jpg`));
      await a.eval(`${V}.setLayer(4)`); // plain soil: judge the light without the data tint
      await a.wait(200);
      await a.shot(join(dir, `${label}-2b-eye-plain.jpg`));
      await a.eval(`${V}.setLayer(0)`);
      await a.eval(`${V}.setCam("overhead"); ${V}.setTime(${V}.stops[32].start + 3.2)`);
      await a.wait(2500);
      await a.shot(join(dir, `${label}-3-field.jpg`));
    },
  },
  // Before, during and after the shower in a weather run (no video):
  // runs/lookdev/weather-*.jpg. Needs a rain run served on port 8766, e.g.
  // `agrisim run --config configs/scenarios/rain_shower.yaml --seed 7 --view`, then `agrisim view`.
  weather: {
    virtual: true,
    video: false,
    async run(a) {
      const V = "window.viewer";
      const dir = join(REPO, "runs", "lookdev");
      mkdirSync(dir, { recursive: true });
      await a.go(`http://127.0.0.1:8766/?paused&quality=high`);
      await a.until(`${V} && !document.getElementById("loading")`, 120000);
      await a.eval(`document.getElementById("hideIntro").click()`);
      for (const [name, t] of [["1-before", 500], ["2-raining", 1000], ["3-after", 1500]]) {
        await a.eval(`${V}.setCam("follow"); ${V}.setTime(${t})`);
        await a.wait(2500);
        await a.shot(join(dir, `weather-${name}.jpg`));
      }
    },
  },
  // Frame times of the 3D replay at each graphics level, on this machine's GPU (no video).
  perf: {
    gpu: true,
    video: false,
    async run(a) {
      const V = "window.viewer";
      for (const q of ["low", "medium", "high"]) {
        await a.go(`http://127.0.0.1:8766/?quality=${q}`);
        await a.until(`${V} && !document.getElementById("loading")`, 120000);
        await a.eval(`${V}.setSpeed(20); ${V}.setTime(${V}.stops[4].start - 20); ${V}.setPlaying(true)`);
        await sleep(3000); // shaders compile, caches fill
        const r = await a.eval(`new Promise((done) => {
          const gl = document.querySelector("canvas").getContext("webgl2");
          const info = gl.getExtension("WEBGL_debug_renderer_info");
          const gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
          // Average over 240 frames (total time / frames): with the frame cap off, single frame
          // times swing as the GPU works in bursts, but the average is the real throughput.
          const times = []; const start = performance.now(); let last = start;
          const tick = (now) => { times.push(now - last); last = now; if (times.length < 240) requestAnimationFrame(tick); else { gl.finish(); const mean = (performance.now() - start) / times.length; times.sort((x, y) => x - y); done({ gpu, median: mean.toFixed(1), p95: times[228].toFixed(1), size: innerWidth + "x" + innerHeight + "@" + devicePixelRatio }); } };
          requestAnimationFrame(tick);
        })`);
        console.log(`perf ${q}: ${r.median} ms per frame on average (${(1000 / r.median).toFixed(0)} fps), 95th percentile ${r.p95} ms (${r.size}) on ${r.gpu}`);
      }
    },
  },
  // The replay at the viewport sizes of Responsively App's device presets (phones, tablet,
  // laptop, desktop), the way a responsive review there would look at it (no video):
  // runs/devices/<device>-<view>.jpg. Needs `agrisim view <run> --no-browser --port 8766`.
  devices: {
    virtual: "timers",
    video: false,
    async run(a) {
      const V = "window.viewer";
      const dir = join(REPO, "runs", "devices");
      mkdirSync(dir, { recursive: true });
      for (const [name, w, h, mobile] of DEVICES) {
        await a.viewport(w, h, mobile);
        await a.go("http://127.0.0.1:8766/?paused&quality=low");
        await a.until(`${V} && !document.getElementById("loading")`, 120000);
        await a.eval(`${V}.setTime(${V}.stops[12].start + 9)`);
        await a.wait(1200);
        await a.shot(join(dir, `${name}-1-stop.jpg`));
        await a.eval(`${V}.setCam("overhead"); ${V}.setLayer(2); ${V}.select(8)`);
        await a.wait(1800);
        await a.shot(join(dir, `${name}-2-field.jpg`));
        if (mobile) {
          await a.eval(`${V}.setSheet("map"); ${V}.setLayer(0)`);
          await a.wait(300);
          await a.shot(join(dir, `${name}-3-map.jpg`));
        }
        await a.eval(`${V}.openHelp(true)`);
        await a.wait(300);
        await a.shot(join(dir, `${name}-4-help.jpg`));
      }
    },
  },
};

const CHROMES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

async function record(name, segment) {
  const W = segment.width ?? 1600, H = segment.height ?? 900;
  const srv = segment.viewer ? await serveViewer() : null;
  const BEATS = existsSync(join(WORK, "beats.json")) ? beatsFile() : {};
  const beatsAt = [];
  let recStart = 0;
  const outDir = join(WORK, `seg_${name}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "demo-video-"));
  const binary = CHROMES.find((p) => existsSync(p));
  if (!binary) throw new Error("no Chrome or Edge found; set CHROME to its path");
  const chrome = spawn(binary, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--hide-scrollbars", "--allow-file-access-from-files", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", ...(segment.gpu ? ["--enable-gpu", "--use-angle=d3d11", "--enable-features=Vulkan", "--disable-frame-rate-limit"] : []),
    `--window-size=${W},${H}`, "about:blank"]);
  const port = await new Promise((ok, fail) => {
    let text = "";
    chrome.stderr.on("data", (c) => { text += c; const m = text.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//); if (m) ok(Number(m[1])); });
    setTimeout(() => fail(new Error("Chrome did not start")), 20000);
  });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener("open", ok));
  let id = 0;
  const waiting = new Map();
  const frames = [];
  let recording = false;
  const send = (method, params = {}) => new Promise((ok, fail) => { const i = ++id; waiting.set(i, { ok, fail }); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) { const { ok, fail } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? fail(new Error(JSON.stringify(msg.error))) : ok(msg.result); return; }
    if (msg.method === "Runtime.exceptionThrown") console.error(`${name}: page error:`, msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method !== "Page.screencastFrame") return;
    send("Page.screencastFrameAck", { sessionId: msg.params.sessionId });
    if (!recording) return;
    const file = join(outDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(msg.params.data, "base64"));
    frames.push({ file, t: Date.now() / 1000 }); // wall clock, the same clock as start and stop
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: segment.scale ?? 1, mobile: !!segment.mobile });
  if (segment.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  if (segment.virtual) await send("Page.addScriptToEvaluateOnNewDocument", { source: virtualClock(segment.virtual === "timers") });
  let vclock = 0; // seconds of virtual time (virtual segments only)

  let mouse = [W / 2, H / 2];
  let t1 = 0;
  const a = {
    async viewport(w, h, mobile = false) { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile }); await send("Emulation.setTouchEmulationEnabled", { enabled: mobile }); },
    async go(target) { await send("Page.navigate", { url: target }); await sleep(300); await a.until("document.readyState === 'complete'"); },
    async eval(js) { const r = await send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true }); return r.result?.value; },
    async until(js, timeout = 60000) {
      const t0 = Date.now();
      while (!(await a.eval(js))) {
        if (Date.now() - t0 > timeout) throw new Error(`timeout: ${js}`);
        if (segment.virtual) await a.eval(`window.__vt && window.__vt.step(${FRAME_MS})`);
        await sleep(100);
      }
    },
    // Let ms of page time pass. Live segments just wait; virtual ones step the clock one frame
    // at a time and screenshot each frame, so the video is smooth however slow the rendering.
    async wait(ms) {
      if (!segment.virtual) return sleep(ms);
      for (let n = Math.round(ms / FRAME_MS); n > 0; n--) {
        await a.eval(`window.__vt.step(${FRAME_MS})`);
        vclock += FRAME_MS / 1000;
        if (!recording) continue;
        const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 });
        const file = join(outDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
        writeFileSync(file, Buffer.from(shot.data, "base64"));
        frames.push({ file, t: vclock });
      }
    },
    async move(x, y, ms = 600) { // eased glide that takes ms (of page time on a virtual clock)
      const [x0, y0] = mouse, t0 = Date.now();
      const steps = Math.max(1, Math.round(ms / FRAME_MS));
      for (let i = 1; ; i++) {
        const k = segment.virtual ? Math.min(1, i / steps) : Math.min(1, (Date.now() - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + (x - x0) * e, y: y0 + (y - y0) * e });
        if (k >= 1) break;
        if (segment.virtual) await a.wait(FRAME_MS);
        else await sleep(16);
      }
      mouse = [x, y];
    },
    async click(x, y) { await a.move(x, y, 400); for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); },
    async clickSel(sel) {
      const [x, y] = await a.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
      await a.click(x, y);
    },
    // A real key press (down and up), as the viewer's keyboard shortcuts receive it.
    async press(key) {
      const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
      const vk = { ArrowRight: 39, ArrowLeft: 37 }[key] ?? key.toUpperCase().charCodeAt(0);
      for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, ...(type === "keyDown" && key.length === 1 ? { text: key } : {}) });
    },
    // Capture frames until the page says it is ready (for waits that belong in the video).
    async waitUntil(js, timeout = 60000) {
      const t0 = Date.now();
      while (!(await a.eval(js))) {
        if (Date.now() - t0 > timeout) throw new Error(`timeout: ${js}`);
        await a.wait(FRAME_MS);
      }
    },
    b(id) {
      if (!BEATS[id]) throw new Error(`no beat ${id}: run prepare.py`);
      return BEATS[id];
    },
    // One narrated beat: note when it starts, do its actions, then hold until its voice is over.
    async beat(id, actions) {
      const now = () => (segment.virtual ? vclock : Date.now() / 1000);
      const t0 = now();
      beatsAt.push({ id, at: +(t0 - recStart).toFixed(3) });
      await actions?.();
      const left = a.b(id).dur - (now() - t0);
      if (left > 0) await a.wait(left * 1000);
    },

    async drag(x0, y0, x1, y1, ms = 800) {
      await a.move(x0, y0, 300);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", clickCount: 1 });
      const t0 = Date.now();
      for (;;) {
        const k = Math.min(1, (Date.now() - t0) / ms);
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, button: "left", buttons: 1 });
        if (k >= 1) break;
        await sleep(16);
      }
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", clickCount: 1 });
      mouse = [x1, y1];
    },
    // A key press sent to the element itself, so the figure does not show its keyboard focus ring.
    async jsKey(sel, key) { await a.eval(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`); },
    async shot(file) {
      const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 85 });
      writeFileSync(file, Buffer.from(r.data, "base64"));
      console.log(`${name}: wrote ${file}`);
    },
    async start() {
      if (!segment.virtual) await send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
      recording = true;
      recStart = segment.virtual ? vclock : Date.now() / 1000;
    },
    async stop() {
      recording = false;
      t1 = segment.virtual ? vclock : Date.now() / 1000;
      if (!segment.virtual) await send("Page.stopScreencast");
    },
  };
  try {
    await segment.run(a, srv);
  } finally {
    srv?.close();
    ws.close();
    chrome.kill();
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      // Chrome's GPU process can hold the profile a little longer; the OS temp cleaner gets it.
    }
  }
  if (segment.video === false) return;
  if (!frames.length) throw new Error(`${name}: no frames captured`);
  // ffmpeg concat list: each frame lasts until the next one arrived.
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : t1;
    lines.push(`file '${fwd(f.file)}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file '${fwd(frames.at(-1).file)}'`);
  writeFileSync(join(outDir, "frames.ffconcat"), lines.join("\n") + "\n");
  writeFileSync(join(outDir, "beats.json"), JSON.stringify(beatsAt));
  console.log(`${name}: ${frames.length} frames over ${(t1 - frames[0].t).toFixed(1)} s`);
}

// A video's segments, in order: each beat's `seg` (default: the beat's own id).
const segmentsOf = (video) => [...new Set(SCRIPT[video].map((b) => b.seg ?? b.id))];
const args = process.argv.slice(2);
if (!args.length) throw new Error(`name a video (${Object.keys(SCRIPT).filter((k) => k !== "_").join(", ")}) or segments (${Object.keys(SEGMENTS).join(", ")})`);
const names = args.flatMap((n) => (SCRIPT[n] && n !== "_" ? segmentsOf(n) : [n]));
for (const name of names) {
  if (!SEGMENTS[name]) throw new Error(`unknown segment ${name}; choose from ${Object.keys(SEGMENTS).join(", ")}`);
  await record(name, SEGMENTS[name]);
}
