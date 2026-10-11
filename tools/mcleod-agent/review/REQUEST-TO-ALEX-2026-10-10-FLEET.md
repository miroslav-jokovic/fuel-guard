**Subject:** Two more tractor columns, and a small connector update

**Attach:** `SILVICOM-READ-ROUTINE.sql` (this folder, as on `main`) and
`silvicom-connector-update-2026-10-10.zip` (built by the owner's session from `main` with
`git archive`, tracked files only, `connector\` folder only; no Node, no `node_modules`, no secrets).

> **Why this exists (DISPATCH-BOARD-PLAN DB1).** The Dispatch board groups trucks by their McLeod home
> fleet, and the VM's connector was packaged on 2026-10-07, before the roster read learned
> `tractor.fleet_id` (#1421) — or `tractor.exclude_fueltax` (IFTA-PRECISION-PLAN IP4, 2026-10-05).
> Production measured 2026-10-10: 0 trucks carry a fleet code, so every truck reads "No fleet" and
> "My fleet" narrows nothing. Diff of the VM's `connector\` against `main`, same day: `roster.mjs`,
> `queries.mjs`, `agent.mjs`, the new `fuelTaxReceipts.mjs`, and the review files; `package.json` and
> `package-lock.json` are unchanged, so the installed `node_modules` stays. The roster hashes the whole
> row (`diffAgainstState`), so the first pass after the update resends every truck once, by design.

---

Hi Alex,

The connector has been running well since Friday, thank you. Before we update it, here is the one
change to what it reads, for your review, as agreed.

**What changes.** The roster statement for tractors (in the attached SQL file, search for
`fleet_id`) reads two more columns from `dbo.tractor`, which the login can already read:

- `fleet_id`: the truck's home fleet (VINNIEV, KANE and so on). Our new Dispatch board uses it so each
  dispatcher can see their own fleet's trucks.
- `exclude_fueltax`: McLeod's switch for leaving a tractor out of fuel tax. On 10-05 it was N on every
  tractor; we use it for the IFTA report.

Same statement, same schedule, same filter. No new tables and nothing that writes.

The update also includes the fuel-tax receipts statement from my 10-05 note (`fuel_tax_history`,
source F only). It's part of the nightly finance read, so it does not run while finance is off, and
it needs the grant that's still pending anyway.

**If that's fine, the update takes a few minutes on the VM** (PowerShell as Administrator, in the
folder with `install-connector.ps1`):

    powershell -NoProfile -ExecutionPolicy Bypass -File .\install-connector.ps1 -Step Stop
    Expand-Archive .\silvicom-connector-update-2026-10-10.zip -DestinationPath C:\Install\update -Force
    Copy-Item C:\Install\update\connector\* C:\Silvicom\connector -Recurse -Force
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install-connector.ps1 -Step Start

It only replaces program files. `connector.env` and `service-state.json` are not in the zip, so the
settings, password and token stay as they are. Please send me what `-Step Start` prints. The first
roster run after the update will show every truck as changed. That's expected, because each truck
now has two more fields, and it only happens once.

Thanks,
Miki
