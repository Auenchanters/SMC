# Demo video

Rebuilds [docs/media/agrisim-demo.mp4](../../docs/media/agrisim-demo.mp4): the CLI, a run's outputs, the Rerun viewer, the 3D replay and both rover figures, each driven for real and screen-recorded. Also rebuilds the README screenshots `docs/img/viewer3d*.jpg`.

Needs Node.js 22 or later, Chrome or Edge (set `CHROME` to its path if it is somewhere else), and `ffmpeg` on PATH. Everything is written to `runs/demo_video/` (gitignored) except the final MP4. Run from the repository root in PowerShell, one command per line.

1. Run the demo commands for real (their output and timing are recorded) and record seed 7 to an `.rrd` file. About 1 minute.

   ```powershell
   uv run python scripts/demo_video/prepare.py
   ```

2. In two more terminals, serve the Rerun web viewer and the 3D replay. Leave both running.

   ```powershell
   uv run rerun --serve-web --bind 127.0.0.1 --web-viewer-port 9090 runs/demo_video/seed7.rrd
   ```

   ```powershell
   uv run agrisim view runs/demo_video --no-browser --port 8766
   ```

3. Record every segment in headless Chrome, then join them. About 10 minutes.

   ```powershell
   node scripts/demo_video/record.mjs
   uv run python scripts/demo_video/assemble.py
   ```

   `node scripts/demo_video/record.mjs fig1 fig2` re-records only those segments. Segments: `title`, `term`, `outputs`, `rerun`, `view3d`, `fig1`, `fig2`, `end`. `node scripts/demo_video/record.mjs stills` rewrites the README screenshots.

4. Stop both servers from step 2 (Ctrl+C).

How it is honest: the terminal segment replays the real captured output at its real timing. Waits longer than 1.6 s are sped up, and the page says so on screen with the real elapsed time. The rest is live: the Rerun viewer, the 3D replay and the rover figures are driven with real mouse and key events. Those pages render too slowly in headless Chrome for real-time capture, so the recorder replaces their clock with a virtual one and takes exactly one frame per 1/30 s of page time; the motion is the page's own, just captured smoothly. Captions and slide text live in `prepare.py`, `record.mjs` and `pages/`.
