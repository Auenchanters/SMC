"""Smoke-test app for the Hugging Face Space: run one survey, show its numbers and maps.

shortcut: plain Gradio widgets, replace with the designed pages once a redesign is picked.
"""

import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE if (HERE / "configs").is_dir() else HERE.parent  # Space layout, else the repository
sys.path.insert(0, str(HERE))  # on the Space the deploy script puts agrisim/ next to this file

import gradio as gr  # noqa: E402

from agrisim.config import load  # noqa: E402
from agrisim.io import save_run  # noqa: E402
from agrisim.policies import STRATEGIES  # noqa: E402
from agrisim.sim import run_survey  # noqa: E402

CONFIGS = sorted(
    p.relative_to(ROOT / "configs").as_posix() for p in (ROOT / "configs").rglob("*.yaml")
)


def run_mission(config: str, policy: str, seed: int) -> tuple[dict[str, object], str]:
    """Run one soil-moisture survey and return its metrics and the path of its map image."""
    if config not in CONFIGS or policy not in STRATEGIES:  # the API accepts any string
        raise gr.Error("Unknown scenario or strategy.")
    out_dir = Path(tempfile.mkdtemp(prefix="agrisim_"))
    result = run_survey(
        load(ROOT / "configs" / config),
        int(seed),
        policy,
        rerun=False,
        budget=None,
        rrd_path=out_dir / "recording.rrd",
        model=None,
    )
    save_run(result, out_dir)
    metrics = json.loads((out_dir / "metrics.json").read_text(encoding="utf-8"))
    return metrics, str(out_dir / "maps.png")


with gr.Blocks(title="SMC soil-moisture survey") as demo:
    gr.Markdown(
        "# SMC: soil-moisture survey\n"
        "A rover drives the lanes of a simulated tomato field, probes the soil and maps its "
        "moisture. This page is a first test of the hosted simulator; the full command centre "
        "and 3D replay come next. Soil and probe numbers are placeholders until calibrated."
    )
    with gr.Row():
        config = gr.Dropdown(CONFIGS, value="demo.yaml", label="Field scenario")
        policy = gr.Dropdown(list(STRATEGIES), value="planned_survey", label="Probing strategy")
        seed = gr.Number(7, precision=0, minimum=0, label="Seed")
    go = gr.Button("Run survey", variant="primary")
    maps = gr.Image(label="True moisture, estimate and uncertainty", type="filepath")
    metrics = gr.JSON(label="Metrics")
    go.click(run_mission, [config, policy, seed], [metrics, maps])

if __name__ == "__main__":
    demo.launch()
