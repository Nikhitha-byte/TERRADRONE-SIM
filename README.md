<div align="center">

# 🛰️ TerraDrone Sim

### Know before you fly: a weather-aware survey-drone flight lab, mission planner and 6-DOF physics simulator

<p>
  <img src="https://img.shields.io/badge/SIMULATION-NO%20HARDWARE-00C48C?style=for-the-badge" alt="Simulation, no hardware">
  <img src="https://img.shields.io/badge/WEATHER-NVIDIA%20Earth--2%20StormCast-76B900?style=for-the-badge&logo=nvidia&logoColor=white" alt="NVIDIA Earth-2 StormCast">
  <img src="https://img.shields.io/badge/PHYSICS-6--DOF%20RK4%20%40%20500%20Hz-7C5CFF?style=for-the-badge" alt="6-DOF physics">
</p>
<p>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Aircraft-DJI%20P4%20Multispectral-FF8A00?style=flat-square" alt="DJI P4 Multispectral">
  <img src="https://img.shields.io/badge/Rule-FAA%2014%20CFR%20107.51(c)-E5484D?style=flat-square" alt="FAA 14 CFR 107.51(c)">
</p>

<img src="preview.png" alt="TerraDrone Sim: Flight Lab with survey map, mission planner and physics panels" width="92%">

</div>

---

## 🎯 The question it answers

> **"If I launch at this time in 2–3 days, will the drone finish the survey safely, and how much battery will it take?"**

Farm and research crews plan drone surveys days ahead, but wind, gusts, rain, dust and cold decide whether a flight is
safe and whether one battery is enough. TerraDrone Sim turns an **AI weather forecast** for *your* field into a
**per-hour go / no-go decision**, by actually flying the survey in the simulator under every forecast scenario.

<div align="center">

| 🟢 **CLEARED** | 🟠 **CONDITIONAL** | 🔴 **NOT CLEARED** |
|:---:|:---:|:---:|
| Fly it. | Fly with care: low reserve, long time at full speed, steep tilt, dust or cold. | Don't: gusts over 10 m/s, rain, visibility under 3 miles, temperature out of range, emergency landing, or not enough batteries. |

</div>

---

## 🧭 How it works

```mermaid
flowchart LR
    A["🌩️ earth2_weather.py<br/>Earth-2 StormCast / GFS / mock"]:::wx --> B["📄 forecast_scenarios.json<br/>every hour × every scenario"]:::data
    B --> C["🗺️ Mission planner<br/>(planner.js · mission_planner.cjs)"]:::plan
    D["🛩️ Flight Lab simulator<br/>(app.js, point-mass, 0.1 s)"]:::sim --> C
    C --> E["✅ Per-hour decision<br/>battery · path · stress"]:::out
    E --> F["⚙️ 6-DOF physics replay<br/>(physics6dof.js)"]:::phys
    classDef wx fill:#0B3D2E,stroke:#00C48C,color:#E6FFF5
    classDef data fill:#1B2A4A,stroke:#4C8DFF,color:#E8F0FF
    classDef plan fill:#3B2A00,stroke:#FF8A00,color:#FFF1DC
    classDef sim fill:#2A1B4A,stroke:#7C5CFF,color:#F0EAFF
    classDef out fill:#3A1020,stroke:#E5484D,color:#FFE8EC
    classDef phys fill:#102A3A,stroke:#2CC4E8,color:#E6F9FF
```

1. **Forecast.** `earth2_weather.py` pulls weather for your field's lat/lon (an ensemble from NVIDIA Earth-2
   **StormCast-CONUS**, or NOAA GFS, or synthetic data) and writes `forecast_scenarios.json`.
2. **Plan.** For every launch hour and every scenario, the planner flies your survey with Flight Lab's own simulator,
   using your aircraft settings.
3. **Decide.** Each hour gets CLEARED / CONDITIONAL / NOT CLEARED with the reasons, battery needed, flight time
   and drone stress.
4. **Check the physics.** Replay the chosen hour in a **6-DOF rigid-body** model to see roll, pitch, tracking error and motor load.

---

## ✨ Features

| | |
|---|---|
| 🗺️ **Flight Lab** | Real field imagery (potato trial, cherry orchard), draw a survey area, live flight simulator with time warp ×16 / ×64 |
| 🌦️ **Weather-aware planner** | Launch-time slider over the whole forecast window; Median / Worst / scenario #n; recommended best hour |
| 🌫️ **Dust and visibility** | Visibility from blowing dust and rain against the FAA 3-mile minimum |
| 🔋 **Battery planning** | Battery needed per launch hour (median and range) against calm weather; how many packs to carry |
| ⚙️ **6-DOF physics** | 17-state rigid body, RK4 at 500 Hz, Dryden turbulence, geometric SO(3) attitude control, momentum-theory power |
| 📈 **Interactive charts** | Path deviation, tilt and power over time; scrub the timeline and watch a 3D aircraft lean with the wind |
| 🧪 **Tested** | Physics checked against hand calculations (hover thrust, hover power, steady-wind tilt, density scaling) |
| 🏷️ **Honest labels** | Every input is tagged **MODEL**, **DERIVED**, **SPEC** or **ASSUMED**, so you know what to trust |

