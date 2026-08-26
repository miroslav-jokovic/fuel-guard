# Avoidable idling — HOS-framed, evidence-based model (PLAN)

> **⚠ DORMANT (2026-08-26 truth pass):** dormant since 2026-07-18 — re-validate before building.

**Status:** proposal for review. No code changes beyond the APU source-of-truth fix already applied.
**Goal:** a per-truck avoidable-idle number that is duty-aware, temperature-aware and equipment-aware — no
systematic over-count, and every excluded minute explainable.

---

## 0. What's already fixed (separate from this plan)

The immediate "every truck is APU / everything is avoidable" bug is fixed and tested (not yet deployed):

- Avoidability is now granted **only** by the admin equipment flags on the Vehicles page
  (`has_apu` / `has_optimized_idle`). An explicit "no APU" now wins over any inferred pattern.
- The **learned** capability no longer makes idle avoidable — a diesel APU is invisible to telematics
  (engine-off at rest looks identical to a plain shutdown), so it's display/cross-check only.
- The learned badge was relabelled **"Engine-off rest"** (it was mislabelled "APU").

That stops the false positives. This plan is the second half: making the *amount* of avoidable idle precise
for trucks that genuinely have an alternative.

---

## 1. The core idea (agreed): frame idle by HOS duty status

Telematics tells us the engine was idling; it doesn't tell us **why the truck was parked**. HOS duty status
does. When a truck is parked the driver is in one of:

| Duty status | What it usually means | Idle treatment |
|---|---|---|
| **Sleeper Berth (SB)** | Rest in the bunk — hotel load (heat/AC/power) | **Prime avoidable target** — this is exactly what an APU replaces |
| **Off Duty (OFF)**, longer | Rest / break | Same as SB — hotel-load idle, APU-replaceable |
| **On Duty, not driving** | Loading, dock wait, fuelling, inspection, PTO work | **Grace period, then avoidable — unless the engine is cycling** (see §2a). |
| **Driving** | Traffic, lights | Not park idle — excluded by the min-duration floor already |

### On-Duty rule (per Miki)

An **operational grace period** (default ~15 min, configurable) is never avoidable — pre-trip, paperwork,
short loading. Continuous main-engine idle **beyond** the grace period is avoidable **unless** the engine is
cycling in an equipment signature (§2a). Note this grace is *operational*, separate from the pure engine
**warm-up** allowance, which OEMs put at only **3–5 min** (PACCAR: "idle 3–5 minutes before operating with a
load"; Navistar: "2 to 3 minutes"). So 15–20 min is a fair On-Duty work grace; it is not "warm-up" — the
engines don't need that long.

Anchoring "avoidable" on **SB + long OFF** rest-period idle is the right call: it's the coachable behaviour
("use your APU when you're resting"), and it excludes work idle we'd otherwise wrongly blame.

---

## 2. Push-back: fixed percentages per equipment are the wrong tool

Your examples — "APU → 70% avoidable, optimized idle → 50%" — are directionally right but should **not** be
hard-coded. This system's whole design principle is *judge from evidence, never assumption* (it's in the
module header). A flat "APU = 70%" is an assumption that's wrong in both directions:

- **Mild weather:** a working APU carries essentially the whole hotel load → a 10 h sleeper idle on the main
  engine is ~**100% avoidable**, not 70%.
- **Extreme cold (e.g. −15 °F):** even a good diesel APU / battery-HVAC can't fully hold cab temp, and
  battery-HVAC fades fastest → a real slice of main-engine idle is **legitimate**, so avoidable is well under
  70%.

The "% avoidable" is a **function of ambient temperature and the equipment's capability envelope**, not a
constant. Your own observation — "optimized idle runs ~50–60% of the time based on temperature" — is exactly
this: it's temperature-driven, and we can **measure** it per truck rather than guess it. So we keep your
intuition and replace the fixed numbers with a derived, temperature-conditioned envelope.

The honest target is **not "100% precise"** — we're inferring intent from sensors. The achievable, defensible
target is: no systematic bias, temperature/duty/equipment-fair, thin/ambiguous data excluded not guessed, and
every bucket (avoidable / justified / off / excluded) explainable on the row.

