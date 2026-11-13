"""SMC Rover Control Center: launch a mission and show the AI agronomist's debrief.

Run with: uv run streamlit run ai_agronomist/control_centre_app.py
"""

import re
import subprocess
from pathlib import Path

import streamlit as st

st.set_page_config(page_title="SMC Rover Control Center", layout="wide")

st.title("🚜 SMC Rover Control Center")
st.markdown("---")

# Sidebar Configuration
st.sidebar.header("Mission Parameters")
selected_model = st.sidebar.selectbox(
    "Select AI Agronomist", ["smc-edge-specialist", "smc-edge-doctor", "smc-brain"]
)


def _field_configs() -> list[str]:
    """Every field config on disk: the ones in configs/ and the scenarios under it."""
    found = sorted(Path("configs").glob("*.yaml"))
    found += sorted(Path("configs/scenarios").glob("*.yaml"))
    return [p.as_posix() for p in found] or ["configs/demo.yaml"]


config_file = st.sidebar.selectbox("Select Field Config", _field_configs())

probe_budget = st.sidebar.slider("Probe Budget", 10, 100, 30)
strategy = st.sidebar.selectbox(
    "Probing Strategy", ["moisture_seeker", "spatial_coverage", "planned_survey"]
)


def _marker(output: str, name: str) -> Path | None:
    """The absolute path a mission-manager marker line reported, if any."""
    match = re.search(rf"^{name}=(.+)$", output, flags=re.MULTILINE)
    return Path(match.group(1).strip()) if match else None


if st.sidebar.button("🚀 Launch Mission"):
    with st.spinner("Rover is deploying... Mapping field and consulting AI Doctor..."):
        cmd = [
            "uv",
            "run",
            "python",
            "ai_agronomist/run_mission.py",
            "--config",
            config_file,
            "--budget",
            str(probe_budget),
            "--strategy",
            strategy,
            "--model",
            selected_model,
        ]

        try:
            process = subprocess.run(
                cmd, capture_output=True, text=True, encoding="utf-8", timeout=1800
            )
        except subprocess.TimeoutExpired:
            st.error("Mission Failed: the pipeline did not finish within 30 minutes.")
        else:
            output = process.stdout
            run_folder = _marker(output, "MISSION_RUN_DIR")
            package_dir = _marker(output, "MISSION_PACKAGE_DIR")

            if process.returncode != 0 or run_folder is None:
                st.error("Mission Failed.")
                st.text(output)
                if process.stderr:
                    st.text(process.stderr)
            else:
                report_path = run_folder / "executive_report.md"
                if report_path.is_file():
                    report_text = report_path.read_text(encoding="utf-8")
                    st.success(f"Mission Complete! Telemetry: `{run_folder}`")
                    st.markdown(report_text)
                else:
                    st.error("Telemetry is saved, but the AI debrief was not generated.")

                if package_dir is not None:
                    st.info(f'To visualize the 3D path, run: `uv run agrisim view "{package_dir}"`')
                with st.expander("Mission output log"):
                    st.text(output)

st.markdown("---")
st.caption("SMC Autonomous Agriculture Rover - Edge AI Diagnostic Suite")
