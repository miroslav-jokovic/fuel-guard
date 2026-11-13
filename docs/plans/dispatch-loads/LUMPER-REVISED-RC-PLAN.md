# Lumper fees — track the revised rate confirmation until the lumper is billed

Status: **PROPOSED 2026-11-13. Research done, nothing built.** Asked for by the owner on 2026-11-12:
when we pay a lumper fee, the broker owes it to us, and the proof is a revised rate confirmation (RC)
from the broker. Today dispatchers and accounting check each load by hand. 360 should track every
lumper, know whether the revised RC is in, and remind the right people every day until it is.

Decision prefix `D-LRC`, question prefix `Q-LRC`, phases `LRC0`–`LRC7`.

## 1. What we measured

Read-only, 2026-11-13, on the analytics copy of our McLeod database (`lme_analytics`, company `TMS`).
The copy was restored on 2026-10-09, so every 2026 figure below means **2026-01-01 to 2026-10-09**.
Nothing was read from live LME and nothing was written anywhere.

### 1.1 A lumper leaves three separate traces in McLeod

| Trace | Table | Who keys it | When | What it proves |
|---|---|---|---|---|
| **Paid** — the EFS money code | settlement deduction, code `UNL` | payroll | 9 to 88 hours after the lumper day | We paid. Carries the order number (272 of 272), the amount and the EFS reference (271 of 272). |
| **Paid** — the driver's reimbursement | settlement deduction, code `LUM`, type R | payroll | same sitting as `UNL` | Same payment, other side of the settlement. 246 of 263 carry the order number. |
| **To be billed** — the charge on the order | `other_charge`, code `LUM` | the dispatcher first, then billing | see 1.2 | Somebody intends to bill the broker. |
| **Billed** — the charge on the invoice | `other_charge_hist`, tied to the invoice | billing | on the bill date | The broker was invoiced for it. |

2026 volume: **256 orders carry a billed lumper, $68,170.81** (285 charge rows). 2025: 337 orders,
$82,833.44. About one order in fifty.

### 1.2 How the charge gets on the order today

The audit log covers 61 lumper charge rows keyed between 2026-09-09 and 2026-10-07:

- The **dispatcher** keys the charge around delivery: 7 rows before delivery, 23 within 24 hours.
- **Billing deletes the dispatcher's row and keys it again** on the bill date. In that month
  `other_charge` had 879 inserts and 489 deletions. So a charge row's id is not stable; only the
  order number is.
- No charge was keyed after the bill date.

### 1.3 Where the revised RC is recorded in McLeod: nowhere, except in A/R's notes after a short pay

Six places were checked. Five are empty of it; the sixth mentions it only after the money is short.

| Place | Finding |
|---|---|
| `rate_confirmation_status` and `movement.rate_confirmation_status` | These are for confirmations **we send** to a carrier (brokerage). Used on 1 movement of 281,420. |
| Attachments (`comments`) | 41,571 rows: driver expenses, truck and trailer papers, accident files, customer notes. No order paperwork. "Rate confirmation and BOL" was last used in 2022 (30 files in total). |
| Stop notes on 2026 orders | 0 mention a lumper, a revised confirmation or a rate confirmation. |
| Rebill reasons | Mention lumpers in 2014, 2015 and 2018 only. |
| Order history (`order_post_hist`, checked on the second pass) | 119,245 rows in 2026, all written by McLeod itself (settlement paid, freight bill printed, loaded, empty). 0 attachments since 2021, 0 mentions. |
| Collections call notes (`ar_call_record`, second pass) | **This is where it shows up, as free text, after the broker short-pays.** Of 7,839 notes in 2026, 28 mention a lumper and 16 a revised RC: "$310 SHORT PAY. LUMPER NOT REIMBURSED. NO REVISED RC." (10/08), "INVOICED FOR $150 W/O REVISED RC" (10/06). One file attached all year. |

A second pass also listed every table that holds a file (33) and every table with an order number
(59). None of the others holds order paperwork.

