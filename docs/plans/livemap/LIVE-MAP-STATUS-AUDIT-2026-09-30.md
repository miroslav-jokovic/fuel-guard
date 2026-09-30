# Live map status audit — 2026-09-30

The owner compared the live map's Moving / Stopped / Parked / Offline census against the Samsara
dashboard and found it wrong, the offline count included. This records what was measured, the
decisions taken, and the steps. Decisions continue the `D-LM*` series in `LIVE-MAP-PLAN.md`; the
dated log at the end of that plan points here.

## 1. What was measured (production, 2026-09-30 ~17:05 UTC)

The feed is **not** late: `received_at − sampled_at` averages 3.2–3.4 s. The census is wrong
because of how a state is DERIVED, not how fast it arrives.

| state | trucks | fix age |
|---|---|---|
| moving | 76 | 3–13 s |
| stopped | 20 | 3–25 s |
| parked | 46 | 32–880 s |
| offline | 48 | 52 min – 190 days |

1. **`stopped` vs `parked` is a coin toss.** `deriveVehicleState` infers "engine on" from a fix
   ≤ 30 s old, on D-LM9b's premise that Samsara pings every ≤ 5 s while the engine runs. The
   not-moving trucks' ages spread evenly 0–350 s (17/11/12/10/4/8/1 per 50 s band) — no cluster
   under 30 s. Six snapshots 25 s apart: **29 trucks flipped `stopped` ↔ `parked`** with nothing
   about them changing. Samsara's dashboard reads the ECU's `engineStates` (On / Idle / Off); we
   never requested it (`types=gps` only, `samsaraDeltaFeeds.ts`).
2. **`offline` conflates "engine off for days" with "device not reporting".** By fix age: 1 in
   15 min–1 h, 2 in 1–6 h, 3 in 6–24 h, 20 in 1–7 days, 22 over 7 days. Samsara calls a gateway
   offline by its CONNECTION; a truck switched off on Friday is "Off", not offline.
3. **All 6 `maintenance` trucks are on the board** and count as offline when stale (660: 190 days).
4. **Five `active` trucks are not on the board at all** — 797, 800, 811, 812, 813 have no
   `samsara_vehicle_id`, so the census total is short of Samsara's.
5. **Unit 568 is a device swap split across two rows** — `568 - OLD` is `active` on the retired
   gateway (29.7 days stale, counted offline); `568` on the current gateway is `retired` and hidden.
   See the `samsara-old-suffix-is-a-device-swap` finding.
6. Minor: we call > 3 mph moving; Samsara starts a trip at 5 mph. 8 trucks flipped moving ↔ stopped
   in the same 2.5 minutes, which is ordinary stop-and-go and not addressed here.

## 2. Decisions

**D-LM29 — the engine state is collected, stored, and becomes the input that tells `stopped` from
`parked`.** The collector asks the positions feed for `gps,engineStates` (one request, as now); the
latest engine event per truck is stored beside its position (0394) and advanced on its own clock.
The state NAMES do not change: `stopped` already means "stationary, engine on" and `parked`
"stationary, engine off" — only the evidence behind them changes, so D-LM9's reason for keeping
the word `idle` off the map is untouched. Fix age remains the fallback for a truck whose engine
state is unknown.

## 3. Steps (each one PR, in order)

| step | what | depends on |
|---|---|---|
| LS1a | 0394: `engine_state` + `engine_state_at` on `vehicle_positions`, writer advances them independently | — |
| LS1b | collector requests `engineStates`, on a NEW feed cursor so it seeds every truck's current state from the head | LS1a applied |
| LS1c | contract + `deriveVehicleState` read the engine state; board serves it | LS1b in production; offline rule measured from the stored states |
| LS2 | marker shape per state (arrow / ring / square / hollow), polish | LS1c |
| LS3 | offline = not reporting, not "engine off"; maintenance trucks out of the census; the five unlinked trucks and 568 fixed at the source | LS1c |
| LS4 | census redesign in the rail | LS2, LS3 |

## 4. Progress log

- 2026-09-30 — audit written; LS1a built (0394 + 12 matrix assertions, two mutants caught: the
  tenant filter and the go-forward guard on the engine clock).
