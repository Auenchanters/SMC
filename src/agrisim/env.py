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
from agrisim.field import FieldLayout, lane_sites
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
        sd = s.std_vwc or 1.0  # a flat test field (std_vwc 0) must not give NaN observations
        obs = np.zeros((N_CHANNELS, self.grid.ny, self.grid.nx), dtype=np.float32)
        obs[0] = (mean - s.mean_vwc) / sd
        obs[1] = var / sd**2
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
        # One action per lane site: a list fixed by the config. Sites too close to a plant in a
        # given field are masked, so plant dropout cannot change the number of actions.
        self.n_sites = n_actions(cfg)
        self.action_space = spaces.Discrete(self.n_sites)
        self.observation_space = self.obs_builder.space
        self.probe = MoistureProbe(cfg.probe)

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
        for _ in range(100):  # a field where every site is too close to a plant has no action
            rng_field, rng_soil, self._rng_probe, *_ = world_rngs(ep_seed)
            layout = FieldLayout.generate(self.cfg.field, rng_field)
            self._sites_now = tuple(layout.lane_sites(self.cfg.survey.candidate_spacing))
            self._ok = layout.site_ok(list(self._sites_now))
            if self._ok.any():
                break
            ep_seed = int(self.np_random.integers(TRAIN_SEED_OFFSET, 2**31 - 1))
        else:
            raise ValueError(
                "no probe site is at least field.stem_keepout from every plant in 100 fields; "
                "lower stem_keepout or candidate_spacing"
            )
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
        return ~self._visited & self._ok

    def step(self, action: np.int64) -> tuple[Obs, float, bool, bool, dict[str, Any]]:
        a = int(action)
        if not 0 <= a < self.n_sites:  # -1 would silently probe the last site
            raise ValueError(f"action {a} out of range [0, {self.n_sites})")
        if not self._ok[a]:
            raise ValueError(f"action {a} is a site within stem_keepout of a plant (masked)")
        site = self._sites_now[a]
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
        done = len(self._readings) >= self.budget or not self.action_masks().any()
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
    AdaptiveProbingEnv(cfg, budget).reset(seed=seed)  # a config with no usable site fails here
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
        """Load and check the model fits this config's field before any run starts."""
        try:
            model = MaskablePPO.load(path, device="cpu")
        except Exception as exc:  # zip, pickle and torch errors all mean "not a model"
            raise ValueError(f"{path} is not a MaskablePPO model.zip ({exc})") from None
        grid = GridSpec.for_field(cfg.field, cfg.mapping.output_resolution)
        want_obs = ObsBuilder(cfg, grid, 1).space.shape
        want_n = n_actions(cfg)
        got_obs = model.observation_space.shape
        got_n = int(getattr(model.action_space, "n", -1))
        if got_obs != want_obs or got_n != want_n:
            raise ValueError(
                f"model {path} was trained for a different field: it expects observations "
                f"{got_obs} and {got_n} sites, this config gives {want_obs} and {want_n}"
            )
        return cls(model, cfg)

    def choose(self, ctx: Context) -> int:
        grid = GridSpec.for_field(self.cfg.field, self.cfg.mapping.output_resolution)
        mean, var = estimate(self.cfg, grid, ctx.readings)
        xy = np.array([(r.x, r.y) for r in ctx.readings]).reshape(-1, 2)
        t = ctx.readings[-1].t if ctx.readings else 0.0
        obs = ObsBuilder(self.cfg, grid, ctx.budget).build(
            mean, var, xy, (ctx.position.x, ctx.position.y), len(ctx.readings), t
        )
        # The model's actions are every lane site; ctx.sites leaves out those near a plant.
        g = ctx.graph
        every = lane_sites(g.lane_y, g.x_west, g.x_east, self.cfg.survey.candidate_spacing)
        index = {(s.lane, round(s.x, 6)): i for i, s in enumerate(every)}
        mine = np.array([index[(s.lane, round(s.x, 6))] for s in ctx.sites], dtype=np.intp)
        mask = np.zeros(len(every), dtype=bool)
        mask[mine] = ~ctx.visited
        action, _ = self.model.predict(obs, deterministic=True, action_masks=mask)
        return int(np.flatnonzero(mine == int(action))[0])


def n_actions(cfg: SimConfig) -> int:
    """Number of lane sites (actions) for a config; the same for every field it generates."""
    layout = FieldLayout.generate(cfg.field, np.random.default_rng(0))
    return len(layout.lane_sites(cfg.survey.candidate_spacing))
