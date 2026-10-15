# Seeded demo: one survey with the Rerun viewer, then a small benchmark.
# Run from the repository root:  .\scripts\demo.ps1
# Stops at the first failing step, like demo.sh (PowerShell does not stop on a failing program).
$ErrorActionPreference = "Stop"
function Step([string]$what) {
    if ($LASTEXITCODE -ne 0) { Write-Error "demo stopped: $what failed (exit code $LASTEXITCODE)" }
}
uv sync
Step "uv sync"
uv run agrisim run --config configs/demo.yaml --seed 7 --rerun
Step "agrisim run"
uv run agrisim bench --config configs/demo.yaml --seeds 0-9 --budget 30 --workers 4
Step "agrisim bench"
