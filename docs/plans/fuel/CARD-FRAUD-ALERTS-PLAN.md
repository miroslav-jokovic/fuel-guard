# Card fraud alerts — replacing the fill-anomaly queue with "a card used where its truck isn't"

Status: **APPROVED 2026-10-02** — the owner ruled the direction ("solve this as suggested") and then
every §6 recommendation ("proceed as suggested", 2026-10-02). Building from CF1.

Decision prefix `D-CF`, question prefix `Q-CF`, phases `CF0`–`CF8`.

## 1. Why — measured on production 2026-10-02

The owner reviews the Alerts page every day and reports that 100% of what it shows is unusable,
while a stolen card was used repeatedly the week of 2026-09-22 and nobody acted on it. Both halves
are true and both are measured:

**The queue is noise.** Last 60 days, real org (`86d6b3ea…`), excluding superseded:

| | Cases |
|---|---|
| Closed by a reviewer | ~2,030 dismissed + 10 resolved |
| Confirmed real | **3** (one is the reefer fuelled with ULSD, 2026-08-11) |
| Open today | 81 |

- `card_multi_vehicle` led **1,959** of them, **0 confirmed**. It mostly stopped after the HOS
  driver check (`cardMultiReconcile.ts`, 2026-09-05): 834 cases the week of 09-07, 13 the week of 09-28.
- `tank_space_exceeded` is what fills the queue today: **53 of 81 open**, 1 confirmed in 60 days.
  It compares the bill to ONE pre-fill Samsara sample. The owner's example (unit 786, 150.02 gal,
  "36% full, ~22.92 gal could not fit") is a truck with a learned capacity of 196.1 gal from 19 sensor
  samples that has billed 172, 169 and 166 gal before. The open cases claim 36–45 gal "could not fit"
  on average, whichever capacity source the truck has (auto/manual, sensor reliable or not). That is
  a sensor-timing gap, not a capacity problem and not theft.
- Of 3,811 tractor fills in 60 days, Samsara put the truck away from the station **once** (09-03,
  West Memphis). EFS Secure Fueling already refuses a fill when the truck is not at the pump, which
  is why: location, volume and consumption rules on APPROVED fills duplicate EFS's job.

**The stolen card was caught and drowned.** Declines over 30 days where Samsara says the truck was
NOT at the station: **13 rows on 5 cards**.

| Card | Truck | Attempts | Where the truck actually was |
|---|---|---|---|
| …27564 | 729 | South Bend, IN — 09-22 19:24 (failed the **odometer** prompt), 09-23 00:16, 09-27 12:46 | TN, AR, NV, TX |
| …37977 | 799 | Franklin, KY — 09-26 03:47 (failed the **driver ID** prompt), 09-26 22:42 | Pasco, WA eleven hours earlier |
| …07967 | 555 | Jacksonville, FL — 09-11 ×3, **again 10-01** | elsewhere |
| …77960 | 739 | Wayland, MO — 09-22 | elsewhere |
| …87149 | 735 | Harrisonburg, VA — 09-23 | elsewhere |

Every South Bend and Franklin row was scored `alert` and notified within 3–15 minutes
(`efsProcessing.ts` `emitDeclinedAlerts`). The notifications failed as a product, for two reasons:

1. **Volume.** 5 rows among ~1,290 notifications in 14 days (498 `card_status_changed`, 264 `system`,
   357 `declined_alert`). Recipients are hard-coded roles (`ALERT_ROLES`, `efsProcessing.ts:20`) and
   delivery is the web bell plus driver-app push; no office user gets email or SMS for a decline.
2. **Wording.** The body read `Unit 729: 3 — INACTIVE CARD IN0851565240|Non-Active Card|`. The
   sentence that mattered ("Samsara shows the truck was not at SOUTH BEND, IN…") was stored in
   `suspicion_reasons` and shown nowhere.

**Decline false alerts exist too.** `proximity_failure` (EFS "Merchant Position Too Far") weighs 85,
an alert on its own. In 30 days, 4 of its 6 rows were followed by a good fill from the SAME truck
within minutes (589 Gretna, 506 Effingham, 768 Bowman, 649 Corbin): EFS's geofence missing,
not theft. The two without a follow-up fill are Jacksonville (truck elsewhere per Samsara, the
stolen-card pattern) and Chicopee (Samsara says the truck was there).