---

## 2a. Pattern recognition — equipment working vs. waste (grounded in OEM specs)

Your key point: if the engine is **turning on and off** during a park, that's the equipment *working*
(optimized idle holding cab temp, or an electric APU auto-starting the engine to recharge its batteries) —
**not** avoidable waste. Continuous, flat idle is the waste. We can tell them apart from the engine-state
time series, and the thresholds come straight from the OEM documentation, not guesses:

**Detroit "Optimized Idle" (factory defaults — DTNA operator manual):**
- **Thermostat cycling:** engine auto start/stops to hold a "comfort zone" of **±4/7/10 °F** around setpoint.
- **Battery-charge cycling:** engine **starts when battery drops below 12.2 V** and runs a **minimum of 2 h**,
  then shuts down — exactly the "turning on for battery charging" you described.
- **Extreme-temp continuous run (legitimate):** below **25 °F** or above **90 °F** ambient the system runs
  the engine **continuously** because the setpoint can't otherwise be held. → outside 25–90 °F, continuous
  idle on an optimized-idle truck is **justified, not avoidable**.
- **Stall-cycle:** if the setpoint isn't reached within 45 min it runs a **15-min on / 15-min off** cycle.

**Diesel APU — Thermo King TriPac Evolution (factory operator manual):** thermostat dead band **3 °F**; engine
**shuts down at setpoint, restarts on demand**; **battery restart at 12.2 Vdc** (runs until charge current
falls to ~12 A); Arctic pack starts the engine if coolant **< 35 °F**, runs until **55 °F**. Note the **12.2 V
restart appears in BOTH Detroit optimized idle and the Thermo King APU** — a consistent, cross-manufacturer
number, so it's a safe default, not a guess.

**Electric APU — recharge method is unit-specific (important):** run the cab on a battery bank (Carrier says
**7,500 BTU/hr for ~11 h**), but *how they recharge differs*, and that changes the expected engine pattern:
- **Carrier ComfortPro Electric (factory manual):** recharges via the **truck alternator (while driving) or
  optional shore power** — it does **NOT** auto-start the main engine. → on these trucks, main-engine running
  during a rest is **not** an expected recharge cycle (likely waste, or a genuine cold/Arctic event).
- **Volvo's electric system:** **does** auto-start the main engine when batteries get low. → here, short
  engine-on bursts separated by long Off stretches **are** legitimate battery-charge cycles.

So "engine cycling = equipment working" holds for diesel APUs and optimized idle universally, but for electric
APUs only where the unit is documented to auto-start. Where we can't tell the sub-model, treat brief isolated
engine-on bursts conservatively (not avoidable) but flag them.

**Detection signatures** (from the engine on/off series we already store per park session):
| Signature | Reading | Verdict |
|---|---|---|
| Repeated Off↔On transitions, high Off share | Thermostat / battery-charge cycling | Equipment working → **not avoidable** |
| Short On bursts, long Off gaps, on an electric-APU / optimized truck | Battery recharge | **Not avoidable** |
| One long continuous On, little/no Off, **inside** 25–90 °F band | Alternative not used | **Avoidable** |
| Continuous On **outside** the equipment's temp band | Extreme-weather run | **Justified** |

This is what `buildIdleSessions` already measures (`cycles`, `offShare`, `mode`) — we extend it with the
OEM-grounded temperature band and battery/thermostat thresholds instead of the single crude "continuous vs
apu_or_off" split.

## 3. Proposed avoidable model (per rest period)

For each park session that overlaps an **SB or long-OFF** rest period, split the parked time:

```
rest period ─┬─ engine OFF            → good behaviour (APU / shut down). Never avoidable.
             ├─ engine IDLE, justified → temperature outside the equipment's capable band,
             │                           + bounded warm-up / DPF-regen allowance. Not avoidable.
             └─ engine IDLE, avoidable → main-engine idle that a working alternative COULD have carried.
```

`avoidable = rest-period main-engine idle − justified idle − tolerances`, conditioned on equipment:

**A. APU-class (diesel APU / battery-HVAC / shore power) — admin-confirmed**
Within the equipment's temperature band the APU carries hotel load → main-engine idle there was unnecessary →
**avoidable**. Outside the band (or when engine-state evidence shows the APU wasn't running) → **justified**.
Naturally lands near-total in mild weather and tapers in extremes.

**B. Optimized idle (OEM ECU start/stop) — admin-confirmed**
The engine is *meant* to cycle to hold setpoint, so **cycling** idle is the feature (not waste). Using the
Detroit factory band: **inside 25–90 °F** the system should cycle → continuous non-cycling idle there is
avoidable; **outside 25–90 °F** it runs continuously by design → justified. Avoidable = continuous idle inside
the band, minus the battery-charge cycles (12.2 V → 2 h run) and tolerances. If the truck cycled normally →
~0 avoidable; if it idled flat-out inside the comfort band with the feature off → the excess is avoidable.
This is where your "50–60%" comes from — **derived from the truck's own cycling pattern + temperature against
the OEM band**, not a fixed number.

**C. No equipment / unconfirmed**
No alternative → rest-period idle is **not** the driver's avoidable waste (unavoidable / unconfirmed). Flagged
so an admin sets the equipment. (This is the fix already shipped.)

**Universal tolerances** (bounded minutes, applied before avoidable, any equipment):
- **Cold-start warm-up / cool-down** — OEM guidance is short: PACCAR **3–5 min** warm-up before load and
  **3–5 min** cool-down after full load; Navistar **2–3 min**. So a ~5-min allowance, not more.
- **DPF parked regen** — periodic (roughly every 1–3 days, ~20–45 min at elevated idle), cannot run on an APU
  → a bounded allowance when the regen engine-state signature (sustained elevated idle) is present. Detect it;
  don't hard-code a schedule.

---

## 4. Equipment capability envelopes

`apu_type` already distinguishes diesel APU / battery-HVAC / fuel-heater / shore-power / none — good, because
their temperature envelopes differ (battery-HVAC fades in extreme cold faster than a diesel APU; a fuel-heater
is heat-only and does nothing for summer AC). The band per type can start from sane defaults and, where we
have enough data, be **learned per truck** from the temperature at which that truck actually starts bumping
the main engine. The fleet already learns a comfort band from its idle-vs-temperature histogram — the same
machinery extends to a per-equipment capable band.

---

## 5. Data we need (new)

1. **HOS / ELD duty-status logs** from Samsara (`/fleet/hos/logs` or equivalent) — not currently pulled. Per
   driver: status (D / ON / SB / OFF) with start/end. New sync job + storage table, backfillable like the
   idle/engine-state history.
2. **Alignment** HOS(driver) ↔ park session(truck): via the driver↔vehicle assignment at time *T* — we
   already resolve this (`matchAssignmentAt` / assignment intervals) for idle attribution, so the plumbing
   exists.
3. **Fallback** when HOS is missing (no ELD, team drivers, personal conveyance, yard moves): fall back to the
   current temperature/PTO event model, **labelled lower-precision**, and exclude from the confident total if
   coverage is thin — never guess.

---

## 6. Confidence gating

A truck-period only feeds the headline avoidable total when: equipment is **confirmed**, HOS coverage over the
period is adequate, and engine-state coverage is adequate. Otherwise it's shown but **excluded** (the existing
"confident vs low-data" treatment). This keeps the fleet number honest.

---

## 7. Suggested phasing

- **P0 (done):** APU source-of-truth fix + badge relabel. Removes the systematic over-count now.
- **P1:** Pull + store HOS duty-status logs; backfill; align to park sessions. Surface SB/OFF vs ON idle
  split on the truck row (no scoring change yet — just show the duty breakdown so we can eyeball it).
- **P2:** Temperature-conditioned avoidable per equipment class (envelopes + tolerances), replacing the flat
  continuous-idle = avoidable rule. Unify the truck tab and driver tab onto this one definition.
- **P3:** Per-truck learned envelopes (once a season of data exists), with defaults until learned.

---

## 8. Decisions