### Path colors on the map

| Color | Meaning |
|:---:|---|
| 🟢 **Green** | Original path with no wind |
| 🟠 **Orange** | Recommended path for the day (best launch hour, median scenario) |
| 🔵 **Blue** | The selected launch window (and the live simulator path) |
| 🔴 **Red dot** | Emergency landing |

---

## 🚀 Quick start (5 minutes)

**Needs:** Python 3 and a browser. Node.js only for the command-line tools and tests.

```bash
git clone https://github.com/Nikhitha-byte/TERRADRONE-SIM.git
cd TERRADRONE-SIM
python -m http.server 8000
```

Open **http://127.0.0.1:8000/index.html**. (Double-clicking `index.html` also works; then click **Load forecast** and pick `forecast_scenarios.json`.)

1. **Choose the field.** Pick a map at the top. To survey only part of it, click **Draw survey area** and drag a rectangle.
2. **Plan the launch window** (panel *04 / Mission planner*). The sample forecast loads by itself. Set how many batteries you carry and click **Plan launch window**.
3. **Read the decision.** Drag the launch-time slider (or use ← →). Each hour shows the verdict and the reasons.
4. **Watch it fly.** **Fly this in the simulator** replays that scenario live (use Time warp).
5. **Run the physics** (panel *05 / Physics (6-DOF)*). **Run 6-DOF physics** flies the survey three times (no wind, recommended path, selected window)
   and compares flight time, energy, tilt, tracking error, distance from the original path and motor load.
   **Download CSV** exports the run.

**Checks:**

```bash
node tests/flight.test.cjs     # Flight Lab simulator
node tests/physics.test.cjs    # 6-DOF physics vs hand calculations
```

---

## 🌩️ 1 · Forecast the weather

| Source | What it is | Needs |
|---|---|---|
| `--source stormcast` | NVIDIA Earth-2 **StormCast-CONUS**: AI ensemble at 3 km, hourly, steered by NOAA GFS for days-ahead plans | NVIDIA GPU, `pip install "earth2studio[data,stormcast-conus]"`, US fields only |
| `--source gfs` | NOAA GFS forecast (not AI), 0.25°, one scenario, includes surface gusts | Internet, no GPU, works worldwide |
| `--source mock` | Synthetic weather with a gust front and showers | Nothing (demo and testing) |

```bash
python earth2_weather.py --source stormcast --lat 29.6436 --lon -82.3549 --field-name "UF survey field" \
       --mission-time "2026-10-27 09:00" --window 8 --members 2 --alt 30
```

* `--mission-time` is local time (`--tz`, default America/New_York); `--window` is the number of launch hours to check.
* `--map-heading` is the compass bearing the top of your map points to (0 = north).
* StormCast downloads about 4 GB of weights and needs HRRR and GFS data, and it needs a large GPU. **Run it before the demo and keep the output.**

## 🛩️ 2 · Fly the mission in every scenario (command line)

```bash
node mission_planner.cjs --forecast forecast_scenarios.json --map field --batteries 2
node mission_planner.cjs --forecast forecast_scenarios.json --map rect --size 400x300 --batteries 8
```

* `--map field` (potato trial), `cherry` (orchard), or `rect --size WxH` for any field size in metres.
* `--area x,y,W,H` limits the survey to part of the map; `--base-config` uses your saved aircraft settings.
* Uses **`app.js` unchanged**, headless: same `step()`, same 0.1 s timestep, same controller, power and return-to-home logic.
* Writes `mission_plan.html`, plus `replay_*.json` files you can load in Flight Lab to watch a scenario fly.

---

## 🔬 Under the hood

### The 6-DOF physics model

State: position, velocity, attitude quaternion, body rates and the 4 motor thrusts (17 states), integrated with
4th-order Runge–Kutta at 500 Hz (250 Hz for long surveys).

