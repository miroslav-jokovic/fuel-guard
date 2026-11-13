# Home time: dispatchers mark it, the board shows it, the right people are told — plan

Status: **PROPOSED 2026-11-13.** Asked by the owner on 2026-11-13: a button for dispatchers to mark a
driver who is going on home time, with the return time; notifications the office controls from Settings
(dashboard, email, SMS, and the Dispatch board's Warnings column); alerts when home time is about to end,
when it is overstayed, and when a truck has been at the driver's home for more than 8 days.

Decision IDs `D-HT*`, open questions `Q-HT*`, steps `HT1`–`HT7`. This plan closes **Q-LA1** of
`LOADS-ACTIVITY-PLAN.md` with its answer (b), "the office marks home time in Silvicom", and builds the
first working part of `docs/plans/notifications/NOTIFICATION-ROUTING-PLAN.md` (D-NR2..D-NR5), which has
been PROPOSED and unbuilt since 2026-10-02.

## 1. What is true today (measured 2026-11-13, production unless said)

| Fact | Value | Where it was read |
|---|---|---|
| `driver_time_off` rows | **0**. The table exists since migration 0068 and nothing writes it | production |
| Its columns | `driver_id`, `start_at`, `end_at`, `kind` (comment: home_time / pto / unavailable), `provider` (default `mcleod`), `external_id`, `raw` | `supabase/schema.generated.sql` |
| Who reads it | Only the fuel rule "fuel bought while the driver was home" (`anomalies/scoring/tmsGates.ts`): start ≤ fill + 1 day, and `end_at` null or ≥ fill − 1 day. **A null `end_at` means "still off"** | code |
| The board for a driver who is home | "Empty", Available **"Now"** in red, as if the truck could take a load | `DispatchBoardTable.vue`, `availableAt()` |
| Board actions | None. A row click opens the truck drawer; the drawer has only links | `DispatchTruckDrawer.vue` |
| McLeod `driver` table | Has `next_home_date`, `last_home_date`, `home_duration`, `return_home_flag`, `home_location_id`, `pta_date` | live `lme`, `information_schema` |
| Can we read those | **No.** The connector login (`silvicom_dispatch_ro`) is refused on each column, on `lme` and on `lme_analytics` | live probe, each column by itself |
| Are they filled in | **Not known.** It cannot be measured with our login; see Q-HT1 | — |
| Office accounts | admin 6, dispatcher **3**, fleet manager 1, safety manager 1, recruiter 1, technician 1 | `memberships` |
| McLeod dispatchers | 16 active logins; **2** linked to a Silvicom account; 13 of 16 fleets linked to a dispatcher | `tms_dispatchers`, `tms_fleets` |
| Team trucks | 4 trucks with a co-driver | `vehicles.co_driver_id` |
| Drivers | 186 active; 185 have a home city and ZIP; `on_leave` status used by 0 | `drivers` |
| Bell | Works; per-person mute exists; 0 people have set a preference | `notification_preferences` |
| Email alerts | One carrier-wide list (`organizations.notification_emails`, 1 address) for every alert | code, production |
| SMS | Telnyx toll-free number, verified 2026-09-30. Sends to applicants only. **No office phone number is stored anywhere** (`memberships`, `user_profiles` have none) | code, schema |
| Routing | Who receives an alert is decided in fourteen places. `NOTIFICATION-ROUTING-PLAN.md` designs one matrix; none of it is built; Q-NR1..5 are unanswered | that plan §1, §6 |
| Staff SMS on the applicant number | Ruled allowed by the owner (D-NR5, 2026-10-02) | that plan §2 |

## 2. What other products do (web research, 2026-11-13)

- **McLeod LoadMaster** sells a "Time-Off and Event Calendar" with home time tracking and automatic home
  events ([McLeod driver management](https://www.mcleodsoftware.com/solutions/driver-management-software/)).
  Its page could not be opened by our fetch (403); the summary is the search result's. Whether Silvicom's
  McLeod has it switched on is Q-HT1.
- **LoadOps**: Dispatch page → driver → View Details → ⋮ → "Request Time Off"; fields are previous load,
  location, start and end. The board then shows a grey "Vacation/Time Off" block and the driver cannot be
  assigned. Four clicks to reach the form; no return reminder
  ([LoadOps help](https://help.loadops.com/driver-time-off-report)).
- **An open-source logistics app (PR #531, merged 2026-10-15)**: time off is a section on the driver's
  card; every list says "Off until Oct 20" and sorts those drivers last; one live period per driver;
  periods are cancelled, never deleted; alerts about that truck are paused while its driver is off
  ([pull request](https://github.com/akosiArvin081596/logistics-app/pull/531)).
- **Planning-board advice**: home time is a locked block on the same board as hours and appointments,
  and a promised home date deserves the weight of a delivery appointment
  ([Scale Alpha](https://www.scalealphasi.com/blog/dispatch-software-for-trucking-companies),
  [Transplus](https://www.transplus.io/blog/how-a-tms-can-help-with-driver-scheduling)).
- **Telematics vendors** treat "parked at home" as normal and alert on dwell time past a limit
  ([ERM](https://www.ermtelematics.com/post/how-to-set-up-geofence-alerts-for-fleets)). That is the
  owner's 8-day rule.

What we take from them:

1. Put the action where the dispatcher already is (the truck's row), not four clicks away.
2. Say "Home until <date>" in the place that today says "Now".
3. One live period per driver; never delete, always record who changed what.
4. No product found sends a return reminder. The owner's three alerts are new work, not a copy.
5. Every forgotten "he is back" click becomes a false "overstayed" alert. The system must close a period
   itself when McLeod shows the driver hauling again (D-HT6).

## 3. The design

### 3.1 The record

**D-HT1 — Home time is a period on the driver, stored in `driver_time_off`.** The table already exists,
belongs to `roster`, is already carried by a driver merge, and is already what the fuel rule reads. No
second table. Our rows have `provider = 'silvicom'` and `kind = 'home_time'`.

**D-HT2 — `end_at` stays "when it actually ended"; the promise is a new column.** The fuel rule already
treats a null `end_at` as "still off", so the meaning must not change. New columns:

| Column | Meaning |
|---|---|
| `expected_return_at` | when the driver is due back (the time the dispatcher enters) |
| `truck_disposition` | `with_driver` · `at_yard` · `no_truck` |
| `vehicle_id` | the truck the driver had when the period was marked |
| `note` | free text, optional, shown only to people who can view Dispatch |
| `created_by`, `created_at`, `updated_by`, `updated_at` | who marked and last changed it |
| `ended_by`, `end_reason` | `returned` · `load_evidence` (the system, D-HT6) · `driver_left` |
| `canceled_at`, `canceled_by` | marked by mistake; the row stays |

State is **derived from the times, never stored**: *scheduled* (start in the future), *active*, *overdue*
(active and past `expected_return_at`), *ended*, *canceled*. Nothing has to run for a scheduled period to
become active.

**D-HT3 — One live period per driver, enforced inside the write function.** `home_time_mark` locks the
driver's row, refuses when a scheduled or active period exists, and returns that period so the screen can
show it. Not a unique index: `merge_driver` moves these rows, and an index would make a merge of two
drivers who are both home fail.

**D-HT4 — The driver's roster status does not change.** `drivers.status` has `on_leave`, used by nobody,
and status belongs to McLeod for linked drivers. Home time is a period, not a status; flipping status
would drop the driver from lists that have nothing to do with a week at home.

**D-HT5 — Nothing is written to McLeod** (D-LMR1 stands).

**D-HT6 — The system ends a period when McLeod shows the driver working.** Evidence: a load whose
`driver_id` or `co_driver_id` is this driver has a stop with `actual_arrival_at` or `actual_departure_at`
later than the period's start. The alert job (D-HT13) ends the period at that time with
`end_reason = 'load_evidence'`, writes the audit row, and shows "Ended by the system: on load 0136753" in
the history. A dispatcher can **Reopen** it. Reason: an overstay alert about a driver who is on the road
is the kind of false alarm that got 80% of the bell ignored (routing plan §1). McLeod's actual stop
times are filled on 762 of 762 delivered loads (LOADS-ACTIVITY-PLAN §2). Samsara "driving" is not used
as evidence: a driver heading home is also driving.

### 3.2 Who may do what

**D-HT7 — Marking is a named permission, `roster.home_time`, on by default for the roles that manage
Dispatch** (admin, fleet manager, dispatcher — derived with `rolesThatManage("dispatch")`, never typed).
The dispatcher role holds `roster: view` only, and the row is a roster row, so neither section alone says
this. The codebase's answer for that case is a permission by name on the roster routes (the recruiter's
applicant row; `notes.manage_all` in `rolePermissions.ts`). It appears on Settings → Permissions like the
others. Reading home time needs `dispatch: view`.

### 3.3 Where the dispatcher does it

**D-HT8 — Three entry points, one form.**

1. **The truck drawer** (click any board row): a new first section, "Home time", per seat. One primary
   button, **Mark home time**. Two clicks from the board to the form.
2. **A "Home time" tab on the board**, between the queues and History: everyone scheduled, home or
   overdue — overdue first, then by return time — with a **Mark home time** button in the header that
   starts with a driver search. This is where a dispatcher plans ahead when a driver calls, and where a
   driver with no truck row is found.
3. **The driver page**: the same section, for a driver without a truck.

The form:

| Field | Default | Rule |
|---|---|---|
| Driver | from the row; on a team truck, a choice of seat | required |
| Leaves | the truck's **Available** time when it carries a load, else now | up to 30 days back |
| Returns | empty; time prefilled 08:00, carrier time | required, after Leaves and after now |
| Truck | the driver's answer on his previous period; empty the first time | required: *Goes home with the driver* / *Stays at the yard*. Hidden for a driver with no truck |
| Note | empty | optional |

Dates are MM/DD/YYYY on the carrier's clock, like every other date. When *with the driver* and the stay
is longer than the limit (D-HT12), the form says so before saving; it does not refuse.

After saving, the section shows the period and its actions: **Back from home time** (one click, ends it
now), **Change return** (re-arms the alerts), **Truck is back at the yard**, **Cancel** (asks to
confirm), and the history of changes with names and times.

### 3.4 What the board shows

**D-HT9 — The row carries `homeTimes`, added after the 20-second row cache**, as note chips are (D-UN18):
one small read per request, so a mark or a "Back" shows on the next poll. Up to two entries per row, one
per seat.

**D-HT10 — Available tells the truth.**

| Situation | Available | Sorts and filters as |
|---|---|---|
| Driver home, truck with him | neutral badge **Home until 11/18 08:00** | free at the return time, at the truck's position |
| Driver home, truck at the yard | unchanged (the truck is free for another driver) | unchanged |
| Team truck, one seat home | unchanged | unchanged |
| In shop | In shop (wins, as today) | as today |

`available.basis` gains `home_time`, set on the server, so State / Near / Free and the default sort need
no special case in the browser.

**D-HT11 — Warnings chips**, drawn like the note chips, each naming the seat on a team truck:

| Chip | Tone | When |
|---|---|---|
| Home time from 11/20 | neutral | scheduled |
| Driver home until 11/18 | neutral | active, truck at the yard or a team seat |
| Back in 18 h | amber | inside the warning window |
| Home time overdue 1 d 4 h | red | past the return time |
| Truck at home 9 days | red | truck with the driver past the limit |

The two red ones set a new flag `homeTimeUrgent`, which joins `needsAttention`. The Needs attention tab,
its count and the Operations dashboard cards that link to it follow without their own change (D-FM7).

The Loads **Activity** view stops saying it cannot tell home time from idle: a driver's idle days inside a
period read "Home time" (this is Q-LA1's close).

### 3.5 The three alerts

**D-HT12 — Thresholds are the carrier's settings**, in a new one-row-per-org table `home_time_settings`
(roster's), edited on Settings → Notifications beside the alerts they drive:

| Alert | Fires | Default | Repeats |
|---|---|---|---|
| **Home time ending** (`home_time_return_due`) | this long before the return time | 24 h | once per return time |
| **Home time overstayed** (`home_time_overdue`) | this long after the return time, period not ended | 2 h | daily, at most 7 times, until ended or the return is changed |
| **Truck at home too long** (`home_time_truck_limit`) | truck *with the driver*, this long after the start | 8 days (8 × 24 h) | once |

Dedupe keys carry the period id and the return time (or the day number for a repeat), so a changed
return re-arms an alert and a retried job never sends twice.

**D-HT13 — One new scheduler entry, `home-time`, lane `general`, every 15 minutes**, registered in
`SCHEDULERS` (`apps/api/src/schedulers.ts`) so the lane's lease runs it in exactly one process; off with
`HOME_TIME_ALERTS_ENABLED=false`. Each run, per org: end periods on load evidence (D-HT6), end periods of
drivers who left the company, then plan and send the three alerts. The planning is a pure function in
`packages/shared` (`planHomeTimeAlerts(periods, settings, now, alreadySent)`), as `planFileAlerts` is.

### 3.6 Who is told, and how — the first part of the routing plan

**D-HT14 — Home time is the first alert sent through the routing plan's resolver and sender**, not a
fifteenth private audience. Built here, to that plan's design:

| Routing plan piece | Built in this plan | Left to that plan |
|---|---|---|
| NR1 catalogue | the catalogue file, with the three home-time alerts | the existing alerts' entries, the `system` split |
| NR2 storage | `notification_routes`, `notification_contacts`, plus `notification_deliveries` | — |
| NR3 resolver + sender | `recipientsFor`, `sendAlert` (bell, email, SMS) | moving the fourteen existing senders |
| NR4 settings page | the routing section, showing the alerts in the catalogue | the 30-day count for old alerts |
| NR5, NR6 | — | all of it |

**D-HT15 — Routes are alert × recipient × channel.** A recipient is a role, a person, or one of two
relations the resolver works out per period:

- **Whoever marked it** (`created_by`) — always a real account.
- **The truck's dispatcher** — truck's fleet code → `tms_fleets` → `tms_dispatchers.user_id`. Today this
  resolves for 2 of 16 dispatchers; the rest need linking in Settings → McLeod fleets (owner task 1).

A person's own switch beats their role's (D-NR2). If an alert resolves to nobody, it goes to everyone who
manages Dispatch and the job logs it: an alert addressed to nobody is a failure, not a quiet success.

Defaults on day one (all editable):

| Alert | Whoever marked it | Truck's dispatcher | Fleet manager role |
|---|---|---|---|
| Home time ending | bell | bell | — |
| Home time overstayed | bell | bell | bell + email |
| Truck at home too long | bell | bell | bell + email |

SMS starts off for everyone, because nobody has a confirmed number yet.

**D-HT16 — Channels.**

- **Dashboard** = the bell, through `notify()`; its per-person mute still applies. Clicking opens the
  board's Home time tab on that driver.
- **Email** goes to the member's login email. One email per person per run listing everything new, never
  one per driver (the DQ alerts' rule).
- **SMS** goes to the member's confirmed mobile number. One text per person per run ("2 drivers overdue
  from home time: J. Smith, R. Diaz"). Names and dates only; the note is never sent by email or SMS.
- **Warnings column** is not a route: everyone who can view Dispatch sees the chips.

**D-HT17 — A phone number is confirmed by its owner.** New "My alerts" item in the account menu: what I
receive (read-only) and "Text alerts": enter a mobile number, receive a 6-digit code, type it in
(`notification_contacts`: number, hashed code, attempts, `verified_at`, `stopped_at`). The confirmation
is the consent record. A reply of STOP switches that person's SMS off and the Settings page shows it.
The inbound webhook learns to look in `notification_contacts` as well as the applicants' list.

**D-HT18 — Texts wait for morning.** Between 21:00 and 07:00 carrier time an SMS is held in
`notification_deliveries` (`not_before`) and sent at 07:00; the bell and email are not held. The window
is a setting on the same page.

**D-HT19 — `notification_deliveries` is the per-channel record**: one row per alert, person and channel,
with status (queued, sent, failed, skipped and why) and the provider's message id. It is the email and
SMS dedupe (D-NR4), the held-SMS queue, and what the Settings page counts for "sent in the last 30 days"
(D-NR6).

### 3.7 What follows without being built for it

- The fuel rule "fuel bought while the driver was home" starts answering, since the table has rows. It is
  a supporting signal only and cannot open a case by itself. It must skip canceled rows: that filter ships
  in HT2, one merge after the column (migration discipline).
- The driver app may already read a driver's own rows (RLS, 0136). No driver screen is built here.

## 4. Every case, and what happens

| Case | Behaviour |
|---|---|
| Team truck, one seat goes home | Period on that driver; the truck runs; chip names him |
| Both seats go home | Two periods; Available says "Home until" the later return |
| Driver has no truck | Marked from the Home time tab or the driver page; no truck question; listed on the tab |
| Driver is moved to another truck while home | The chip follows the driver's seat; the 8-day rule keeps reading `truck_disposition` until someone presses "Truck is back at the yard" |
| Truck goes to the shop | Available says In shop; the chip stays |
| Dispatcher forgot to mark it | Leaves may be up to 30 days back |
| Return time already passed when typed | Refused: "that time has passed" |
| Driver asks for more days | Change return; audit keeps old and new; alerts re-arm |
| Driver comes back early | Back from home time |
| Nobody presses Back | D-HT6 ends it on the first stop of his next load; until then the overstayed alert is right |
| System ended it wrongly | Reopen (refused if a newer live period exists) |
| Marked by mistake | Cancel; the row stays with who and when |
| Two dispatchers mark the same driver | The second gets the first one's period back (D-HT3) |
| Driver leaves the company while home | The job ends the period (`driver_left`); no alerts |
| Two driver records are merged | Rows move with the merge, as today; readers take the newest live one |
| Nobody resolves for an alert | Falls back to everyone who manages Dispatch; logged |
| Recipient muted the bell category | Bell skipped; email and SMS follow their own switches |
| Staff member replies STOP | SMS off for them, visible on the Settings page |
| Org without the Dispatch module | No button, no tab, no job work |
| Clock change (DST) | All inputs and thresholds are instants; entry and display use the carrier zone helpers |

## 5. Steps (one PR each, in this order)

- **HT1 — Schema, one migration.** `driver_time_off` columns and CHECKs (kind, disposition, end reason);
  write functions `home_time_mark / change / end / cancel / reopen` (service role only);
  `home_time_settings`; `notification_routes`, `notification_contacts`, `notification_deliveries`; the
  three categories in the `notification_events` CHECK. With it: RLS on each new table,
  `scripts/table-modules.json`, `supabase/schema.generated.sql`, the tenant-isolation matrix, a
  `home-time` PGlite matrix, and the retention classification of the three new tables
  (`dataRetentionPolicy.ts` is at 499 of 500 lines, so it is split first in the same PR). No reader ships
  here.
- **HT2 — Rules, contract, API.** `packages/shared`: `homeTimeContract.ts`, `homeTime.ts` (state, chips,
  `planHomeTimeAlerts`), the board contract's `homeTimes`, `basis: home_time`, `homeTimeUrgent`.
  `roster`: the service and routes (`GET/POST /api/roster/home-time`, change / end / cancel / reopen),
  `roster.home_time` permission, audit actions `home_time.marked | changed | ended | canceled | reopened |
  auto_ended`. `livemap`: the board merge. The fuel rule's canceled filter. Every service query
  org-filtered and asserted with `expectOrgScoped`; mutation-proved tests.
- **HT3 — Screens.** Drawer section and form, Available cell, chips, Home time tab, driver page section,
  the Activity view's wording. Browser pass on three fixtures (solo, team, driver without a truck) at
  1440 px; the table's column widths do not change, because nothing is added as a column.
  **After HT3 dispatchers can use the feature.**
- **HT4 — Alerts by bell and email.** Catalogue, `recipientsFor`, `sendAlert`, the scheduler entry,
  D-HT6's auto-end, the three bell categories with their web destinations, default routes seeded per org.
- **HT5 — Settings.** Settings → Notifications gains the routing section (thresholds, role columns,
  the two relations, people, quiet window) under its existing permission (`admin.settings.notifications`);
  save is audited as `settings.notification_routes_saved`. "My alerts" in the account menu.
- **HT6 — SMS.** Phone confirmation, the held queue, STOP handling, sending through `sendSms`. Ends with
  a real text to the owner's confirmed phone on production; if the carrier refuses it, staff SMS stays off
  and the refusal code goes in §7 as a blocker with its fix. Nothing else depends on this step.
- **HT7 — Production walk and hand-back.** Walk every row of §4 on staging, then production after the
  release; mark Q-LA1 closed in `LOADS-ACTIVITY-PLAN.md`; record in the routing plan which of its phases
  are now built.

Deploy rules that apply: a merge reaches staging in minutes and production only in the nightly release
the owner approves; HT1 must be released before HT2's readers.

## 6. Questions for the owner (none stops HT1–HT3; each has a recommendation)

- **Q-HT1 — Where do dispatchers keep home time today?** McLeod has the fields and we cannot see whether
  they are used. *(a)* In McLeod → after this plan, ask Alex for read access to five `driver` columns and
  prefill our form from them, so nobody types a date twice. *(b)* On the old board, a sheet or by memory →
  nothing more to do. *The build is the same either way; only the later import depends on the answer.*
- **Q-HT2 — Thresholds.** 24 h before, 2 h after, 8 days. *Recommend: start with these;* they are
  settings.
- **Q-HT3 — Who hears "overstayed" and "truck too long" besides the dispatcher?** *Recommend: the fleet
  manager role, bell and email* (D-HT15's table).
- **Q-HT4 — May the system end a period when McLeod shows the driver on a load?** *Recommend: yes*
  (D-HT6). The other choice is a "looks like he is back" chip that waits for a click.
- **Q-HT5 — Texts at night.** *Recommend: hold 21:00–07:00* (D-HT18).
- **Q-HT6 — Other reasons** (vacation, medical, personal). *Recommend: home time only for now.* The
  column can already hold them; a reason picker is one more field for the dispatcher on every entry.
- **Q-HT7 — The routing plan's questions, for these alerts only.** Q-NR2: only people who can view
  Dispatch may be chosen (*recommend yes*). Q-NR3: SMS is allowed on all three (*recommend yes; the owner
  asked for it*). Q-NR5: each person gets "My alerts" for their phone, and no self-service muting of email
  or SMS (*recommend yes*). Q-NR1 and Q-NR4 concern the old alerts and stay with that plan.

- **Q-HT8 — A carrier's own section changes are not seen by a background audience** (found building HT5,
  2026-11-13; not new with home time). "Who can view Dispatch" is asked of the DEFAULT role matrix
  (`rolesThatCanView`) by the alert resolver, by "My alerts" and by the Settings page — the same way every
  other background audience asks (`usersInRoles(rolesThatManage(section))`, `org/memberLookup.ts`). An
  org that gave a role Dispatch on the Permissions page, or took it away, is honoured by the API gates
  (the token carries the override) and not by an alert, which has no token. The three home-time surfaces
  agree with each other, so nothing reads wrong today. Candidates: (a) a shared reader of the org's
  overrides used by every background audience; (b) leave it, and say on the Permissions page that
  alerts follow the default roles. *Recommend (a), as its own step in the routing plan:* it touches
  fourteen senders, not this feature.
  **Answered for these alerts 2026-11-13 (owner: "proceed and fix").** It was not hypothetical: measured
  on production the same day, 6 saved changes, one of them Dispatch taken from the Fleet Manager role —
  the role every overstay escalates to by default. The resolver, the sender's fallback, the Settings
  page and "My alerts" now ask the carrier's answer (progress log). The other background audiences
  (`usersWhoManage`, 32 call sites) are unchanged and stay with the routing plan's NR3.

## 7. Owner tasks, known limits, blockers

Owner tasks (the feature works without them; the alerts reach fewer people until they are done):

1. Link each dispatcher's Silvicom account to their McLeod login in Settings → McLeod fleets (2 of 16
   today). Dispatchers without an account need an invitation first: only 3 dispatcher accounts exist.
2. Each person who wants texts confirms their own number in "My alerts" (HT6).
3. For the staging walk: the staging org has no `notifications` module, so no bell rings there
   (UNIT-NOTES UN9 walk). It is switched on in the platform console before HT4's walk, and the tester's
   email and phone go on staging's `OUTBOUND_ALLOWLIST`.

Known limits, stated so nobody finds them later:

- "Truck with the driver" is what the dispatcher said, not a GPS reading. A check of the truck's position
  against the driver's home ZIP is possible later (185 of 186 drivers have one); it is not in this plan.
- The toll-free number was verified with Telnyx for hiring messages. The owner ruled it may carry staff
  alerts (D-NR5); whether carriers deliver them is proved by HT6's real text, not assumed.
- Drivers cannot request home time from the app here.

Blockers: none open.

## 8. What this does NOT do

No writes to McLeod. No change to a driver's status. No block on assigning a load (loads are assigned in
McLeod). No driver-app screen. No move of the fourteen existing alert senders. No new page in the
sidebar.

## 9. Progress log

- 2026-11-13 — Written. Measurements in §1 taken the same day; McLeod's home-date columns found and found
  unreadable with the connector login.
- 2026-11-13 — **Rulings.** The owner answered "proceed as proposed", so every recommendation in §6 is a
  ruling: Q-HT2 thresholds 24 h / 2 h / 8 days; Q-HT3 the fleet manager role hears overstayed and
  truck-too-long by bell and email; Q-HT4 the system ends a period on load evidence; Q-HT5 texts are held
  21:00–07:00; Q-HT6 home time only; Q-HT7 as recommended. **Q-HT1 stays open as a fact, not a ruling**
  (where dispatch keeps home time today); nothing built depends on it.
- 2026-11-13 — **HT1 the schema** (branch `claude/home-time-ht1-schema`), as two migrations so each
  touches one module's tables: `0597_home_time.sql` (roster) and `0598_notification_routing.sql`
  (messaging). Matrix `supabase/tests/home-time.test.mjs`, 87 cases; seven mutants of the two migrations
  each fail it (no live check in mark, reopen ignoring a newer period, end without a reason, cancel of an
  ended period, the driver's org check, every item counted fresh, a key without its channel).
  Changes from §3, each for a reason found while writing the SQL:
  - **D-HT20 — no Note field; the form links to the driver's notes.** `driver_time_off` is readable by
    every member of the carrier and by the driver himself (the policies of 0068 and 0136), and a
    dispatcher's remark about a driver is not his to read. Notes on a driver already exist, office-only
    and shown on the board (`unit_notes`). This replaces the `note` column of D-HT2 and the Note row of
    §3.3's form, and takes one field off every entry.
  - **Only mark and reopen are database functions**, because only they need the one-live-period lock.
    Change, end and cancel are conditional UPDATEs from the roster service, held to a consistent row by
    the `driver_time_off_silvicom_shape` CHECK.
  - **Default routes are derived, not seeded** (replaces "default routes seeded per org" in HT4): an
    alert with no `notification_routes` row uses the catalogue's defaults, so the defaults are written
    once and an org is not frozen on the day it was created.
  - **`notification_deliveries` is not the dedupe.** `queue_notification_delivery` claims each item's
    key in the existing ledger (`notification_dedupe_keys`, as `<channel>:<key>`) and queues only what it
    claimed, in one transaction, so the delivery log can be pruned at 90 days without re-sending. A
    retention rule for it ships here; `dataRetentionPolicy.ts` was already split (366 lines), so the
    split §5 expected was not needed.
  - The held-text window is its own one-row table, `notification_channel_settings` (messaging's), not a
    column of `home_time_settings` (roster's): it holds every alert's texts, not only home time's.
- 2026-11-13 — **HT1 merged** (PR 2333, `9dfdc7a`); `migrate-staging` applied 0597 and 0598 the same hour
  (`pnpm verify:live staging`: schema version 0598).
- 2026-11-13 — **HT2 the rules and the API** (branch `claude/home-time-ht2-api`).
  - **Shared:** `homeTimeContract.ts` (wire shapes, `HOME_TIME_DEFAULTS`), `homeTime.ts` (state, the
    board's chips, `homeTimeHold`, the time refusals, the tab's order), the board contract's `homeTimes`,
    `available.basis = "home_time"` and `flags.homeTimeUrgent`, which joins `needsAttention`.
  - **Permission:** `roster.home_time` in `EDITABLE_PERMISSIONS`, shipped to
    `rolesThatManage("dispatch")` (D-HT7); no migration, the key's shape is 0564's.
  - **Roster:** `modules/roster/homeTime/` — the service and `/api/roster/home-time` (list, the form's
    drivers, mark, change, end, cancel, reopen). Reads ask `dispatch: view` on a carrier entitled to
    Dispatch; every write asks the named permission and writes `home_time.marked | changed | ended |
    canceled | reopened`.
  - **Board:** `withHomeTimes` merges each seat's live period after the row cache. A truck is held only
    when every seat is home and it is with one of them, and never when it carries a load or is in the
    shop; a held truck is not "empty now".
  - **Fuel rule:** `deriveDriverHomeAtFill` skips canceled periods (§3.7).
  - **`home_time_settings` left the producer gate's waiver list**: the board and the tab read it.
  - **Not in this step, moved to where it is used:** the alert planner (`planHomeTimeAlerts`) is HT4's,
    with its sender; `PUT` of the thresholds is HT5's, with the page that calls it.
  - Tests: shared 30, routes 21, board merge 17, fuel rule 4. Thirteen mutants (missing live condition
    on change, no org filter on the period read, McLeod rows in the live read, any driver status, ending
    a scheduled period, cancel without the permission, reads without the Dispatch gate, holding a loaded
    or shop truck, a held truck still empty-now, a seat not home ignored, the window's boundary, canceled
    read after ended, the fuel rule's canceled filter) each fail a test.
- 2026-11-13 — **HT2 merged** (PR 2336, `87d2c8d`). The `driver_time_off` writer pair was added to
  `scripts/table-writers.json`, and the service names its table literally (the table gates read
  `.from("<literal>")`).
- 2026-11-13 — **HT3 the screens** (branch `claude/home-time-ht3-screens`). After this step dispatchers can
  use the feature.
  - **One drawer, opened by the URL** (`?homeTime=<driver>` or `=new`), in `components/homeTime/`: the
    truck's drawer, the Home time tab, the driver's page and a pasted link open the same thing. Opening it
    takes `?truck=` out of the URL, so the board shows one dialog at a time. It shows the form (no live
    period), or the period's facts with **Back from home time**, **Change**, **Truck is back at the
    yard**, **Cancel** (asks first), or **Reopen** on the last ended period.
  - **Truck drawer:** "Home time" is the first section, one line per seat, with **Mark home time** for
    whoever holds `roster.home_time`. Two clicks from a board row to the form.
  - **Board row:** Available reads a "Home time" badge and "until <date>" (quiet until the return passes,
    then red; never amber or green), Status reads "Home time" instead of "Empty", and the Warnings cell
    carries the server's chips, naming the seat on a team truck.
  - **Home time tab**, before History: live periods in the server's order with the tab's own count, and
    "Ended, last 60 days" one switch away.
  - **Driver page:** a "Home time" button for whoever views Dispatch.
  - **Loads → Activity** says "Home time until …" under a marked driver's days without a load, and under
    a truck that home time holds (this closes Q-LA1).
  - Changes from §3.3, each for a reason:
    - **The Warnings chips are plain badges, not links.** A link inside a badge takes the link's colour,
      and here the colour is the message (red = act now). The row's click opens the truck's drawer, whose
      first section is home time.
    - **Returns starts empty; no 08:00 default.** The shared date-time picker has no default time, and a
      prefilled date is a promise a dispatcher could save without noticing.
    - **No list of changes in the drawer.** It shows who marked the period and when; every change is on
      the Audit page (`home_time.*`), where an admin keeps track, as for unit notes.
    - **"Leaves" defaults to when the truck empties** only for a driver whose truck is carrying a load;
      otherwise now.
  - Tests: wording and the form's clock 11, the form 14, the board page end to end 19 (row, two clicks,
    tab, drawer, a reader without the permission), board view 4 more. Three existing screen tests take a
    stand-in for home time (`@/testing/fakeHomeTime`), and the tab-strip test lists the new tab.
  - **Browser pass** on the built app behind a stubbed API, at 1440 px and 390 px, with three fixtures
    (real data, nobody home, the home-time API failing): no page error, nothing wider than the viewport.
    It found and fixed three things no test saw: the drawer's facts squeezed into four columns, the tab's
    list choice wearing a filter's clear button, and a held truck still reading "Empty" in Status.
- 2026-11-13 — **HT4 the alerts, by bell and email** (branch `claude/home-time-ht4-alerts`). After this
  step the office is told, without anybody looking: home time is ending, a driver has overstayed, a
  truck has been at a driver's home too long.
  - **Shared** (`packages/shared`): `alertRouting.ts` holds the alert catalogue, each alert's default
    routes and `resolveAlertRecipients`; `homeTime.ts` gains the pure planner `homeTimeAlertsDue` and the
    sentence `homeTimeAlertLine`.
  - **API:** `messaging/alertRouting.ts` is the one resolver and the one sender (`recipientsFor`,
    `sendAlerts`): a bell item per event through `notify()`, ONE email per person listing everything new,
    queued with `queue_notification_delivery` and its outcome written back. `loads/driverPickups.ts` reads
    the pickups; `livemap/homeTimeAlerts.ts` is the job (`runHomeTimeOnce`), registered in `SCHEDULERS`
    as `home-time`. The bell opens the driver's home time on the Dispatch board (`notificationRoute`).
  - Changes from §3, each for a reason:
    - **D-HT6 refined: the evidence is a PICKUP's actual arrival after the period started, not any
      stop.** A delivery after the mark is the OLD load ending — the driver was marked while still
      carrying it — and ending on it would close every period marked ahead of the last drop.
    - **The job lives in `livemap`, not `roster`.** `loads -> roster` exists, so `roster -> loads` would
      close a cycle. It composes the board's own four owners (roster, loads, mcleod, org) and hands the
      result to messaging; the new edge `livemap -> messaging` is in `scripts/check-feature-boundaries.mjs`.
    - **D-HT13's switch is `HOME_TIME_ALERT_MINUTES` (default 15, 0 = off)**, not
      `HOME_TIME_ALERTS_ENABLED`: one setting carries both the cadence and the off state, as the other
      schedulers' do.
    - **The planner takes no `alreadySent` list** (D-HT13 named `planHomeTimeAlerts(…, alreadySent)`).
      `notify()` and `queue_notification_delivery` each claim the key in the dedupe ledger, so a prefilter
      would be a second copy of a rule the database already owns.
    - **A pickup McLeod has keyed ahead of the clock is refused by `endHomeTime`, not filtered by the
      job.** `endHomeTime` owns "the end is between the start and now"; the job's own copy of that check
      changed no outcome under mutation and was removed. A future pickup sorts after every real one, so
      it cannot hide a pickup that has happened.
    - **`notification_channel_settings` keeps its schema-only waiver until HT6** (only a text is ever
      held, so its reader ships with texting); the waivers of `notification_routes` and
      `notification_contacts` are gone, both now read.
  - Tests: shared 53; the job 23 (what it closes, whom it tells, saying a fact once, every query the
    carrier's); the bell's destination 14. Mutation run: 16 deliberate breakages, 13 caught at first;
    two got tests (a pickup from before a LATER period's start when two drivers are home; a suspended
    member is told nothing), and the third was the redundant clock check above.
  - Until the owner links dispatchers to their McLeod logins (2 of 16 today), "the truck's dispatcher"
    resolves to nobody for most trucks and the alert reaches whoever marked the period; when that is
    nobody either, everyone who manages Dispatch.
- 2026-11-13 — **HT4 merged** (PR 2342, `3c79540`). The table-writer manifest gained
  `notification_deliveries` ← `messaging/alertRouting.ts`, found by `pnpm ci:local` before the push.
- 2026-11-13 — **HT5 the settings** (branch `claude/home-time-ht5-settings`). After this step an admin
  decides when the three alerts are sent and who is told, and everybody can see what they are told.
  - **Settings → Notifications** gains "Home time alerts" (only for a carrier with Dispatch): the three
    thresholds with the table's own ranges, and one card per alert with a switch per recipient for
    Dashboard and Email — the two relations, every role that can view Dispatch with how many people it
    is today, and any person added by name. Save sends the alert's whole set; "Use the defaults" asks
    first and removes the carrier's rows.
  - **"My alerts"** in the account menu: for each alert, in a sentence, how it reaches the signed-in
    person — always, or only when the period or the truck is theirs. Read-only.
  - **API:** `GET/PUT/DELETE /api/alert-routing[/:alert]` (messaging) and `GET/PUT
    /api/roster/home-time/settings` (roster, the table's owner), all behind the screen's own pair
    (`settings: manage`, then `admin.settings.notifications`); `GET /api/me/alerts` for any member.
    Audited as `settings.notification_routes_saved` (the switches on and off), `…_reset`, and
    `settings.home_time_alerts_saved` (the old numbers beside the new).
  - **One rule, three readers.** `alertRoutesProblem` (shared) refuses a set that reaches nobody, a role
    or a person who cannot view Dispatch, a relation the alert does not have, and a switch listed twice;
    the page shows its sentence before the click and the API answers 422 with the same one. "My alerts"
    is `alertsForMember`, which asks the sender's own resolver.
  - Changes from §5, each for a reason:
    - **No Text column and no quiet window on the page yet.** Nobody can confirm a number until HT6, and
      only a text is ever held; both arrive with texting. A text route already saved is carried through
      a save untouched.
    - **A save writes the switches before it removes anything** (whole rows on the route's own identity,
      then the rows the page no longer lists). The other order could leave an alert with no rows, which
      reads as "use the defaults".
    - **Adding a person starts on what their role already gives them**, because a person's own switch
      wins over the role's in both directions: starting on "dashboard only" would silently take a fleet
      manager's email away.
    - **A person who left is dropped by the form** and removed by the next save; the API would refuse
      to save their row again.
    - Q-HT8 is new (§6): background audiences ask the default role matrix, not the carrier's own.
  - Tests: shared 30 (the save rule, what one member receives); API 20 through the real mounts (the
    gate on all five routes, what a save writes and removes, every refusal writing nothing, org scope);
    web 42 (the form's logic, the section on screen, "My alerts"). Mutation run: 14 deliberate breakages,
    14 caught.
  - **Browser pass** on the built app behind a stubbed API at 1440 px and 390 px, with data and with
    the three reads failing: no page error, nothing wider than the viewport. It found and fixed three
    things no test saw: a dash in every role's row where "Take off" stands for a person, the person
    picker reading "Select…", and the dispatcher row's explanation cut off on a phone.
  - `pnpm ci:local` found three things before the push: the routes table stood as a card inside a card
    (`lint:ui-adoption`; it is `embedded dense` now), the older Notifications page test mounted the new
    section without its data layer, and `GET /api/me/alerts` needed its argument in the open-route
    ledger (it is gated per alert, by the caller's role, inside the read).
  - CI's file-size gate refused the merge with main: `apps/api/src/app.ts` reached 501 lines once the
    lumper mount and this step's three met. The thresholds are now served under the home-time mount
    (`/api/roster/home-time/settings`, mounted ahead of the board's router with its own gate) instead
    of a mount of their own. **`app.ts` is at exactly 500**: the next mount anybody adds needs a split.
- 2026-11-13 — **HT5 merged** (PR 2344, `18daab0`).
- 2026-11-13 — **HT6 texts** (branch `claude/home-time-ht6-sms`). Built and tested; **the real text to
  the owner's phone on production is still owed** and is the step's last line (§5).
  - **A person confirms their own number** under My alerts → Text alerts: a mobile number, the consent's
    words above the button, a 6-digit code by text, typed back. Only the code's hash is stored (bound to
    the person), it lives 10 minutes, five wrong tries spend it, and a new one can be asked for once a
    minute. Asking for a code un-confirms the row, so no alert goes to a number nobody has proved.
    "Stop text alerts" and a reply of STOP set the same column; START lifts a STOP on a confirmed number.
    `POST /api/me/alerts/phone`, `/phone/confirm`, `/phone/stop`, `GET /phone` — the caller's own row only.
  - **The sender** (`messaging/alertTexts.ts`): ONE text per person per run, queued through
    `queue_notification_delivery` so a fact is texted once, sent at once by day and held until the
    quiet window ends at night. The drain runs on the home-time job's tick (no new scheduler): it sends
    held texts whose morning has come and any a dead run left queued, and asks again at the door — still
    this person's confirmed number, not stopped, not still night. Otherwise the row is `skipped` with the
    reason. A carrier's refusal after acceptance (Telnyx `message.finalized`) marks the row `failed`.
  - **Settings → Notifications**, only where the server can text: a Text column (a role's switch says
    "1 of 2 confirmed", a person's "No confirmed number") and "Quiet hours for texts"
    (`PUT /api/alert-routing/text-hours`, audited). The `notification_channel_settings` waiver is gone.
  - Decisions, each for a reason:
    - **The consent wording is ours, ahead of counsel** (`ALERT_TEXT_CONSENT`, version
      `staff-alerts-2026-11-13`), as the applicants' was (D-SMS10). It is stored with each confirmation.
    - **The number is never deleted by the page.** Stopping keeps the row: it is the record that the
      person agreed, and when they stopped.
    - **The inbound STOP is not org-scoped**, on purpose: a text carries a number and no carrier.
    - **"stop" anywhere in a reply counts**, by the product's one rule (`isStopMessage`, G-2).
    - **A text that fails is not retried.** The dashboard already told the person; a second attempt at
      a number a carrier refused is how a sender gets blocked.
  - **Known risk, not yet measured:** the toll-free number was verified with Telnyx for "HR / Staffing"
    (applicant texts). Office alert texts are a different message on the same number. The production
    text to the owner's phone is where a refusal would show, as `failed` with the carrier's code on the
    delivery row; §7 takes it as a blocker with its fix if so.
  - Tests: shared 12 (the window on the carrier's clock, the words, the code's rules); API 15 for the
    number, 17 for the sender and drain, 4 through the whole job, 6 route tests; web 14 more. Mutation
    run: 16 deliberate breakages, 14 caught at first; the two survivors were the "confirmed and not
    stopped" filters, invisible because the stand-in database ignores a negated filter — both now
    asserted on the query itself and seen to fail.
  - **Browser pass** with texting on, 1440 px and 390 px, data and failing reads, and the Text alerts
    form in its four states: no page error, nothing wider than the viewport. Two fixes: a divider drawn
    in a colour that is not a token, and "Take off" wrapping onto two lines.
- 2026-11-13 — **HT6 merged** (PR 2346). `pnpm ci:local` caught one thing first: the Text alerts form's
  fallback sentence did not name what failed (`lint:ui-adoption`).
- 2026-11-13 — **HT7 hand-back, the paper half.** Q-LA1 is marked answered in `LOADS-ACTIVITY-PLAN.md`,
  and `NOTIFICATION-ROUTING-PLAN.md`'s log says which of its phases now exist. **Still owed, and not
  doable from a desk today:** the walk of every row of §4 on staging (the staging org has no
  notifications module, so no bell rings there until it is switched on), the same walk on production
  after the release that carries HT4–HT6, and HT6's real text to the owner's phone.
- 2026-11-13 — **Alerts follow the Permissions page** (branch `claude/alerts-follow-permissions`, Q-HT8).
  - **Measured on production first:** `org_section_access` 5 rows, `user_section_access` 1. Fleet
    Manager: Dispatch `none`. With the shipped matrix the one fleet manager would have been rung and
    emailed about every overstay and could not open the page, and nobody else was escalated to.
  - **One rule.** Every member the alert code handles now carries the section claim their own token
    would (`AlertMember.sections`, built by `alertMemberSections`: the role's saved rows with the
    person's own over them, nothing for admin and driver, whose access cannot be edited). "Can view"
    and "can manage" are `resolveSectionAccess`, the function the API's gates ask. `readDirectory`
    reads the two tables beside the member list and throws on a failed read: falling back to the
    shipped matrix would be this defect again.
  - **Four readers, one answer:** the resolver (role, person and relation routes), the sender's
    fallback (those who MANAGE the section), the Settings page (the roles offered, the people listed,
    the save rule) and "My alerts" (now from the directory, not the token: a token is up to a lifetime
    old, and the page must say what the next run does).
  - **A set that named somebody who can no longer receive it** — the DEFAULTS included — is shown
    without that switch (`receivableRoutes`) and the next save writes it so; the sender already skips
    them. Otherwise a permission change would leave a set the page refuses to save.
  - **What it leaves for the owner:** on production the overstay and truck-too-long alerts now reach
    whoever marked the period and the truck's dispatcher, and nobody above them, until somebody is
    switched on in Settings → Notifications. That is the carrier's choice to make; the code does not
    pick a person.
  - Tests: shared 9 more (taken from a role, given to a role, a person both ways, the two locked
    roles, the fallback, the save rule, the shown set); the job 4 more, with production's own case;
    routes 4 more; web 1. Mutation run: 11 deliberate breakages, 11 caught.