`card_not_active` is 182 of 322 declines in 30 days. Under card control a card is off between
fills, so an inactive-card decline is normal. It means something only where the truck isn't.

## 2. What the product becomes

- **D-CF1. One alert: a card used where its truck isn't.** Raised from a decline OR an approved fill,
  whenever Samsara places the card's truck away from the station at that time, and no fill
  by the same truck at that station explains it (the existing `wrong_unit_number` exoneration,
  `declinedScoring.ts:164-210`). Nothing else raises an alert or sends an SMS.
- **D-CF2. One incident per card, not one alert per attempt.** Attempts on the same card within 72 h
  join one incident. Its text names the attempts, the place, where the truck was, and which EFS prompt
  failed: *"Card …27564 was tried 3 times in South Bend, IN. Truck 729 was in Memphis, TN. The
  first attempt failed the odometer prompt."*
  - **Escalation raises priority but makes no new incident.** It escalates on a repeat at the same far-away place, an
    attempt on a deactivated card, or a failed odometer/driver-ID prompt.
  - **Notification only at real changes.** One notification when the incident opens, and another
    only when it escalates or the place changes.
- **D-CF3. EFS's own rules are not duplicated.** On APPROVED fills, every location, volume,
  consumption, odometer and behaviour rule becomes a **note**. A note is stored on the fill and shown
  on the Fills page, and it never opens a case, notifies, or counts toward risk. Mechanically that
  means weight 0 in `catalog.yaml`, which the engine already routes to `case_signals_unscored`
  (Q-FUI17). The model exists; only the weights and the Fills page change.
  - **One exception: billed vs measured rise.** `tank_fill_short` (billed vs the Samsara before→after
    rise) stays a **Review**. It shows on the Alerts page and never notifies. It is the only check
    that sees fuel pumped into a second tank or a container, which EFS cannot see. It produced the
    reefer confirmation.
  - **`tank_space_exceeded` becomes a note.** It reads one pre-fill sample (§1).
- **D-CF4. Odometer is data quality, never fraud.** It is a note on the fill when the entered odometer
  differs from Samsara (OBD only) by more than the Q-CF2 threshold, plus a per-driver count for
  coaching.
- **D-CF5. Wrong unit number is a note.** It reads *"entered 632, the card's truck is 633"* on the decline. The
  signal exists (`wrong_unit_number`, `card_unit_typo`, weight 0); only the Declines tab shows it.
- **D-CF6. EFS proximity declines are notes when Samsara and a follow-up fill exonerate them.** They join an
  incident only through D-CF1 (truck elsewhere, no explaining fill).
- **D-CF7. Driver changing trucks is never an alert.** It is already a note under D-CF3. The
  existing HOS check stays as the reason text.
- **D-CF8. Recipients are chosen, not derived from roles.** Settings → Notifications gets a
  "Fraud alerts" list: an org member, plus email on/off, plus SMS on/off with a verified phone number.
  The bell and push keep their current role-based audience. Email and SMS go to the list only.
- **D-CF9. Detection starts fresh.** History is cleared or retired (Q-CF1). The new engine raises
  nothing for fills or declines dated before the epoch, which is the moment CF4 is served.

## 3. Phases

Ordered so the stolen-card alert reaches a phone before anything is removed.

**CF1 — store where the truck was.** On a decline, persist Samsara's observed position
(`samsara_observed_city/state/lat/lng`, as `fuel_transactions` already has) alongside the existing
`samsara_location_matched`. Today scoring keeps only the verdict. `efs_truck_position_at` and
`efs_proximity_miles` are 0/322 filled because the EFS reject export doesn't carry them, so we do not rely on them.
- **Shipped in two merges:** migration (new columns), then the writer and reader, because of
  `lint:migration-ordering`.

**CF2 — card fraud incidents.** A new table `card_fraud_incidents` (org_id, card_ref, vehicle_id,
opened_at, last_attempt_at, level, attempt count, places, the truck's positions, status,
disposition), with RLS enabled. A pure function in `packages/shared` folds declines and approved
fills into incidents by D-CF1/D-CF2, and the decline and fill scorers call it.
- **The fold is pinned before anything consumes it.** A PGlite matrix and unit tests pin it
  against the five real cards in §1, plus the four proximity rows that must NOT open an incident.

