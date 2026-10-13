# Seeded demo: one survey with the Rerun viewer, then a small benchmark.
# Run from the repository root:  .\scripts\demo.ps1
uv sync
uv run agrisim run --config configs/demo.yaml --seed 7 --rerun
uv run agrisim bench --config configs/demo.yaml --seeds 0-9 --budget 30 --workers 4
