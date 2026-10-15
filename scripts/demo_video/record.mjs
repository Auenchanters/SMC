// Demo video, step 2: drive each part of the app in headless Chrome and screencast it.
// Needs Node 22+, Chrome or Edge, `prepare.py` already run, the Rerun web viewer serving
// runs/demo_video/seed7.rrd on port 9090 and `agrisim view` serving runs/demo_video on port
// 8766 (see README.md). Run from the repository root:
//   node scripts/demo_video/record.mjs            all segments
//   node scripts/demo_video/record.mjs fig1 fig2  only these
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK = join(REPO, "runs", "demo_video");
const url = (path) => pathToFileURL(path).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fwd = (p) => p.split("\\").join("/");

// Caption pill for pages this script does not own (Rerun, the rover figures).
const capJs = (n, title, sub, css) => `(() => {
  let c = document.getElementById("__cap");
  if (!c) { c = document.createElement("div"); c.id = "__cap"; document.body.appendChild(c); }
  c.style.cssText = "position:fixed;z-index:2147483647;max-width:640px;padding:9px 16px;border-radius:10px;background:rgba(18,22,27,.94);border:1px solid #263040;color:#e6edf3;font:600 19px/1.35 'Segoe UI',sans-serif;pointer-events:none;${css}";
  c.innerHTML = '<span style="color:#7ee0a1;margin-right:9px">${n}</span>${title}<div style="font-weight:400;color:#8b98a5;font-size:15px;margin-top:2px">${sub}</div>';
})()`;

const slide = (page, secs) => async (a) => { await a.go(url(join(WORK, page))); await a.start(); await sleep(secs * 1000); await a.stop(); };
const RERUN_TOP = "left:300px;top:6px";
const SIDE = "left:14px;top:240px;max-width:284px";
const TOP = "left:50%;top:16px;transform:translateX(-50%)";
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
const FIG = { width: 1280, height: 720, scale: 1.25 };
const figure = (name) => url(join(REPO, "hardware", "rover-v1", "anatomy", `${name}.html`));
const scrollToCard = "(() => { const c = document.querySelector('.iso-plate') ?? document.querySelector('svg'); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 12); const r = document.querySelector('.iso-stage svg').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()";