**Confirmed by Miki (2026-08):**
- **HOS coverage — FULL.** Every driver (company + owner-operator) runs Samsara ELD. So the HOS path carries
  essentially the whole fleet; the temperature/PTO fallback is a rare edge case (missing log / yard move), not
  a main path.
- **Equipment inventory — will be COMPLETE.** Miki is setting each vehicle on the Vehicles page to APU /
  Optimized idle / None. So `has_apu` + `apu_type` + `has_optimized_idle` become the trustworthy source of
  truth the whole calc gates on. (Until a truck is set it stays "unconfirmed / needs equipment" and is
  excluded from the headline — never guessed.)

- **On-Duty idle (per Miki):** a ~15-min operational grace, then avoidable — **except** when the engine is
  cycling in an equipment signature (battery-charge / thermostat), which is the equipment working, not waste.
  Grounded in §2a pattern recognition + OEM specs. (Separate from the 3–5 min engine warm-up.)

**Still open (lower stakes — sane defaults proposed, confirm or adjust):**
1. **Tolerances:** start with OEM-grounded defaults (≈5-min warm-up/cool-down; a DPF-regen allowance when the
   signature shows) and **learn** thresholds from data later. → confirm.
2. **Envelopes:** start from OEM/per-equipment temperature defaults (Detroit 25–90 °F cycling band for
   optimized idle; diesel APU widest; battery-electric narrower in extreme cold + auto engine-start to
   recharge; fuel-heater heat-only; shore-power full), refine to per-truck learned bands over a season. → confirm.
3. **Headline scope:** the avoidable-$ headline counts **confirmed-equipment, HOS-covered** trucks only;
   everything else shows as "unconfirmed / needs equipment" rather than skewing the number. → confirm.

---

## 9. References (authoritative — thresholds grounded here, not invented)

- **Detroit "Optimized Idle" operator manual (DTNA / Freightliner)** — auto start/stop triggers: battery
  **12.2 V → 2 h** run, oil temp 60–104 °F, comfort-zone **±4/7/10 °F**, **continuous run below 25 °F / above
  90 °F**, 15-on/15-off stall cycle. https://dtnacontent-dtna.prd.freightliner.com/content/dam/public/dtna-servicelit/ddc/pdfs/OperatorsManual/Other_Misc/DDC-SVC-MAN-0019.pdf
- **ORNL "Summary of OEM Idling Recommendations from Owner's Manuals" (ORNL/TM-2016/50)** — PACCAR warm-up /
  cool-down **3–5 min**; Navistar **2–3 min**; extended idling discouraged (Volvo, International, PACCAR).
  https://info.ornl.gov/sites/publications/files/pub61263.pdf
- **EPA SmartWay — Idle Reduction** — eliminating unnecessary idling saves **>900 gal/truck/yr**; categories
  of idle-reduction tech. https://www.epa.gov/smartway/idle-reduction
- **Argonne National Laboratory — Idle Reduction Research** — main-engine rest idle burn (~0.8 gal/hr basis
  the code already uses) and APU savings. https://www.anl.gov/esia/idle-reduction-research
- **Heavy Duty Trucking — electric APU technology** — battery-electric APU runtime **~10–11 h**, recharge via
  shore power or **automatic main-engine start** when batteries low (Volvo).
  https://www.truckinginfo.com/articles/beat-the-heat-apu-technology-goes-mainstream
- **Thermo King TriPac Evolution — official operator manual (TK 55711-19-OP)** — diesel APU: thermostat dead
  band 3 °F, auto shutdown at setpoint, **battery restart 12.2 Vdc**, Arctic coolant 35 °F → 55 °F.
  https://www.thermoking.com/content/dam/thermoking/documents/products/TriPac%20EVOLUTION%2055711-19-OP.pdf
- **Carrier ComfortPro Electric — official operator manual (62-12077)** — electric APU: recharged by truck
  alternator / shore power (no auto engine-start), A/C ≥65 °F, heat ≤85 °F, default 70 °F.
  https://reefersales.com/wp-content/uploads/2022/04/62-12077_B-Operators-Manual-ION-Electric-and-Electric.pdf
