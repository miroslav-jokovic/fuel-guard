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
   `samsara_vehicle_id`. ⚠ **Corrected the same day: this is not bad data.** All five are McLeod
   rows created 2026-09-08 / 09-14 with VINs, and `FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md` measured the
   fleet as 193 trucks with 181 gateways — 12 pulled or not yet fitted. A truck with no tracker
   cannot be drawn; the gap to fix is that the board says NOTHING about it (LS3).
5. ~~Unit 568 is a device swap split across two rows~~ ⚠ **Withdrawn the same day.** 568 is `- OLD`
   (gateway swapped) AND `- SOLD` — owner-stated 2026-09-22: a sold truck stays active in McLeod
   until the buyer collects it. That is correct, expected, and not to be flagged. It matters here
   for a different reason: **eight sold-awaiting-pickup trucks (506, 550, 557, 568, 572, 592, 594,
   607) sit in the "offline over 7 days" bucket**, engines off, gateways asleep. Samsara shows them
   "Off"; we showed them offline. D-LM29's rule moves them to `parked` without any new "sold" fact —
   membership stays McLeod's (D-FC0).
6. Minor: we call > 3 mph moving; Samsara starts a trip at 5 mph. 8 trucks flipped moving ↔ stopped
   in the same 2.5 minutes, which is ordinary stop-and-go and not addressed here.

## 2. Decisions

**D-LM29 — the engine state is collected, stored, and becomes the input that tells `stopped` from
`parked`, and `parked` from `offline`.** The collector asks the positions feed for `gps,engineStates` (one request, as now); the
latest engine event per truck is stored beside its position (0394) and advanced on its own clock.
The state NAMES do not change: `stopped` already means "stationary, engine on" and `parked`
"stationary, engine off" — only the evidence behind them changes, so D-LM9's reason for keeping
the word `idle` off the map is untouched. Fix age remains the fallback for a truck whose engine
state is unknown. The rule (`deriveVehicleState`):

| engine | fix | state |
|---|---|---|
| `Off` | fresh, > 3 mph | moving (the GPS can lead the engine event by seconds after a start) |
| `Off` | anything else, **any age** | parked — a switched-off truck going quiet is not a lost signal |
| `On`/`Idle` | older than 15 min | **offline — last reported running, now silent** |
| `On`/`Idle` | fresh, > 3 mph | moving |
| `On`/`Idle` | fresh, still | stopped |
| unknown | — | the old ping-rate inference |

**D-LM30 — each state has its own marker shape** (LS2, #1159): arrow (moving, the only one that
rotates), lit disc (stopped), "P" square (parked), slashed hollow disc (offline). One geometry
module feeds both the map canvas and the rail, so the legend cannot drift from the map.

## 3. Steps (each one PR, in order)

| step | what | depends on |
|---|---|---|
| LS1a | 0394: `engine_state` + `engine_state_at` on `vehicle_positions`, writer advances them independently | — |
| LS1b | collector requests `engineStates`, on a NEW feed cursor so it seeds every truck's current state from the head | LS1a applied |
| LS1c | contract + `deriveVehicleState` read the engine state; board serves it | LS1b in production; offline rule measured from the stored states |
| LS2 | marker shape per state (arrow / ring / square / hollow), polish | LS1c |
| LS3 | the board names the trucks it cannot draw (no tracker) instead of omitting them silently; the shop trucks read as "in shop" — they stay on the map (Q-LM8a) | LS1c |
| LS4 | census redesign in the rail | LS2, LS3 |

## 4. Progress log

- 2026-09-30 — audit written; LS1a built (0394 + 12 matrix assertions, two mutants caught: the
  tenant filter and the go-forward guard on the engine clock). **Merged #1155.**
- 2026-09-30 — LS2 merged (#1159). LS1b (collector) built; the cursor is renamed
  `vehicle_positions_engine` so the first tick seeds every truck's CURRENT engine state from the
  feed head. Findings 4 and 5 corrected above; the "offline" half of finding 2 turns out to be
  D-LM29's to fix, not a separate LS3 rule.
- 2026-09-30 18:12 UTC — LS1b live (#1160). The fresh cursor seeded **every** non-retired truck's
  engine state on the first tick (190 of 190: Off 83, On 74, Idle 33). The D-LM29 rule, measured
  against the old one on the same rows at the same instant:

  | | moving | stopped | parked | offline |
  |---|---|---|---|---|
  | ping-rate rule | 65 | 20 | 56 | 49 |
  | engine-state rule | 65 | 36 | 83 | **6** |

  43 `offline` → `parked` (engine off), 20 `parked` → `stopped` (idling), 4 `stopped` → `parked`.
  Six snapshots 25 s apart: **52 trucks changed state under the old rule, 14 under the new**, and
  the 14 are mostly moving ↔ stopped, which is traffic. The six still `offline` were last reported
  RUNNING and went silent 1–13 days ago (579, 802, 769, 707, 663, 563) — a gateway that lost power
  with the engine on, which is exactly what the word should name. LS1c ships.
