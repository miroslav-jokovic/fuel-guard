# Notification routing — choose which alert goes to whom, and how

Status: **PROPOSED 2026-10-02.** Asked for by the owner on 2026-10-02: "we need more control on this,
so we can set what alerts will be sent to which user or role … for the dashboard notifications too,
because now it is a little bit messy." This replaces CF3 of `docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md`;
CF4 (stolen-card delivery) becomes the first alert sent through it.

Decision prefix `D-NR`, question prefix `Q-NR`, phases `NR1`–`NR6`.

## 1. What we have — measured on production 2026-10-02

**The bell sent ~2,100 notifications in 30 days to 7 office people (~70 a day), and ~20% were ever
read. Five of the six admins read none.**

| Category (30 days) | Sent | People | Read | What it actually is |
|---|---|---|---|---|
| `declined_alert` | 687 | 8 | 20% | one per EFS decline at alert/review (568 "needs review") |
| `system` | 579 | 7 | 24% | **419 are "Finance job failed: efs soap posted — fetch failed"**, in 55 separate hours 09-03..09-30 |
| `card_status_changed` | 528 | 6 | 16% | card control switching cards ACTIVE ↔ HOLD around every fill |
| `dq_expiring` / `dq_expired` | 284 | 8 | ~20% | qualification expirations |
| `fuel_alert` | 25 | 7 | 20% | anomaly cases |
| `application_stalled` | 6 | 6 | 17% | applicants who stopped part-way |

**Who receives what is decided in fourteen places, five different ways:**
- **Hard-coded role lists:** `ALERT_ROLES` (`efsProcessing.ts:20`) and `HAZMAT_REVIEW_ROLES`
  (`shared/hazmatApi.ts:79`).
- **Whoever can manage a section:** `usersWhoManage("fuel" | "accounting" | "equipment" | "roster")`,
  through two copies of an `officeUserIds` helper.
- **Specific people:** the submitting driver, or the thread participants.
- **Email:** one flat address list, `organizations.notification_emails` (one address today, a team
  member), used by eight senders.
- **The master switch:** one carrier-wide switch, `notifications_enabled`, which every email
  sender obeys. Some bell senders obey it and others don't.

**What nobody can do today:**
- choose a person or a role for a particular alert;
- choose bell vs email vs SMS for an alert;
- see how often an alert fires.

The web has no notification settings beyond that one switch and that one list
(`useNotifications.ts:9`: "No preferences UI"). The `system` category lumps a failing finance job
together with a fleet-list difference, and cannot be muted (`notificationsContract.ts:90`).

**SMS:** reaches applicants only (`applicationSms.ts`, `smsOutbox.ts`). No office user has a phone
number anywhere (`memberships`, `user_profiles`).

## 2. What it becomes

- **D-NR1. One catalogue of office alerts, each with a plain name.** It lives in `packages/shared`:
  what the alert says, which section it belongs to, how often it fired in the last 30 days, and
  which channels it may use. `system` is split into what it actually carries. The catalogue (§3) is the only list;
  the settings page, the senders and the CHECK constraint all read it (`lint:codegen`-style drift
  check).
- **D-NR2. Routing is a matrix, alert × role, with per-person exceptions.** For each alert, each
  office role gets bell / email / SMS on or off. A person can be added to an alert their role doesn't
  get, or removed from one it does. The person's choice beats the role's.
- **D-NR3. Every sender asks the same resolver.** `recipientsFor(org, alert)` returns people and
  channels. The fourteen ad-hoc audiences above are each replaced by one call, one sender at a
  time, each change pinned by a test showing the default routes reproduce today's recipients exactly.
- **D-NR4. One send function fans out.** `sendAlert(org, alert, message)` writes the bell row (and
  push, as today), sends the email, and sends the SMS. Each channel has its own dedupe, so one event
  never texts twice.
- **D-NR5. SMS uses the approved toll-free number.** Owner ruling 2026-10-02: the number already
  carries application texts and may carry staff alerts. A person's phone number is confirmed by a
  6-digit code texted to it before any alert goes there; that confirmation is also their consent.
  Every text names Silvicom and says how to stop (STOP is already handled by the inbound webhook).
- **D-NR6. The settings page shows each alert's last-30-day count beside its switches.** Seeing
  "Finance job failed — 419" next to the switch is how a person decides, so the number is read from
  `notification_events`, never estimated.

## 3. The catalogue (proposed)

