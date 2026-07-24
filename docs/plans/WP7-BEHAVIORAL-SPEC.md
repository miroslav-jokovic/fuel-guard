# WP7 — Behavioral Rules: Decisions + Implementation Record

**Status:** implemented · **Date:** 2026-07-24 · **Predecessors:** WP1–WP6 (+WP3b hotfix)

## 1. rapid_repeat_fueling — same-station split purchases exempt

The known FP class: a pump pre-auth cap forces a second swipe minutes later at the same pump, or a
driver pulls forward and tops off — both fired "rapid repeat." Now a pair at the **same station**
(site-name match, else city+state) inside the window is exempt: it's a split purchase, not a theft
interval, and the volume side stays fully covered by `cumulative_overfuel` + the tank rules.
Different-site pairs — the actual "card can't be in two places" signal — still fire, now with the
combined gallons and both site names in evidence. **Unknown location never exempts** (no guessing).

## 2. off_hours_fueling — truck-local time + no assumed schedule

Two fixes:
- **Station-local evaluation**: the fill's clock is judged in the STATION state's timezone (via the
  existing `stateTimeZone` map) — a 7pm-Pacific fill is no longer "9pm Central" for a Chicago office.
  Org tz remains the fallback when the station state is unknown.
- **No silently assumed schedule**: an org that never configured operating hours used to get a default
  05:00–20:00 America/Chicago window and alerts against it. `loadOperatingHours` now returns the 24/7
  sentinel (start == end → rule off) for unset config. Detection here is opt-in via settings, as a
  schedule-based rule must be; orgs that configured hours keep them verbatim.

## 3. cost_outlier — alive on real market data

Previously dead-by-default (static min/max, both null unless configured). Now, keeping org static
bounds first-priority when set, a **diesel tractor** fill priced **≥35% above the regional posted-diesel
median** fires on the global posted-price layer you already ingest (`fuel_prices_posted` ⋈ station
state, ±3 days, one vote per station, ≥5 stations required, USD/gal, posted prices only — cash quotes
never blended per 0064). Above-market only: an inflated price is the theft-relevant direction (receipt
inflation / collusion); cheap fuel is not misuse. Reefer (dyed) and gasoline fills are excluded from
the diesel-market comparison — category error otherwise. Median lookups are memoized per (state, day)
so rebuilds don't re-query per fill.

Weight stays 15 (corroboration-only) pending WP9 calibration.

## Verification

814 shared / 132 api / 19 web tests (10 new: same-site exemption incl. case/whitespace tolerance and
the never-exempt-on-unknown guard, station-tz firing both directions + the 24/7 sentinel, market
variant fire/spread/below-market/no-data matrix). Typecheck clean, eslint 0 errors, boundaries clean,
catalog byte-identical, file budgets held (only pre-existing `routes/fueling.ts` remains).

## Deploy

No migration. Deploy API. Then Rebuild: expect rapid-repeat reviews at truck stops to drop (split
purchases), off-hours signals to re-time to station-local (and disappear entirely for orgs that never
configured hours), and occasional new low-weight cost outliers where fills priced far over the
regional market.
