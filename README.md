# Drone Scout · Flight Lab + Mission Planner

Simulates a survey drone over real field imagery and answers, before you fly:
**"If I launch at this time in 2–3 days, will the drone finish safely, and how much battery will it take?"**

## Run the simulation (5 minutes)

**Needs:** Python 3 (any version) and a browser. Node.js only for the command-line tools and tests.

1. **Start a local web server in this folder**
   ```
   cd dronesim
   python -m http.server 8000
   ```
   Open **http://127.0.0.1:8000/index.html**. (Double-clicking `index.html` also works; then click
   **Load forecast** in step 3 and pick `forecast_scenarios.json`.)
2. **Choose the field.** Pick a map at the top (potato trial or cherry orchard). To survey only part
   of it, click **Draw survey area** and drag a rectangle on the map.
3. **Plan the launch window** (panel *04 / Mission planner*). The sample forecast loads by itself.
   Set the batteries you will carry and click **Plan launch window**.
4. **Read the decision.** Drag the **launch-time slider** (or ← →). Each hour shows CLEARED / CONDITIONAL / NOT CLEARED
   with the reasons: wind and gusts vs the 10 m/s rating, rain, **visibility from dust and rain vs the
   FAA 3-mile minimum**, temperature, battery needed, emergency landings. Pick **Median / Worst / #n**
   for a scenario. On the map: green = original path with no wind, orange = recommended path for the day
   (best launch hour, median scenario), blue = the selected window's path (and the live simulator path).
5. **Watch it fly.** **Fly this in the simulator** replays that scenario live in Flight Lab
   (use Time warp ×16 / ×64).
6. **Run the physics** (panel *05 / Physics (6-DOF)*). **Run 6-DOF physics** flies the same survey as a
   rigid body three times: no wind (green), the recommended path (orange) and the selected window (blue)
   (a few seconds for a small field). Then:
   * the table compares flight time, energy, tilt, roll/pitch, rotation rate, tracking error,
     **distance from the original path** and motor load;
   * the charts show path deviation, tilt and power over time (hover for values, click to jump);
   * **Play** or drag the scrubber: the drone moves on the map and the 3D aircraft leans and turns
     with the simulated roll, pitch and heading;
   * **Download CSV (MATLAB)** and run `plot_physics('that_file.csv')` in MATLAB for 3-D path,
     roll/pitch, motor thrust and power plots.
7. **Use a real forecast** (optional, before the demo): see *1. Forecast the weather* below, then
   replace `forecast_scenarios.json` and reload the page.

**Checks:** `node tests/flight.test.cjs` (Flight Lab simulator) and `node tests/physics.test.cjs`
(6-DOF physics vs hand calculations).

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js` | Flight Lab: map, survey planning, the flight simulator (`step()`), live view |
| `planner.js` | 04 / Mission planner panel inside Flight Lab |
| `physics6dof.js`, `physics_view.js` | 6-DOF rigid-body physics engine and the 05 / Physics panel |
| `drone_data.js`, `drone_data5.js` | Map imagery: potato trial (FIELDimageR) and cherry orchard (Kerasia) |
| `earth2_weather.py` | Weather forecast for your field → `forecast_scenarios.json` (NVIDIA Earth-2 StormCast, GFS, or mock) |
| `forecast_scenarios.json` | Sample forecast (mock) so the planner works out of the box |
| `mission_planner.cjs`, `mission_report.cjs` | Same planning from the command line → `mission_plan.html` report |
| `mission_demo/` | Sample command-line report for a 12-ha field |
| `tests/flight.test.cjs`, `tests/physics.test.cjs` | Simulator and physics tests |

## How the planner works

```
earth2_weather.py  ──►  forecast_scenarios.json  ──►  mission_planner.cjs  ──►  mission_plan.html
(weather at your field,       (every hour × every              (your Flight Lab sim flies          (CLEARED / CONDITIONAL / NOT CLEARED,
 Earth-2 AI forecast)          forecast scenario)                the survey in each scenario)       battery, path, drone stress)
