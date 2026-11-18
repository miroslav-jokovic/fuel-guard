# Lumper fees — track the revised rate confirmation until the lumper is billed

Status: **APPROVED 2026-11-13 ("proceed as recommended, start building"). LRC1's statements are written and dry-run on the analytics copy; nothing runs on the VM until IT grants the tables.** Asked for by the owner on 2026-11-12:
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
  | Billed, RC on file | Invoice carries the lumper for at least the paid amount, and the revised RC is on the case | Closed |
  | **Billed, no revised RC** | Invoiced for the lumper, but no RC file on the case. The broker can still refuse to pay (1.3: "INVOICED FOR $150 W/O REVISED RC") | Dispatcher + accounting + chosen people, daily, until the file is added or the case is closed with a reason |
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
- **D-LRC10. The case answers "where and what did we pay" on one line** (owner, 2026-11-13): the
  amount paid, the day, the EFS reference, the driver, the broker, and the stop where the lumper was
  paid. The list page shows the same fields for every open case, with "Revised RC: yes / no" as its
  own column, to everyone the owner gives the page to. McLeod does not say at which stop a lumper was
  paid: `other_charge.stop_id` is empty on all 285 `LUM` rows of 2026 (measured in LRC1). So "where"
  is the order's consignee stop, read with the order.
- **D-LRC11. Who works the cases is the screen entitlement `dispatch.lumper-cases`**, not a section.
  Dispatch and billing work the same list and no section holds both: the dispatcher has no money
  section and the accountant has no Dispatch. The screen starts on for every role that manages
  Dispatch or Billing, and an admin turns it on for another role **or for one person** on Settings →
  Permissions, which is "other users we select". `/api/lumper-cases` asks for the same screen. There
  is no separate "may only look": whoever sees that an RC is missing can file it. (First built as a
  named permission the same day and replaced before it merged: the screen entitlement already
  answers per role and per person, and a second switch for the same question would have been a copy.)
- **D-LRC12. A filed revised RC is never changed or deleted; a wrong paper is removed with a reason.**
  The row stays, with who removed it and why, and stops counting. PDF, JPEG or PNG, up to 25 MB, and
  the API checks the stored bytes before the paper counts. An email is saved as a PDF first; taking
  the email itself is LRC6.
- **D-LRC9. Two weeks of silent running before the first reminder.** The cases are built and shown
  to admins only; each day's list is compared with what billing actually did. Reminders are switched
  on when the list has had no false case for a week.
- **D-LRC13. A payment keyed on the wrong order is pointed at, never moved** (owner, 2026-11-17,
  from the accuracy audit). When one order holds a payment with no lumper charged or billed, and
  another order of the same dispatcher and company holds a charge or invoice of the same amount to
  the cent with no payment, delivered within 14 days of the payment, both cases say "check order …"
  and the case explains what to correct in McLeod. Same dispatcher, not same broker: on the first
  read payroll's wrong order was the dispatcher's previous load for a different broker. Two
  candidates on either side give no hint. States do not change: McLeod is the record, and the next
  read corrects both cases once payroll moves the line (`lumperPossibleMisposts`).
- **D-LRC14. An order-less settlement line that is the other half of a counted payment is not
  "order unknown".** A money code and its reimbursement are one payment (LRC2's "larger side, not
  the sum"); when one half carries the order and the other does not, the order-less half (same
  payee, same amount, within 7 days, on an order that lacks that half) is listed under the order it
  belongs to, not as a lumper to match. Ambiguity leaves it on the unknown list
  (`lumperOrderlessMatches`).
- **D-LRC15. "Broker paid the invoice in full" closes a case** (owner, 2026-11-17). The first read
  opened 78 cases "Billed, no revised RC" back to August, before 360 could hold an RC; for an
  invoice the broker already paid, the RC no longer decides anything. A person's statement, kept
  with their name, taken only on an order McLeod shows invoiced (migration 0629). Reading McLeod's
  receivables to know it would be a new request to IT, not made.

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

