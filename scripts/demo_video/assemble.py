"""Videos, step 3: join the recorded segments into docs/media/agrisim-<video>.mp4, with the
narration, a soundtrack written here, subtitles and a poster (needs ffmpeg). From the repo root:
    uv run python scripts/demo_video/assemble.py explainer
    uv run python scripts/demo_video/assemble.py demo

Each beat's voice starts where record.mjs logged the beat, so speech stays on its picture.
"""

import json
import re
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve

REPO = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
WORK = REPO / "runs" / "demo_video"
MEDIA = REPO / "docs" / "media"
BG = "0x0d1114"
FIT = (
    "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,"
    f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color={BG},setsar=1"
)
FADE = 0.3  # s dip through the background between segments
LEAD = 0.35  # s of quiet before each voice (prepare.py)
RATE = 48000
# Final quality: the demo's dense foliage and rain need a higher CRF to stay under 50 MB.
CRF = {"explainer": "29", "demo": "33"}
# A settled frame for the poster: (segment, seconds into it).
POSTER = {"explainer": ("e-results", 13.0), "demo": ("d-view", 62.0)}
# How the voice was spelled, back to how it is written.
WRITTEN = {
    "agri-sim": "agrisim",
    "agri-bench": "agribench",
    "kree-ging": "kriging",
    "dash dash view": "--view",
    "u v sync": "uv sync",
    "Agri-Rover": "AgriRover",
}


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args], check=True)


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(out.stdout)


def write_wav(path: Path, stereo: np.ndarray) -> None:
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def soundtrack(seconds: float, seed: int) -> np.ndarray:
    """A quiet, slow pad in A minor (Am9, Fmaj7, C, G6), a soft arpeggio and a room: written to
    sit under a voice, nothing sharp in it. Deterministic for a given seed."""
    rng = np.random.default_rng(seed)
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)  # noqa: E731 (MIDI note to Hz)
    chords = [
        [45, 52, 57, 59, 60, 64],
        [41, 48, 57, 60, 64],
        [48, 55, 60, 64, 67],
        [43, 50, 55, 59, 64],
    ]
    bar = 60 / 66 * 4  # s per bar at 66 BPM
    span = 2 * bar  # each chord lasts two bars
    out = np.zeros((n, 2))
    for k in range(int(seconds / span) + 2):
        start = k * span
        notes = chords[k % len(chords)]
        a, b = int(max(0, (start - 1.5) * RATE)), min(n, int((start + span + 2.5) * RATE))
        if a >= n:
            break
        tt = t[a:b] - start
        env = np.clip((tt + 1.5) / 3.0, 0, 1) * np.clip((span + 2.5 - tt) / 3.0, 0, 1)
        env = env**2 * (3 - 2 * env)  # smooth in and out, so chords crossfade
        for m in notes:
            f = hz(m)
            for side, detune in ((0, -0.0012), (1, 0.0012)):
                tone = np.sin(2 * np.pi * f * (1 + detune) * tt) + 0.18 * np.sin(4 * np.pi * f * tt)
                out[a:b, side] += 0.06 * env * tone
        root = hz(notes[0] - 12)
        out[a:b] += (0.09 * env * np.sin(2 * np.pi * root * tt))[:, None]
        # a soft arpeggio, one note per beat, up an octave
        for beat in range(8):
            on = start + beat * bar / 4
            i0 = int(on * RATE)
            if i0 >= n:
                break
            m = notes[(beat * 2 + k) % len(notes)] + 12
            i1 = min(n, i0 + int(2.2 * RATE))
            tp = t[i0:i1] - on
            pluck = np.sin(2 * np.pi * hz(m) * tp) * np.exp(-tp * 2.6) * np.clip(tp / 0.012, 0, 1)
            pan = 0.35 + 0.3 * rng.random()
            out[i0:i1, 0] += 0.035 * pluck * (1 - pan)
            out[i0:i1, 1] += 0.035 * pluck * pan
    # a room: decaying noise as the impulse response, mixed in under the dry sound
    ir_t = np.arange(int(2.0 * RATE)) / RATE
    for side in (0, 1):
        ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.2)
        wet = fftconvolve(out[:, side], ir / np.sqrt(np.sum(ir**2)))[:n]
        out[:, side] = 0.6 * out[:, side] + 0.4 * wet
    fade = np.clip(t / 2.0, 0, 1) * np.clip((seconds - t) / 4.0, 0, 1)
    out *= fade[:, None]
    return 0.5 * out / max(1e-9, np.abs(out).max())


def captions(beats: list[dict[str, object]], starts: dict[str, float]) -> str:
    """SRT: each beat's words, as written, in short lines spread over its voice."""
    blocks = []

    def stamp(s: float) -> str:
        return f"{int(s // 3600):02}:{int(s % 3600 // 60):02}:{s % 60:06.3f}".replace(".", ",")

    for b in beats:
        text = str(b["say"])
        for spoken, written in WRITTEN.items():
            text = text.replace(spoken, written)
        parts = [p.strip() for p in re.split(r"(?<=[.,:;?!])\s+", text) if p.strip()]
        chunks: list[str] = []
        for p in parts:  # merge short pieces, so each caption is 4 to 12 words
            if chunks and len(chunks[-1].split()) + len(p.split()) <= 12 and len(p.split()) < 4:
                chunks[-1] += " " + p
            else:
                chunks.append(p)
        t = starts[str(b["id"])] + LEAD
        total = sum(len(c) for c in chunks)
        for c in chunks:
            d = float(b["voice"]) * len(c) / total  # type: ignore[arg-type]
            blocks.append(f"{len(blocks) + 1}\n{stamp(t)} --> {stamp(t + d)}\n{c}\n")
            t += d
    return "\n".join(blocks)