```

### 0. Interactive: plan inside Flight Lab (recommended for the demo)

`planner.js` adds **04 / Mission planner** under the survey map.

1. Run the forecast once (step 1 below) and put `forecast_scenarios.json` next to `index.html`.
   * Opened through the local server above, it loads automatically.
   * Opened as a file, click **Load forecast** and pick it.
2. Pick a map and, if you only want part of the field, click **Draw survey area** and drag a rectangle.
3. Set how many batteries you will carry and click **Plan launch window**. Every launch hour × every
   forecast scenario is flown with Flight Lab's own simulator and your current aircraft settings
   (a few hundred milliseconds for a small field; a few seconds for a big one).
4. Drag the **launch-time slider** (or click an hour, the chart, or use ← →) to see the decision,
   battery needed, flight time and drone stress for that hour. Pick **Median / Worst / #1…#n** to choose a scenario.
   The map shows three paths: green = original path with no wind, orange = recommended path for the day,
   blue = the selected window; a red dot marks an emergency landing.
5. **Fly this in the simulator** puts that hour's weather into the aircraft settings and flies it live
   (use time warp). It retraces the planned path exactly, because it is the same simulator and seed.

If you draw a new area or switch map after planning, the panel says so: plan again.

### 1. Forecast the weather

| Source | What it is | Needs |
|---|---|---|
| `--source stormcast` | NVIDIA Earth-2 **StormCast-CONUS** (Earth2Studio v0.17.0, July 2026). AI ensemble at 3 km, hourly, steered by NOAA GFS for days-ahead plans | NVIDIA GPU (HiPerGator), `pip install "earth2studio[data,stormcast]"`, US fields only |
| `--source gfs` | NOAA GFS forecast (not AI), 0.25°, one scenario, includes surface gusts | Internet, no GPU, works worldwide |
| `--source mock` | Synthetic weather with a gust front and showers | Nothing (demo / testing) |

```
python earth2_weather.py --source stormcast --lat 29.40 --lon -82.17 --field-name "PSREU block 4" \
       --mission-time "2026-10-27 09:00" --window 8 --members 4 --alt 30
