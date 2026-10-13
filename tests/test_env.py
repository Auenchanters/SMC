from pathlib import Path

import numpy as np
from gymnasium.utils.env_checker import check_env
from typer.testing import CliRunner

from agrisim.cli import app
from agrisim.config import SimConfig
from agrisim.env import AdaptiveProbingEnv


def test_check_env(cfg: SimConfig) -> None:
    check_env(AdaptiveProbingEnv(cfg, budget=6), skip_render_check=True)


def test_episode_masks_and_determinism(cfg: SimConfig) -> None:
    def episode() -> tuple[list[float], np.ndarray]:
        env = AdaptiveProbingEnv(cfg, budget=6)
        obs, _ = env.reset(options={"episode_seed": 5})
        rewards, done = [], False
        while not done:
            mask = env.action_masks()
            a = int(np.flatnonzero(mask)[-1])
            obs, r, done, _, _ = env.step(np.int64(a))
            assert not env.action_masks()[a]
            rewards.append(r)
        assert env.observation_space.contains(obs)
        return rewards, obs

    (r1, o1), (r2, o2) = episode(), episode()
    assert len(r1) == 6
    assert r1 == r2 and np.array_equal(o1, o2)


def test_train_and_eval_smoke(tmp_path: Path, demo_path: Path) -> None:
    runner = CliRunner()
    cfg_args = ["--config", str(demo_path)]
    res = runner.invoke(
        app,
        ["train", *cfg_args, "--timesteps", "128", "--budget", "4", "--out", str(tmp_path / "m")],
    )
    assert res.exit_code == 0, res.output
    model = tmp_path / "m" / "model.zip"
    assert model.exists()
    args = ["eval", "--model", str(model), *cfg_args, "--seeds", "100", "--budget", "4"]
    res = runner.invoke(app, [*args, "--out", str(tmp_path / "e")])
    assert res.exit_code == 0, res.output
    header = next(line for line in res.output.splitlines() if line.startswith("| metric"))
    assert header.endswith("| ppo |")
    bad = runner.invoke(app, [*args[:-4], "--seeds", "1000", "--budget", "4"])
    assert bad.exit_code != 0