McLeod imaging is not set up (0 images). So **McLeod can say a lumper was paid and whether it was
billed. It cannot say the revised RC arrived.** That fact has to be recorded in 360.

The collections notes are not a usable signal: they are free text, written weeks later, and only
when something already went wrong. They are the evidence of what a missing revised RC costs.

### 1.4 What goes wrong today, in numbers (2026 to 10-09)

| Problem | Orders | Money |
|---|---|---|
| Lumper paid to the driver, order billed with **no** lumper charge | 10 (8 lumpers, 1 pallet jack, 1 late fee) | $2,912.24 |
| Lumper billed for **less** than was paid | 6 | $760.33 short |
| Lumper missed on the first invoice, added on a re-bill | 25 (27 in 2025) | $6,040.96 billed late |
| Days from delivery to bill | lumper orders 4.7, all other orders 2.8 | 18 lumper orders took over 7 days |

The honest size: about **$3,700 in nine months was never billed**, about $6,000 was billed late
through a credit memo and a re-bill, and every lumper load bills about two days slower. The larger cost is the
hand checking the owner described, which the database cannot measure.

### 1.5 Other facts the design depends on

- **Not every `LUM` row is a lumper.** Of 285 rows in 2026, 249 say "Unloading" and about 20 say
  something else (late fee 7, pallet jack 2, trailer washout 2, gate fee, re-schedule fee).
- **Who the customers are.** Four brokers account for 136 of the 256 orders.
- **The dispatcher.** `orders.operations_user` names one person per order. On the audited rows the
  person who keyed the charge was usually that same user.
- **Only 2 of 18 McLeod dispatchers are linked to a 360 user** (production, 2026-11-12).
- **The connector cannot read any of this yet.** Checked on live LME under the connector's own
  login on 2026-11-13: it reads the nine load-board and roster tables plus `reference_number` and
  five `customer` columns, and **none** of the finance tables, `other_charge`, `other_charge_hist`
  or the settlement deduction tables. The grant lines are Parts 4 and 5 of
  `tools/mcleod-agent/review/SILVICOM-GRANTS.sql`, not yet run.
- **Routing alerts to chosen people by bell, email and SMS does not exist yet.** It is designed in
  `docs/plans/notifications/NOTIFICATION-ROUTING-PLAN.md` (PROPOSED 2026-10-02, nothing built). No
  office user has a phone number stored.

## 2. What it becomes

- **D-LRC1. One case per order with a lumper.** Keyed by McLeod company + order number, never by a
  charge row (1.2). A case opens at the earliest of: a `LUM` charge appears on the order, or a
  settlement `UNL` / `LUM` row names the order. Two independent sources mean a lumper the dispatcher
  forgot to key is still caught when payroll keys the EFS money code.
- **D-LRC2. A case holds three facts and never guesses any of them.**
  - **Paid:** amount, date, EFS reference — from the settlement rows.
  - **Revised RC:** the document itself, filed on the case in 360, with who filed it and when.
  - **Billed:** invoice number, date and lumper amount — from the invoice.
- **D-LRC3. The revised RC is "received" only when its file is on the case.** No tick-box without a
  document. Phase one is an upload on the case (drag the PDF or the email in). A mailbox that
  dispatchers forward the broker's email to comes later (LRC6); 360 already reads a Microsoft 365
  mailbox for EFS reports (`apps/api/src/lib/graphMail.ts`).
- **D-LRC4. Case states.**

  | State | Meaning | Who is reminded |
  |---|---|---|
  | Waiting for revised RC | Lumper known, no RC file, not billed | Dispatcher of the order + chosen people, daily |
  | RC received | File on the case, not billed yet | Nobody; shown on the list for billing |
  | Billed | Invoice carries the lumper for at least the paid amount | Closed |
  | **Billed without the lumper** | Order invoiced, lumper paid, no lumper on the invoice | Accounting + admins, daily, until re-billed or closed with a reason |
  | **Billed short** | Invoice lumper is less than was paid | Same as above |
  | Closed, not billable | A person closed it and chose a reason (broker paid the lumper directly, broker refused, included in the rate, not a lumper) | Closed; reason and person kept |