**LRC4 — reminders by bell and email.** The routing pieces (routes, confirmed contacts, delivery
record, resolver, one send function, the Settings section) are built by `HOME-TIME-PLAN.md` HT1 and
HT4 to HT6 (D-HT14), merged as a plan on 2026-11-13. This phase adds the lumper alert to that
catalogue and the daily run in the scheduler process; it does not build a second resolver. It
therefore follows HT4. Dispatchers need 360 accounts linked to their McLeod user
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
- (a) Yes: the case closes as "billed, RC not filed in 360".
- **(b) Recommended, changed 2026-11-13: no.** The owner stated the purpose: without the revised RC
  the broker may not pay a lumper we already paid on the spot, so the question the system answers is
  "do we have the revised RC", not "did we invoice". A billed case with no file stays open as
  "Billed, no revised RC" (D-LRC4) and keeps being reminded. This is our reading of the owner's
  statement; he has not said "(b)" in those words.

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

**Q-LRC9 — a case older than the sweep's 90 days.** A case now stays open until the revised RC is
filed, so it can outlive the window, and the feed then stops refreshing its paid and billed facts.
- **(a) Recommended: the ingest answer names the open cases the sweep did not return, and the feed
  looks those orders up by number** (the pattern the loads close read uses). One more statement for
  IT to review; built with LRC2, before any reminder is sent.
- (b) Widen the window to a year. Simpler, but reads about four times the rows every hour.
- **(c) Built 2026-11-17, replacing (a) as the recommendation: no change to what McLeod is asked.**
  (a) is a new statement for IT to review, and (b) changes the 90 days IT approved in Part 7's own
  words, so each would be a new request to IT for a case nobody has met yet (the feed has not run).
  Instead 360 says which facts are old: a case whose order the latest read did not carry shows its
  McLeod facts "as of" the last read that did (`factsCurrent`, `factsSeenAt`). Whether the revised RC
  is on file is 360's own fact and never goes stale, so the two RC reminders still go for such a case;
  the billing-gap reminder does not, because a re-bill after day 90 would not reach 360 and accounting
  would be told every morning to re-bill a load they already re-billed. If old billing gaps turn out
  to matter in the silent weeks, (a) is still the fix, taken to IT with the evidence.

**Q-LRC10 — 360 finds the revised RC in McLeod by itself and downloads it onto the case (owner,
2026-11-18).** The owner's statement of the feature: "find revised confirmations and download them
when they are uploaded", so a paid lumper is tracked to its RC without anybody filing it twice. Today
the only "RC on file" fact is a file somebody puts on the 360 case (§1.3), because the place the
dispatchers actually put it is out of reach. **This is a BLOCKER: no route to that place exists, and
none is built around it.** Measured:
- Dispatchers get the RC from the broker as a PDF by email and print it to "Print to Billing"
  (owner, 2026-11-17 and 11-18). That is McLeod's imaging (DocumentPower), not the LME database:
  `image` and `image_type` are empty, `imaging_control`'s hosts are NULL, `orders.image_is_present`
  is 'Y' on 0 orders, and the RC fields on `movement` are empty on all 281,420 movements.
- It is NOT `comments` either. The unit-papers export reads `comments.attachment` straight out of
  the database, and that works for trucks and trailers, but the 78 attachments of 2026 with
  `parent_row_type = 'O'` are not orders: every key is 9 digits, `orders.id` is 7 characters on all
  136,414 orders, and 0 match an order (any company, trimmed) or a movement (lme_analytics,
  restore 2026-10-09, counts only, measured 2026-11-18).
