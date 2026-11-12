"""Check and fit agrisim's soil-water physics against two years of real field data.

Data: the Cook Agronomy Farm sensor network (Pullman, Washington, USA): 42 stations in a 37 ha
field, daily volumetric water content at 0.3 m depth, with daily rain and air temperature, 2011 and
2012 (Gasch et al. 2015, Spatial Statistics 14:70-90). The copy used here ships with the R package
GSIF (https://github.com/cran/GSIF, data/cookfarm.rda). The data file is downloaded when the script
runs; it is not part of this repository.

What it does:
  1. Fits the physical model (weather.water_balance) and the simple bucket to each station's 2011
     growing season, then scores both on the unseen 2012 season as a free-running forecast from
     the first day's reading.
  2. Fits one parameter set to all stations, for configs/scenarios/cookfarm_fit.yaml.
  3. Measures how moisture varies across the field (spread and variogram range).

Run (the extra packages are only needed here, not by agrisim):
    uv run --with rdata --with pandas python scripts/calibrate_cookfarm.py --out runs/cookfarm

The site is a rain-fed wheat field on silt loam in a cool climate, not a drip-irrigated tomato field
in Karnataka. The fit tests the model's form; the fitted numbers are that site's, not ours.
"""

import argparse
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

from agrisim.config import PhysicalSoilConfig
from agrisim.weather import water_balance

URL = "https://raw.githubusercontent.com/cran/GSIF/master/data/cookfarm.rda"
LATITUDE = math.radians(46.78)
SEASON = (105, 288)  # day of year: 15 April to 15 October (no snow or frozen soil)
EPOCH = np.datetime64("1970-01-01")


def extraterrestrial_mm(doy: np.ndarray) -> np.ndarray:
    """Daily extraterrestrial radiation as mm of evaporation (FAO-56 eq. 21)."""
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365)
    decl = 0.409 * np.sin(2 * np.pi * doy / 365 - 1.39)
    ws = np.arccos(-np.tan(LATITUDE) * np.tan(decl))
    ra = (24 * 60 / np.pi * 0.0820 * dr) * (
        ws * np.sin(LATITUDE) * np.sin(decl) + np.cos(LATITUDE) * np.cos(decl) * np.sin(ws)
    )
    return ra * 0.408


def hargreaves(doy: np.ndarray, tmax: np.ndarray, tmin: np.ndarray) -> np.ndarray:
    """Reference evapotranspiration, mm/day (Hargreaves & Samani 1985; FAO-56 eq. 52)."""
    tmean = (tmax + tmin) / 2
    return 0.0023 * extraterrestrial_mm(doy) * (tmean + 17.8) * np.sqrt(np.maximum(tmax - tmin, 0))


def load(path: Path) -> tuple[dict[str, np.ndarray], np.ndarray, np.ndarray, dict[str, tuple]]:
    import rdata

    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(URL, path)
    cf = rdata.read_rda(path)["cookfarm"]
    w = cf["weather"].sort_values("Date")
    days = w["Date"].to_numpy().astype(int)
    doy = np.array(
        [(EPOCH + np.timedelta64(d, "D")).astype(object).timetuple().tm_yday for d in days]
    )
    forcing = np.column_stack(
        [
            days,
            doy,
            w["Precip_wrcc"].fillna(0).to_numpy(),
            hargreaves(doy, w["MaxT_wrcc"].to_numpy(), w["MinT_wrcc"].to_numpy()),
        ]
    )
    r = cf["readings"]
    series = {}
    for sid, g in r.groupby("SOURCEID"):
        s = np.full(len(days), np.nan)
        idx = np.searchsorted(days, g["Date"].to_numpy().astype(int))
        s[idx] = g["Port1VW"].to_numpy()
        series[str(sid)] = s
    prof = cf["profiles"].groupby("SOURCEID").first()
    xy = {str(k): (float(v["Easting"]), float(v["Northing"])) for k, v in prof.iterrows()}
    return series, forcing, days, xy


def season(forcing: np.ndarray, year: int) -> np.ndarray:
    d = (EPOCH + forcing[:, 0].astype(int).astype("timedelta64[D]")).astype("datetime64[Y]").astype(
        int
    ) + 1970
    return np.flatnonzero((d == year) & (forcing[:, 1] >= SEASON[0]) & (forcing[:, 1] <= SEASON[1]))


def physical(x: np.ndarray) -> tuple[PhysicalSoilConfig, float]:
    ts, log_ks, b, kc, depth = x
    p = PhysicalSoilConfig(
        texture="silt_loam", theta_s=ts, ks_mm_per_h=10**log_ks, b=b, crop_coefficient=kc,
        depletion_fraction=0.55, et0_mm_per_day=0.0, diurnal=False,  # FAO-56 p for wheat
    )  # fmt: skip
    return p, depth