**CF3 — recipients in Settings.** A new table `fraud_alert_recipients` (org_id, user_id,
email_enabled, sms_phone, sms_verified_at, sms_enabled), with RLS enabled and writes through the API only.
- **Gate:** `requireSection("settings")` + `requireSurface("admin.settings.notifications")`, the
  same as the existing notifications save (`orgSettings.ts:65-78`).
- **Every change is audited.** It is recorded as `settings.fraud_recipients_saved`.
- **Phone verification:** the number is verified by a 6-digit code texted to it, which also records
  that person's consent. A member's email comes from their auth account.
- **Edits are not limited by section role.** A member can be added regardless of their section role. Receiving an alert grants
  no access; the link in the text opens a page the person must still be allowed to see.

**CF4 — delivery.** When an incident opens or escalates:
- the bell notification (category `card_fraud`, which needs the CHECK constraint extended);
- email to recipients through `mailer.ts`;
- SMS to verified recipients through `lib/sms.ts`.
- The text follows D-CF2 and links to the incident.
- **Dedupe:** per incident and escalation step.
- **Stale header:** the `sms.ts` header still says the account has no number. It has had one since
  2026-09-06 and has been verified since 09-30, so the header is corrected in this phase.
- **SMS blocker:** SMS is blocked on Q-CF3; email and bell ship without it.

**CF5 — approved-fill rules become notes (D-CF3, D-CF4).** Weight changes in `catalog.yaml`
(`pnpm gen:rules`; `RULESET_HASH` changes, and a `SCORING_VERSION` bump re-scores history under it).
- **Odometer rule** to the Q-CF2 threshold.
- **Old fill alerts stop.** Email (`notifyForTransaction`) and `fuel_alert` notifications stop for
  everything but `tank_fill_short` reviews.
- **The Detection metrics page** keeps measuring precision, now over incidents and the one review rule.

**CF6 — the Fills page shows notes.** Today a note reaches the user only through a tooltip on
fills that have no case (`FillsTab.vue:288-295`). The page gets a visible notes chip per fill
("Odometer 312 mi off Samsara", "Tank rose 20 gal less than billed"). The Declines tab shows the
D-CF5/D-CF6 notes the same way.

**CF7 — the case drawer, rewritten.** Three plain lines: what happened, why it may be fraud, and what to
check. Every number names its source and time ("Samsara, 09-22 19:20"). The score, weights and
near-miss history move behind "Details". Built from `apps/web/CLAUDE.md` and the existing
drawer's call sites, using the incident row from CF2.

**CF0 — the reset (D-CF9), run once CF5 is served.**
- **Detection epoch:** a per-org detection epoch timestamp is set, and the Alerts page, dashboard
  counts and digest read only cases on or after it.
- **History:** existing anomaly history is handled per Q-CF1.
- **Recompute:** decline `suspicion_level` and fill flags are derived values. They are re-scored
  under the new engine rather than edited by hand, and `reconcileAnomalyFlags` clears `has_anomaly`.
- **Audit:** the reset is an explicit, audited service-role act that names the actor, the epoch and
  the row counts. It is never a side effect of a deploy.

## 4. What the reset touches (measured from code, 2026-10-02)

- **`anomalies`, and the tables that cascade from it:** `anomaly_transitions`, `case_pattern_reports`,
  `pattern_sweep_requests`. `ai_verifications.anomaly_id` is set to null on delete.
- **Flags on fills:** `fuel_transactions.has_anomaly`, `max_severity`, `case_*`, mirrored into
  `fuel_txn_scores` by trigger.
- **Untouched:** `fuel_txn_dispositions` (human audit verdicts) — the 0261 comment forbids a
  rebuild from touching it.
- **Decline scores:** `declined_transactions.suspicion_*`, mirrored into `declined_txn_scores`.
- **Notifications:** `notification_events` rows with entity_type `anomaly` or `declined_transaction`
  have no FK, so they outlive a delete and must be handled explicitly.
- **Readers that change:** `dashboard_summary` (0347), `/api/reports/detection-metrics`,
  `/api/audit/recall-metrics`, `askData`, the weekly digest, the fuel-spend Findings inbox,
  Driver/Vehicle detail pages, and the fuel-log export.
- **Protections:** `anomalies` and `declined_transactions` are in `RETENTION_FORBIDDEN`, which bars
  prune rules, not an audited act. No trigger blocks a delete.
