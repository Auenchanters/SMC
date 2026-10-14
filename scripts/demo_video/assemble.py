"""Demo video, step 3: join the recorded segments into docs/media/agrisim-demo.mp4 (needs ffmpeg).

Run from the repository root:
    uv run python scripts/demo_video/assemble.py
"""

import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORK = REPO / "runs" / "demo_video"
OUT = REPO / "docs" / "media" / "agrisim-demo.mp4"
# Segment and, for still slides, a fixed length in seconds.
ORDER: list[tuple[str, float | None]] = [
    ("title", 5.5),
    ("term", None),
    ("outputs", 8.0),
    ("rerun", None),
    ("view3d", None),
    ("fig1", None),
    ("fig2", None),
    ("end", 7.5),
]
FIT = "fps=30,scale=1600:900:force_original_aspect_ratio=decrease,pad=1600:900:(ow-iw)/2:(oh-ih)/2"
FADE = 0.4


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


def main() -> None:
    draft = ["-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast"]
    parts = []
    for name, length in ORDER:
        frames = WORK / f"seg_{name}" / "frames.ffconcat"
        raw, part = WORK / f"raw_{name}.mp4", WORK / f"part_{name}.mp4"
        ffmpeg("-f", "concat", "-safe", "0", "-i", str(frames), "-vf", FIT, *draft, str(raw))
        d = length or duration(raw)
        hold = f"tpad=stop_mode=clone:stop_duration={d}," if length else ""  # still slides
        fades = f"{hold}fade=t=in:st=0:d={FADE},fade=t=out:st={d - FADE:.3f}:d={FADE}"
        ffmpeg("-i", str(raw), "-t", f"{d:.3f}", "-vf", fades, *draft, str(part))
        parts.append(part)
        print(f"{name}: {d:.1f} s")
    listing = WORK / "parts.txt"
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    final = "-c:v libx264 -crf 25 -preset slow -tune animation -pix_fmt yuv420p -movflags faststart"
    ffmpeg("-f", "concat", "-safe", "0", "-i", str(listing), *final.split(), str(OUT))
    print(f"wrote {OUT} ({duration(OUT):.0f} s, {OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