const SEGMENTS = {
  title: { run: slide("title.html", 6) },
  term: {
    async run(a) { await a.go(url(join(WORK, "term.html"))); await a.start(); await a.until("window.done === true", 300000); await sleep(300); await a.stop(); },
  },
  outputs: { run: slide("outputs.html", 8) },
  rerun: {
    virtual: true, // renders slowly in headless Chrome: step a virtual clock instead
    async run(a) {
      await a.go("http://127.0.0.1:9090/?url=rerun%2Bhttp%3A%2F%2Flocalhost%3A9876%2Fproxy");
      await a.wait(8000); // let the viewer load the whole recording
      await a.eval(capJs("8", "The same survey in the Rerun viewer (agrisim run --rerun)", "a guide panel explains every view · the maps update after every reading", RERUN_TOP));
      await a.start();
      await a.wait(1200);
      await a.click(290, 886); // time cursor to the start; the viewer keeps playing at 30x
      await a.wait(9000);
      await a.eval(capJs("8", "Map error falls as readings come in", "average map error over time, bottom left · playback at 30x simulated time", RERUN_TOP));
      await a.wait(12000);
      await a.eval(capJs("8", "Click or drag the time bar to jump to any moment", "every frame, map and number is kept in recording.rrd", RERUN_TOP));
      await a.click(1200, 886);
      await a.wait(2500);
      await a.click(760, 886);
      await a.wait(4000);
      await a.stop();
    },
  },
  view3d: {
    virtual: true, // too heavy to render live in headless Chrome: step a virtual clock instead
    async run(a) {
      const V = "window.viewer";
      await a.go("http://127.0.0.1:8766/?paused&quality=high");
      await a.until(`${V} && !document.getElementById("loading")`, 120000);
      const first = await a.eval(`${V}.stops[2].start`);
      await a.eval(`${V}.setSpeed(20); ${V}.setTime(${first} - 7)`);
      await a.wait(1500);
      await a.start();
      await a.wait(3500); // the intro panel explains the page
      await a.eval(`document.getElementById("hideIntro").click(); ${V}.setPlaying(true)`);
      await a.eval(capJs("9", "The same survey as a 3D replay: agrisim run --view", "the robot drives between the rows, parks, and pushes its probe into the soil; the panel on the right says what it is doing", TOP));
      await a.wait(9000);
      await a.eval(capJs("9", "Each reading becomes a coloured mark, and the map fills in", "orange = too dry, blue = wet · the robot's map gets better with every reading", TOP));
      await a.eval(`${V}.setCam("overhead"); ${V}.setTime(${V}.stops[30].start - 4); ${V}.setSpeed(60)`);
      await a.wait(7000);
      await a.eval(capJs("9", "Compare with the real moisture, which the robot never sees", "buttons on the left change what the ground colour shows", TOP));
      await a.eval(`${V}.setLayer(1)`);
      await a.wait(3500);
      await a.eval(`${V}.setLayer(2)`);
      await a.wait(3000);
      await a.eval(`${V}.setLayer(0); ${V}.setTime(${V}.T_END - 2)`);
      await a.eval(capJs("9", "Survey complete: 60 stops (1 probe failed), 0 plants touched", "the whole replay plays in the browser; drag to look around, Space to pause", TOP));
      await a.wait(4500);
      await a.stop();
    },
  },
  // README screenshots of the 3D replay (no video): docs/img/viewer3d*.jpg
  stills: {
    virtual: true,
    video: false,
    async run(a) {
      const V = "window.viewer";
      await a.go("http://127.0.0.1:8766/?paused&quality=high");
      await a.until(`${V} && !document.getElementById("loading")`, 120000);
      await a.eval(`document.getElementById("hideIntro").click(); ${V}.setTime(${V}.stops[4].start + 3.2)`);
      await a.wait(1500);
      await a.shot(join(REPO, "docs", "img", "viewer3d.jpg"));
      await a.eval(`${V}.setCam("overhead"); ${V}.setTime(${V}.stops[32].start + 3.2)`);
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
  fig1: {
    ...FIG,
    virtual: "timers", // smooth however slow the SVG renders
    async run(a) {
      await a.go(figure("rover-anatomy"));
      const [x, y, w, h] = await a.eval(scrollToCard);
      await a.move(x + w * 0.5, y + h * 0.3, 10);
      await a.eval(capJs("10", "AgriRover v1: the rover in detail", "4WD RC chassis with the probe module on top. Hover over the figure to move the probe by hand.", SIDE));
      await a.wait(400);
      await a.start();
      await a.wait(800);
      await a.move(x + w * 0.52, y + h * 0.74, 3200);
      await a.wait(700);
      await a.move(x + w * 0.5, y + h * 0.28, 2200);
      await a.wait(500);
      await a.move(150, 650, 500);
      await a.eval(capJs("11", "Space: one full probe cycle, then a leaf scan (3x speed)", "lower until the ground sensor sees soil · insert 60 mm · read · pull up through the brush seal · air blast · air check · camera arm slides under the leaves", SIDE));
      await a.jsKey(".iso-stage", " ");
      await a.wait(14500);
      await a.eval(capJs("12", "A: slide the under-leaf camera arm out by hand", "351 mm reach from the centre line; a brush at the beam mouth wipes the camera window on every retraction", SIDE));
      await a.jsKey(".iso-stage", "a");
      await a.wait(3000);
      await a.jsKey(".iso-stage", "a");
      await a.wait(2600);
      await a.stop();
    },
  },
  fig2: {
    ...FIG,
    virtual: "timers", // smooth however slow the SVG renders
    async run(a) {
      await a.go(figure("probe-cleaning"));
      await a.eval(scrollToCard);
      await a.move(150, 650, 10);
      await a.eval(capJs("13", "Fig 2: the self-cleaning probe cartridge, cut in half", "Soil stuck to the rods would bias the next reading, so every cycle ends with cleaning (1.5x speed)", SIDE));
      await a.jsKey(".iso-stage", " ");
      await a.start();
      await a.wait(9500);
      await a.eval(capJs("13", "Brushes scrape the rods on the way up", "the scraped soil falls back where it came from; then six nozzles blow the rods dry and the probe must read clean air within 0.02 m³/m³", SIDE));
      await a.wait(10500);
      await a.stop();
    },
  },
  end: { run: slide("end.html", 8) },
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
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: segment.scale ?? 1, mobile: false });
  if (segment.virtual) await send("Page.addScriptToEvaluateOnNewDocument", { source: virtualClock(segment.virtual === "timers") });
  let vclock = 0; // seconds of virtual time (virtual segments only)

  let mouse = [W / 2, H / 2];
  let t1 = 0;
  const a = {
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
    },
    async stop() {
      recording = false;
      t1 = segment.virtual ? vclock : Date.now() / 1000;
      if (!segment.virtual) await send("Page.stopScreencast");
    },
  };
  try {
    await segment.run(a);
  } finally {
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
  console.log(`${name}: ${frames.length} frames over ${(t1 - frames[0].t).toFixed(1)} s`);
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SEGMENTS).filter((n) => !["stills", "lookdev", "perf"].includes(n));
for (const name of names) {
  if (!SEGMENTS[name]) throw new Error(`unknown segment ${name}; choose from ${Object.keys(SEGMENTS).join(", ")}`);
  await record(name, SEGMENTS[name]);
}
