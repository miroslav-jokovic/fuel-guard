# DRAFT — not sent. Message to Alex Tzakov, Cc Alex Lockwood (McLeod API Kit v2)

**Status:** draft written 2026-11-27 for the owner to send. Claude does not send it. It is the ONE message to IT for the
whole API Kit (memory `it-requests-are-one-complete-list`): nothing is ever added by an "also" e-mail.

**Before sending, the owner fills in** (this repository is public, so the real values are never written here):
- `<LME SQL LAN IP>` — the SQL server address Alex already has on record;
- `<read-only SQL login>` and `<analytics SQL login>` — the two SQL logins, by their real names;
- `<integration user>` — the LoadMaster web user name we propose (for example the company name plus "360");
- `<test driver code>` — the McLeod driver code for a test driver, if Alex creates one;
- `<date of the 11-13 email>` is 2026-11-13; check its subject line in Sent mail and reply **in that thread**.

**And runs, the same day, before sending** (so items 12–13 name only what is still missing): the CHECK block at the end
of `tools/mcleod-agent/review/SILVICOM-GRANTS.sql` under `<read-only SQL login>` on `lme`, and the Part 6 check on `dta`.
Edit items 12 and 13 to the result.

**Attach:** `SILVICOM-GRANTS.sql` as on `main` the day it is sent (Part 4 with the two new lines).

---

**Subject:** Re: Analytics copy refresh, the finance night, and three tables for lumper fees — plus McLeod's API

Hi Alex, hi Alex,

This follows my November 13 email and replaces part of it. It is long because it is complete: everything we will need
from you for McLeod's API is in this one message, so there is no second one.

**First, what changes from my November 13 email.**
- **Withdrawn:** the analytics copy refresh (point 1) and running Part 2 again on `lme_analytics` (point 2). We do not
  need them any more. We will compare the copy and LME ourselves, from my Mac on the office network, with the two
  logins we already have.
- **Still asked:** Part 4 on LME (item 12 below), now with two more lines.
- **Done, thank you:** Part 5 (the lumper tables) and `billing_history`, `drs_deduct_hist`, on November 17.

**Why the rest.** The owners bought McLeod's API Kit on November 19. Silvicom 360 will read McLeod through McLeod's
own web API, and it will also write a few things back — only through McLeod's API, never through SQL.

1. **(Alex Lockwood) Your written OK for a change to what you approved on September 24.** Silvicom 360 would write to
   McLeod only through McLeod's API, never through SQL, and only these things:
   (a) clear a stop when the driver completes it in the app (arrival and departure time);
   (b) file the BOL, the signed delivery copy and the revised rate confirmation on the order;
   (c) create a new hire's driver record, reactivate a returning driver, end a driver's employment, and update the
   medical-card and CDL expiry dates;
   (d) put a truck or trailer in or out of service;
   (e) later, and only if our ETA proves accurate enough, a stop ETA.
   Each one starts **off**. Each is switched on alone, after it worked on a test company, by Silvicom staff — never by a
   user. `<read-only SQL login>` stays SELECT-only. Nothing connects into your network. We never write an e-mail address
   into McLeod (your September 24 condition stays). **If you agree with conditions**, please list each one: we will
   either map it to a lock we already have (for example "only between 7 AM and 6 PM") or keep that write off. If you ever
   withdraw the OK, every write is switched off the same day.

2. **The VM.** It is the Windows Board VM (task "Silvicom 360 connector", runs as SYSTEM). Please tell us: who on your
   side holds admin on it; that its clock syncs time; and the date of any LoadMaster upgrade at least one day before. We
   switch writes off the night before, check every SQL statement and the API after the upgrade, and only then switch
   anything back on.

3. **Network.** Unchanged: LME `<LME SQL LAN IP>:1433`. Changed on 2026-10-27 and working: HTTPS to
   `api.360.silvicominc.com` (it replaced the Railway address; please update your record). New: HTTPS from the VM to
   McLeod's API on your LAN (McLeod gives the address). Still nothing inbound. And: **is the public address our API sees
   from the VM fixed?** We record it on every request and alert when it changes; we would only start refusing other
   addresses after you confirm in writing that it is fixed.

4. **The integration user in LoadMaster** (you create it, after McLeod enables the API). Web-user type `Users` only,
   named `<integration user>` so dispatchers recognise it on a stop's history; a security profile that denies billing,
   settlements, deductions, payroll, wires, order entry and every delete; an API token for it (we prefer a token to a
   password login). When it exists, please look at LoadMaster's user monitor before and after our first sign-in, to see
   whether it takes a licence seat.

5. **The secret.** McLeod's token is typed by a person at a hidden prompt into its own file, `mcleod-ws.env`, on the VM
   (SYSTEM and Administrators only), separate from `connector.env`. It never leaves the VM, a log or our repository. You
   place that file during the visit in item 17; you may hold the token instead of us — your choice.

6. **How you stop it at once, without us.** (a) Disable `<integration user>` in LoadMaster, or delete its token. We will
   test whether disabling the user also stops a token that was already issued, and tell you the result; if it does not,
   we will sign in with short-lived tokens and sign out after each batch, so disabling the user still stops us within
   minutes. (b) On the VM, `set-mcleod-api.ps1 -Writes off` stops writes only; stopping the task stops everything. On our
   side there is a switch per kind of write and one master switch.

