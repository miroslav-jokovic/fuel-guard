# Warning desk — Samsara warnings become follow-ups one person works · 2026-11-26

**Status:** plan, owner-approved in principle 2026-11-26 ("proceed with all as suggested and
recommended; solve the open questions on the best research"). Every question this plan raised is
answered in §6 with the reasoning that chose it; none is left open. Decision IDs **D-WD**,
question IDs **Q-WD** (both unused in the repo before this file).

## 0. The ruling in one paragraph

Samsara already detects the problems — a trailer losing air, a dying battery, a driver tailgating, a
defect nobody fixed — and it already tells the driver. What nobody does is **notice that it keeps
happening and pick up the phone**. Silvicom 360 collects the warnings an admin selects, folds every
repeat of the same problem on the same truck, trailer or driver into **one follow-up**, and opens it
only when the problem repeats past the rule's number (the "Nth time"). One person — or more — in the
**Maintenance** section works that list: calls the driver, sends the unit to the shop, closes it with
a note. No video is stored; no Samsara setting is changed; the measured load is **~22 follow-ups per
working day** across every source (§1.6), tunable by the admin.

## 1. Measured reality (live Samsara org 6308 + production DB, read-only, 2026-11-26)

### 1.1 Alerts on the account
- **17 alert configurations**, ~**5,270 incidents / 30 days**. Idling 2,473, Harsh Event 1,304,
  Out of Route 587 = 83% of volume. `GET /alerts/configurations` + `GET /alerts/incidents/stream`
  both answer 200 with the production token (Read Alerts).
- Every incident carries `conditions[].triggerId`, `details.<kind>.vehicle {id,name}` and
  `driver {id,name}` (geofence alerts carry vehicle only), `happenedAtTime`, `isResolved`,
  `resolvedAtTime`, `updatedAtTime`, and an **`incidentUrl` that is unique per incident** (1,764 of
  1,764 in 10 days) — it is the dedupe key (D-WD4).
- **5 of 17 configurations are two-condition** (e.g. battery < 12 V AND engine off); 197 of 1,764
  incidents carried >1 condition. Samsara webhooks only fire for single-condition alerts
  ([Alert Webhooks](https://developers.samsara.com/docs/webhook-reference)), and retry 5 times then
  drop ([Webhooks](https://developers.samsara.com/docs/webhooks)). → polling, D-WD2.
- The **"Harsh Event"** configuration's only action is a webhook (`1964860816422226`) that no longer
  exists in `GET /webhooks` — 1,304 events/month notify nobody. Not ours to fix (token is read-only
  for alerts), and not needed by this plan (safety events are read directly, §1.3). Owner action
  listed in §5 WD0.

### 1.2 Tires — the owner's example is the trailer ATIS lamp
- The driver's photos (Aug 13, Freightliner tablet): Samsara Driver app inbox, **"ATIS Lamp On —
  Please check your trailer tires. The system has detected an air leak."** repeated five times in two
  days. ATIS = the trailer's Automatic Tire Inflation System (Hendrickson); Samsara's
  [Maintenance Status](https://kb.samsara.com/hc/en-us/articles/360042885132-Maintenance-Status)
  defines the lamp as on > 10 minutes, likely a low tire.
- The "ATIS Lamp On" trigger is **not API-enabled**: its configuration does not appear in
  `/alerts/configurations` (17 listed; none is ATIS), so its incidents cannot be streamed.
- The **reading** is: `GET /readings/history?readingId=atisLamp&entityType=asset&assetTypes=trailer`
  returns `{entityId, value:"on"|"off", happenedAtTime}`. **120 trailers report it.** 30 days =
  ~780,000 rows / 8,933 on↔off changes / **755 lamp-on episodes ≥ 10 min on 29 trailers**.
  A 30-day window answers **504**; 3-day windows succeed (D-WD5).
- Rule "3 episodes in 7 days per trailer" → **20 follow-ups / 30 days**; "1 episode" → 37.
- Trucks report nothing: `stats?types=tirePressure` is empty for every vehicle and no truck fault
  code names a tire. Trailer TPMS readings (`axleNtirefromleftMpressure`) exist in the catalogue,
  unused on our trailers today — admin can switch them on later with no code (§7).

### 1.3 Safety events (the "harsh event" volume) and video
- `GET /safety-events/stream`: **1,309 events / 30 days, 159 drivers, 1,157 with video.**
  Labels: FollowingDistance 754, UnsafeParking 184, Braking 162, MaxSpeed 82, SevereSpeeding 69,
  HarshTurn 23, RollingStop 20, RanRedLight 8, DefensiveDriving 7, ForwardCollisionWarning 4,
  Crash 2, LaneDeparture 2.
- Samsara's own coaching inbox is not worked: **needsCoaching 894, needsReview 200, coached 214.**
- Each event's `media[].url` is a signed link on `us4-safetymediadelivery.samsara.com`; measured
  lifetime **≈ 8.1 hours** (`exp` param); `GET /safety-events?safetyEventIds=<id>` returns a fresh
  one (200, `video/mp4`, range requests work). → never store video, D-WD7.
- Crash video is replaced by a blurred placeholder for API tokens (Samsara Sensitive Assets,
  measured 2026-09-23) — the desk opens crash events in Samsara instead (D-WD7).

### 1.4 Defects, engine lamps, HOS
- **DVIR defects:** `GET /defects/stream` → 187 defects / 120 days, **46 open**, 44 open > 3 days.
  Every one of the 79 `fleetpal_defects` rows of the same 120 days matches a Samsara defect within
  15 minutes — FleetPal holds a copy of Samsara's DVIR; Samsara is the source (D-WD3).
- **Engine lamps:** `GET /fleet/vehicles/stats?types=faultCodes` (one page, 254 vehicles):
  active trucks now with **red STOP lamp 3**, amber/MIL only **41**.
- **HOS violations:** `GET /fleet/hos/violations` → 741 / 30 days: unsubmittedLogs 590,
  shiftDrivingHours 52, shiftHours 48, restbreakMissed 40, cycleHoursOn 11.

### 1.5 What the repo already has (verified at call site)
- IDs: `vehicles.samsara_vehicle_id` (0012), `drivers.samsara_driver_id` (0015),
  `trailers.samsara_asset_id` (0030). Driver phone `drivers.phone` (0003). No `tel:` link exists in
  `apps/web/src`.
- Trailer → truck now: `trailers.assigned_vehicle_id` + `pairing_source` (0030/0041). Driver ↔ truck
  history: `driver_vehicle_assignments` (0051, Samsara) and `duty_equipment_segments` (0086, driver
  app, authoritative where present).
- Samsara client: `loadSamsaraToken` (per-org sealed token, env fallback,
  `modules/samsara/lib/samsaraToken.ts`), `samsaraFetch` (lane rate limit, 429/5xx retry,
  `lib/samsaraHttp.ts`), `listAllPages`, cursors in `samsara_feed_cursors (org_id, feed, end_cursor)`
  (0288) — a new feed is a new `feed` value, no migration.
- Scheduling: `startTier` / `runOrgTier` (`lib/tierRunner.ts`), jobs ledger single-run
  (`org/jobs.ts`, `JobConflictError`), handlers registered in `queue/handlers/index.ts`.
- Nothing pulls safety events, alert incidents, defects, fault codes or readings today.
- Permissions: Maintenance = `manage` for admin, fleet_manager, technician; `view` for auditor,
  accountant (`packages/shared/src/auth.ts` `SECTION_ACCESS`). Screens are `SURFACES`
  (`surfaceCatalogue.ts`), overridable per role (`org_role_surface_access`, 0296) and per user
  (`user_surface_access`, 0298) on the Permissions page.
- Retention: `RETENTION_RULES` (`modules/org/dataRetentionPolicy.ts`).
- Bell: `notify()` (`modules/messaging/notify.ts`), categories `NOTIFICATION_CATEGORIES`.
- CSP (`apps/api/src/appHttp.ts`) has **no `media-src`**, so it falls back to `'self'` and would
  block Samsara's video host — WD4 adds it.
- Texting hired drivers is blocked on consent (Q-TR9,
  `docs/plans/training/SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS-2026-11-24.md`) → v1 calls, does not text.

### 1.6 The load the default rules produce (simulated on the last 30 days)

| Source → rule (default) | Subject | Follow-ups / 30 d |
|---|---|---|
| Trailer ATIS lamp ≥ 10 min, **3 in 7 days** | trailer | 20 |
| Battery / cranking alerts (3 configs), **3 in 7** | truck | 55 |
| Critically low fuel, **3 in 7** | driver | 3 |
| Speeding alert (> 126 km/h 3 min), **3 in 7** | driver | 2 |
| Dashcam disconnected, **1** | truck | 7 |
| Out of route, **3 in 7** (desk + dispatch) | truck | 75 |
| Safety — serious behaviour, **1** (per driver per day) | driver | 59 |
| Safety — other behaviour, **3 in 7** | driver | 109 |
| HOS driving-limit violation, **1** (per driver per day) | driver | 63 |
| HOS unsubmitted logs, **3 in 7** | driver | 41 |
| DVIR defect still open after **2 days** | truck/trailer | ≈ 47 ongoing (187 / 120 d) + **44 backlog on day one** |
| Red STOP lamp, **1** | truck | 3 on now; ongoing rate measured in WD7 |
| Amber / check-engine lamp on **3 days** | truck | 41 on now (day-one backlog) |
| **Total ongoing** | | **≈ 480 / month ≈ 22 per working day**, plus ≈ 88 day-one backlog |

At 5–10 minutes each that is 2–4 hours a day: one person, with room. Out of route (75) is shared
with dispatch. Off by default and why: idling (owner ruling — fuel matter, `idle` module),
predatory-towing geofence (real-time; it already pushes to the role and the driver — a desk call
minutes later adds nothing), temperature (reefer, 0 incidents), harsh-braking and rolling-stop
alerts (duplicates of safety events), "DVIR submitted" alert (duplicate of defects).

## 2. Findings that shape the design

1. **Collecting is easy; grouping is the product.** 5,270 alerts + 1,309 safety events + 755 ATIS
   episodes a month would bury anyone. One follow-up per *problem*, opened at the Nth time, is the
   whole simplification.
2. **Three kinds of source, one shape.** Event sources (alert incidents, safety events, HOS), lamp
   sources whose state must be watched for onsets (ATIS, engine lamps), and an open-item source
   (DVIR defects). All three normalise into one row: *what, who, when, still active?*
3. **Samsara is read, never written.** The token is read-only for Alerts and Webhooks
   (measured 2026-09-06); the plan needs no write and changes no Samsara setting.

## 3. Decisions

- **D-WD1. A desk in Maintenance, one screen.** New surface `maintenance.follow-ups`, path
  `/shop/follow-ups`, label "Follow-ups", group `maintenance`, gate `section("maintenance")` — so
  admin, fleet_manager and technician see it by default and the auditor/accountant read it. Who works
  the desk is decided on the existing Permissions page (role or single user), not by a new role and
  not by a hand-written list (Q-WD1).
- **D-WD2. Poll, don't webhook.** One Samsara tier every **5 minutes** reads the incremental streams
  with persisted cursors (`samsara_feed_cursors` feeds `alert_incidents`, `safety_events`,
  `dvir_defects`, `atis_lamp`); engine lamps every 15 minutes (one stats page); HOS violations hourly
  over the last 48 hours (logs certify late). Reason: two-condition alerts cannot webhook (§1.1),
  webhooks drop after 5 retries, and polling needs no Samsara change. Measured cost: < 1 request/s
  peak, far inside the 5–10 req/s limits.
- **D-WD3. Samsara is the one source for DVIR defects.** FleetPal's copy is a mirror (§1.4); reading
  both would show every defect twice. The Shop home keeps its FleetPal defect count unchanged.
- **D-WD4. One normalised warning table, owned by the `samsara` collector.** `samsara_warnings`
  (org_id, source, source_key, rule_key, subject_kind truck|trailer|driver, vehicle_id, trailer_id,
  driver_id, samsara names for unmatched units, label, happened_at, ended_at, still_active,
  samsara_url, detail jsonb ≤ 2 KB) — unique `(org_id, source, source_key)`; `source_key` is the
  incidentUrl / safety event id / defect id / `trailerId:onsetISO` / `vehicleId:lamp:onsetISO` /
  `driverId:type:startISO`. Re-reads update `still_active`/`ended_at` in place (an UPDATE, never a
  partial upsert — `lint:upserts`). Roster ids are resolved at write time through roster's interface;
  an unmatched unit keeps its Samsara name and is shown "not in roster". Lamp onsets need the last
  known state: `samsara_lamp_states (org_id, entity_kind, entity_id, lamp, is_on, since)`, same
  owner. **Retention: 90 days** (`RETENTION_RULES`, `happened_at`) — follow-ups keep their own copy of
  what matters (count, first/last time, labels).
- **D-WD5. ATIS read in short windows.** Live: from the cursor's last time to now (minutes). Backfill
  and catch-up: 3-day windows (30 days answers 504). An episode = lamp `on` until `off`; **an episode
  shorter than 10 minutes is not a warning** (Samsara's own lamp definition); two episodes less than
  30 minutes apart are one (a leaking tank cycles). Only episodes are stored, never the 26,000 raw
  readings a day.
- **D-WD6. Follow-ups are a harness module, `followups`.** Owns `follow_up_rules`, `follow_ups`,
  `follow_up_actions`. It reads warnings only through `modules/samsara`'s exported
  `listWarningsSince` / `readWarning` (D-ARC3); boundary edge `followups -> samsara` declared in
  `scripts/check-feature-boundaries.mjs`.
  - **A follow-up** = one `(org_id, rule_key, subject)` that is not closed. Fields: status, severity,
    category, warning_count, first_at, last_at, looks_fixed, warned_after_contact, assignee_id,
    phone snapshot. Partial unique index on `(org_id, rule_key, subject_kind, subject_id) where
    status <> 'closed'` — one open follow-up per problem.
  - **Opening:** after each sync, `evaluateFollowUps(orgId)` counts the subject's warnings under that
    rule inside the rule's window; at ≥ N it opens one. Every later warning attaches (count + 1,
    last_at); if the follow-up was already *Called driver* it gets **"Warned again after the call"**
    and returns to the top.
  - **Statuses (four, plain words):** *New* → *Driver called* → *Sent to shop* → *Closed*
    (outcome **Fixed** or **Not a problem**, note required for *Not a problem*).
  - **Looks fixed:** when every attached warning has ended and none arrived for 24 hours (lamp off,
    defect resolved, alert resolved), the line shows "Looks fixed — confirm". It never closes itself:
    a person confirms, so a fix is a recorded act (D-WD9).
  - **After Closed**, the count starts again from the next warning.
- **D-WD7. Video is played from Samsara, never stored.** `GET /api/follow-ups/:id/video/:eventId`
  calls `GET /safety-events?safetyEventIds=` and returns the fresh signed URLs (≈ 8 h life); the page
  plays them in `<video>`. CSP gains `media-src 'self' https://*.samsara.com`. Storage cost: zero
  bytes; one Samsara call per click. Crash events (Sensitive Assets placeholder) show "Samsara keeps
  crash video restricted — Open in Samsara", linking `inboxEventUrl`.
- **D-WD8. Coaching state stays Samsara's.** The token cannot write safety events. The line shows
  Samsara's state (`needsCoaching`, `coached`…) read back on the stream, plus **Open in Samsara**.
  Closing our follow-up does not change Samsara, and the page says so in the drawer.
- **D-WD9. Every action is a row.** `follow_up_actions` is append-only (trigger, like
  `part_movements`): actor, action (`called`, `no_answer`, `sent_to_shop`, `note`, `closed_fixed`,
  `closed_not_a_problem`, `reopened`, `assigned`), note, at. Status lives on `follow_ups` and is
  changed only through one RPC `transition_follow_up` that writes both (pattern: 0158
  `transition_anomaly`). Kept with no retention rule — it is the record of who told which driver what.
- **D-WD10. Rules are admin-only, defaults are derived, not restated.** The catalogue of rule kinds
  and their defaults lives once in `packages/shared/src/followUpRules.ts`: fixed kinds (`atis`,
  `safety_serious`, `safety_other`, `hos_driving`, `hos_unsubmitted`, `dvir_open`, `lamp_stop`,
  `lamp_amber`) and **one kind per Samsara alert configuration**, `alert:<configurationId>`, whose
  default is computed from its trigger type ids (§1.6: on for 1000, 1005, 1007, 1012, 1027 and any
  1029/1034; off for 1003, 1019, 5016, 5033, 5039, 5005). `follow_up_rules` stores only an admin's
  override (enabled, N, window days, category, severity). Settings card **"Follow-up rules"**
  (surface `maintenance.follow-ups.rules`, gate `ADMIN`) lists the live configurations from
  Samsara beside the fixed kinds. A configuration added in Samsara tomorrow appears in the card with
  its derived default — nothing to code.
- **D-WD11. Serious safety behaviours** (N = 1, one follow-up per driver per day): Crash,
  RanRedLight, ForwardCollisionWarning, SevereSpeeding, Drowsy, MobileUsage, NoSeatbelt,
  ObstructedCamera, DidNotYield. Everything else is *other* (3 in 7). The list is a constant in
  `followUpRules.ts`, editable per label by the admin.
- **D-WD12. Categories:** Maintenance (ATIS, battery, lamps, DVIR, dashcam, low fuel), Safety (safety
  events, speeding), Compliance (HOS), Route (out of route). Severity: **Urgent** = crash, red STOP
  lamp, panic button; **High** = serious behaviour, HOS driving limit, ATIS on > 4 h in one episode;
  **Normal** = the rest. The list sorts Urgent → High → Normal, then "warned again", then oldest.
- **D-WD13. Dispatch sees Route follow-ups on its own screen.** Surface `dispatch.route-follow-ups`,
  path `/loads/follow-ups`, gate `section("dispatch")`, the same page component with category fixed
  to Route. The API checks the surface that matches the follow-up's category, so a dispatcher can act
  on Route and nothing else. One record: whoever acts first, both screens show it.
- **D-WD14. The bell only for Urgent.** New category `follow_up_urgent`; `notify()` to every user who
  can see `maintenance.follow-ups`, deduped per follow-up. Everything else waits on the list — a desk
  is a list, not an alarm.
- **D-WD15. Who is the driver.** Driver-based sources carry the driver. For truck sources, the driver
  is the one on the warning when Samsara names one, else `driver_vehicle_assignments` at that time.
  For a trailer (ATIS), the truck is `duty_equipment_segments` at that time, else the trailer's
  current `assigned_vehicle_id`, then its driver as above. The line says which source named the
  driver ("from the driver app" / "from Samsara" / "trailer pairing"), so a guess is never shown as a
  fact.
- **D-WD16. Calling, not texting, in v1.** Phone as a `tel:` link plus Copy. Texting a hired driver
  waits on Q-TR9 — when it lands, a "Text driver" action is one more `follow_up_actions` value.
- **D-WD17. Start-up.** WD2 backfills 7 days of warnings (the longest default window) so counts are
  right on day one; open items (DVIR, lamps) open immediately. Expect ≈ 88 backlog lines the first
  day. Samsara's 894-event coaching backlog is **not** imported: safety follow-ups open only for
  events from the backfill window on.

## 4. What the screen looks like

**Maintenance › Follow-ups** — list, phone-and-tablet first (DataTable card mode under 768 px):

| Column | Example |
|---|---|
| Problem | **Trailer tire losing air** · ATIS lamp, 5 times in 3 days |
| Unit / driver | Trailer R535973 · truck 847 · Angel Perez (from the driver app) · 📞 |
| Last time | 2 h ago |
| State | New · Warned again after the call · Looks fixed — confirm |

Filters: category tabs (All · Maintenance · Safety · Compliance · Route), "Mine", "Closed". The
drawer: the warnings in time order, Samsara links, video player (safety), action buttons **Called
driver · No answer · Sent to shop · Close — fixed · Close — not a problem**, note box, the action
history. Wording follows the Maintenance glossary (plain words, no "incident", no "ATIS" without
"tire" beside it).

## 5. Steps

### WD0 · Owner actions in Samsara (no code, not blocking)
Remove or re-point the dead webhook action on the "Harsh Event" alert (§1.1). Nothing else in
Samsara changes.

### WD1 · Tables · *next-numbered migration*
`samsara_warnings`, `samsara_lamp_states` (owner `samsara`); `follow_up_rules`, `follow_ups`,
`follow_up_actions` + append-only trigger + `transition_follow_up` RPC (owner `followups`). RLS
enabled, no client policies. New tables only — no column-and-reader ordering risk. Ownership rows
added to `docs/ARCHITECTURE.md` §2/§4. `RETENTION_RULES`: `samsara_warnings` 90 days.

### WD2 · Collector (after WD1 is on staging)
`modules/samsara/warnings/`: one file per source (`alertIncidents.ts`, `safetyEvents.ts`,
`dvirDefects.ts`, `atisLamp.ts`, `engineLamps.ts`, `hosViolations.ts`) each normalising to the
D-WD4 row; job kind `sync_warnings`; tier `SAMSARA_WARNINGS_SYNC_MINUTES` default 5; 7-day backfill
on first run. Tests: recorder tests per source (org-scoped, dedupe on re-read, episode merge < 30 min,
< 10 min ignored, 504 → 3-day windows).

### WD3 · Rules and evaluation
`packages/shared/src/followUpRules.ts` + `followUpContract.ts`; `modules/followups/evaluate.ts` run
after each sync. Tests: N-in-window opening, attach, warned-again, looks-fixed, close then fresh
count, one open per problem under concurrency.

### WD4 · API
`/api/follow-ups` list/detail/transition/video; `/api/follow-ups/rules` (admin). `requireSurface` per
D-WD1/D-WD13; CSP `media-src`.

### WD5 · Screens
`/shop/follow-ups` page + drawer, `/loads/follow-ups` (Route), Settings card "Follow-up rules".
Surfaces added with icon, route and snapshot (`check-surfaces`). First `tel:` link.

### WD6 · Bell
`follow_up_urgent` category + `notify()` fan-out (D-WD14).

### WD7 · Release and measure
Release; after 14 days record in §8: follow-ups opened per rule vs §1.6, median time New → closed,
share closed *Not a problem* per rule (a rule above 50% gets its N raised), red-STOP-lamp ongoing
rate.

## 6. Questions — all answered

| # | Question | Answer and why |
|---|---|---|
| **Q-WD1** | Who works the desk — new role? | **No new role.** Surface in Maintenance; the admin grants it to a role or a single user on Permissions (0296/0298). A new role would be a second source of truth beside the matrix. |
| **Q-WD2** | What is the default "Nth time"? | **3 in 7 days** for repeating warnings; **1** for serious safety, crash, red STOP lamp, dashcam, HOS driving limit; **open > 2 days** for DVIR; **on 3 days** for amber lamps. Gives ≈ 22/day (§1.6). |
| **Q-WD3** | Webhooks or polling? | **Polling** every 5 min — two-condition alerts can't webhook; drops after 5 retries; no Samsara change needed. |
| **Q-WD4** | Store harsh-event video? | **Never.** Fresh signed link per click (≈ 8 h life). Zero storage. |
| **Q-WD5** | Can we mark "coached" in Samsara from our page? | **Not with our read-only token.** Show Samsara's state, link to it. Asking for write scope buys one click and costs a wider key — not worth it. |
| **Q-WD6** | DVIR from FleetPal or Samsara? | **Samsara** — FleetPal's rows are a copy (79 of 79 match). |
| **Q-WD7** | Tire data for trucks? | **None exists** in Samsara for our trucks; ATIS covers trailers. TPMS readings can be enabled later as a rule kind. |
| **Q-WD8** | Towing-zone alert on the desk? | **Off by default** — real-time, already pushed to driver and role. Admin can turn it on. |
| **Q-WD9** | Out of route: dispatch or desk? | **Both, one record** (D-WD13). |
| **Q-WD10** | Text the driver? | **Not in v1** — Q-TR9 consent. Call + note. |
| **Q-WD11** | How long to keep warnings? | **90 days** raw; follow-ups and actions kept. |
| **Q-WD12** | Import Samsara's coaching backlog (894)? | **No.** Start from the 7-day backfill; the backlog belongs to Samsara's inbox. |

## 7. Out of scope (deliberately)

Writing to Samsara; texting drivers (Q-TR9); creating FleetPal work orders from a follow-up (waits on
the shop managers' task lists, ~2026-12-04 — "Sent to shop" records the hand-off only); driver-app
screens; trailer TPMS and wheel-end temperature rules (catalogue entries, enable later); idling.

## 8. Log

- 2026-11-26 — Plan written from live measurements; owner asked for all recommendations to stand and
  all questions to be answered (§6).
- 2026-11-26 — **WD1–WD3 built** (migration 0653; `modules/samsara/warnings/`, `modules/followups/`,
  `orchestration/warningDesk.ts`, job kind `warning_desk`, scheduler `warning-desk` on the `general`
  lane). Four refinements of §3, each simpler than what it replaces:
  - **No `samsara_lamp_states` table (D-WD4).** A lamp that is on IS a warning row with `still_active`;
    an "off" ends it and an "on" within 30 minutes re-opens the same row. The episode is the state.
  - **Samsara ids, not roster foreign keys, on warnings and follow-ups (D-WD4/D-WD15).** A
    `drivers(id)` FK would oblige every driver merge to move the row (`check-driver-references`), and a
    unit Samsara lists but the roster does not ("783 - OLD") would have nowhere to go. The API joins the
    Samsara id to the roster when it draws a line (WD4); who holds a trailer NOW is read then, which is
    the person to call.
  - **"Looks fixed" and "warned again after the call" are derived, not stored (D-WD6).** The follow-up
    keeps `active_count` and `contacted_at`; both states are computed when the line is drawn
    (`looksFixed`, `warnedAfterContact` in `followUpRules.ts`), so neither can go stale.
  - **The tick lives in `orchestration/`, not in the Samsara scheduler.** The desk's rules decide what
    the collector reads (idling incidents are never fetched), which is a cross-module chain — the
    orchestration layer is its sanctioned home. Five-minute cadence, no new env variable; the Samsara
    kill switch (`SAMSARA_SYNC_HOURS=0`) stops it too.
  - Defects read 180 days back on the first run (a defect is not "updated" until it is fixed, and 44 of
    46 open ones were older than three days). HOS is re-read over the last two days at most hourly.

- 2026-11-27 — **WD6-a merged** (#2682, migration 0654): `notification_events`' CHECK and
  `NOTIFICATION_CATEGORIES` gain `follow_up_urgent`. Nothing writes it until WD6-b, its own merge.
- 2026-11-27 — **WD4 + WD5 built** in one PR: `/api/follow-ups` (list, detail, actions, video, rules) and the
  three screens — Maintenance › Follow-ups (`/shop/follow-ups`), Loads › Route follow-ups
  (`/loads/follow-ups`, the same page fixed to Route), Settings › Follow-up rules (admin only). As built:
  - **Who works the desk is two screens and the section behind each.** Seeing needs `maintenance.follow-ups`
    (every category) or `dispatch.route-follow-ups` (Route alone); acting also needs `manage` on that
    screen's section, so the auditor and the accountant read and change nothing. A line in a category the
    caller cannot see answers 404, not 403, so a dispatcher cannot probe for safety lines.
  - **Who to call is read when the line is drawn**, through roster's new `readSamsaraSubjects`: a driver's
    problem — that driver; a truck's — the driver Samsara has on the truck now, else the one it named on the
    warning; a trailer's — its truck now, then that truck's driver ("trailer pairing"). A Samsara name the
    roster cannot match is shown with "not in roster" and no phone. D-WD15's "from the driver app"
    (`duty_equipment_segments`) is not read in v1: one driver has an app login on 2026-11-27.
  - **Alert rule labels come from Samsara's configuration names, cached ten minutes per org** (the list
    refreshes every minute; the tick reads them fresh). Samsara down: the fixed kinds still resolve, the
    card says so, and a line whose configuration is gone reads "Samsara alert".
  - **No second audit row for an action**: `follow_up_actions` is the record (D-WD9). Rule saves and resets
    are on the Audit page (`settings.follow_up_rule_saved` / `_reset`).
  - **Video**: the event must be one of the follow-up's own warnings before Samsara is asked; a crash is
    never fetched (Sensitive Assets) and opens in Samsara. CSP `media-src` gains `https://*.samsara.com`.
