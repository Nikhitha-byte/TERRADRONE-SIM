"""
earth2_weather.py - forecast scenarios for a planned drone mission
==================================================================

Step 1 of the Drone Scout mission planner. Forecasts the weather at your
field for a launch window up to a few days ahead and writes:

  forecast_scenarios.json   every forecast scenario (ensemble member) for every
                            hour of the launch window -> input to mission_planner.cjs
  drone_scout_config.json   Flight Lab configuration for the planned launch hour
                            (median scenario) -> "Load configuration" in the app

Weather sources (--source):
  stormcast  NVIDIA Earth-2 StormCast-CONUS (Earth2Studio v0.17.0, July 2026).
             AI generative ensemble at 3 km, hourly. For days-ahead plans it is
             steered by NOAA's GFS forecast and adds km-scale detail and spread.
             Needs an NVIDIA GPU (HiPerGator) and
             pip install "earth2studio[data,stormcast-conus]"
  gfs        NOAA GFS forecast through Earth2Studio. 0.25 deg, hourly to 5 days,
             one scenario, includes surface gusts. No GPU, NOT an AI model.
  mock       Synthetic 3-day weather with a passing gust front and showers.
             No internet or GPU. For demos and testing.

Examples:
  python earth2_weather.py --source mock --mission-time "2026-10-27 14:00"
  python earth2_weather.py --source stormcast --lat 29.40 --lon -82.17 \
         --mission-time "2026-10-27 14:00" --window 6 --members 4
  python earth2_weather.py --source gfs --lat 29.40 --lon -82.17 --mission-time "2026-10-28 09:00"

Labels in the output:
  MODEL    straight from the weather model
  DERIVED  computed from model output with a standard formula
  ASSUMED  a modelling constant you can change with a flag
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

# Drone Scout configuration defaults (from the app's GROUPS table)
APP_DEFAULTS = {
    "mass": 1.487, "capmAh": 5870, "vnom": 15.2, "vmax": 14, "vup": 6, "vdown": 3,
    "gsdk": 18.9, "tmin": 2, "acc": 3, "dec": 3, "tau": 0.7, "zacc": 3, "yawr": 90,
    "kp": 0.8, "ki": 0.05, "phov": 165, "pload": 12, "kv": 0.004, "eta": 0.85,
    "start": 100, "rthres": 15, "crit": 10, "alt": 30, "fwd": 80, "side": 70,
    "vtr": 8, "dir": 0, "wind": 3, "wdir": 270, "gust": 0.8, "gnss": 0.75,
    "gtau": 15, "seed": 7,
    "energy": 89.224, "tmaxSpec": 27, "px": 1600, "py": 1300, "focal": 5.74,
}
WEATHER_RANGES = {"wind": (0, 12, 0.5), "wdir": (0, 355, 5), "gust": (0, 3, 0.1)}
CONUS = (21, 53, -135, -60)


# --------------------------------------------------------------------------- helpers
def snap(value, lo, hi, step):
    v = min(hi, max(lo, value))
    return min(hi, max(lo, round(round(v / step) * step, 6)))


def snap_dir(deg):
    d = round((deg % 360) / 5) * 5
    return 0 if d >= 360 else d


def wind_from_deg(u, v):
    """Direction the wind blows FROM, degrees clockwise from north."""
    return (np.degrees(np.arctan2(-u, -v)) + 360.0) % 360.0


def circular_mean_deg(deg):
    r = np.radians(np.asarray(deg, dtype=float))
    return float((math.degrees(math.atan2(np.sin(r).sum(), np.cos(r).sum())) + 360) % 360)


def dbz_to_rain_mmh(dbz):
    """Marshall-Palmer Z = 200 R^1.6 (DERIVED). Below 15 dBZ treated as dry."""
    dbz = np.asarray(dbz, dtype=float)
    r = np.power(np.power(10.0, dbz / 10.0) / 200.0, 1.0 / 1.6)
    return np.where(dbz < 15.0, 0.0, r)


def visibility_km(dust_risk, rain_mm_h, clear_km=50.0):
    """Horizontal visibility (ASSUMED empirical): light extinction from dust and rain adds.
    Dust: 50 km at no risk, ~5 km at risk 0.5, ~0.5 km at risk 1 (blowing-dust events).
    Rain: ~12 km at 1 mm/h, ~3.5 km at 7 mm/h (V = 12 R^-0.65)."""
    ext = 1.0 / clear_km
    ext += 1.0 / (clear_km * math.exp(-4.6 * dust_risk)) - 1.0 / clear_km
    if rain_mm_h > 0.05:
        ext += 1.0 / (12.0 * rain_mm_h ** -0.65)
    return min(clear_km, 1.0 / ext)


def rh_from_q(q, t_k, p_pa):
    e = q * p_pa / (0.622 + 0.378 * q)
    tc = t_k - 273.15
    return np.clip(100.0 * e / (611.2 * np.exp(17.67 * tc / (tc + 243.5))), 0, 100)


def air_density(p_pa, t_k, rh_pct):
    """Moist-air density, kg/m3 (DERIVED, ideal gas with virtual temperature)."""
    tc = t_k - 273.15
    e = (rh_pct / 100.0) * 611.2 * math.exp(17.67 * tc / (tc + 243.5))
    q = 0.622 * e / (p_pa - 0.378 * e)
    return p_pa / (287.05 * t_k * (1 + 0.608 * q))


def hrrr_grid_index(lat, lon):
    """(row, col) on NOAA's 3 km HRRR Lambert grid; row 0 = southern edge."""
    R, phi0, lam0 = 6371229.0, math.radians(38.5), math.radians(-97.5)
    n = math.sin(phi0)
    F = math.cos(phi0) * math.tan(math.pi / 4 + phi0 / 2) ** n / n
    rho0 = R * F / math.tan(math.pi / 4 + phi0 / 2) ** n

    def proj(la, lo):
        rho = R * F / math.tan(math.pi / 4 + math.radians(la) / 2) ** n
        th = n * (math.radians(lo) - lam0)
        return rho * math.sin(th), rho0 - rho * math.cos(th)

    x0, y0 = proj(21.138123, -122.719528)
    x, y = proj(lat, lon)
    return (y - y0) / 3000.0, (x - x0) / 3000.0


