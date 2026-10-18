# Videos

Rebuilds the two videos in [docs/media/](../../docs/media/), each with a voiceover, a soundtrack, subtitles (`.srt`, also inside the MP4) and a poster (`.jpg`, also frame 0):

- **[agrisim-explainer.mp4](../../docs/media/agrisim-explainer.mp4)**: what the project is, the problem, the gaps in existing products and research, how it works, the agribench results, the rover, and what is left.
- **[agrisim-demo.mp4](../../docs/media/agrisim-demo.mp4)**: a live, hands-on run: the CLI, the 3D replay driven with real mouse and key input, a rain run, the phone layout and a benchmark.

Also rebuilds the README screenshots `docs/img/viewer3d*.jpg` (`stills`) and a responsive check of the replay at Responsively App's device sizes (`devices`, written to `runs/devices/`).

Everything is written to `runs/demo_video/` (gitignored) except the files in `docs/media/`. Run from the repository root in PowerShell, one command per line.

## What it needs

- Node.js 22 or later, Chrome or Edge (set `CHROME` to its path if it is somewhere else) and `ffmpeg` on PATH.
- For the voice: a separate Python environment with [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) (MIT) and soundfile, and the Kokoro-82M model (Apache-2.0). This is a video tool, not an agrisim dependency: kokoro-onnx pulls in a GPL phonemizer, which the licence rule keeps out of the package. One-time setup:

  ```powershell
  uv venv $env:USERPROFILE\kokoro-venv --python 3.12
  uv pip install --python $env:USERPROFILE\kokoro-venv kokoro-onnx soundfile
  npx -y hyperframes tts "test" -o $env:TEMP\test.wav
  ```

  The last line downloads the model to `~/.cache/hyperframes/tts/` (it may report that kokoro-onnx is missing; the download is what matters). Then point `KOKORO_PYTHON` at that environment:

  ```powershell
  $env:KOKORO_PYTHON = "$env:USERPROFILE\kokoro-venv\Scripts\python.exe"
  ```

## Steps

1. Voice every beat, run the demo commands for real (their output and timing are recorded) and write the two replays. A few minutes; voices are cached by their text, so only changed lines are spoken again.

   ```powershell
   uv run python scripts/demo_video/prepare.py
   ```

2. Record each video in headless Chrome. This starts its own server for the 3D replay. About 20 to 40 minutes per video, depending on the GPU.

   ```powershell
   node scripts/demo_video/record.mjs explainer
   node scripts/demo_video/record.mjs demo
   ```

   `node scripts/demo_video/record.mjs d-view d-rain` re-records only those segments. Segment names are the `seg` (or `id`) of the beats in `narration.json`.

3. Join each video with its voice, soundtrack, subtitles and poster.

   ```powershell
   uv run python scripts/demo_video/assemble.py explainer
   uv run python scripts/demo_video/assemble.py demo
   ```

## Editing

- **What is said and shown:** [narration.json](narration.json). Each beat has the spoken text (`say`, spelled for the voice), and the title and subtitle on screen. A beat lasts as long as its voice plus a short pause, so editing the text re-times the video.
- **Slides:** [pages/explainer.html](pages/explainer.html), one `<section>` per beat. Every frame is a pure function of time, so it records the same every time. Benchmark numbers on the slides are copied from README.md, which got them from `agrisim suite`.
- **What the recorder does in each beat:** the segments near the top of [record.mjs](record.mjs).
- **The soundtrack** is written by `soundtrack()` in [assemble.py](assemble.py): a slow pad in A minor with a soft arpeggio, ducked under the voice.

## How it stays honest

- The terminal segments replay the real captured output at its real timing. Waits longer than 1.6 s are sped up, and the page says so on screen with the real elapsed time.
- The 3D replays are surveys the simulator really ran: `view_demo` is the same config, seed and strategy as the command shown, so it is the same survey; `view_rain` is the rain-shower scenario on the same seed.
- The replay, the rover figure and the slides render too slowly in headless Chrome for real-time capture, so the recorder replaces the page's clock with a virtual one and takes exactly one frame per 1/30 s of page time. The motion is the page's own, just captured smoothly. Mouse moves, clicks and key presses are real input events.
- The video was made with the method of the [/brag](https://github.com/latent-spaces/brag) skill (brag-slim): story and storyboard first ([brag-plan.md](brag-plan.md)), the real product on screen instead of mock-ups, readable text, music written for the piece, a settled poster frame.