- **D-LRC5. One page lists every open case**, oldest first, with amount, broker, dispatcher, days
  open and state. Reminders point to it. Nothing depends on a person reading a notification.
- **D-LRC6. One reminder per person per day**, listing that person's open cases, not one message per
  load. Bell for everyone who receives it; email and SMS as set per person in Settings.
- **D-LRC7. Recipients and channels come from the notification routing plan, not from a settings card
  made for this alert.** This feature is the first alert built on it: the alert joins the catalogue,
  Settings → Notifications chooses roles and people and bell / email / SMS, and a phone number is
  confirmed by a texted code before any SMS goes to it. Building a private recipient list here would
  be the second source of truth the no-workarounds rule forbids.
- **D-LRC8. The connector gets one new feed, "lumper".** A bounded sweep, not change tracking (rows
  are deleted and re-keyed): every `LUM` charge, settlement `UNL` / `LUM` row (pending and paid) and
  invoice lumper line for orders delivered in the last 60 days. Read-only, same session rules as the
  other feeds. When the McLeod API kit arrives, only this feed changes its source.
- **D-LRC9. Two weeks of silent running before the first reminder.** The cases are built and shown
  to admins only; each day's list is compared with what billing actually did. Reminders are switched
  on when the list has had no false case for a week.

## 3. Phases

**LRC0 — rulings and access.** The questions in §5. Sit with one billing person for one lumper load
and note every screen they open (this confirms 1.3 or finds a fifth place). Decide who runs the
grants on the SQL server.

**LRC1 — the connector feed.**
- Three new statements in `queries.mjs`, the regenerated `SILVICOM-READ-ROUTINE.sql`, and the grant
  lines in `SILVICOM-GRANTS.sql`: on live LME, `SELECT` on named columns of `other_charge`,
  `other_charge_hist`, `drs_pending_deduct`, `drs_deduct_hist`, `billing_history`.
- Dry run on the analytics copy; expected about 55 orders in a 60-day window.
- The 360 ingest route must be released before the VM is updated.

**LRC2 — cases in 360, silent.** A new raw table for the feed and a case table (new tables, RLS on).
The rules of D-LRC1 and D-LRC4 are pure functions in `packages/shared`, tested against the measured
shapes: a charge deleted and re-keyed, a lumper with no dispatcher charge, a short bill, a re-bill.

**LRC3 — the page.** The open-cases list, the case on the load page, upload of the revised RC, close
with a reason. Every action recorded on the Audit page.

**LRC4 — reminders by bell and email.** The routing slice this alert needs from the notification
routing plan (catalogue entry, routes, resolver, one send function), the Settings matrix row, and
the daily run in the scheduler process. Dispatchers need 360 accounts linked to their McLeod user
first.

**LRC5 — SMS.** Phone number with a texted confirmation code, then the daily text.

**LRC6 — mailbox intake.** Forward the broker's email to one address; 360 files the attachment on
the matching case and a person confirms the match.

**LRC7 — McLeod API kit.** Swap the feed's source; consider writing the "RC received" fact back.

## 4. What can still go wrong

**A reminder that should not be sent**
- The RC arrived and nobody filed it. The page and the daily reminder are the pressure to file it.
- A `LUM` row that is a late fee or a washout (about 7%). See Q-LRC3.
- A customer who pays lumpers without a revised RC. See Q-LRC4.
- A charge keyed by mistake and deleted. The sweep sees it gone and the case closes itself as
  "charge removed", unless a settlement row still says we paid.

**A lumper that is missed**
- Paid, never keyed by the dispatcher, and payroll has not keyed the money code yet: invisible for
  up to 88 hours (1.1). Reading EFS money codes directly would close this gap; whether the EFS feed
  360 already has shows them is not yet checked (Q-LRC8).
