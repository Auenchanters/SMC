"""Gymnasium environment for adaptive probing, MaskablePPO training and the learned policy.

The REWARD in `AdaptiveProbingEnv.step` is the only place in this module that reads the ground
truth (`self._truth_grid`). Observations are built from probe readings only, by the same
function the learned policy uses inside `run_survey`.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
import numpy.typing as npt
import torch
from gymnasium import spaces
from sb3_contrib import MaskablePPO
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv, VecEnv
from torch import nn

from agrisim.config import SimConfig
from agrisim.field import FieldLayout, ProbeSite
from agrisim.mapping import GridSpec, KrigingMapper
from agrisim.metrics import truth_on_grid
from agrisim.planning import LaneGraph
from agrisim.policies import Context
from agrisim.sensor import MoistureProbe, ProbeReading
from agrisim.sim import world_rngs
from agrisim.soil import SoilTruth

FloatArray = npt.NDArray[np.float64]
Obs = npt.NDArray[np.float32]
N_CHANNELS = 6  # mean, variance, visited, rover position, budget left, time
OBS_LIMIT = 10.0
TRAIN_SEED_OFFSET = 1000  # training episodes use seeds >= 1000; keep evaluation seeds below


def estimate(
    cfg: SimConfig, grid: GridSpec, readings: tuple[ProbeReading, ...]
) -> tuple[FloatArray, FloatArray]:
    """Kriging map from readings; the config prior (mean_vwc, std_vwc^2) where undefined."""
    mapper = KrigingMapper(cfg.mapping)
    for r in readings:
        mapper.update(r)
    mean, var = mapper.estimate(grid)
    mean = np.where(np.isfinite(mean), mean, cfg.soil.mean_vwc)
    var = np.where(np.isfinite(var), var, cfg.soil.std_vwc**2)
    return mean, var


@dataclass(frozen=True, eq=False)
class ObsBuilder:
    cfg: SimConfig
    grid: GridSpec
    budget: int

    def cell(self, x: npt.ArrayLike, y: npt.ArrayLike) -> tuple[npt.NDArray[np.intp], ...]:
        g = self.grid
        col = np.clip((np.asarray(x) / g.resolution).astype(np.intp), 0, g.nx - 1)
        row = np.clip((np.asarray(y) / g.resolution).astype(np.intp), 0, g.ny - 1)
        return row, col

    def build(
        self,
        mean: FloatArray,
        var: FloatArray,
        probed_xy: FloatArray,
        position: tuple[float, float],
        probes_used: int,
        t: float,
    ) -> Obs:
        c, s = self.cfg, self.cfg.soil
        obs = np.zeros((N_CHANNELS, self.grid.ny, self.grid.nx), dtype=np.float32)
        obs[0] = (mean - s.mean_vwc) / s.std_vwc
        obs[1] = var / s.std_vwc**2
        if len(probed_xy):
            obs[2][self.cell(probed_xy[:, 0], probed_xy[:, 1])] = 1.0
        obs[3][self.cell(position[0], position[1])] = 1.0
        obs[4] = 1.0 - probes_used / self.budget
        leg_time = (
            c.probe.insertion_time_s + (c.field.length_x + c.field.width_y) / c.rover.max_speed
        )
        obs[5] = t / (self.budget * leg_time)
        return np.clip(obs, -OBS_LIMIT, OBS_LIMIT)

    @property
    def space(self) -> spaces.Box:
        shape = (N_CHANNELS, self.grid.ny, self.grid.nx)
        return spaces.Box(-OBS_LIMIT, OBS_LIMIT, shape, dtype=np.float32)


class AdaptiveProbingEnv(gym.Env[Obs, np.int64]):
    """Each episode: a fresh field and soil truth; each step: travel to a site and probe it.

    Travel follows the lane graph; its time is distance / max_speed (the kinematic drive is not
    stepped here, for speed). Reward = reward_scale * (RMSE before - RMSE after)
    - time_penalty * travel time (s).
    """

    def __init__(
        self,
        cfg: SimConfig,
        budget: int | None = None,
        time_penalty: float = 1e-3,
        reward_scale: float = 100.0,
    ) -> None:
        self.cfg = cfg
        self.budget = cfg.survey.probe_budget if budget is None else budget
        self.time_penalty = time_penalty
        self.reward_scale = reward_scale
        self.grid = GridSpec.for_field(cfg.field, cfg.mapping.output_resolution)
        self.obs_builder = ObsBuilder(cfg, self.grid, self.budget)
        n_sites = len(self._sites(FieldLayout.generate(cfg.field, np.random.default_rng(0))))
        self.n_sites = n_sites
        self.action_space = spaces.Discrete(n_sites)
        self.observation_space = self.obs_builder.space
        self.probe = MoistureProbe(cfg.probe)

    def _sites(self, layout: FieldLayout) -> tuple[ProbeSite, ...]:
        return tuple(layout.candidate_probe_sites(self.cfg.survey.candidate_spacing))

    def _obs(self) -> Obs:
        xy = np.array([(r.x, r.y) for r in self._readings]).reshape(-1, 2)
        return self.obs_builder.build(
            self._mean, self._var, xy, (self._here.x, self._here.y), len(self._readings), self._t
        )

    def _rmse(self) -> float:
        # Ground truth read here, for the reward only.
        return float(np.sqrt(((self._mean - self._truth_grid) ** 2).mean()))

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[Obs, dict[str, Any]]:
        super().reset(seed=seed)
        if options and "episode_seed" in options:
            ep_seed = int(options["episode_seed"])
        else:
            ep_seed = int(self.np_random.integers(TRAIN_SEED_OFFSET, 2**31 - 1))
        rng_field, rng_soil, self._rng_probe, *_ = world_rngs(ep_seed)
        layout = FieldLayout.generate(self.cfg.field, rng_field)
        self._sites_now = self._sites(layout)
        if len(self._sites_now) != self.n_sites:
            raise RuntimeError("candidate-site count changed between episodes")
        self._truth = SoilTruth.generate(self.cfg.soil, layout, rng_soil)
        self._truth_grid = truth_on_grid(self._truth, self.grid)
        self._graph = LaneGraph.from_layout(layout)
        self._here = self._graph.start_site()
        self._visited = np.zeros(len(self._sites_now), dtype=bool)
        self._readings: tuple[ProbeReading, ...] = ()
        self._t = 0.0
        self._mean, self._var = estimate(self.cfg, self.grid, self._readings)
        return self._obs(), {"episode_seed": ep_seed}

    def action_masks(self) -> npt.NDArray[np.bool_]:
        return ~self._visited

    def step(self, action: np.int64) -> tuple[Obs, float, bool, bool, dict[str, Any]]:
        site = self._sites_now[int(action)]
        travel = float(self._graph.distances(self._here, [site])[0]) / self.cfg.rover.max_speed
        self._t += travel + self.cfg.probe.insertion_time_s
        reading = self.probe.read(self._truth, site.x, site.y, self._t, self._rng_probe)
        self._readings += (reading,)
        self._visited[int(action)] = True
        self._here = site
        before = self._rmse()
        self._mean, self._var = estimate(self.cfg, self.grid, self._readings)
        after = self._rmse()
        reward = self.reward_scale * (before - after) - self.time_penalty * travel
        done = len(self._readings) >= self.budget or bool(self._visited.all())
        info = {"rmse": after, "time_s": self._t, "travel_s": travel}
        return self._obs(), float(reward), done, False, info


class SmallCNN(BaseFeaturesExtractor):
    """Three conv layers and a linear layer; small enough for CPU training."""

    def __init__(self, observation_space: spaces.Box, features_dim: int = 128) -> None:
        super().__init__(observation_space, features_dim)
        c = observation_space.shape[0]
        self.cnn = nn.Sequential(
            nn.Conv2d(c, 16, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(16, 32, 3, stride=2, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 32, 3, stride=2, padding=1),
            nn.ReLU(),
            nn.Flatten(),
        )
        with torch.no_grad():
            n = self.cnn(torch.zeros(1, *observation_space.shape)).shape[1]
        self.linear = nn.Sequential(nn.Linear(n, features_dim), nn.ReLU())

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        out: torch.Tensor = self.linear(self.cnn(obs))
        return out


def train(
    cfg: SimConfig, timesteps: int, seed: int, out: Path, budget: int, n_envs: int = 1
) -> Path:
    """Train MaskablePPO; write model.zip and train_meta.json into `out`. Returns the model path."""
    out.mkdir(parents=True, exist_ok=True)

    def make() -> gym.Env[Obs, np.int64]:
        return Monitor(AdaptiveProbingEnv(cfg, budget))

    fns: list[Callable[[], gym.Env[Any, Any]]] = [make] * n_envs
    # Windows has no fork: subprocess envs must use spawn.
    venv: VecEnv = SubprocVecEnv(fns, start_method="spawn") if n_envs > 1 else DummyVecEnv(fns)
    venv.seed(seed)
    model = MaskablePPO(
        "MlpPolicy",
        venv,
        n_steps=max(64, 1024 // n_envs),
        batch_size=64,
        ent_coef=0.01,
        policy_kwargs={
            "features_extractor_class": SmallCNN,
            "features_extractor_kwargs": {"features_dim": 128},
            "net_arch": {"pi": [256], "vf": [256]},
        },
        seed=seed,
        device="cpu",
        verbose=1,
    )
    model.learn(total_timesteps=timesteps)
    venv.close()
    path = out / "model.zip"
    model.save(path)
    meta = {"timesteps": timesteps, "seed": seed, "budget": budget, "n_envs": n_envs}
    (out / "train_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return path


@dataclass(frozen=True, eq=False)
class LearnedPolicy:
    """A trained MaskablePPO model used as a probing strategy inside `run_survey`."""

    model: MaskablePPO
    cfg: SimConfig

    @classmethod
    def load(cls, path: Path, cfg: SimConfig) -> "LearnedPolicy":
        return cls(MaskablePPO.load(path, device="cpu"), cfg)

    def choose(self, ctx: Context) -> int:
        grid = GridSpec.for_field(self.cfg.field, self.cfg.mapping.output_resolution)
        mean, var = estimate(self.cfg, grid, ctx.readings)
        xy = np.array([(r.x, r.y) for r in ctx.readings]).reshape(-1, 2)
        t = ctx.readings[-1].t if ctx.readings else 0.0
        obs = ObsBuilder(self.cfg, grid, ctx.budget).build(
            mean, var, xy, (ctx.position.x, ctx.position.y), len(ctx.readings), t
        )
        action, _ = self.model.predict(obs, deterministic=True, action_masks=~ctx.visited)
        return int(action)
