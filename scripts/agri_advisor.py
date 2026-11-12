"""AI agronomist debrief for one agrisim run.

The mission verdict is computed here, in code, from `metrics.json`: a language model is good at
explaining a result and bad at deciding one. The model writes only the narrative, and
`validate_report()` rejects prose that contradicts the telemetry (for example a report that says
the rover touched plants when `plant_contacts` is 0). Unresolved contradictions are recorded at
the end of the report instead of being hidden.
"""

import argparse
import csv
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from openai import OpenAI

DEFAULT_URL = "http://localhost:11434/v1"
DEFAULT_MODEL = "qwen2.5:1.5b"

# Verdict thresholds. Draft values, like every PLACEHOLDER in configs/: an agronomist should
# set these before anyone quotes them.
SUCCESS_DRY_F1 = 0.60
PARTIAL_DRY_F1 = 0.30
SUCCESS_MAX_RMSE = 0.035
DURATION_TOLERANCE_MIN = 1.0

# Prose that contradicts a survey in which no plant was touched.
CONTACT_CONTRADICTIONS = (
    r"(?:not|never|didn'?t|did not|failed to)\s+"
    r"(?:achiev\w*|maintain\w*|keep\w*|reach\w*|record\w*)[^.\n]{0,40}plant\s+contacts?",
    r"plant\s+contacts?[^.\n]{0,40}(?:occurred|happened|recorded|were made|detected)",
    r"(?:touched|hit|damaged|collided with|contacted)\s+(?:a|the|some|any)?\s*plants?\b",
)
VERDICT_LINE = r"\bmission status\b[^.\n]{0,60}"
DURATION = re.compile(r"(\d+(?:\.\d+)?)\s*(?:minutes|minute|min)\b", re.IGNORECASE)


@dataclass(frozen=True)
class Facts:
    """Everything the narrative is allowed to assert, taken from the run's telemetry."""

    policy: str
    minutes: float
    path_m: float
    plant_contacts: int
    rmse: float
    dry_f1: float
    dry_recall: float
    calibration_95: float
    truth_dry_fraction: float
    probes_used: int
    valid_probes: int
    lane_coverage: float

    @classmethod
    def from_metrics(cls, metrics: dict[str, Any]) -> "Facts":
        map_m = metrics.get("map") or {}
        run_m = metrics.get("run") or {}

        def num(source: dict[str, Any], key: str) -> float:
            value = source.get(key)
            return float(value) if value is not None else 0.0

        return cls(
            policy=str(metrics.get("policy", "unknown")),
            minutes=num(run_m, "mission_time_s") / 60.0,
            path_m=num(run_m, "path_length_m"),
            plant_contacts=int(num(run_m, "plant_contacts")),
            rmse=num(map_m, "rmse"),
            dry_f1=num(map_m, "dry_f1"),
            dry_recall=num(map_m, "dry_recall"),
            calibration_95=num(map_m, "calibration_95"),
            truth_dry_fraction=num(map_m, "truth_dry_fraction"),
            probes_used=int(num(run_m, "probes_used")),
            valid_probes=int(num(run_m, "valid_probes")),
            lane_coverage=num(run_m, "lane_coverage"),
        )

    @property
    def probe_success(self) -> float:
        """Share of probes that returned a value (0.0 when nothing was probed)."""
        return self.valid_probes / self.probes_used if self.probes_used else 0.0

    @property
    def verdict(self) -> str:
        """SUCCESS, PARTIAL or FAIL, decided from the metrics alone.

        Combines our thresholds (dry F1 / RMSE) with upstream's rules: a plant
        contact is a hard FAIL; a map that finds under 30% of the truly dry area,
        or fewer than 80% of probes returning a value, downgrades to PARTIAL.
        """
        if self.plant_contacts > 0:
            return "FAIL"
        status = "SUCCESS"
        if self.truth_dry_fraction > 0.01 and self.dry_recall < 0.3:
            status = "PARTIAL"
        if self.probes_used and self.valid_probes / self.probes_used < 0.8:
            status = "PARTIAL"
        if not (self.dry_f1 >= SUCCESS_DRY_F1 and self.rmse <= SUCCESS_MAX_RMSE):
            status = "PARTIAL"
        return status

    def as_block(self) -> str:
        return f"""### VERIFIED TELEMETRY (computed in code; do not contradict or recompute)
- Mission verdict: {self.verdict}
- Policy used: {self.policy}
- Plant contacts: {self.plant_contacts} (0 means no plant was touched at all)
- Mission time: {self.minutes:.2f} minutes
- Path length: {self.path_m:.2f} metres
- Probes that returned a value: {self.valid_probes} of {self.probes_used}
  ({self.probe_success:.0%})
- Share of the lanes driven: {self.lane_coverage:.0%}
- Map error (RMSE): {self.rmse:.4f} VWC
- Dry-zone F1: {self.dry_f1:.2f}
- Dry-cell recall: {self.dry_recall:.2f}
- Calibration (95% band): {self.calibration_95:.2f}
- Truth dry fraction: {self.truth_dry_fraction:.2%}

Rules: use only the numbers above; do not invent a duration, a target, or an event that is not
listed; if the telemetry does not say something, write that it is unknown. Do not claim a plant
contact unless the number above is greater than 0."""


