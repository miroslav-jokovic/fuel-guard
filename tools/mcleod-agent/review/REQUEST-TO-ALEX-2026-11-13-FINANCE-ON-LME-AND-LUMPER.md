**Subject:** Finance read on LME, three tables for lumper fees, and a refresh of the analytics copy

**Attach:** `SILVICOM-GRANTS.sql` (this folder, as on `main`). The new lines are Part 4 and Part 5,
marked "added 2026-11-13, NOT YET RUN".

> **Why this exists (LUMPER-REVISED-RC-PLAN LRC1; owner's request 2026-11-13).** Checked on
> 2026-11-13 under the connector's own login: on LME `silvicom_dispatch_ro` reads the load-board and
> roster tables only, and none of the finance tables. Finance in 360 therefore still comes from the
> analytics copy, which was last restored on 2026-10-09, so the finance pages end on that day. Part 4
> ends the dependence on the restore; Part 5 is what the lumper tracking needs; the refresh is the
> stopgap until Part 4 is run.

---

Hi Alex,

Three things, all read-only as always. The first one is the only one that is urgent.

**1. A refresh of the analytics copy, when you have a moment.** `lme_analytics` was last restored on
October 9, so our finance pages stop on that day. Could you restore it from a current backup? I'll
run the finance read from my side the same day and send you the row counts.

**2. The finance tables on LME, so we stop asking you for refreshes.** This is the step we agreed in
September: the finance grants went on the analytics copy first, and onto LME once the read had run
clean there. It has: every finance statement ran under the connector's login on the copy on 09-29,
and the full read has run from the copy since, most recently after the October 9 restore. Part 4 of
the attached file is the same list of tables on LME. It also carries the four small ones still
waiting from October (`fuel_tax_history`, `voucher_dist`, `gl_control`, `fiscal_year_dtl`), so it
can all be done in one go.

Once Part 4 is in, the connector on the VM reads finance itself, once a night at 2:00 Central, the
way we discussed. The statements are the ones already in `SILVICOM-READ-ROUTINE.sql`; I'll send you
the current file before we switch it on. It measured about 10 seconds of CPU a night on one core.

**3. Three tables for lumper fees.** We are building a list in Silvicom 360 of every load where we
paid a lumper, so dispatch and billing stop checking them by hand: was it paid, is it on the
invoice, and has the broker's revised rate confirmation come in. McLeod already holds the first two
facts; we only need to read them. Part 5 of the file:

- `other_charge` — the accessorial charges on an order. We read the rows with code `LUM`.
- `other_charge_hist` — the same charges as they went out on an invoice.
- `drs_pending_deduct` — settlement lines not paid yet (the lumper advance and the driver's
  reimbursement). The paid ones are in `drs_deduct_hist`, which is already in Part 4.

Nothing personal in them beyond a driver id on a settlement line. No statement reads them yet. I'll
write the statements against the analytics copy first and send them to you for review before
anything runs on LME, same as the others.

The check block at the bottom of the file shows what the login can read after each part, and that
it still cannot write.

Thanks,
Miki