def main(video: str) -> None:
    script = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))[video]
    order = list(dict.fromkeys(b.get("seg", b["id"]) for b in script))
    draft = ["-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "veryfast"]
    parts, starts, at = [], {}, 0.0
    for name in order:
        seg = WORK / f"seg_{name}"
        raw, part = WORK / f"raw_{name}.mp4", WORK / f"part_{name}.mp4"
        frames = seg / "frames.ffconcat"
        if not part.exists() or part.stat().st_mtime < frames.stat().st_mtime:  # re-recorded
            ffmpeg("-f", "concat", "-safe", "0", "-i", str(frames), "-vf", FIT, *draft, str(raw))
            d = duration(raw)
            fades = f"fade=t=in:st=0:d={FADE}:color={BG},fade=t=out:st={d - FADE:.3f}:d={FADE}"
            ffmpeg("-i", str(raw), "-vf", f"{fades}:color={BG}", *draft, str(part))
        d = duration(part)
        for mark in json.loads((seg / "beats.json").read_text(encoding="utf-8")):
            starts[mark["id"]] = at + mark["at"]
        parts.append(part)
        print(f"{name}: {d:.1f} s at {at:.1f} s")
        at += d
    total = at
    listing = WORK / f"parts_{video}.txt"
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    silent = WORK / f"{video}_silent.mp4"
    ffmpeg("-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(silent))

    # Voice: every line at its beat. Music: under it, ducked while someone speaks.
    spoken = json.loads((WORK / "beats.json").read_text(encoding="utf-8"))
    voices = [spoken[b["id"]] for b in script if b["id"] in starts]
    inputs = [arg for b in voices for arg in ("-i", str(WORK / "voice" / f"{b['id']}.wav"))]
    delays = "".join(
        f"[{i}:a]aresample={RATE},pan=stereo|c0=c0|c1=c0,"
        f"adelay={int((starts[b['id']] + LEAD) * 1000)}:all=1[v{i}];"
        for i, b in enumerate(voices)
    )
    mix = "".join(f"[v{i}]" for i in range(len(voices)))
    voice = WORK / f"{video}_voice.wav"
    graph = f"{delays}{mix}amix=inputs={len(voices)}:normalize=0,apad=whole_dur={total:.3f}[out]"
    ffmpeg(
        *inputs,
        "-filter_complex",
        graph,
        "-map",
        "[out]",
        "-t",
        f"{total:.3f}",
        "-ar",
        str(RATE),
        str(voice),
    )
    music = WORK / f"{video}_music.wav"
    write_wav(music, soundtrack(total, seed=7 if video == "demo" else 11))
    audio = WORK / f"{video}_audio.wav"
    duck = (
        "[0:a]volume=0.32[m];[1:a]asplit[v1][v2];"
        "[m][v1]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=600[d];"
        "[d][v2]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]"
    )
    ffmpeg(
        "-i",
        str(music),
        "-i",
        str(voice),
        "-filter_complex",
        duck,
        "-map",
        "[out]",
        "-ar",
        str(RATE),
        str(audio),
    )

    # Subtitles and the poster (a settled frame, also baked in as frame 0 for thumbnails).
    MEDIA.mkdir(parents=True, exist_ok=True)
    srt = MEDIA / f"agrisim-{video}.srt"
    srt.write_text(captions(voices, starts), encoding="utf-8")
    seg, into = POSTER[video]
    poster = MEDIA / f"agrisim-{video}.jpg"
    first = starts[next(b["id"] for b in script if b.get("seg", b["id"]) == seg)]
    ffmpeg(
        "-ss", f"{first + into:.3f}", "-i", str(silent), "-frames:v", "1", "-q:v", "3", str(poster)
    )
    out = MEDIA / f"agrisim-{video}.mp4"
    ffmpeg(
        "-i", str(silent), "-i", str(audio), "-i", str(poster), "-i", str(srt),
        "-filter_complex", "[0:v][2:v]overlay=enable='eq(n,0)'[v]",
        "-map", "[v]", "-map", "1:a", "-map", "3:s",
        "-c:v", "libx264", "-crf", CRF[video], "-preset", "slow", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng",
        "-shortest", "-movflags", "faststart", str(out),
    )  # fmt: skip
    size = out.stat().st_size / 1e6
    print(f"wrote {out} ({duration(out):.0f} s, {size:.1f} MB), {srt.name}, {poster.name}")


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("explainer", "demo"):
        raise SystemExit("usage: assemble.py explainer|demo")
    main(sys.argv[1])