def run_physical(x: np.ndarray, v0: float, rain: np.ndarray, et0: np.ndarray) -> np.ndarray:
    try:
        p, depth = physical(x)
    except ValueError:
        return np.full(len(rain), 9.0)
    v, out = np.array([v0]), []
    for r, e in zip(rain, et0, strict=True):
        v = water_balance(v, r / 24, e / 24, 24.0, depth, p)
        out.append(float(v[0]))
    return np.array(out)


def run_bucket(x: np.ndarray, v0: float, rain: np.ndarray, et0: np.ndarray) -> np.ndarray:
    """agrisim's first model (weather._step): constant drying, linear drainage above capacity."""
    fc, drain_per_day, et_mm_per_day, depth = x
    v, out = v0, []
    for r in rain:
        v = v + (r - et_mm_per_day) / 1000 / depth
        v = v - max(v - fc, 0.0) * (1 - math.exp(-drain_per_day))
        v = min(max(v, 0.05), 0.55)
        out.append(v)
    return np.array(out)


MODELS = {
    "physical": (
        run_physical,
        [0.45, 0.5, 6.0, 0.9, 0.45],
        ([0.3, -1.5, 2.0, 0.2, 0.2], [0.6, 2.5, 14.0, 1.4, 0.9]),
    ),
    "bucket": (run_bucket, [0.30, 0.3, 2.0, 0.45], ([0.1, 0.0, 0.0, 0.2], [0.5, 5.0, 8.0, 0.9])),
}


def fit(name: str, obs: list[np.ndarray], rain: np.ndarray, et0: np.ndarray) -> np.ndarray:
    run, x0, bounds = MODELS[name]

    def resid(x: np.ndarray) -> np.ndarray:
        parts = []
        for o in obs:
            ok = ~np.isnan(o)
            first = int(np.flatnonzero(ok)[0])
            sim = run(x, o[first], rain[first + 1 :], et0[first + 1 :])
            parts.append((sim - o[first + 1 :])[ok[first + 1 :]])
        return np.concatenate(parts)

    best = None
    for scale in (1.0, 0.8, 1.2):  # a few starts: the surface has local minima
        start = np.clip(
            np.array(x0) * scale, np.array(bounds[0]) + 1e-6, np.array(bounds[1]) - 1e-6
        )
        res = least_squares(resid, start, bounds=bounds, loss="soft_l1", f_scale=0.02)
        if best is None or res.cost < best.cost:
            best = res
    assert best is not None
    return best.x


def rmse(name: str, x: np.ndarray, o: np.ndarray, rain: np.ndarray, et0: np.ndarray) -> float:
    ok = ~np.isnan(o)
    first = int(np.flatnonzero(ok)[0])
    sim = MODELS[name][0](x, o[first], rain[first + 1 :], et0[first + 1 :])
    return float(np.sqrt(np.mean((sim - o[first + 1 :])[ok[first + 1 :]] ** 2)))


