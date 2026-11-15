"""Run store: one folder per run (written by io.save_run) plus a SQLite index of those folders.

The folders stay the record; `runs.sqlite` in the store root lists them with the verdict each run
was given when it was stored, so a later rules change never rewrites an old verdict. `backfill`
indexes folders that were written before the store existed (by `agrisim run`, for example).
"""

import json
import re
import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from agrisim.verdict import Facts, RulesFile

STAMP = re.compile(r"(\d{8}T\d{6}Z)_seed")  # io.run_dir_name
SCHEMA = """CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,           -- folder path relative to the store root, with '/'
    created TEXT NOT NULL,         -- ISO 8601 UTC
    field TEXT,                    -- scenario file, when the run was started from the app
    policy TEXT NOT NULL,
    seed INTEGER,
    verdict TEXT NOT NULL,
    why TEXT NOT NULL,
    rules_version INTEGER NOT NULL,
    metrics TEXT NOT NULL          -- metrics.json as written
)"""


class RunStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.file = root / "runs.sqlite"
        with self._db() as db:
            db.execute(SCHEMA)

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        """One connection per call: the app writes from worker threads."""
        with closing(sqlite3.connect(self.file)) as db, db:
            db.row_factory = sqlite3.Row
            yield db

    def add(self, run_dir: Path, rules: RulesFile, field: str | None = None) -> str:
        """Index a finished run folder, judging it with `rules`; returns its id."""
        metrics = json.loads((run_dir / "metrics.json").read_text(encoding="utf-8"))
        facts = Facts.from_metrics(rules.rules, metrics)
        stamp = STAMP.search(run_dir.name)
        created = (
            datetime.strptime(stamp.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
            if stamp
            else datetime.fromtimestamp((run_dir / "metrics.json").stat().st_mtime, UTC)
        )
        run_id = run_dir.resolve().relative_to(self.root.resolve()).as_posix()
        with self._db() as db:
            db.execute(
                "INSERT OR REPLACE INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    run_id,
                    created.isoformat(timespec="seconds"),
                    field,
                    facts.policy,
                    metrics.get("seed"),
                    facts.verdict,
                    facts.why,
                    rules.version,
                    json.dumps(metrics),
                ),
            )
        return run_id

    def backfill(self, rules: RulesFile) -> int:
        """Index every run folder under the root that is not indexed yet; returns how many."""
        with self._db() as db:
            known = {row["id"] for row in db.execute("SELECT id FROM runs")}
        added = 0
        for path in sorted(self.root.rglob("metrics.json")):
            run_dir = path.parent
            if run_dir.relative_to(self.root).as_posix() in known:
                continue
            try:
                metrics = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue  # a half-written or foreign file: not a run
            if isinstance(metrics, dict) and "map" in metrics and "run" in metrics:
                self.add(run_dir, rules)
                added += 1
        return added

    def runs(self) -> list[dict[str, Any]]:
        """Every stored run, newest first."""
        with self._db() as db:
            rows = db.execute("SELECT * FROM runs ORDER BY created DESC, id DESC").fetchall()
        return [_row(r) for r in rows]

    def get(self, run_id: str) -> dict[str, Any] | None:
        with self._db() as db:
            row = db.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        return _row(row) if row else None

    def folder(self, run_id: str) -> Path | None:
        """The run's folder, only for an id the store knows (ids come from untrusted requests)."""
        return self.root / run_id if self.get(run_id) else None


def _row(row: sqlite3.Row) -> dict[str, Any]:
    out = dict(row)
    out["metrics"] = json.loads(out["metrics"])
    return out
