"""A survey's verdict, decided in code from its metrics and the rules in a verdict_rules.yaml.

A language model is good at explaining a result and bad at deciding one, so the verdict and its
reasons come from here; the debrief (ai_agronomist/) only writes prose under them.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field


class Rules(BaseModel):
    """The limits a survey must meet. Every value is validated: the app lets an admin edit them."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    max_plant_contacts: int = Field(ge=0)
    max_rmse: float = Field(gt=0, le=1)
    min_dry_recall: float = Field(ge=0, le=1)
    min_dry_f1: float = Field(ge=0, le=1)
    min_probe_success: float = Field(ge=0, le=1)
    dry_area_to_judge: float = Field(ge=0, le=1)


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid")

    at: str
    by: str = Field(min_length=1, max_length=80)
    note: str = Field(max_length=500)


class RulesFile(BaseModel):
    """The rules plus their change log; the version is the number of changes."""

    model_config = ConfigDict(extra="forbid")

    rules: Rules
    changes: list[Change] = Field(min_length=1)

    @property
    def version(self) -> int:
        return len(self.changes)


def load_rules(path: Path) -> RulesFile:
    return RulesFile.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def save_rules(path: Path, current: RulesFile, rules: Rules, by: str, note: str) -> RulesFile:
    """Write `rules` to `path` with one more change-log entry that names every changed value."""
    old, new = current.rules.model_dump(), rules.model_dump()
    diff = ", ".join(f"{k} {old[k]} -> {new[k]}" for k in new if new[k] != old[k])
    entry = Change(
        at=datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
        by=by,
        note=f"{note.strip()} ({diff or 'no value changed'})".lstrip(),
    )
    saved = RulesFile(rules=rules, changes=[*current.changes, entry])
    path.write_text(
        yaml.safe_dump(saved.model_dump(), sort_keys=False, allow_unicode=True), encoding="utf-8"
    )
    return saved


@dataclass(frozen=True)
class Facts:
    """Everything the verdict and the narrative may assert, taken from the run's telemetry."""

    rules: Rules
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
    def from_metrics(cls, rules: Rules, metrics: dict[str, Any]) -> "Facts":
        map_m = metrics.get("map") or {}
        run_m = metrics.get("run") or {}

        def num(source: dict[str, Any], key: str) -> float:
            value = source.get(key)
            return float(value) if value is not None else 0.0

        return cls(
            rules=rules,
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

        Touching plants beyond the limit is a hard FAIL. SUCCESS means no shortfall at all.
        Anything else is PARTIAL.
        """
        if self.plant_contacts > self.rules.max_plant_contacts:
            return "FAIL"
        return "PARTIAL" if self.shortfalls else "SUCCESS"

    @property
    def shortfalls(self) -> list[str]:
        """Why the mission is not a SUCCESS, in plain words (empty for a SUCCESS). The model is
        given these: left to guess, it invents a reason (it once blamed "0 plant contacts")."""
        r = self.rules
        out = []
        if self.plant_contacts > r.max_plant_contacts:
            out.append(
                f"the rover touched plants {self.plant_contacts} time(s); "
                f"the limit is {r.max_plant_contacts}"
            )
        # A field with no dry zone has no dry scores (metrics.json holds null): not a shortfall.
        if self.truth_dry_fraction > r.dry_area_to_judge:
            if self.dry_recall < r.min_dry_recall:
                out.append(
                    f"the map found only {self.dry_recall:.0%} of the truly dry area "
                    f"(at least {r.min_dry_recall:.0%} is needed)"
                )
            elif self.dry_f1 < r.min_dry_f1:
                out.append(
                    f"dry-zone F1 is {self.dry_f1:.2f} (at least {r.min_dry_f1:.2f} is needed)"
                )
        if self.probes_used and self.probe_success < r.min_probe_success:
            out.append(
                f"only {self.valid_probes} of {self.probes_used} probes returned a value "
                f"(at least {r.min_probe_success:.0%} is needed)"
            )
        if self.rmse > r.max_rmse:
            out.append(f"map error (RMSE) is {self.rmse:.4f} VWC (at most {r.max_rmse} is allowed)")
        return out

    @property
    def why(self) -> str:
        """One sentence explaining the verdict."""
        return "; ".join(self.shortfalls) or "no plant was touched and every target was met"
