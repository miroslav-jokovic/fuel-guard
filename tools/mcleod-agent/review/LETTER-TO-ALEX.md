Subject: Silvicom 360 connector: what we built and how it reads LME

Hi Alex,

Here's a short overview of what we've built on our side, how it reads LME, and what we do with the
data. The two attachments have the details: SILVICOM-READ-ROUTINE.sql has every statement word for
word, and INSTALL-ON-VM.md covers setting it up on the VM.


WHAT IT IS

A small program we call the connector. It runs on the VM, reads LME with the read-only login,
and sends what it reads to Silvicom 360 over HTTPS:

    LME  ->  connector on the VM  ->  HTTPS  ->  Silvicom 360

It's one program with one connection, and it only ever runs SELECTs. Nothing connects in to your
network. In SQL Server it shows up as "Silvicom 360 connector".


WHAT WE DO WITH THE DATA

McLeod stays the system where loads are created, dispatched and changed. Silvicom 360 becomes a
read-only mirror of it that we build on:

- Loads board: every open load with its stops, driver, truck, trailer and dispatcher, shown
  exactly as McLeod has it. We're taking out the load creation and approval we had on our side,
  so a load's status always comes from McLeod.
- Live map: which truck is on which load and which stops are next. Truck positions come from
  Samsara, and the load and stops come from LME.
- Drivers, trucks and trailers: our lists stay matched to yours, for compliance and inspections.
- Finance: settlements, fuel, AP, billing and GL, for cost per mile and the fleet report.

We're setting up our storage in two layers. The first is a raw copy, exactly as LME says it. The
second is our own model built from that copy. If we ever change how we interpret something (a
stop type, for example), we rebuild from the raw copy instead of reading LME again.


HOW IT READS (THE LOGIC)

  Every minute - open loads (statements 1-3)
    Movements with status P or A that have a stop in the last 30 days, plus their stops and
    dispatchers. That's about 160 loads and 335 stops. The connector keeps a fingerprint (hash)
    of every load it has sent, and only sends loads whose fingerprint changed. A quiet minute
    reads the board and sends nothing.

  Every 10 minutes - closing loads (statements 4-5)
    A load that drops off the open board isn't assumed finished. The connector looks it up by
    movement id and sends what LME says: delivered (D) or void (V). It's a short keyed read of
    at most 300 ids, and usually only a handful.

  Every 15 minutes - drivers, trucks, trailers (statements 6-8)
    The same fingerprint approach: only changed records are sent.

  Every night at 2:00 AM Central - finance (statements 9-21)
    A rolling 75-day window of settlements, deductions, vouchers, fuel, movements, billing and GL,
    plus month totals. For now this runs against the analytics copy, which was last restored
    September 10. It moves to LME once the finance tables are granted.

  By hand only - three "who has left" reads (statements 22-24).

The feeds run one after another, never at the same time, on one held connection. Every statement
goes out with LOCK_TIMEOUT 5000, DEADLOCK_PRIORITY LOW, READ COMMITTED and OPTION (MAXDOP 1),
and has a 15-second limit. After three timeouts in a row, the connector pauses for 15 minutes.
The idea is simple: if anything is busy, we're the ones who wait. The attached SQL file is
generated from the connector's code, so it always matches what actually runs.

We looked at Change Tracking (thanks for granting it). At this size, asking "what changed" cost
more than simply reading the ~160 open loads (about 60 ms against 32 ms), so the connector
doesn't use it. The fingerprints give us the same result on our side.


WHAT IT COSTS APPNEW (measured September 24)

  Open loads, 3 statements          about 32 ms CPU, from memory
  Closing loads, 300 ids            under 16 ms CPU
  Drivers/trucks/trailers           under 16 ms CPU
  Finance, whole night              about 10 s CPU, one core (measured on the analytics copy)

  Per day, all together             about 60 CPU-seconds, or 0.002% of the server
  Statements per day                about 4,900, or 0.04% of its normal request rate

While measuring we found one of our finance queries was missing a company_id match. It picked up
TMS2/TMS3 order numbers on 128 movements, and it was much heavier than it needed to be (over 4 s
of CPU). It only ever ran against the analytics copy. It's fixed now (0.22 s), and every query is
checked automatically for the same mistake.


WHAT WE'D NEED FROM YOU

- The VM: Windows or Linux, 2 vCPU / 4 GB is plenty, Node.js 22+. It needs to reach LME on 1433
  and HTTPS out to fleetguardapi-production.up.railway.app.
- A few more read grants for silvicom_dispatch_ro:
  - reference_number, which is where the PU number lives;
  - customer, just the id, name, city and state;
  - for finance: gl_ledger, gl_ledger_hist, gl_account, billing_history, drs_settle_hist,
    drs_deduct_hist, voucher, voucher_hist, fuel_detail, fuel_detail_hist, equipment_item;
  - SHOWPLAN, optionally.
  Once finance is on this login, the NikiAnalytics login isn't needed for us anymore.
- When the VM is live, I'll switch off the roster sync that runs on my laptop today.

A few things we couldn't work out from the data:
  1. Stop types VA/VP and SD/SP. SD/SP look like a trailer split across two movements. VA/VP
     mostly sit at SAIA terminals on the Viking Packing runs. Is VA/VP a real stop or a routing
     point, and what's the difference between them? For now we leave those stops out.
  2. Is A "available / not covered yet" and P "dispatched", with D delivered and V void?
  3. Encryption: we tested an encrypted connection with the server's current self-signed
     certificate and it works, so we'd start with that. If you'd rather use a proper certificate
     or stay unencrypted on the LAN, just tell us.
  4. Dispatchers: tractor.fleet_id matched the load's dispatcher on 95 of 97 loads we checked. Is
     that the right field to use? And are the "loadmaster" loads created automatically, by EDI for
     example?

Soon we'd like to read a few more columns from tables you've already granted: stop location name,
actual arrival/departure, ETA, stop contact, PO number, customer code, weight and pieces. We'll
send you the updated SQL file before that goes in.

If you'd like anything changed or left out, let me know. Nothing runs on a schedule until you're
OK with it.

Thanks,
Miki