* `p′ = v` · `v′ = (R(q)·[0,0,ΣTᵢ] + F_drag(v − wind))/m − g` · `q′ = ½ q⊗[0,ω]` · `ω′ = J⁻¹(τ − ω×Jω)` · `Tᵢ′ = (Tᵢ,cmd − Tᵢ)/τ_motor`
* **Wind:** forecast mean wind + Dryden low-altitude turbulence (MIL-HDBK-1797) + GNSS noise.
* **Control:** route guidance → velocity PI (learns the wind) → thrust vector (35° tilt limit) → geometric attitude control on SO(3) → X-quad mixer with motor limits.
* **Power:** momentum theory per rotor (`Pᵢ ∝ Tᵢ^1.5/√(2ρA)`), calibrated to Flight Lab's hover power, so thin, hot or humid air costs more.
* **Airframe:** mass, size and props follow the DJI P4 Multispectral; inertia, drag, motor lag and thrust-to-weight are assumptions, tagged in the panel.

### Wind coupling in Flight Lab

The flight controller is not told the wind. Like a real autopilot it estimates it from the gap between ground and air
velocity (3 s time constant), so gusts, takeoff and turns push the drone off its path, while steady wind mainly costs
airspeed, power and tilt. The 3D aircraft leans by the angle that balances acceleration and air drag
(14.4° in an 8 m/s crosswind, against 13.9° from the 6-DOF model).

### What feeds the simulator, and how honest each piece is

| Effect | How | Label |
|---|---|:---:|
| Wind, direction | Forecast 10 m wind scaled to flight altitude (`U·(alt/10)^0.14`) | MODEL + ASSUMED profile |
| Gusts | √((0.15·U)² + ensemble spread²); GFS adds its gust field | ASSUMED turbulence + MODEL |
| Air density → hover power | `phov × √(1.225/ρ)` from forecast temperature, pressure, humidity | DERIVED |
| Cold battery | −0.75 %/°C below 20 °C, floor 80 % | ASSUMED |
| Rain | Radar reflectivity → mm/h. Rain > 0.5 mm/h = NOT CLEARED (no published rain rating). Not in flight physics | DERIVED |
| Dust → visibility | Dust + rain light extinction → visibility. < 4.8 km (FAA 3 miles) = NOT CLEARED, < 8 km = CONDITIONAL | ASSUMED |
| Limits | 10 m/s wind, 0–40 °C; visibility ≥ 3 statute miles | SPEC (DJI P4 Multispectral); FAA 14 CFR 107.51(c) |

**Status per scenario.** NOT CLEARED for gusts over 10 m/s, rain, visibility under 3 miles, temperature out of range,
an emergency landing, or needing more batteries than you carry. CONDITIONAL for using every battery, landing near the
reserve, more than 5 % of survey time at full airspeed, more than 30° tilt, more than 2 m tracking error, low coverage, dust or cold.

**Status per hour.** NOT CLEARED if half or more scenarios are; CONDITIONAL if any is NOT CLEARED or half are CONDITIONAL; otherwise CLEARED.

### Dust and visibility

FAA 14 CFR 107.51(c) requires at least **3 statute miles (4.8 km)** of flight visibility from the control station.
The forecast step estimates visibility from blowing dust (wind, humidity, rain) and rain, which both scatter light and add up.
Dust is not a force in the flight physics: at these concentrations it changes whether you may fly and how good the images are,
not how the drone flies. The visibility numbers are an estimate (ASSUMED empirical relation), not a model output.

### Known limits

* The planner sweeps with Flight Lab's fast point-mass simulator; the 6-DOF physics runs on the selected hour and scenario.
* One forecast grid cell is used for the whole field.
* The simulator's return-home check assumes calm air, which is why strong headwinds can end in an emergency landing.

---

## 📁 Files

| File | What it is |
|---|---|
| `index.html`, `app.js` | Flight Lab: map, survey planning, the flight simulator (`step()`), live view |
| `planner.js` | 04 / Mission planner panel inside Flight Lab |
| `physics6dof.js`, `physics_view.js` | 6-DOF rigid-body physics engine and the 05 / Physics panel |
| `drone_data.js`, `drone_data5.js` | Map imagery: potato trial (FIELDimageR) and cherry orchard (Kerasia) |
| `earth2_weather.py` | Weather forecast for your field → `forecast_scenarios.json` (Earth-2 StormCast, GFS, or mock) |
| `forecast_scenarios.json` | Sample forecast so the planner works out of the box |
| `mission_planner.cjs`, `mission_report.cjs` | Same planning from the command line → `mission_plan.html` report |
| `tests/flight.test.cjs`, `tests/physics.test.cjs` | Simulator and physics tests |
| `Drone_Scout_Guide.pdf` | Full guide: drone, battery, limits and the weather-to-mission coupling |

---

<div align="center">

**TerraDrone Sim**: simulation only, no hardware. Weather is a forecast and several inputs are labeled ASSUMED, so confirm real conditions before any real flight.

</div>