- Keyed under another code. `DAS` (driver unload) and `EXD` (driver assist) had 89 rows from
  September 2025 to September 2026.
- A settlement row with no order number: 20 of 269 in 2026. These are listed on the page as
  "lumper paid, order unknown" for a person to match.
- The connector is stopped. The page shows the time of the last sweep and the reminder says so when
  it is older than a day.

**The wrong person is reminded**
- The dispatcher has no 360 account or is not linked (16 of 18 today). The reminder then goes to
  the chosen admins only, and the case shows "dispatcher not linked".

## 5. Questions for the owner

**Q-LRC1 — is a lumper billed in McLeod enough to close a case with no RC on file?**
- **(a) Recommended: yes.** Billing checks the RC before invoicing today. The case closes as
  "billed, RC not filed in 360", and the count of those is shown, so the habit of filing grows
  without holding up anything.
- (b) No: a billed case stays open for accounting until the file is added.

**Q-LRC2 — at what hour does the daily reminder go, and on which days?**
- **(a) Recommended: 08:00 Central, Monday to Friday.**
- (b) Every day including weekends.

**Q-LRC3 — which charges count?**
- **(a) Recommended: every `LUM` row,** whatever its text. A late fee or a gate fee paid for the
  broker needs the same proof. `DAS` and `EXD` stay out until billing says they need an RC.
- (b) Only rows whose text says lumper or unloading.

**Q-LRC4 — are any customers exempt?**
- **(a) Recommended: none on day one.** The silent weeks (D-LRC9) will show which customers never
  send one; add an exempt list then, from evidence.
- (b) Start with a list the owner names.

**Q-LRC5 — who is "the dispatcher in charge"?**
- **(a) Recommended: the order's `operations_user`** — one person per order, and usually the one who
  keyed the charge. If that user is not linked to 360, the chosen admins get it.
- (b) The dispatcher on the movement (an order can have several).

**Q-LRC6 — who runs the grants on the SQL server, and does new SQL still go to Alex first?**
The grants are on the SQL server, not on the VM, so being VM admin does not cover them. The
2026-09-24 agreement (Alex sees regenerated SQL before the VM runs it) is treated as in force until
the owner says otherwise.

**Q-LRC7 — should the same tracking cover detention, layover and truck-not-used later?**
- **(a) Recommended: build for lumper only, but key the case by charge code,** so adding detention
  is a setting and not a rebuild. Detention was 417 rows and $112,731 from September 2025 to September 2026,
  larger than lumper.
- (b) Lumper only, no provision.

**Q-LRC8 — may we check whether the EFS feed shows lumper money codes?** If it does, a case can open
the same day the money code is used, before anyone keys anything in McLeod.

## 6. Progress log

- 2026-11-13 — Sandbox research done from the office (analytics copy, restore of 2026-10-09). Found
  the three traces of a lumper, that billing re-keys the dispatcher's charge, that McLeod records the
  revised RC nowhere, and the sizes in 1.4. Plan written. Nothing built.
- 2026-11-13, second pass — Checked every table that holds a file or an order number. Order history
  holds no paperwork. Collections call notes mention a missing revised RC after a short pay (16 notes
  in 2026). Checked the connector's login on live LME: no finance or lumper table is granted. Grant
  lines added as Parts 4 and 5 of `SILVICOM-GRANTS.sql`; request to Alex drafted in
  `tools/mcleod-agent/review/REQUEST-TO-ALEX-2026-11-13-FINANCE-ON-LME-AND-LUMPER.md`.
- 2026-11-13, third pass — Read the saved thread with IT before writing to them. The connector's
  login reads no finance table on the analytics copy either: the 10-09 restore removed the 09-28/29
  grants, so the agreed finance night never ran under it. The request to IT was rewritten around
  that: refresh, Part 2 on the copy again, one night, then Parts 4 and 5 on LME.