- **Found, 2026-11-18: `dta`..`dta6` ARE McLeod Imaging (DocumentPower), and `dta` holds a per-load
  image index.** Measured with server metadata only, no row of `dta` read (neither login can open it):
  every session on `dta`..`dta6` is the login `imagingsql` from a separate host `MCLEODIMAGING`,
  running the imaging programs `dplogix`, `getimgd`, `javaimgd`, `ImgLicServer` and `wdp-wflogix`
  (`dplogix` also connects to lme as `lmeadm`, and LME's own `Javaimgd` runs on APPNEW). The plan
  cache since the 2026-11-17 19:45Z server start names the tables:
  - `bolimgh` (one row per load: `bimh_load_no`, `bimh_bill_to`, `bimh_blnum`, `bimh_noimgs`) and
    `bolimgd` (one row per image: `bimd_load_no`, `bimd_imgcat`, `bimd_scandt`, `bimd_user`,
    `bimd_imgnm`, `bimd_volid`, `bimd_ext`). 304 `bolimgd` inserts and 812 updates in those ~18 hours,
    which is a working store, not a relic. LME's billing side runs
    `select * from bolimgd where bimd_load_no = ? and bimd_imgcat = 1`, so the key is the order.
  - `imapcats` (`icat_appid`, `icat_catid`, `icat_catdesc`) names the categories; which `catid` is the
    rate confirmation is the one fact metadata cannot give.
  - `media` (`med_volid`, `med_volhost`, `med_mntpnt`) says where each volume lives. The image itself
    is a FILE on the imaging host's volume, not a column: `dta` is 2.2 GB and grows ~20 MB a month.
  - Also there: `renbill` (`renb_load_no`, `renb_invno`, `renb_printdt`, `renb_done`) — billing's
    image packet per invoice; `dpfdimgh` (driver scans: `dpfh_loadno`, `dpfh_driver`, `dpfh_tractor`);
    `dxlimgd` (generic projects, `dxld_index0..8`).
  So "is a revised RC on this order, since when, keyed by whom" is a read of three tables, and the
  PDF is one file read on the imaging volume (or one call to its image service).

Whatever the route, the matching rule is ours and needs nothing new from McLeod: a case already has
the order and the lumper's date, so an RC-type document on that order dated on or after the lumper
charge is the revised RC. It is downloaded into the case's files (0601) with McLeod as its source,
which closes the RC reminders exactly as a hand-filed one does, and a dispatcher never files it twice.

- (a) McLeod's own API (DocumentPower / ImagingService), with a read-only API user. The supported
  route and it returns the file, but it is still unconfirmed for this install, costs an API user and
  possibly a licence through McLeod, and one new outbound connection from the VM.
- **(b) Ruled 2026-11-18: a read grant on `dta.dbo.bolimgh`, `bolimgd`, `imapcats` and
  `media` for `silvicom_dispatch_ro`, plus read-only access for the VM to the imaging volume the
  `media` rows name.** No longer a guess: the tables are measured above, the connector already reads
  SQL on the same server from the VM, and it needs no licence. The grant alone already closes the RC
  reminders ("an RC-category image on the order, scanned on or after the lumper charge"); the file
  read adds the PDF onto the case. The risk is an undocumented schema across the 26.2 upgrade — so the
  read must fail loudly (a missing column is an error, never an empty answer), and (a) stays the
  fallback. It also answers the 2026-11-11 meeting's "BOL and POD scans in DocumentPower" question
  and the BOL reader's corpus from the same four tables.
- (c) Read the broker emails where the RC arrives (Microsoft Graph, already used for the Pilot
  mailbox), limited to the dispatchers' mailboxes, and read the order number off the PDF. Needs no
  McLeod change, but it is a second source beside the one billing uses, it misses an RC that came any
  other way, and it puts the document reader in the path of a money decision.

What IT is asked: Part 6 of `tools/mcleod-agent/review/SILVICOM-GRANTS.sql` (a `dta` user for
`silvicom_dispatch_ro` and SELECT on the four tables), and read-only access for the connector VM to
the imaging folder(s) `media` names. Owner, 2026-11-18: this goes to IT ON ITS OWN, without the
finance grants, which are taken up later (13 of Part 4's 15 tables still refused on LME, measured
the same day with HAS_PERMS_BY_NAME). The category names are not asked: `imapcats` answers them once
the grant is run.

**Ruled 2026-11-18 (owner: "proceed as proposed"): Q-LRC10 is (b), with the rule below.** New fact
from the owner the same day: Imaging has NO separate category for a revised RC. A dispatcher files
the revised RC as an ordinary RC, and billing, when it checks the load, re-marks the previous RC as
"Unknown". So a revision is visible as an order with an RC image AND an older image now "Unknown".

- **D-LRC16 — what counts as the revised RC.** On the case's order, the RC-category image scanned on
  or after the lumper's date is the revised RC; 360 attaches it as soon as the connector sees it.
  Billing's "Unknown" mark is NOT the trigger: it comes when billing reviews the load, days later,
  and until then the dispatcher would be reminded about an RC already filed. It is the
  confirmation — an older image on the same order re-marked "Unknown" shows billing accepted the
  new one as the replacement, and it is the old RC the amount check below compares against.
  Caution to measure first: "Unknown" may also be the default for any scan nobody categorised
  (McLeod's own reads filter `bimd_imgcat > 0`), so a stray Unknown image proves nothing on its own;
  only an Unknown image scanned BEFORE the current RC counts as the replaced RC.
- **D-LRC17 — the amount is checked against what we paid (EFS money code / payroll), by the
  INCREASE, not the total.** The RC total includes the line-haul and often detention, so it never
  equals the lumper. The broker approved the lumper when the revised RC carries a lumper line ≥ what
  we paid, or, failing a line, when new total − old ("Unknown") total ≥ what we paid. The amounts are
  only inside the PDFs, so the document reader reads both. Outcomes:

  | Read result | Case |
  |---|---|
  | lumper line or increase ≥ paid | closes: "Broker approved $X" |
  | lumper line or increase < paid | stays open, flagged: "Broker approved $X, we paid $Y" — a short pay to chase |
  | amount not read with confidence | stays open: "RC on file, amount unchecked", a person confirms with one click |

  An unread amount never counts as a match: a wrong guess would hide money owed to the carrier,
  which is the thing this feature exists to catch.
- **Before any reminder depends on it**, measured on 2026's 256 lumper orders once the grant runs:
  (1) the `imapcats` id of "Rate Confirmation" and of "Unknown"; (2) that `bimd_load_no` is
  `orders.id` (not a movement id) — share of LUM orders that join; (3) file extensions (`bimd_ext`)
  — TIFF is likely (LME's printer setup uses `tiff2ps`) and case files accept PDF/JPEG/PNG only, so
  the connector converts TIFF to PDF; (4) how often the reader gets the amount right, against a hand
  check of a sample.

**What changes in 360 (build, after the grant and the measurements):**
- connector `lumper.mjs`: read `bolimgh`/`bolimgd`/`imapcats` for the orders of open cases only, and
  copy a newly matched RC (and its "Unknown" predecessor) from the imaging folder, TIFF → PDF;
- migration: `lumper_case_files` gains `source` (`upload` | `mcleod`), the McLeod image id (unique
  per case, so a file is never imported twice) and a role (`revised_rc` | `previous_rc`);
  `uploaded_by` nullable for McLeod files; the append-only guard stays;
- API: `POST /api/tms/lumper` carries the image-index lines (so the case can say "RC in McLeod" before
  the file lands) and a connector-only endpoint receives the file;
- case page: source, scan date and scanner; the D-LRC17 amount line; manual upload stays as the
  fallback;
- reminders: no new logic — a McLeod file closes them as a hand-filed one does; the amount flag is a
  new line on the case, not a new reminder, until the silent weeks show its rate;
- the daily silent-weeks check adds "revised RC in McLeod but not on the case" (must be 0).

**Rulings, 2026-11-13.** The owner answered "proceed as recommended": Q-LRC3 (every `LUM` row),
Q-LRC5 (the order's `operations_user`), Q-LRC7 (lumper only, case keyed by charge code) and Q-LRC2
(08:00 Central, Monday to Friday) and Q-LRC4 (no exempt customers on day one) stand as recommended.
Q-LRC1 is (b), from his statement of the purpose the same day. Q-LRC6: new SQL goes to IT before the
VM runs it. Q-LRC8 (EFS money codes) and Q-LRC9 are open.

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
- 2026-11-13, owner's clarification — The purpose is the revised RC itself: without it we may not be
  paid for a lumper we paid on the spot, and dispatchers, billing and chosen users must see whether
  it is in, and where and what we paid. Changes: a billed case with no RC file stays open (D-LRC4,
  Q-LRC1 recommendation reversed); D-LRC10 added; LRC4 now rests on the home-time plan's routing
  pieces. What can be built before IT grants the tables: the feed's statements and dry run on the
  copy (LRC1), the tables and ingest route (LRC2), the rules, and the page (LRC3). Only the VM
  reading live LME waits.
- 2026-11-13, LRC1 statements — Four statements in `queries.mjs` (`LUMPER_ORDERS`, `LUMPER_CHARGES`,
  `LUMPER_PAYMENTS`, `LUMPER_BILLS`), the reader `tools/mcleod-agent/lumper.mjs`, and Part 7 of the
  review file (33 statements now). Dry run on the analytics copy, 90 days to 2026-10-09: 87 orders,
  90 charges ($25,490.56), 170 settlement lines (87 money codes $24,879.33, all with an EFS
  reference; 9 pending; 1 voided; 3 with no order number), 109 bills of 85 orders (12 credit memos);
  7 orders paid with no `LUM` charge and 7 billed with no lumper line; 0 rows outside the order
  list; about 0.7 seconds for all four. Not done in LRC1 yet: the feed is not on the service's
  schedule and posts nowhere (it needs LRC2's ingest route), and the VM's file list
  (`windows/manifest.mjs`) is regenerated on the day the VM is updated. The regenerated review file
  must go to IT before that day.
- 2026-11-13, LRC2 — Migration 0600: `mcleod_lumper_orders`, `_charges`, `_payments`, `_bills`,
  `_sweeps`, the `lumper_cases` table, and `lumper_sweep_apply`, which writes one sweep and removes
  what the sweep no longer holds in one transaction. `POST /api/tms/lumper` takes the sweep
  (`lumperContract.ts`). The state of a case is not stored: `lumperCaseState`
  (`packages/shared/src/lumperCase.ts`) reads it from the facts each time. Two rules in it are
  readings of the measurements and are what the silent weeks (D-LRC9) check first: the amount paid is
  the larger of the money-code lines and the reimbursement lines, because payroll keys one lumper as
  both; an order counts as invoiced while it has more invoices than credit memos. Flag values
  measured for the rule: every 2026 bill has `canceled` N and `rebilled` N, and a credit memo's
  amounts are positive. Not built yet: the connector does not post (no schedule entry, the VM is
  unchanged), the RC file and the close action are LRC3, and Q-LRC9 is still open.
- 2026-11-13, LRC3 server side — Migration 0601 (`lumper_case_files`, the private `lumper-files`
  bucket) and `/api/lumper-cases`: the list (open by default, `?scope=all` for every case) with where
  and what we paid, the settlement lines that name no order, and the time of the last sweep; filing
  the revised RC in two steps (a place to upload, then the bytes are checked and the paper is on the
  case); a link to open it; removing a wrong paper; closing with a reason; reopening. Every act is
  on the Audit page. D-LRC11 and D-LRC12 added. Next: the web page.
- 2026-11-13, LRC3 page — `/lumper-fees` ("Lumper fees", under Dispatch): open cases oldest first
  with broker, delivery place, dispatcher, what was paid, "Revised RC: on file / missing", status
  and days; search, status, "show closed", the page and the open case in the URL. The case drawer
  shows where and what we paid, says what the state asks for, and files the RC, removes a wrong
  paper with a reason, closes with a reason and reopens. Settlement lines with no order number are
  listed under "Lumper paid, order unknown". The page says when McLeod was last read, and says so
  plainly while the connector's lumper read is not switched on. An amount the dispatcher keyed that
  payroll has not paid yet is shown and labelled "keyed". Not done: the case on the load page
  (the list is the door for now), and a browser pass on staging once the tables hold data.
- 2026-11-13, LRC3 merged and walked — PR #2341 is on main (migration 0601) and on staging. Browser
  pass on staging as the test dispatcher: "Lumper fees" is in the Dispatch group, the page loads,
  says McLeod has not been read yet, and the only refused request is the notifications one that
  staging refuses for every page. Two wording faults found there and fixed: the empty list said
  "every lumper is invoiced" before any read had happened, and the search hint was cut off.
- 2026-11-13, grants checked (permission metadata only, no table read) under the connector's login
  after the request went to IT. **On live LME, Part 5 is in:** `other_charge`, `other_charge_hist`
  and `drs_pending_deduct` are readable. **Part 4 is not:** `drs_deduct_hist`, `billing_history` and
  the other finance tables are still refused. The lumper read needs those two (what payroll paid,
  and the invoices), so it cannot run on LME yet. The analytics copy is unchanged: last restored
  2026-10-09, and it refuses every finance and lumper table under the connector's login. Still owed
  by IT: the refresh, Part 2 on the copy, Part 4 on LME. Still owed by us: the regenerated review
  file (33 statements, Part 7) sent to IT before the VM runs the lumper read.
- 2026-11-13, LRC1 second half — the connector can send the lumper read, and ships switched off.
  `schedule.mjs` has a `lumper` job, every 60 minutes, that `serviceJobs` leaves out unless
  `connector.env` says `LUMPER_FEED=on`; a missing line means off, so updating the VM's code starts
  nothing. `agent.mjs --lumper --dry-run` reads once and prints counts; `--lumper` without
  `--dry-run` refuses, because a sweep replaces what 360 holds and one run by hand against the
  analytics copy would take away every payment newer than the copy. A sweep with no orders, or
  whose four statements disagree, is not sent (`lumperSweepProblems`), and the API refuses an empty
  one too. The review file's Part 7 changed in its comments only (the four statements are byte for
  byte what IT was sent on 2026-11-13); the new version must reach IT before the feed is switched on.
- 2026-11-13, a real sweep checked end to end — the 90 days to 2026-10-09 read from the analytics
  copy, passed through `lumperSweepPayloadSchema`, applied by `lumper_sweep_apply` in a database
  built from the migrations, and read by `lumperCaseState`. Counts only. The contract accepted all
  456 rows (143 KB against the route's 8 MB); a second apply of the same sweep removed nothing and
  opened nothing; 87 cases. With no RC on file: 77 billed with no revised RC ($23,350.69 paid,
  $24,960.56 billed), 7 billed without the lumper ($2,156.64), 1 billed short ($80.00 of $200.00),
  2 waiting. 3 settlement lines name no order. Of the 67 orders that carry both a money code and a
  reimbursement, the two amounts are equal on 66 and differ on one by $250.00, which is what the
  "paid is the larger side, not the sum" rule was written for. The 7 billed without the lumper are
  the same count the first measurement found.
- Still to do before the feed runs on the VM, in order: IT grants `drs_deduct_hist` and
  `billing_history` on LME; IT reviews Part 7; production has the release that carries
  `/api/tms/lumper` (the route merged 2026-11-13; a release is the owner's approval); the VM's code is
  updated (`windows/manifest.mjs` first, then `update-connector.ps1` pinned to that commit); the dry
  run on LME; then the `LUMPER_FEED=on` line. **`set-connector-line.ps1` cannot add that line**: it
  changes the address or the token only, and checks that the line count is unchanged. Adding a
  third change to it has to be written and tried on the VM itself, since PowerShell is not on the
  Mac it would be written from. Open: Q-LRC9, Q-LRC8.
- 2026-11-17, LRC4 and the rest of LRC3 (branch `claude/lumper-finish`). Checked first, permission
  metadata only, under the connector's login on 2026-11-16 21:19Z: `drs_deduct_hist` and
  `billing_history` are still refused on LME, the same two tables IT was asked for on 2026-11-13;
  nothing new is needed from IT. Production already serves `/api/tms/lumper` and the page (release at
  `9598f10`), with 0 sweeps and 0 cases. Built:
  - **The daily reminder** (D-LRC4, D-LRC6, D-LRC7, Q-LRC2). Three alerts in the routing catalogue,
    one per reminder in D-LRC4: `lumper_rc_waiting` (the order's dispatcher by dashboard and email,
    admins by dashboard), `lumper_rc_missing_billed` (the same plus accounting), `lumper_billing_gap`
    (accounting and admins). Who receives is Settings › Notifications, like home time's alerts. A
    person gets one dashboard item per alert per day counting their loads, one email listing them,
    and a text only if Text is switched on for them. The audience is the Lumper fees SCREEN, not a
    section (D-LRC11): the alert resolver now asks the carrier's screen answers per role and per
    person, which needed the two pure helpers that read them moved from org into `@silvicom/shared`
    (`surfaceClaims.ts`, unchanged). When the routes reach nobody, the admins get it.
  - **The order's dispatcher** is a new routing relation: the order's `operations_user`, through the
    office's link from that McLeod login to a 360 account. Measured on LME the same day: in 4,565
    orders of 90 days, `operations_user` matches `users.id` exactly and is always lowercase, as
    `tms_dispatchers.external_id` is; 7 orders have none. Only 2 of 16 non-system McLeod dispatchers
    are linked today (Settings › McLeod fleets), so until more are, the dispatcher's reminder mostly
    falls back to the admins.
  - **The silent weeks (D-LRC9)** are a switch, `lumper_reminder_settings` (0624): no row is off. An
    admin turns it on in Settings › Notifications › Lumper fee reminders, audited with the old and the
    new answer. The Lumper fees page says plainly that no reminders are sent until then.
  - **Once a morning.** A job every 15 minutes (`lumper-reminders` in `SCHEDULERS`) claims the
    carrier's day in `lumper_reminder_runs` (0624) before sending, so a restart or a second process
    never sends a morning twice, and a server down at 08:00 sends it when it is back that day. A run
    that fails gives the day back. Nothing is sent before the first McLeod read; past 26 hours without
    one, the dashboard item says when McLeod was last read.
  - **Q-LRC9** as (c) above.
  - **The case on the load page:** a McLeod load whose order has a lumper case shows what was paid,
    whether the revised RC is on file and the status, and links to the case on Lumper fees. Only for
    somebody who can open Lumper fees.
  - **The VM switch:** `tools/mcleod-agent/windows/set-lumper-feed.ps1`. The line could not be added
    by `set-connector-line.ps1` (it changes Url or Token only). Rehearsed on a Mac with PowerShell 7.7
    (`set-lumper-feed.test.ps1`): 14 cases (a new line added with LF and with CRLF endings, a line
    changed in place, a refused dry run, a sweep that fails after the restart, no sweep within the
    wait, Node reading the file back wrong, no lumper route on 360, an agent from before the feed, two
    lines, a database other than `lme`, already on, off, already off), and 8 mutants of the script,
    every one caught; one (no restore when a check after the write fails) survived the first run, and
    the Node read-back case was added for it. One more case ran the REAL agent of `b864665` with the real settings against
    LME: the dry run was refused on `drs_deduct_hist`, and the script put nothing in the file and
    restarted, as it must until IT runs the two grants.
  - **The VM update stays pinned to `b864665`.** `update-connector.ps1` on main lists the files of
    that commit (all 40 checksums regenerated and compared on 2026-11-16), 180 of 180 connector tests
    pass there, and its four lumper statements are byte for byte what IT approved (Part 7 compared
    with comments removed at `91a6a02`, `6c31f17`, `b864665` and main: identical). A later commit is
    not used: `0cf39de` (finance, merged 2026-11-15) changed `agent.mjs` and `queries.mjs`. The VM
    has run `43f6abc` since 2026-10-30; nothing in this branch changes a file the VM runs.
  - Still to do, in order: IT runs the two grants (`drs_deduct_hist`, `billing_history` on `lme`);
    a release carrying this branch (migration 0624); on the VM, `update-connector.ps1 -Commit
    b864665… -RosterMode create`, then `set-lumper-feed.ps1 -Feed on`; two silent weeks comparing
    the list with billing; an admin switches the reminder on. Open: Q-LRC8; who sees the page during
    the silent weeks (D-LRC9 says admins, the screen starts on for three roles).
- 2026-11-17, the feed is live. Alex ran the two grants (checked under the connector's login: all five
  lumper tables readable on `lme`, no write permission). The VM was updated to `b864665` with
  `update-connector.ps1` (180/180 tests on the VM) and switched on with `set-lumper-feed.ps1`; both
  ended SUCCESS on Windows PowerShell 5.1. First sweep 17:12:37Z: 94 orders, 96 charges, 185
  settlement lines, 99 bills, 94 cases — 78 billed with no revised RC ($25,268.29 paid), 10 billed
  without the lumper ($2,482.64), 1 billed short ($386.62), 5 waiting ($925.00); 4 settlement lines
  with no order. The silent weeks (D-LRC9) start this day. The owner ruled the page admins-only for
  them (Settings › Permissions, Lumper fees off for fleet manager, dispatcher and accountant); at
  17:28Z only the dispatcher row was saved off.
- 2026-11-17, who the reminder reaches (branch `claude/dispatcher-auto-link`). Measured on the live
  cases: the order's dispatcher was linked to a person on **4 of 94**. The owner had linked every
  dispatcher on 10-15, but the strict `/api/integrations` limiter refused 13 of those person links
  (recorded in `routes/dispatchLinks.ts`); the fleet → login links did save. Built:
  - **Automatic linking (0626).** Every ten minutes (`mcleod-relink`) a McLeod login is linked to the
    one active office member whose login email is that name before the @ (`steve` ↔
    steve@silvicominc.com), only when exactly one such member exists and holds no other login. Audited
    as the system's act. An office unlink leaves a hold (`tms_dispatcher_link_holds`) and is never
    undone automatically; linking by hand releases it. On today's data this links pete, robert,
    steve, teo and vladi. Not linked by rule: `asen` and `miro` (their 360 accounts are alex@ and
    miki@, so only a person can say), and aneta, arturk, chris, ivok, kane, koni, romann, roman and
    jake, who have no 360 account yet.
  - **`roman` and `jake` can be linked.** They run orders (`operations_user`: 377 and 30 in 90 days)
    but never appeared on the board, so the dispatcher list never had them; `romann` is a different
    McLeod user. The lumper sweep now adds an order's dispatcher the list lacks (insert-or-skip, never
    touching a row the roster sent).
  - **Plan §4's "dispatcher not linked"** is shown on the list and in the case.
  - Notifications checked against D-LRC4, D-LRC6, D-LRC7, Q-LRC2 and D-LRC9: as built. Two facts
    for the owner, not code: no member has the Accountant role, so the accounting defaults reach
    nobody until somebody is given it or named on Settings › Notifications; and production still
    runs schema 0623, so no reminder can run there before the release that carries 0624.
- 2026-11-17, accuracy audit of the first production read, and its fixes (branch
  `claude/lumper-accuracy`, no connector change). The 94 cases were recomputed independently from
  the raw McLeod mirror: 78 billed no RC, 10 billed without the lumper, 1 short, 5 waiting, the same
  as the page; no order without a case, no duplicate. Where the list is wrong, McLeod's keying is:
  payroll keyed 0135863's $703.64 on the wrong order (it belongs to 0135778's $403.64 + $300, paid
  10/01 before 0135863 delivered 10/05), and very likely 0135053/0134847's $518 the same way; 0134303's
  $100 money code has no EFS reference and equals a re-bill reduction, so it is probably not a lumper
  (left for a person). Three of the four "order unknown" lines were the reimbursement half of a
  money code already counted. `billing_history.invoice_no` is empty on every bill (99 lumper, 14,156
  finance), so the case showed "— on <day>". Built: D-LRC13 (the two pairs above, and nothing else
  on this read), D-LRC14 (CRTUCKER, TLAMAR, YHUGGLER matched; DRUTHERF's $100 stays unknown),
  D-LRC15 with 0629, "Invoiced <day>" when there is no number, and "Paid to" (the payee) on the
  order-unknown list, where the driver column was empty for every reimbursement line.
- 2026-11-18 — Owner: the feature's point is to find the revised RC in McLeod and download it when it
  is uploaded. Recorded as Q-LRC10, a blocker: the place "Print to Billing" stores it is outside both
  logins' reach, and the `comments` route the unit-papers export uses does not hold it (the 78 'O'
  attachments of 2026 match no order). Nothing built around it; one request to IT, with the finance
  grants, decides between (a) the API and (b) an index grant.
- 2026-11-18 — Q-LRC10's store found. With the sandbox login's server metadata (sessions, plan
  cache, backup history; no `dta` row read, the login cannot open it): `dta`..`dta6` belong to McLeod
  Imaging on host `MCLEODIMAGING` (login `imagingsql`, programs `dplogix`/`getimgd`/`javaimgd`), and
  `dta.dbo.bolimgh`/`bolimgd` index images by `load_no` with category, scan date and user; the files
  sit on the volume `media` names. 304 new image rows in ~18 h. Q-LRC10's recommendation moves from
  (a) to (b), and the IT question shrinks to four grants, volume access and one category name.
- 2026-11-18 — Owner: Imaging has no "revised RC" category; the dispatcher files the new RC and
  billing re-marks the previous one "Unknown". Owner ruled "proceed as proposed": Q-LRC10 is (b),
  D-LRC16 (revised RC = RC scanned on or after the lumper; the Unknown mark confirms, never
  triggers) and D-LRC17 (amount checked by lumper line or by the increase over the old RC, against
  what we paid; an unread amount never matches). Part 6 added to `SILVICOM-GRANTS.sql`. Grants
  re-measured: 13 of Part 4's 15 finance tables still refused on LME; no `dta` access. The owner
  sends the Imaging request alone; finance is a later, separate request.