7. **What a stop clear does in your LoadMaster** — needed in writing before the first live write. For a pickup and a
   delivery, first stop and last stop: which of these does a clear start — movement or order status, an EDI 214 to the
   shipper, customer notifications, ready-to-bill, driver pay or settlement, the tractor's location, a service-failure
   record? Then the exact LoadMaster steps to undo a wrong clear, including after a 214 went out and after
   ready-to-bill; and whether a dispatcher can see that `<integration user>` made the clear.

8. **Rollout, and which customers are EDI.** After go-live a driver's Complete clears the stop; dispatchers can still
   clear by hand, and 360 never overwrites a time McLeod already has. Order: pickups first, for customers you name as not
   EDI; then deliveries for non-EDI customers; EDI customers last. **Please send the list of our EDI customers** (our SQL
   login cannot see that on the customer row). Until we have it, deliveries are never written.

9. **Service failures.** We send each clear as "not reportable" with no delay code. McLeod may still create a
   service-failure record without a code when a stop is late. Is that acceptable to your dispatchers? If not, we write
   pickups only until McLeod gives us a way to clear without one.

10. **Call-ins (for the ETA, later).** Does a call-in in your LoadMaster send anything to a customer — an EDI 214, an
    e-mail or a portal update — for any customer? If yes, we never write the ETA as a call-in.

11. **A test company.** Is there a test company or test server we may write to, with copies of drivers, tractors,
    trailers and customers? Every write except the stop clear is tried there first, and is never switched on without
    it. If there is none, for the stop clear only: a test customer with no EDI partner and no notification contacts,
    not billable; a driver `<test driver code>` excluded from settlements; a yard tractor; one test order with two yard
    stops; and you rehearse the undo from item 7 by hand once before our first call. Driver records, record updates and
    files are never tried on the live company.

12. **SQL grants — the same request as my November 13 email.** Still open: Part 4 on LME — the 13 tables `gl_ledger`,
    `gl_ledger_hist`, `gl_account`, `gl_control`, `fiscal_year_dtl`, `voucher`, `voucher_hist`, `voucher_dist`,
    `drs_settle_hist`, `fuel_detail`, `fuel_detail_hist`, `fuel_tax_history`, `equipment_item` — plus two lines added
    since: `drs_check` and `gl_summary` (read-only; no personal data beyond a payee id). Not needed any more: the copy
    refresh and Part 2 on the copy.

13. **Imaging (Part 6).** The same request as before (the `dta` read for revised rate confirmations) — one status
    line, please: running, or still open.

14. **Driver codes for ending employment.** When an office person ends a driver in 360, McLeod should get the same
    "reason for leaving" code your team uses. We will try to read McLeod's list of those codes through the API. If the
    API cannot read it, please send us the list (code and meaning), and whether "can be rehired" is a Y/N on the driver.

15. **Driver time off.** Our records of drivers' time off from the connector stop on November 17. Is the line
    `MCLEOD_DRIVER_TIMEOFF_PATH` set in the VM's `connector.env`, and if it is, does that job still run? (If it was never
    set, that is the answer; nothing else depends on it.)

16. **SQL for your review before it runs, as agreed — one review for all of it.** One updated routine file, sent before
    the visit in item 17, with:
    (a) the three statements that read `reference_number` for the pickup number. Before writing them, under
    `<read-only SQL login>` on LME, we will run and send you: the column list of `reference_number`
    (`INFORMATION_SCHEMA.COLUMNS`); whether its `stop_id` has the same type and length as `stop.id` (so the join needs
    no conversion); whether a stop can carry the same qualifier and value twice; the read's cost with
    `SET STATISTICS TIME, IO ON`; and whether the login holds the `reference_number` grant on the analytics copy
    (`HAS_PERMS_BY_NAME`);
    (b) the test-company read — the same movement and stop statements with the test company as the parameter
    (movements and stops only, never drivers, tractors or trailers), posted to 360 where reports never count them;
    (c) the finance statements that read `drs_check` and `gl_summary`, and the posting-key statement widened to every
    module.
    Still one program and one SQL connection. McLeod API calls run on their own timer, so one API call may run while the
    one SQL statement runs. Is that within what you agreed?

17. **Volume on McLeod's server.** At most one API call at a time, at least half a second apart; about 230 stop clears a
    day with 2–3 reads each; during the one-week comparison, about one read per changed movement every 15 minutes.

18. **Logs.** Unchanged: counts, times and McLeod ids only; no addresses, licence numbers or McLeod's message text.

19. **Order of visits** (we prepare each; you or Miki run it):
    (1) one connector update with everything new switched off, the routine from item 16, and `mcleod-ws.env` placed;
    (2) API settings and a read-only discovery run;
    (3) comparison reads on;
    (4) writes on for the test company only;
    (5) after your OK on items 1 and 7–9 and the owner's sign-off, the first live operation (stop clears, pickups first).
    One later connector update may follow for the remaining API features; it carries no SQL.

Thank you,
Miki