- **No bulk endpoint exists.** There is no bulk dismiss or close; the reset is new code either way.
- **Rebuild jobs:** the boot rebuild re-scores the last 14 days 45 s after every deploy
  (`rebuildScheduler.ts`), and a `SCORING_VERSION` bump re-scores 2,000 fills a night, oldest first.
  The epoch is what stops either of them re-raising old fills.

## 5. Expected result

From the §1 counts: the Alerts page goes from ~80 open items to about **6 incidents a month** (the
13 not-there declines on 5 cards over 30 days, grouped), plus `tank_fill_short` reviews (10 in 60 days).
Every incident reaches the chosen people by email and, once Q-CF3 clears, by SMS.

## 6. Questions — all ruled 2026-10-02 ("proceed as suggested")

**Q-CF1 — clean up by deleting history or by retiring it?** **RULED (a) retire.**
- **(a) Retire (recommended).** Close every open case with a new disposition `retired_reset_2026_10`
  (the 0034 CHECK is extended in a migration) and set the epoch, so nothing before it is shown.
  The pages read clean from that day, exactly as asked. The 2,030 reviewer verdicts stay in the database as the "before"
  measurement, which is how the new engine's precision gets compared to the old one in front of
  the bosses. The 3 confirmed cases remain as history.
- **(b) Delete.** An audited service-role delete of every `anomalies` row (with its cascades), the
  orphaned `notification_events`, and a re-score of every fill and decline. It is irreversible, and it
  destroys the only measurement of how wrong the old engine was.
- Either way, nothing before the epoch shows on any page.

**Q-CF2 — the odometer threshold.** **RULED: flat 100 mi.** The ">50 mi AND >1%" proposed
on 2026-10-02 turns out to be biased. 1% of a 550,000-mi truck is 5,500 mi, so old trucks would
almost never be flagged. Measured over 3,716 OBD-checked fills in 60 days:

| Threshold | Fills flagged (60 d) | Drivers |
|---|---|---|
| > 50 mi | 216 (~3.6/day) | 97 |
| > 100 mi | 147 | 72 |
| > 50 mi and > 25% of the miles since the last fill | 90 | — |
| > 50 mi and > 1% of the odometer | 60 (biased to newer trucks) | — |

- **Recommendation: a flat 100 mi.** It is a note, so its cost is reading time, not a false
  accusation. 100 mi is clear of any honest rounding, and it treats every truck the same.
- **The current rule** fires at > 10 mi with weight 45 (`odometer_tolerance_miles`), which is the
  515 appearances in §1.

**Q-CF3 — may the toll-free number carry staff fraud alerts?** **RULED: the owner asks Telnyx; SMS stays off until Telnyx answers yes. Still blocks CF4's SMS, not its email.**
- **The problem:** +1 833 352 1766 was verified with Telnyx for the use case "HR / Staffing", which
  covers texting applicants. Internal security alerts are a different use, and toll-free
  verification is reviewed per use case. Whether this needs an amendment, a second verification, or
  nothing is Telnyx's call. We have not asked, and we will not guess.
- **Recommendation:** the owner asks Telnyx support before CF4 ships. Email and bell go live
  regardless, so the stolen-card alert is not waiting on this.

**Q-CF4 — who may edit the fraud-alert list?** **RULED: `manage("settings")`, the existing Notifications gate.**
- **Recommended:** whoever may save Settings → Notifications today, i.e. `manage("settings")`, since
  the list sits on that screen and derives its gate from it.
- **The alternative:** a separate grant, if the owner wants fewer people able to add phone numbers.

## 7. Progress log

- 2026-10-02 — Plan written from production measurements in §1. Nothing built.
- 2026-10-02 — Owner ruled Q-CF1 (a) retire, Q-CF2 flat 100 mi, Q-CF3 owner asks Telnyx, Q-CF4 `manage("settings")`.
- 2026-10-07 — CF2 part 1 (F02-F04 PLAN.md chunk 5a): the pure fold `packages/shared/src/cardFraud.ts`,
  pinned against the 13 §1 declines (7 incidents) and the four proximity rows (none). Rebuilt from
  main; #1216 is not merged. Table (5b) and scorers (5c) follow as their own PRs.
- 2026-10-07 — CF2 part 2 (chunk 5b): migration 0438, the incident tables and their one writer, with
  the matrix replaying the 13 §1 declines through the real fold. The scorers (5c) follow.
