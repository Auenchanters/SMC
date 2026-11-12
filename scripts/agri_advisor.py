import csv
import json
from pathlib import Path
from typing import Any

import yaml

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None


def load_run_data(run_dir: Path) -> dict[str, Any]:
    data = {}

    # 1. Config
    config_path = run_dir / "config.yaml"
    if config_path.exists():
        with open(config_path) as f:
            data["config"] = yaml.safe_load(f)

    # 2. Metrics
    metrics_path = run_dir / "metrics.json"
    if metrics_path.exists():
        with open(metrics_path) as f:
            data["metrics"] = json.load(f)

    # 3. Probes
    probes_path = run_dir / "probes.csv"
    if probes_path.exists():
        probes = []
        with open(probes_path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                probes.append(row)

        # Find "hotspots" (lowest moisture readings) to reduce prompt size
        # Sort by value_vwc (assuming it's numeric)
        try:
            sorted_probes = sorted(probes, key=lambda x: float(x["value_vwc"]))
            data["hotspots"] = sorted_probes[:10]  # Top 10 driest spots
        except (ValueError, KeyError):
            data["hotspots"] = probes[:10]

    return data


def mission_verdict(run: dict[str, Any], soil_map: dict[str, Any]) -> tuple[str, list[str]]:
    """The mission's status by fixed rules, so it never depends on the language model's mood.
    (An 8B model once called a random survey a success because nothing touched a plant.)"""
    reasons = []
    status = "SUCCESS"
    if run.get("plant_contacts", 0) > 0:
        status = "FAILURE"
        reasons.append(f"{run['plant_contacts']} plant contact(s); the limit is 0")
    recall = soil_map.get("dry_recall")
    dry_share = soil_map.get("truth_dry_fraction", 0) or 0
    if dry_share > 0.01 and (recall is None or recall < 0.3):
        found = "none" if recall is None else f"{recall:.0%}"
        if status == "SUCCESS":
            status = "PARTIAL"
        reasons.append(f"the map found {found} of the truly dry area (under 30%)")
    used, valid = run.get("probes_used", 0), run.get("valid_probes", 0)
    if used and valid / used < 0.8:
        if status == "SUCCESS":
            status = "PARTIAL"
        reasons.append(f"only {valid} of {used} probes returned a reading")
    cal = soil_map.get("calibration_95")
    if cal is not None and not 0.85 <= cal <= 0.995:
        reasons.append(
            f"the map's 95% band holds {cal:.0%} of cells; treat its confidence with care"
        )
    return status, reasons or ["no plant contacts, and the dry area was found"]


def generate_prompt(data: dict[str, Any]) -> str:
    metrics = data.get("metrics", {})
    map_metrics = metrics.get("map", {})
    run_metrics = metrics.get("run", {})
    config = data.get("config", {})
    hotspots = data.get("hotspots", [])

    status, reasons = mission_verdict(run_metrics, map_metrics)

    prompt = f"""
You are an Expert AI Agronomist and Precision Irrigation Consultant.
You have just received the mission telemetry from an autonomous soil-moisture survey rover.

### MISSION CONTEXT
- Field Config: {config.get("field", "Unknown")}
- Policy Used: {metrics.get("policy", "Unknown")}
- Mission Time: {run_metrics.get("mission_time_s", 0) / 60:.2f} minutes
- Path Length: {run_metrics.get("path_length_m", 0):.2f} meters
- Plant Contacts: {run_metrics.get("plant_contacts", 0)} (CRITICAL: Must be 0)

### PERFORMANCE METRICS
- Map Accuracy (RMSE): {map_metrics.get("rmse", 0):.4f} VWC
- Dry Zone Detection (F1 Score): {map_metrics.get("dry_f1", 0):.2f}
- Dry Cell Recall: {map_metrics.get("dry_recall") or 0:.2f} (share of the truly dry cells found)
- Calibration (95% Band): {map_metrics.get("calibration_95", 0):.2f}
- Truth Dry Fraction: {map_metrics.get("truth_dry_fraction", 0):.2%}

### DETECTED HOTSPOTS (Driest Probes)
{chr(10).join([f"- Pos({p['x_m']}, {p['y_m']}): {p['value_vwc']} VWC" for p in hotspots])}

### TASK
Generate an "Executive Agronomist Mission Debrief".
The report should not just repeat the numbers, but interpret them for a farm manager.
Structure the report as follows:
1. **Mission Status**: it is {status}, decided by fixed rules: {"; ".join(reasons)}.
   State exactly this status and explain it. Do not change it.
2. **Irrigation Insight**: (Is the field healthy? Where are the critical dry zones? How urgent?)
3. **Confidence Assessment**: (Do we trust the map? Use the RMSE and Calibration metrics)
4. **Action Plan**: (Specific steps for the irrigation team, e.g., "Inspect emitter at Pos X, Y")
5. **Operational Efficiency**: (Comment on mission time and probe success rate)

Tone: Professional, actionable, and authoritative.
"""
    return prompt


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="AI Agronomist Mission Debrief Generator (Local LLM)"
    )
    parser.add_argument("run_dir", type=str, help="Path to the agrisim run folder")
    parser.add_argument("--output", type=str, default="debrief.md", help="Output filename")
    parser.add_argument(
        "--model", type=str, default="qwen2.5:1.5b", help="Local model name (e.g. qwen2.5)"
    )
    parser.add_argument(
        "--url",
        type=str,
        default="http://localhost:11434/v1",
        help="Local LLM API URL (Ollama default)",
    )
    args = parser.parse_args()

    run_path = Path(args.run_dir)
    if not run_path.is_dir():
        print(f"Error: {args.run_dir} is not a directory.")
        return

    print(f"Reading telemetry from {run_path}...")
    data = load_run_data(run_path)
    prompt = generate_prompt(data)

    if OpenAI is None:
        print("Error: 'openai' package not installed. Please run 'pip install openai'.")
        print("\n--- PROMPT PREVIEW ---")
        print(prompt)
        return

    print(f"Consulting Local AI Agronomist ({args.model}) at {args.url}...")
    try:
        client = OpenAI(base_url=args.url, api_key="ollama")  # API key is dummy for local
        response = client.chat.completions.create(
            model=args.model,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert agronomist and precision irrigation consultant.",
                },
                {"role": "user", "content": prompt},
            ],
        )
        report_text = response.choices[0].message.content
    except Exception as e:
        print(f"Error connecting to local LLM: {e}")
        return

    metrics = data.get("metrics", {})
    status, reasons = mission_verdict(metrics.get("run", {}), metrics.get("map", {}))
    header = f"> **Mission status (rule-based): {status}.** {'; '.join(reasons).capitalize()}.\n\n"
    output_path = run_path / args.output
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(header + (report_text or ""))

    print(f"Debrief successfully generated at: {output_path}")


if __name__ == "__main__":
    main()