def load_run_data(run_dir: Path) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """The run's config and metrics, plus the 10 driest probes."""
    data: dict[str, Any] = {}
    config_path = run_dir / "config.yaml"
    if config_path.is_file():
        data["config"] = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    metrics_path = run_dir / "metrics.json"
    if metrics_path.is_file():
        data["metrics"] = json.loads(metrics_path.read_text(encoding="utf-8"))

    hotspots: list[dict[str, str]] = []
    probes_path = run_dir / "probes.csv"
    if probes_path.is_file():
        with probes_path.open(encoding="utf-8", newline="") as f:
            probes = [row for row in csv.DictReader(f) if row.get("valid", "").lower() == "true"]
        try:
            hotspots = sorted(probes, key=lambda x: float(x["value_vwc"]))[:10]
        except (ValueError, KeyError):
            hotspots = probes[:10]
    return data, hotspots


def mission_verdict(run: dict[str, Any], soil_map: dict[str, Any]) -> tuple[str, list[str]]:
    """Upstream's rule-based verdict, kept for compatibility.

    Returns (status, reasons) where status is SUCCESS, PARTIAL or FAIL.
    """
    reasons: list[str] = []
    status = "SUCCESS"
    if run.get("plant_contacts", 0) > 0:
        status = "FAIL"
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
    if not reasons:
        reasons = ["no plant contacts, and the dry area was found"]
    return status, reasons


def generate_prompt(facts: Facts, hotspots: list[dict[str, str]]) -> str:
    """The user message: fixed facts first, then what the narrative should cover."""
    lines = [f"- Pos({p['x_m']}, {p['y_m']}): {p['value_vwc']} VWC" for p in hotspots]
    return f"""
You are an Expert AI Agronomist and Precision Irrigation Consultant.
You have just received the mission telemetry from an autonomous soil-moisture survey rover.

{facts.as_block()}

### DETECTED HOTSPOTS (driest probes)
{chr(10).join(lines) if lines else "- none: every probe failed"}

### TASK
Write an "Executive Agronomist Mission Debrief" for a farm manager. Interpret the telemetry;
do not repeat it as a table. Report the mission verdict exactly as given above.

Cover, in this order:
1. **Mission Status**: restate the verdict above, and say what drove it.
2. **Irrigation Insight**: is the field generally healthy? Where are the critical dry zones, and
   how urgent are they?
3. **Confidence Assessment**: how much should the farm manager trust this map, using RMSE and
   calibration?
4. **Action Plan**: specific, checkable actions (for example "inspect the emitter near
   Pos(x, y)").
5. **Operational Efficiency**: comment on mission time and probe success rate.

Tone: professional, actionable, and honest about uncertainty. Never state a number that is not
in the verified telemetry above.
"""


def validate_report(text: str, facts: Facts) -> list[str]:
    """Contradictions between the narrative and the telemetry (empty list when consistent)."""
    problems: list[str] = []
    if facts.plant_contacts == 0:
        for pattern in CONTACT_CONTRADICTIONS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                problems.append(
                    f"claims a plant contact ({match.group(0)!r}) but the telemetry reports 0"
                )
                break
    status_claim = re.search(VERDICT_LINE, text, re.IGNORECASE)
    if (
        status_claim
        and facts.verdict != "SUCCESS"
        and re.search(r"\bsucc(?:ess|essful|eeded)\b", status_claim.group(0), re.IGNORECASE)
    ):
        problems.append(f"calls the mission a success, but the verdict is {facts.verdict}")
    if (
        status_claim
        and facts.verdict == "FAIL"
        and re.search(r"\b(?:partial|success\w*)\b", status_claim.group(0), re.IGNORECASE)
    ):
        problems.append("does not report the mission as failed (it touched plants)")

    for value in DURATION.findall(text):
        minutes = float(value)
        if abs(minutes - facts.minutes) > DURATION_TOLERANCE_MIN:
            problems.append(
                f"states a duration of {minutes:g} minutes; the telemetry says "
                f"{facts.minutes:.2f} minutes"
            )
            break
    return problems


