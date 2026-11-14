**Subject:** Analytics copy refresh, the finance night, and three tables for lumper fees

**To:** Alex Tzakov. **Cc:** Alex Lockwood (he set the finance conditions on 09-24).

**Attach:** `SILVICOM-GRANTS.sql` (this folder, as on `main`). New lines are Part 4 and Part 5,
marked "added 2026-11-13, NOT YET RUN".

> **What this is based on (checked 2026-11-13, not assumed).**
> - Sent and run: the 09-25 grants file (Alex T. ran it 09-28, fixing `state` to `state_id`) and the
>   six extra lines of 09-28 (run 09-29). Saved thread: "Documentation, prepared for VM".
> - Agreed by Alex L. on 09-24: "Finance stays on the analytics copy first. After we watch one full
>   night and the counts look right, the same grants go on LME."
> - That night has not happened. Under `silvicom_dispatch_ro` today, `lme_analytics` refuses every
>   finance table, the same as LME. The copy was restored on 10-09, and a restore brings LME's
>   permissions with it, so the 09-28/29 grants on the copy are gone.
> - Finance in 360 is read from the copy under the older analytics login, by hand, after each
>   restore (08-21, 09-10, 10-09). That is why it ends on 10-09.
> - NOT confirmed as sent: `REQUEST-TO-ALEX-2026-10-10-FINANCE.md` (fuel_tax_history, voucher_dist,
>   gl_control, fiscal_year_dtl). No saved copy outside the repo. This email does not rely on it.

---

Hi Alex,

Three things, all read-only.

**1. Could you refresh the analytics copy?** `lme_analytics` was last restored on October 9, and
our finance pages stop on that day. A current restore lets us catch up straight away, the same way
as after the September 10 and October 9 ones.

**2. The finance night we agreed in September.** The plan was: finance grants on the analytics copy
first, one full night watched, then the same grants on LME. You ran the grants on 09-28 and 09-29
and they checked out. But I looked today, and under `silvicom_dispatch_ro` the copy now refuses
every finance table. I think the October 9 restore replaced them, since a restore carries LME's
permissions. So the watched night never took place under the connector's login.

To finish it, after the refresh:

- run Part 2 of the attached file on `lme_analytics` again (same lines as before, plus the four
  small tables added since: `fuel_tax_history`, `voucher_dist`, `gl_control`, `fiscal_year_dtl`);
- I run the finance read that night in dry-run mode (it reads and counts, sends nothing) and send
  you the counts per table the next morning;
- if they look right to you, Part 4 puts the same tables on LME, and the connector on the VM reads
  finance itself at 2:00 AM. After that we don't need restores for finance, and the NikiAnalytics
  login is no longer needed for this work.

If you'd rather skip the night on the copy and go straight to Part 4 on LME, that works for us too.
Your call.

**3. Three more tables, for lumper fees.** We are building a list in Silvicom 360 of every load
where we paid a lumper, so dispatch and billing stop checking them by hand. Part 5 of the file, on
LME:

- `other_charge`: the accessorial charges on an order. We read the rows with code `LUM`.
- `other_charge_hist`: the same charges as they went out on an invoice.
- `drs_pending_deduct`: settlement lines not paid yet (the lumper advance and the driver's
  reimbursement). The paid ones are in `drs_deduct_hist`, already in Part 4.

No statement reads these yet. As agreed, I'll send the new SQL file for review before anything runs
against LME.

Thanks,
Miki