def subdomain(row, col, h=512, w=640):
    """StormCast-CONUS crop window. Offsets from the full-model box
    ((17,1041),(3,1795)) and sizes must be divisible by the patch size;
    64-cell steps satisfy that (reproduces NVIDIA's central-US example)."""
    lat0, lat1, lon0, lon1, step = 17, 1041, 3, 1795, 64
    r = min(max(int(round((row - h / 2 - lat0) / step)) * step, 0), (lat1 - lat0) - h)
    c = min(max(int(round((col - w / 2 - lon0) / step)) * step, 0), (lon1 - lon0) - w)
    return (lat0 + r, lat0 + r + h), (lon0 + c, lon0 + c + w)


def nearest_cell(lat2d, lon2d, lat, lon):
    lon2d = np.where(lon2d > 180, lon2d - 360, lon2d)
    d = (lat2d - lat) ** 2 + ((lon2d - lon) * math.cos(math.radians(lat))) ** 2
    j, i = np.unravel_index(np.argmin(d), d.shape)
    return int(j), int(i), 111.2 * math.sqrt(float(d[j, i]))


def latest_cycle(now, min_age_h=5):
    """Newest 00/06/12/18 UTC cycle at least min_age_h old (data published)."""
    t = now - timedelta(hours=min_age_h)
    return t.replace(hour=(t.hour // 6) * 6, minute=0, second=0, microsecond=0)


# --------------------------------------------------------------------------- sources
# Each returns (series, meta). series[var] has shape (members, leads); lead k is
# init + k hours. Required: u10m, v10m. Optional: t2m, refc, pressure, rh, gust10.
def fetch_stormcast(a, init, nsteps):
    import earth2studio.run as run
    from earth2studio.data import GFS_FX, HRRR
    from earth2studio.io import ZarrBackend
    from earth2studio.models.px import StormCastCONUS
    from earth2studio.perturbation import Zero

    try:
        glat, glon = HRRR.grid()
        row, col, _ = nearest_cell(np.asarray(glat), np.asarray(glon), a.lat, a.lon)
    except Exception:
        row, col = hrrr_grid_index(a.lat, a.lon)
    lat_lim, lon_lim = subdomain(row, col)
    print(f"[stormcast] HRRR cell row {row}, col {col}; crop rows {lat_lim}, cols {lon_lim}")

    model = StormCastCONUS.load_model(
        StormCastCONUS.load_default_package(), conditioning_data_source=GFS_FX(),
        hrrr_lat_lim=lat_lim, hrrr_lon_lim=lon_lim)

    j, i, dist = nearest_cell(np.asarray(model.lat), np.asarray(model.lon), a.lat, a.lon)
    jj = slice(max(j - 1, 0), j + 2)
    ii = slice(max(i - 1, 0), i + 2)
    want = ["u10m", "v10m", "t2m", "msl", "refc", "q1hl", "t1hl", "p1hl"]
    keep = np.array([v for v in want if v in list(model.variables)])
    # Save only a 3x3 box around the field: kilobytes instead of gigabytes.
    out = {"variable": keep,
           "hrrr_y": np.asarray(model.hrrr_y)[jj],
           "hrrr_x": np.asarray(model.hrrr_x)[ii]}
    io = run.ensemble([init.strftime("%Y-%m-%dT%H:%M:%S")], nsteps, a.members,
                      model, HRRR(), ZarrBackend(), Zero(),
                      batch_size=min(a.members, a.batch_size), output_coords=out)
    cj, ci = j - jj.start, i - ii.start
    s = {v: np.asarray(io[v])[:, 0, :, cj, ci] for v in keep}   # (members, leads)
    series = {"u10m": s["u10m"], "v10m": s["v10m"]}
    if "t2m" in s:
        series["t2m"] = s["t2m"]
    if "refc" in s:
        series["refc"] = s["refc"]
    if "p1hl" in s:
        series["pressure"] = s["p1hl"]
    elif "msl" in s:
        series["pressure"] = s["msl"]
    if all(k in s for k in ("q1hl", "t1hl", "p1hl")):
        series["rh"] = rh_from_q(s["q1hl"], s["t1hl"], s["p1hl"])
    meta = {"model": "NVIDIA Earth-2 StormCast-CONUS", "kind": "AI generative ensemble, 3 km, hourly, GFS-conditioned",
            "members": a.members, "grid_cell_km_from_field": round(dist, 2)}
    return series, meta


def fetch_gfs(a, init, nsteps):
    from earth2studio.data import GFS_FX

    names = ["u10m", "v10m", "t2m", "refc", "sp", "r2m", "fg10m"]
    leads = [timedelta(hours=h) for h in range(nsteps + 1)]
    da = GFS_FX()(init.replace(tzinfo=None), leads, names)       # (time, lead, var, lat, lon)
    pt = da.isel(time=0).sel(lat=a.lat, lon=a.lon % 360, method="nearest")
    v = {n: pt.sel(variable=n).values[None, :] for n in names}
    dist = 111.2 * math.hypot(float(pt.lat) - a.lat,
                              ((float(pt.lon) + 180) % 360 - 180 - a.lon) * math.cos(math.radians(a.lat)))
    series = {"u10m": v["u10m"], "v10m": v["v10m"], "t2m": v["t2m"], "refc": v["refc"],
              "pressure": v["sp"], "rh": v["r2m"], "gust10": v["fg10m"]}
    meta = {"model": "NOAA GFS forecast (fallback, not AI)", "kind": "physics model, 0.25 deg, hourly",
            "members": 1, "grid_cell_km_from_field": round(dist, 2)}
    return series, meta


def fetch_mock(a, init, nsteps):
    """Synthetic multi-day weather: light diurnal winds, then a gust front with
    dry, dusty outflow followed by showers ~60 % of the way through."""
    rng = np.random.default_rng(a.seed)
    m, L = a.members, nsteps + 1
    h = np.arange(L)[None, :] + init.hour
    diurnal = 0.5 + 0.5 * np.sin((h % 24 - 9) / 24 * 2 * np.pi)          # windier afternoons
    centre = getattr(a, "front_lead", L * 0.6) + rng.normal(0, 1.5, (m, 1))  # members disagree on timing
    front = np.exp(-0.5 * ((np.arange(L)[None, :] - centre) / 1.5) ** 2)
    rainband = np.exp(-0.5 * ((np.arange(L)[None, :] - centre - 2.5) / 1.5) ** 2)
    speed = 1.5 + 2.5 * diurnal + 6.5 * front + rng.normal(0, 0.5, (m, L))
    direc = np.radians(200 + 90 * front + rng.normal(0, 10, (m, L)))
    t2m = 273.15 + 22 + 7 * diurnal - 6 * rainband + rng.normal(0, 0.4, (m, L))
    series = {"u10m": -speed * np.sin(direc), "v10m": -speed * np.cos(direc), "t2m": t2m,
              "refc": -10 + 50 * rainband + rng.normal(0, 4, (m, L)),
              "pressure": 101300 - 600 * front + rng.normal(0, 30, (m, L)),
              "rh": np.clip(40 + 50 * rainband - 15 * diurnal + rng.normal(0, 3, (m, L)), 5, 100)}
    meta = {"model": "MOCK synthetic weather (demo only)", "kind": "synthetic", "members": m,
            "grid_cell_km_from_field": 0.0}
    return series, meta


# --------------------------------------------------------------------------- analysis
def member_weather(series, k, m, a, spread_alt):
    u, v = float(series["u10m"][m, k]), float(series["v10m"][m, k])
    w10 = math.hypot(u, v)
    w_alt = w10 * (max(a.alt, 10.0) / 10.0) ** a.shear_alpha
    gust = math.sqrt((a.turb_intensity * w_alt) ** 2 + spread_alt ** 2)
    if "gust10" in series:  # GFS surface gust: peak ~ mean + 2 sigma
        g10 = float(series["gust10"][m, k]) * (max(a.alt, 10.0) / 10.0) ** a.shear_alpha
        gust = max(gust, (g10 - w_alt) / 2.0)
    wdir_true = float(wind_from_deg(np.array(u), np.array(v)))
    wdir_map = (wdir_true - a.map_heading) % 360
    t_c = float(series["t2m"][m, k]) - 273.15 if "t2m" in series else 20.0
    p = float(series["pressure"][m, k]) if "pressure" in series else 101325.0
    rh = float(series["rh"][m, k]) if "rh" in series else 50.0
    rain = float(dbz_to_rain_mmh(series["refc"][m, k])) if "refc" in series else 0.0
    rho = air_density(p, t_c + 273.15, rh)
    wind_term = min(1.0, max(0.0, (w10 - 6.0) / 4.0))
    dry_term = min(1.0, max(0.0, (80.0 - rh) / 40.0))
    dust = wind_term * dry_term * (0.0 if rain > 0.5 else 1.0)
    return {
        "wind_10m_ms": round(w10, 2), "wind_flight_level_ms": round(w_alt, 2),
        "wind_from_true_deg": round(wdir_true, 1), "wind_from_map_deg": round(wdir_map, 1),
        "gust_sigma_ms": round(gust, 2), "rain_mm_h": round(rain, 2),
        "temperature_c": round(t_c, 1), "relative_humidity_pct": round(rh, 0),
        "pressure_pa": round(p, 0), "air_density_kgm3": round(rho, 4),
        "dust_risk_0_1": round(dust, 2),
        "visibility_km": round(visibility_km(dust, rain), 2),
        "sim": {"wind": snap(w_alt, *WEATHER_RANGES["wind"]), "wdir": snap_dir(wdir_map),
                "gust": snap(gust, *WEATHER_RANGES["gust"])},
    }


def build_scenarios(series, a, init, window_idx, tz):
    u, v = series["u10m"], series["v10m"]
    w_alt = np.hypot(u, v) * (max(a.alt, 10.0) / 10.0) ** a.shear_alpha
    hours = []
    for k in window_idx:
        spread = float(w_alt[:, k].std()) if w_alt.shape[0] > 1 else 0.0
        members = [member_weather(series, k, m, a, spread) for m in range(u.shape[0])]
        valid = init + timedelta(hours=int(k))
        hours.append({
            "valid_utc": valid.strftime("%Y-%m-%dT%H:%MZ"),
            "valid_local": valid.astimezone(tz).strftime("%a %d %b %H:%M"),
            "lead_h": int(k),
            "ensemble_spread_ms": round(spread, 2),
            "members": members,
        })
    return hours


def median_member(hour):
    ws = [m["wind_flight_level_ms"] for m in hour["members"]]
    return hour["members"][int(np.argsort(ws)[len(ws) // 2])]


# --------------------------------------------------------------------------- main
def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--source", choices=["stormcast", "gfs", "mock"], default="mock")
    p.add_argument("--lat", type=float, default=29.6436, help="field latitude (default UF Gainesville)")
    p.add_argument("--lon", type=float, default=-82.3549, help="field longitude, negative = west")
    p.add_argument("--field-name", default="Survey field")
    p.add_argument("--map-heading", type=float, default=0.0,
                   help="compass bearing the TOP of the Flight Lab map points to (0 = north up)")
    p.add_argument("--alt", type=float, default=30.0, help="survey altitude above ground, m")
    p.add_argument("--mission-time", help='planned launch, local time, e.g. "2026-10-27 14:00" '
                                          "(default: tomorrow 10:00)")
    p.add_argument("--tz", default="America/New_York")
    p.add_argument("--window", type=int, default=6, help="launch window length in hours, starting at --mission-time")
    p.add_argument("--init", help="model start time UTC (default: newest published 6-h cycle)")
    p.add_argument("--members", type=int, default=4, help="ensemble members (stormcast/mock)")
    p.add_argument("--batch-size", type=int, default=2)
    p.add_argument("--shear-alpha", type=float, default=0.14, help="ASSUMED wind-profile exponent")
    p.add_argument("--turb-intensity", type=float, default=0.15, help="ASSUMED turbulence intensity")
    p.add_argument("--base-config", help="config JSON saved from Flight Lab (keeps your aircraft settings)")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--out", default=".")
    a = p.parse_args(argv)

    in_conus = CONUS[0] <= a.lat <= CONUS[1] and CONUS[2] <= a.lon <= CONUS[3]
    if a.source == "stormcast" and not in_conus:
        sys.exit("StormCast-CONUS covers the contiguous US only; check --lat/--lon "
                 "(use --source gfs for other regions)")

    tz = ZoneInfo(a.tz)
    now = datetime.now(timezone.utc)
    if a.mission_time:
        launch = datetime.fromisoformat(a.mission_time).replace(tzinfo=tz).astimezone(timezone.utc)
    else:
        launch = (now.astimezone(tz) + timedelta(days=1)).replace(hour=10, minute=0, second=0,
                                                                   microsecond=0).astimezone(timezone.utc)
    if a.init:
        init = datetime.fromisoformat(a.init).replace(tzinfo=timezone.utc)
    elif a.source == "mock":
        init = now.replace(minute=0, second=0, microsecond=0)
    else:
        init = latest_cycle(now)
    first = math.floor((launch - init).total_seconds() / 3600)
    if first < 0:
        sys.exit("Mission time is before the forecast start; pick a later --mission-time")
    window_idx = list(range(first, first + a.window + 1))
    nsteps = window_idx[-1]
    if nsteps > 120:
        print(f"WARNING: {nsteps} h ahead. Beyond ~5 days skill drops fast; treat as indicative.",
              file=sys.stderr)

    print(f"[{a.source}] forecast start {init:%Y-%m-%d %H:%MZ}, launch window "
          f"{launch.astimezone(tz):%a %d %b %H:%M} +{a.window} h, {nsteps} hourly steps")
    a.front_lead = first + a.window * 0.55   # mock only: put the gust front inside the window
    fetch = {"stormcast": fetch_stormcast, "gfs": fetch_gfs, "mock": fetch_mock}[a.source]
    series, meta = fetch(a, init, nsteps)
    hours = build_scenarios(series, a, init, window_idx, tz)

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    scen = {
        "schema": "drone-scout-forecast-v1",
        "generated_utc": now.strftime("%Y-%m-%dT%H:%MZ"),
        "field": {"name": a.field_name, "lat": a.lat, "lon": a.lon,
                  "map_heading_deg": a.map_heading, "flight_altitude_m": a.alt, "timezone": a.tz},
        "source": meta, "init_utc": init.strftime("%Y-%m-%dT%H:%MZ"),
        "planned_launch_local": launch.astimezone(tz).strftime("%a %d %b %H:%M"),
        "assumptions": {
            "flight_level_wind": {"tag": "ASSUMED", "value": a.shear_alpha,
                                  "note": "U(alt) = U10 * (alt/10)^alpha, open farmland"},
            "gust_sigma": {"tag": "ASSUMED", "value": a.turb_intensity,
                           "note": "sqrt((TI*U)^2 + ensemble spread^2); GFS: also (gust - mean)/2"},
            "rain": {"tag": "DERIVED", "note": "radar reflectivity via Marshall-Palmer Z = 200 R^1.6"},
            "air_density": {"tag": "DERIVED", "note": "ideal gas with humidity; feeds hover power"},
            "dust_risk": {"tag": "DERIVED", "note": "heuristic from 10 m wind, humidity, rain; no dust model"},
            "visibility": {"tag": "ASSUMED", "note": "dust + rain extinction; FAA Part 107 needs >= 3 statute miles (4.83 km)"},
        },
        "hours": hours,
    }
    (out / "forecast_scenarios.json").write_text(json.dumps(scen, indent=2))

    values = dict(APP_DEFAULTS)
    if a.base_config:
        base = json.loads(Path(a.base_config).read_text())
        if base.get("schema") != "drone-scout-config-v1":
            sys.exit("--base-config must be saved from Flight Lab (schema drone-scout-config-v1)")
        values.update(base["values"])
    values.update(median_member(hours[0])["sim"])
    values["alt"] = int(min(120, max(8, round(a.alt))))
    (out / "drone_scout_config.json").write_text(json.dumps(
        {"schema": "drone-scout-config-v1",
         "profile": f"P4 Multispectral reference / {meta['model']} for {hours[0]['valid_local']}",
         "source": "https://ag.dji.com/p4-multispectral/specs", "values": values}, indent=2))

    print(f"\n{'local time':<17}{'wind@alt':>9}{'gust':>6}{'rain':>6}{'temp':>6}{'dust':>6}{'vis km':>8}   (median of {len(hours[0]['members'])})")
    for h in hours:
        md = median_member(h)
        print(f"{h['valid_local']:<17}{md['wind_flight_level_ms']:>8.1f}{md['gust_sigma_ms']:>6.1f}"
              f"{max(x['rain_mm_h'] for x in h['members']):>6.1f}{md['temperature_c']:>6.0f}{md['dust_risk_0_1']:>6.2f}"
              f"{min(x['visibility_km'] for x in h['members']):>8.1f}")
    print(f"\nWrote forecast_scenarios.json and drone_scout_config.json to {out.resolve()}")
    print("Next: node mission_planner.cjs --forecast forecast_scenarios.json")


if __name__ == "__main__":
    main()