| Alert | Section | Today's audience (the default) | Channels today | 30 d |
|---|---|---|---|---|
| Card used away from its truck (CF, new) | fuel | — | — | ~7 incidents |
| Declined card (retired by the one above at CF4) | fuel | admin, fleet manager, safety manager | bell | 687 |
| Fuel anomaly needing review | fuel | admin, fleet manager, safety manager | bell + email (high/critical) | 25 |
| Fuel card status changed | fuel | who can manage fuel | bell | 528 |
| Fuel data stopped arriving | fuel | who can manage fuel | bell + email | in `system` |
| Possible fuel drop (Samsara) | fuel | — | email | — |
| Samsara feed late | fuel | — | email | — |
| EFS certificate expiring / expired | fuel | — | email | — |
| Finance job failed | accounting | who can manage accounting | bell + email | 419 |
| Finance data stale | accounting | who can manage accounting | bell + email | ~50 |
| Month close changed | accounting | who can manage accounting | bell | in `system` |
| Fleet list differs from McLeod | equipment | who can manage equipment | bell | 6 |
| Qualification expiring / expired | roster | who can manage roster | bell + email | 284 |
| Application stalled | recruiting | who can manage roster | bell | 6 |
| Hazmat load needs review | dispatch | admin, fleet manager, safety manager | bell | — |
| Weekly digest | — | — | email | 4 |

Driver-facing notifications (loads, messages, duty, weekly score, hazmat outcome) are not in this
matrix: they go to the one driver they concern.

## 4. Phases

**NR1 — the catalogue.**
- The pure catalogue in `packages/shared`, as in §3.
- `system` is split into specific categories. This is a migration that extends the 0397 CHECK,
  derived from the catalogue.
- Each sender's default audience is written down as data.

**NR2 — storage.** Two new tables, both with RLS enabled and written only through the API:
- `notification_routes`: org, alert, role or person, channel, on/off.
- `notification_contacts`: a person's phone, the code they were sent (hashed), attempts, and
  `verified_at`.

**NR3 — resolver and fan-out.**
- `recipientsFor` and `sendAlert` are built.
- Senders migrate one per merge: fuel/EFS first (it carries the stolen-card alert), then accounting,
  equipment, roster, hazmat and the digest.
- Each merge has a test proving the default routes give today's recipients.

**NR4 — the settings page.** Settings → Notifications becomes the matrix:
- alerts grouped by section, a column per role, and bell / email / SMS toggles;
- the 30-day count on each row;
- a "people" panel for exceptions;
- "add my phone", which texts a code and has the person enter it.
- **Gate:** the existing Notifications screen permission (`admin.settings.notifications`,
  `manage("settings")`, Q-CF4).
- **Audit:** every save is recorded as `settings.notification_routes_saved`.

**NR5 — card fraud through it (CF4).**
- The stolen-card incident is sent with `sendAlert`.
- The per-decline `declined_alert` is retired.

**NR6 — retire the old controls.**
- Once every sender reads the routes, `notifications_enabled` and `notification_emails` are
  migrated into routes (§6 Q-NR4) and removed in a later merge.

## 5. Findings while measuring (not part of this plan; recorded so they are not lost)

- **"Finance job failed: efs soap posted" fired 419 times in 30 days.** The body is `TypeError: fetch failed`, in 55
  separate hours from 09-03 to 09-30. Either the EFS SOAP posted-transactions job really does fail
  that often, or its alert fires on a retried error. Either way it is worth its own look. Routing
  will let a person switch it off, but switching off a real failure is not a fix.
- **Card status changes are deduped per card per hour** (`efsCardStatusPoll.ts:259`), so a card that
  card control turns on and off around a fill notifies every time. That is 528 in 30 days.

## 6. Questions

**Q-NR1 — what are the defaults on day one?**
- **(a) Recommended: exactly today's behaviour.** Nothing changes for anyone until a person changes
  a switch. The page shows the counts, so the noisy rows are obvious.
- **(b) Quieter defaults chosen now:** for example card status changes off, and finance job
  failures to accounting only.

**Q-NR2 — who may be chosen for an alert?**
- **(a) Recommended: only people whose role can open that alert's section.** This is derived from
  the existing section × role matrix (`shared/auth.ts`). A text about a stolen card goes only to
  someone who can open the fuel pages to act on it.
- **(b) Anyone in the company.**

**Q-NR3 — which alerts may use SMS?**
- **(a) Recommended: only the urgent ones.** Card used away from its truck, possible fuel drop, and
  EFS certificate expired. This keeps a 419-a-month alert from ever reaching a phone, and keeps the
  texting number's volume close to what Telnyx approved.
- **(b) Any alert,** with the 30-day count shown as the warning.

**Q-NR4 — what happens to the single "Send the carrier's alerts" switch and the email list?**
(This also answers Q-CF5.)
- **(a) Recommended: they become routes.** The one listed address is a team member, so they get
  email on every alert that emails today. If the switch was off, all email routes start off. Then
  the switch and the list are removed. One place to control everything, which is what was asked.
- **(b) Keep the switch** as an emergency "stop all email" above the matrix.

**Q-NR5 — may each person turn alerts off for themselves?**
- **(a) Recommended: not in this programme.** Whoever manages Settings owns routing. The driver
  app's own mute list stays as it is.
- **(b) Add a "My notifications" page** where a person can mute bell and email for themselves
  (never the fraud SMS).

## 7. Progress log

- 2026-10-02 — Plan written from the production measurements in §1 and an inventory of every sender.
  Nothing built.
