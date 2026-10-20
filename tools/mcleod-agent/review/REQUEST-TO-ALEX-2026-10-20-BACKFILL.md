**Subject:** For your information: six months of delivered loads, read once from the analytics copy

**Attach:** `SILVICOM-READ-ROUTINE.sql` (this folder, as on `main`; the two new statements are Part 6).

> **Why this exists (DISPATCH-LOADS-COUNTS-PLAN DLC4, D-DLC6; revised 2026-10-20 after the owner's
> ruling).** The Loads page shows deliveries from the day the mirror began, 09/17/2026, and nothing
> earlier; the owner asked for six months. The first draft of this note asked Alex to install an
> update on the Board VM and run the read on live `lme`. It is not needed: `lme_analytics` was
> restored on 2026-10-09, the day the VM's mirror went live, so the copy holds every delivery in the
> gap, and the owner's own machine reaches it with the analytics login we already have. Nothing goes
> on the VM, nothing is read from live `lme`, and the service is not touched. Measured on the copy
> through the connector's own guards (one core, 5-second lock timeout, 15-second ceiling): a month is
> about 1,550 loaded movements and 3,300 stops in four to six seconds. Empty legs are excluded
> (D-DLC8): they share the loaded leg's order and would show every order twice.

---

Hi Alex,

Nothing to install this time — just so you know what we are reading and from where.

**What.** Part 6 of the attached SQL file: delivered, loaded movements (`status = 'D'`, `loaded = 'L'`)
whose truck left a stop between two dates, with the same columns as Part 1 (the open board) and their
stops as in Part 2. The window is on the stop's actual departure, so the far-future placeholder dates
in `stop` are never read.

**Where.** From `lme_analytics`, the copy restored on 10/09, with the analytics login you gave us for
exactly this kind of one-off read. Not from `lme`, and not from the Board VM — the connector there
keeps running as it is.

**Why.** Our Loads page can only show deliveries since 09/17, when the connector started. The office
wants to look back six months, and those loads are in the copy already.

**How much.** Two-week slices from April 1 to September 18, each a few seconds on one core, run by
hand once. Counts only in the log, no names, as always.

If anything in Part 6 looks wrong to you, say so and we will stop.

Thanks,
Miki
