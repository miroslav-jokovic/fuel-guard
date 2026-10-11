**Subject:** The finance night, and one more table

**Attach:** `SILVICOM-GRANTS.sql` (this folder, as on `main`). The new lines are marked "Added
2026-10-10, NOT YET RUN".

---

Hi Alex,

Thanks again for getting the connector running on the VM. Loads have been coming in since Friday.

Next on our list is finance. Right now our finance report only knows about a month once our McLeod
database has it in the general ledger, and the copy we read from is refreshed by hand. So the report
is running about two months behind, and the owner would like it much closer to today. Almost
everything it needs is already current in LME (billing, settlements, deductions, AP and fuel). What
is missing is the nightly read.

**Where we left it in September:** the finance grants went onto the analytics copy on 09-29, and the
plan was one night of the finance read there in dry-run mode (it reads and counts, and sends
nothing), then the same grants on LME, and then turning finance on in the connector. It would then
run once a night at 2:00 Central, like we discussed.

**The finance night on the analytics copy.** Is there a night this coming week that suits you? I
can run it from my laptop over the VPN, or it can run on the VM, whichever you prefer. The next
morning I'll send you the row counts per table from our side so you can compare them with yours.

**One more table: `voucher_dist`.** The AP part of the finance read only sees the voucher header,
and the header carries the payables account rather than the expense account the bill was coded to
(repairs, tolls, office bills and so on). The expense account is on the distribution lines, so we'd
like to add SELECT on `voucher_dist` to the finance grants, on both databases. It's in the attached
file. It's the same kind of data as `voucher` and `voucher_hist`, and nothing personal. Before I
write the statement that reads it, I'd like to check its columns against the database rather than
guess them. Once the grant is in I'll send you the statement to review, same as the others.

**Still waiting from 10-05:** `fuel_tax_history`, on both databases. It's in the same file, so
there's no rush on that if it's easier to do all of it together.

**A question for the accountant, if you don't mind passing it on.** Is there a usual day each month
when the general journals and the office payroll for the month before get posted? So far September
has only the recurring journals in the ledger. We're not asking anyone to change anything. We'd just
like the report to say when the month is likely to be complete, and until then show the figures it
already has, clearly marked as preliminary.

Thanks,
Miki
