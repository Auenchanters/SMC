"""Upload the Hugging Face Space: huggingface_space/ plus the simulator package and configs.

Run from the repository root, after `hf auth login`:

    uv run --with huggingface_hub python scripts/deploy_huggingface_space.py
"""

import shutil
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

SPACE = "Auenchanters/SMC"
ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    skip = shutil.ignore_patterns("__pycache__")
    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp)
        shutil.copytree(ROOT / "huggingface_space", stage, dirs_exist_ok=True, ignore=skip)
        shutil.copytree(ROOT / "src" / "agrisim", stage / "agrisim", ignore=skip)
        shutil.copytree(ROOT / "configs", stage / "configs")
        HfApi().upload_folder(
            folder_path=stage,
            repo_id=SPACE,
            repo_type="space",
            commit_message="Deploy from the SMC repository",
        )
    print(f"deployed: https://huggingface.co/spaces/{SPACE}")


if __name__ == "__main__":
    main()