def verified_header(facts: Facts) -> str:
    """The code-computed status, written before anything the model produced."""
    return f"""# Executive Agronomist Mission Debrief

**Mission status: {facts.verdict}** (computed from the telemetry, not from the narrative below)

| Field | Value |
|---|---|
| Plant contacts | {facts.plant_contacts} |
| Mission time | {facts.minutes:.2f} min |
| Path length | {facts.path_m:.1f} m |
| Probes with a value | {facts.valid_probes} / {facts.probes_used} |
| Map error (RMSE) | {facts.rmse:.4f} VWC |
| Dry-zone F1 | {facts.dry_f1:.2f} |
| Calibration (95%) | {facts.calibration_95:.2f} |
"""


def render_report(facts: Facts, narrative: str, problems: list[str]) -> str:
    """The final file: computed verdict, then prose, then any unresolved contradictions."""
    parts = [
        verified_header(facts),
        "",
        "---",
        "",
        "### Agronomist narrative (AI-generated)",
        "",
        narrative.strip(),
    ]
    if problems:
        parts += [
            "",
            "---",
            "",
            "> **Validation notes**: the narrative below disagreed with the telemetry. Correct the",
            "> report from the table above, do not trust these sentences.",
            "",
            *[f"> - {p}" for p in problems],
        ]
    return "\n".join(parts).rstrip() + "\n"


def ask_model(client: OpenAI, model: str, facts: Facts, hotspots: list[dict[str, str]]) -> str:
    """One narrative, then one corrective rewrite if it contradicts the telemetry."""
    system = "You are an Expert AI Agronomist and Precision Irrigation Consultant."
    prompt = generate_prompt(facts, hotspots)
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    response = client.chat.completions.create(model=model, messages=messages)  # type: ignore[arg-type]
    text = (response.choices[0].message.content or "").strip()
    problems = validate_report(text, facts)
    if not problems:
        return text

    print(f"Debrief contradicted the telemetry ({len(problems)} issue(s)); asking for a rewrite.")
    messages += [
        {"role": "assistant", "content": text},
        {
            "role": "user",
            "content": (
                "That draft contradicts the verified telemetry:\n"
                + "\n".join(f"- {p}" for p in problems)
                + "\nRewrite the whole debrief, keeping the same sections, and fix exactly these."
            ),
        },
    ]
    response = client.chat.completions.create(model=model, messages=messages)  # type: ignore[arg-type]
    return (response.choices[0].message.content or "").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="AI Agronomist Mission Debrief Generator")
    parser.add_argument("run_dir", type=str, help="Path to the agrisim run folder")
    parser.add_argument("--output", type=str, default="debrief.md", help="Output filename")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help="Local model name")
    parser.add_argument("--url", type=str, default=DEFAULT_URL, help="Ollama OpenAI-compatible URL")
    parser.add_argument(
        "--print-prompt", action="store_true", help="Print the prompt and exit (no model call)"
    )
    args = parser.parse_args()

    run_path = Path(args.run_dir)
    if not run_path.is_dir():
        print(f"Error: {args.run_dir} is not a directory.", file=sys.stderr)
        return 2

    print(f"Reading telemetry from {run_path}...")
    data, hotspots = load_run_data(run_path)
    metrics = data.get("metrics")
    if not isinstance(metrics, dict) or "map" not in metrics:
        print(f"Error: {run_path} has no usable metrics.json.", file=sys.stderr)
        return 2
    facts = Facts.from_metrics(metrics)
    print(f"Verified verdict: {facts.verdict} (plant contacts {facts.plant_contacts})")

    if args.print_prompt:
        print(generate_prompt(facts, hotspots))
        return 0

    print(f"Consulting local AI agronomist ({args.model}) at {args.url}...")
    try:
        client = OpenAI(base_url=args.url, api_key="ollama")  # dummy key for a local server
        narrative = ask_model(client, args.model, facts, hotspots)
    except Exception as exc:
        print(f"Error talking to the local LLM: {exc}", file=sys.stderr)
        return 3

    problems = validate_report(narrative, facts)
    output_path = run_path / args.output
    output_path.write_text(render_report(facts, narrative, problems), encoding="utf-8")
    print(f"Debrief written to: {output_path}")
    if problems:
        print(
            f"Warning: {len(problems)} unverified claim(s) are flagged at the end.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
