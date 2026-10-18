"""Speak a batch of lines with Kokoro, loading the model once. Called by prepare.py with the
Python named by KOKORO_PYTHON (a separate environment with kokoro-onnx and soundfile; not an
agrisim dependency):
    <KOKORO_PYTHON> scripts/demo_video/voice.py jobs.json

jobs.json: {"voice": "af_heart", "jobs": [{"text": "...", "out": "path.wav"}, ...]}.
The model files are the ones `npx hyperframes tts` downloads to ~/.cache/hyperframes/tts/, or
KOKORO_MODEL and KOKORO_VOICES.
"""

import json
import os
import sys
from pathlib import Path

import soundfile as sf  # type: ignore[import-not-found]
from kokoro_onnx import Kokoro  # type: ignore[import-not-found]

CACHE = Path.home() / ".cache" / "hyperframes" / "tts"


def main() -> None:
    spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    model = os.environ.get("KOKORO_MODEL", str(CACHE / "models" / "kokoro-v1.0.onnx"))
    voices = os.environ.get("KOKORO_VOICES", str(CACHE / "voices" / "voices-v1.0.bin"))
    kokoro = Kokoro(model, voices)
    for job in spec["jobs"]:
        samples, rate = kokoro.create(job["text"], voice=spec["voice"], speed=1.0, lang="en-us")
        sf.write(job["out"], samples, rate, subtype="PCM_16")
        print(f"{Path(job['out']).name}: {len(samples) / rate:.1f} s", flush=True)


if __name__ == "__main__":
    main()