```

* `--mission-time` is local time (`--tz`, default America/New_York); `--window` = hours of launch options to check.
* `--map-heading` = compass bearing the top of your Flight Lab map points to (0 = north).
* Before the run, StormCast downloads ~4 GB of weights and needs HRRR + GFS data. Each forecast hour takes
  seconds on an H100-class GPU, so a 3-day plan is minutes per scenario. **Run it before the demo and keep the output.**

### 2. Fly the mission in every scenario

```
node mission_planner.cjs --forecast forecast_scenarios.json --map field --batteries 2
node mission_planner.cjs --forecast forecast_scenarios.json --map rect --size 400x300 --batteries 8
```

* `--map field` (potato trial), `cherry` (Kerasia orchard), or `rect --size WxH` for any field size in metres.
* `--area x,y,W,H` limits the survey to part of the map; `--base-config` uses your saved aircraft settings.
* Uses **your `app.js` unchanged**, headless: same `step()`, same 0.1 s timestep, same controller, power and RTH logic.

### 3. Read the result

Open `mission_plan.html`. You get:
* the decision for the planned hour and the best hour in the window,
* battery needed per launch hour (median and range across scenarios) vs calm weather,
* flight path in the worst scenario, and drone stress after the run (lowest battery, peak power/current/C-rate,
  time at full airspeed, max tilt, tracking error, coverage),
* `replay_*.json`: load in Flight Lab (Aircraft configuration → Load configuration) to watch that scenario fly.

### Dust and visibility

Dust matters for the go / no-go mainly through **visibility**. FAA 14 CFR 107.51(c) requires at least
**3 statute miles (4.8 km)** of flight visibility from the control station. The forecast step estimates
visibility from blowing dust (wind, humidity, rain) and rain, which both scatter light and add up:
below 4.8 km is **NOT CLEARED**, below 8 km is **CONDITIONAL** (keep the drone in sight; images lose contrast).
Dust also means grit in the motors (CONDITIONAL). It is not a force in the flight physics: at these
concentrations it does not change how the drone flies, only whether you may fly and how good the images are.
The visibility numbers are an estimate (ASSUMED empirical relation), not a model output.

### The 6-DOF physics model

State: position, velocity, attitude quaternion, body rates and the 4 motor thrusts (17 states),
integrated with 4th-order Runge–Kutta at 500 Hz (250 Hz for long surveys).

* p′ = v · v′ = (R(q)·[0,0,ΣTᵢ] + F_drag(v − wind))/m − g · q′ = ½ q⊗[0,ω] · ω′ = J⁻¹(τ − ω×Jω) · Tᵢ′ = (Tᵢ,cmd − Tᵢ)/τ_motor
* Wind: forecast mean wind + Dryden low-altitude turbulence (MIL-HDBK-1797) + GNSS noise.
* Control: route guidance → velocity PI (learns the wind) → thrust vector (35° tilt limit) →
  geometric attitude control on SO(3) → X-quad mixer with motor limits.
* Power: momentum theory per rotor (Pᵢ ∝ Tᵢ^1.5/√(2ρA)), calibrated to Flight Lab's hover power,
  so thin, hot or humid air costs more.
* Airframe values (mass, size, props) follow the P4 Multispectral; inertia, drag, motor lag and
  thrust-to-weight are assumptions, listed with tags in the panel.

`tests/physics.test.cjs` checks it against hand calculations: hover thrust = mg/4, hover power =
Flight Lab's 177 W, steady-wind tilt = atan(drag/weight) (13.89° in 8 m/s), hover power ∝ 1/√ρ,
gusts raise attitude activity, the survey completes and lands at home, wind costs energy.

### Wind coupling in Flight Lab

The flight controller is not told the wind. Like a real autopilot it estimates it from the gap between ground and air
velocity (3 s time constant), so wind changes, gusts, takeoff and turns push the drone off its path, while steady wind
mainly costs airspeed, power and tilt. The 3D aircraft leans by the angle that balances acceleration and air drag
(14.4° in an 8 m/s crosswind, against 13.9° from the 6-DOF model). See `Drone_Scout_Guide.pdf` → *Technical basis*
for the drone, battery, limits and the full weather-to-mission coupling.

### What feeds the simulator, and how honest each piece is

| Effect | How | Label |
|---|---|---|
| Wind, direction | Forecast 10 m wind scaled to flight altitude (`U·(alt/10)^0.14`) | MODEL + ASSUMED profile |
| Gusts | √((0.15·U)² + ensemble spread²); GFS adds its gust field | ASSUMED turbulence + MODEL |
| Air density → hover power | `phov × √(1.225/ρ)` from forecast temperature, pressure, humidity | DERIVED |
| Cold battery | −0.75 %/°C below 20 °C, floor 80 % | ASSUMED |
| Rain | Radar reflectivity → mm/h. Rain > 0.5 mm/h = NOT CLEARED (no published rain rating). Not in flight physics | DERIVED |
| Dust → visibility | Dust + rain light extinction → visibility. < 4.8 km (FAA 3 miles) = NOT CLEARED, < 8 km = CONDITIONAL | ASSUMED |
| Limits | 10 m/s wind, 0–40 °C; visibility ≥ 3 statute miles | SPEC (DJI P4 Multispectral); FAA 14 CFR 107.51(c) |

**Status per scenario:** NOT CLEARED for gusts over 10 m/s, rain, visibility under 3 miles, temperature out of range, an emergency landing,
or needing more batteries than you carry. CONDITIONAL for using every battery, landing near the reserve,
>5 % of survey time at full airspeed, >30° tilt (under 5° of control margin), >2 m tracking error, low coverage, dust or cold.
**Per hour:** NOT CLEARED if half or more scenarios are; CONDITIONAL if any is NOT CLEARED or half are CONDITIONAL; otherwise CLEARED.

**Known limits:** the planner sweeps with Flight Lab's fast point-mass simulator; the 6-DOF physics runs on the selected hour and scenario; one forecast grid cell for the whole field;
the simulator's return-home check assumes calm air, which is why strong headwinds can end in an emergency landing.