def variogram(xy: np.ndarray, z: np.ndarray, edges: np.ndarray) -> np.ndarray:
    d = np.hypot(*(xy[:, None, :] - xy[None, :, :]).transpose(2, 0, 1))
    g = 0.5 * (z[:, None] - z[None, :]) ** 2
    iu = np.triu_indices(len(z), 1)
    which = np.digitize(d[iu], edges)
    return np.array(
        [g[iu][which == k].mean() if (which == k).any() else np.nan for k in range(1, len(edges))]
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("runs/cookfarm"))
    ap.add_argument("--data", type=Path, default=None, help="cookfarm.rda (downloaded if missing)")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    series, forcing, _, xy = load(a.data or a.out / "cookfarm.rda")
    train, test = season(forcing, 2011), season(forcing, 2012)
    rows, enough = [], 120  # days of data needed in each season
    for sid, s in sorted(series.items()):
        if (~np.isnan(s[train])).sum() < enough or (~np.isnan(s[test])).sum() < enough:
            continue
        row = {"station": sid}
        for name in MODELS:
            x = fit(name, [s[train]], forcing[train, 2], forcing[train, 3])
            row[f"{name}_train"] = rmse(name, x, s[train], forcing[train, 2], forcing[train, 3])
            row[f"{name}_test"] = rmse(name, x, s[test], forcing[test, 2], forcing[test, 3])
            row[f"{name}_x"] = [float(v) for v in x]
        # no model at all: the soil stays as it was on the first day
        o = s[test][~np.isnan(s[test])]
        row["persistence_test"] = float(np.sqrt(np.mean((o[1:] - o[0]) ** 2)))
        rows.append(row)
        print(f"{sid}  physical {row['physical_test']:.4f}  bucket {row['bucket_test']:.4f}  "
              f"no model {row['persistence_test']:.4f}", flush=True)  # fmt: skip

    stations = [r["station"] for r in rows]
    summary: dict[str, object] = {
        "stations": len(rows),
        "season_days": [len(train), len(test)],
    }
    for key in (
        "physical_train",
        "bucket_train",
        "physical_test",
        "bucket_test",
        "persistence_test",
    ):
        v = np.array([r[key] for r in rows])
        summary[key] = {
            "median": float(np.median(v)),
            "mean": float(v.mean()),
            "q25": float(np.quantile(v, 0.25)),
            "q75": float(np.quantile(v, 0.75)),
        }
    wins = sum(r["physical_test"] < r["bucket_test"] for r in rows)
    summary["physical_beats_bucket_on_test"] = f"{wins} of {len(rows)}"

    # One parameter set for the whole field (both models), fitted on 2011, scored on 2012.
    pooled = {}
    for name in MODELS:
        x = fit(name, [series[s][train] for s in stations], forcing[train, 2], forcing[train, 3])
        t = [rmse(name, x, series[s][test], forcing[test, 2], forcing[test, 3]) for s in stations]
        pooled[name] = {
            "x": [float(v) for v in x],
            "test_rmse_median": float(np.median(t)),
            "test_rmse_mean": float(np.mean(t)),
        }
    summary["pooled"] = pooled
    p, depth = physical(np.array(pooled["physical"]["x"]))
    wp, fc = p.limits()
    ts, ks, _, b = p.hydraulics()
    summary["pooled_physical_config"] = {
        "theta_s": round(ts, 3),
        "ks_mm_per_h": round(ks, 3),
        "b": round(b, 2),
        "crop_coefficient": round(p.crop_coefficient, 2),
        "layer_depth": round(depth, 2),
        "field_capacity": round(fc, 3),
        "wilting_point": round(wp, 3),
    }

    # Spatial structure: spread across stations each day, and the variogram of the season mean.
    m = np.array([series[s] for s in stations])
    both = np.concatenate([train, test])
    daily_sd = np.nanstd(m[:, both], axis=0)
    daily_mean = np.nanmean(m[:, both], axis=0)
    pts = np.array([xy[s] for s in stations])
    anomaly = np.nanmean(m[:, both] - daily_mean, axis=1)
    edges = np.array([0, 60, 120, 180, 240, 320, 400, 500])
    summary["spatial"] = {
        "sd_across_stations_median": float(np.nanmedian(daily_sd)),
        "sd_when_wet": float(np.nanmedian(daily_sd[daily_mean > np.nanquantile(daily_mean, 0.75)])),
        "sd_when_dry": float(np.nanmedian(daily_sd[daily_mean < np.nanquantile(daily_mean, 0.25)])),
        "nearest_station_spacing_m": float(
            np.median(
                np.sort(np.hypot(*(pts[:, None] - pts[None]).transpose(2, 0, 1)), axis=1)[:, 1]
            )
        ),
        "variogram_lag_m": [float(v) for v in (edges[:-1] + edges[1:]) / 2],
        "variogram": [float(v) for v in variogram(pts, anomaly, edges)],
        "variance": float(anomaly.var()),
    }
    (a.out / "cookfarm_fit.json").write_text(
        json.dumps({"summary": summary, "stations": rows}, indent=1), encoding="utf-8"
    )

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    order = np.argsort([r["physical_test"] for r in rows])
    show = [
        rows[order[len(order) // 2]],
        rows[order[len(order) // 4]],
        rows[order[3 * len(order) // 4]],
    ]
    fig, axes = plt.subplots(
        len(show) + 1, 1, figsize=(10, 11), sharex=True, gridspec_kw={"height_ratios": [1, 2, 2, 2]}
    )
    day = forcing[test, 1]
    axes[0].bar(day, forcing[test, 2], color="#2a78d6", width=1.0)
    axes[0].set_ylabel("rain, mm/day")
    axes[0].set_title(
        "Cook Agronomy Farm, 2012 season (not used for fitting): soil moisture at 0.3 m"
    )
    for ax, r in zip(axes[1:], show, strict=True):
        o = series[r["station"]][test]
        first = int(np.flatnonzero(~np.isnan(o))[0])
        ax.plot(day, o, color="#111", lw=2.2, label="measured")
        for name, colour in (("physical", "#1baf7a"), ("bucket", "#f0883e")):
            sim = MODELS[name][0](
                np.array(r[f"{name}_x"]),
                o[first],
                forcing[test, 2][first + 1 :],
                forcing[test, 3][first + 1 :],
            )
            label = "physical model" if name == "physical" else "simple bucket (first model)"
            ax.plot(
                day[first + 1 :],
                sim,
                color=colour,
                lw=1.8,
                label=f"{label}, RMSE {r[f'{name}_test']:.3f}",
            )
        ax.set_ylabel("VWC, m³/m³")
        ax.set_title(f"station {r['station']}", loc="left", fontsize=10)
        ax.legend(loc="lower left", fontsize=9, frameon=False)
        ax.grid(alpha=0.25)
    axes[-1].set_xlabel("day of year")
    fig.tight_layout()
    fig.savefig(a.out / "cookfarm_validation.png", dpi=130)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
