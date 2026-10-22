import os
import json
import csv
import yaml
from pathlib import Path
from typing import Dict, Any

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

def load_run_data(run_dir: Path) -> Dict[str, Any]:
    data = {}
    
    # 1. Config
    config_path = run_dir / "config.yaml"
    if config_path.exists():
        with open(config_path, "r") as f:
            data["config"] = yaml.safe_load(f)
            
    # 2. Metrics
    metrics_path = run_dir / "metrics.json"
    if metrics_path.exists():
        with open(metrics_path, "r") as f:
            data["metrics"] = json.load(f)
            
    # 3. Probes
    probes_path = run_dir / "probes.csv"
    if probes_path.exists():
        probes = []
        with open(probes_path, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                probes.append(row)
        
        # Find "hotspots" (lowest moisture readings) to reduce prompt size
        # Sort by value_vwc (assuming it's numeric)
        try:
            sorted_probes = sorted(probes, key=lambda x: float(x["value_vwc"]))
            data["hotspots"] = sorted_probes[:10] # Top 10 driest spots
        except (ValueError, KeyError):
            data["hotspots"] = probes[:10]
            
    return data

def generate_prompt(data: Dict[str, Any]) -> str:
    metrics = data.get("metrics", {})
    map_metrics = metrics.get("map", {})
    run_metrics = metrics.get("run", {})
    config = data.get("config", {})
    hotspots = data.get("hotspots", [])
    
    prompt = f"""
You are an Expert AI Agronomist and Precision Irrigation Consultant. 
You have just received the mission telemetry from an autonomous soil-moisture survey rover.

### MISSION CONTEXT
- Field Config: {config.get('field', 'Unknown')}
- Policy Used: {metrics.get('policy', 'Unknown')}
- Mission Time: {run_metrics.get('mission_time_s', 0) / 60:.2f} minutes
- Path Length: {run_metrics.get('path_length_m', 0):.2f} meters
- Plant Contacts: {run_metrics.get('plant_contacts', 0)} (CRITICAL: Must be 0)

### PERFORMANCE METRICS
- Map Accuracy (RMSE): {map_metrics.get('rmse', 0):.4f} VWC
- Dry Zone Detection (F1 Score): {map_metrics.get('dry_f1', 0):.2f}
- Dry Cell Recall: {map_metrics.get('dry_recall', 0):.2f} (How many of the truly dry cells were found)
- Calibration (95% Band): {map_metrics.get('calibration_95', 0):.2f}
- Truth Dry Fraction: {map_metrics.get('truth_dry_fraction', 0):.2%}

### DETECTED HOTSPOTS (Driest Probes)
{chr(10).join([f"- Pos({p['x_m']}, {p['y_m']}): {p['value_vwc']} VWC" for p in hotspots])}

### TASK
Generate an "Executive Agronomist Mission Debrief". 
The report should not just repeat the numbers, but interpret them for a farm manager.
Structure the report as follows:
1. **Mission Status**: (Success/Partial/Failure based on plant contacts and F1 score)
2. **Irrigation Insight**: (Is the field generally healthy? Where are the critical dry zones? What is the urgency?)
3. **Confidence Assessment**: (Do we trust the map? Use the RMSE and Calibration metrics)
4. **Action Plan**: (Specific recommendations for the irrigation team, e.g., "Inspect emitter at Pos X, Y")
5. **Operational Efficiency**: (Comment on mission time and probe success rate)

Tone: Professional, actionable, and authoritative.
"""
    return prompt

def main():
    import argparse
    parser = argparse.ArgumentParser(description="AI Agronomist Mission Debrief Generator (Local LLM)")
    parser.add_argument("run_dir", type=str, help="Path to the agrisim run folder")
    parser.add_argument("--output", type=str, default="debrief.md", help="Output filename")
    parser.add_argument("--model", type=str, default="qwen2.5:1.5b", help="Local model name (e.g. qwen2.5)")
    parser.add_argument("--url", type=str, default="http://localhost:11434/v1", help="Local LLM API URL (Ollama default)")
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
        client = OpenAI(base_url=args.url, api_key="ollama") # API key is dummy for local
        response = client.chat.completions.create(
            model=args.model,
            messages=[
                {"role": "system", "content": "You are an Expert AI Agronomist and Precision Irrigation Consultant."},
                {"role": "user", "content": prompt}
            ]
        )
        report_text = response.choices[0].message.content
    except Exception as e:
        print(f"Error connecting to local LLM: {e}")
        return

    output_path = run_path / args.output
    with open(output_path, "w") as f:
        f.write(report_text)
    
    print(f"Debrief successfully generated at: {output_path}")

if __name__ == "__main__":
    main()
