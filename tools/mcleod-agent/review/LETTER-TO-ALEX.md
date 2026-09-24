Subject: Silvicom 360 connector: how we will read LME, and what we need from you

Hi Alex,

Thanks again for the read-only login and for fixing our grant script. We've been using it carefully
for discovery, and before anything runs on a schedule I want to give you the complete picture,
the way we promised. It covers how the connector is built, exactly what it reads and how often,
what that costs your server (measured on APPNEW, not estimated), what we'll never do, and the few
things we need from you.

Nothing will be scheduled until you've read this and the attached SQL file and told us it's OK.


1. HOW IT FITS TOGETHER

    LME (APPNEW)  ->  Board VM (your network)  ->  HTTPS out  ->  Silvicom 360

- The connector runs only on the Board VM you're setting up for us. That VM will be the only
  machine that ever connects to LME for Silvicom: one program, one login, one connection.
- It sends data out to us over HTTPS. Nothing connects in from outside, so you don't need to open
  a firewall port or keep an IP allow-list for us.
- Once the VM is running we'll switch off everything else we have today. That means the roster
  sync running on my laptop in your office, and our reads from the analytics database under the
  NikiAnalytics login. After that, all Silvicom reads from LME come from the VM and nowhere else.
- In SQL Server the connection shows up as program_name "Silvicom 360 connector" in
  sys.dm_exec_sessions, so you can always see us, and stop us, from your side.


2. WHAT THE VM NEEDS

- Windows Server or Linux, whichever is easier for you. 2 vCPU, 4 GB RAM and 20 GB disk is
  plenty; the connector itself uses well under 100 MB of memory.
- Node.js 22 LTS. The connector has one dependency, the Microsoft SQL driver for Node (mssql).
  Nothing else gets installed.
- Network: it needs to reach 10.0.1.171 on port 1433, and HTTPS (port 443) out to one address on
  our side. I'll send the exact hostname with the install notes.
- It runs as one background service that starts with the VM. We'll give you the install steps,
  and you or we can stop it at any time by stopping that service.
- The LME password and our upload token are stored in a config file on the VM, readable only by
  the service account. Neither is in our source code.


3. WHAT IT READS, AND HOW OFTEN

Everything is a plain SELECT. The attached SILVICOM-READ-ROUTINE.sql has every statement, word
for word, so you can open it in SSMS and run it yourself. You'll get back exactly the rows we get.

  a) Open loads - every 60 seconds.
     Movements with status P or A that have a stop in the last 30 days, with their stops, driver,
     truck, trailer and dispatcher. About 160 loads and 335 stops today.
     We'd also like to add a few columns from tables you've already granted: stop location name,
     actual arrival/departure, ETA, stop contact, PO number, customer code, weight and pieces.
     We measured it, and it reads the same pages, so it costs no more.

  b) Closing loads - every 10 minutes.
     For the loads we still have open on our side, we ask LME for their current status by movement
     id, so we see when one is delivered (D) or voided (V). That's one short keyed read, about 300
     ids at most.

  c) Drivers, trucks and trailers - every 15 minutes.
     Today this runs every 2 minutes from my laptop. That's more often than needed, so we'll slow
     it down when it moves to the VM.

  d) Finance - once a night at 2:00 AM Central, plus one extra pass on the first days of each
     month to catch late entries.
     Settlements, deductions, AP vouchers, fuel, billing history and GL totals for a rolling 75-day
     window. Today this reads the analytics database, which hasn't been refreshed since
     September 10, so our numbers are two weeks old. Moving it to LME fixes that, but it needs the
     grants in section 6.

  e) By hand only, never on a timer: three "who has left" reads (drivers, trucks and trailers
     marked inactive), which we run when we clean up our roster.


4. WHAT IT COSTS YOUR SERVER

Measured on APPNEW with SET STATISTICS TIME/IO, median of three runs, on September 24:

  Open loads (3 statements)       about 32 ms CPU, 5,200 + 3,800 pages, all from memory
  Closing loads (300 ids)         under 16 ms CPU, 1,556 pages
  Roster (3 statements)           under 16 ms CPU, about 500 pages
  Finance, whole nightly run      about 3.7 seconds CPU

  Per day, all together:          about 55 CPU-seconds, out of 3.6 million core-seconds a day on
                                  42 cores = 0.0015%
  Statements per day:             about 4,800 (mostly the three open-load reads, once a
                                  minute), next to your roughly 138 requests per second = 0.04%

To be straight with you: while measuring for this letter we found one of our finance statements
was far heavier than it needed to be, over 4 seconds of CPU and 3.3 million page reads. It was
also slightly wrong: two joins didn't check company_id, so on 128 movements it picked up order
numbers from the TMS2/TMS3 movement with the same id. We're fixing it before it runs anywhere
near LME. With the fix it takes 0.27 seconds, and the 3.7 seconds above already includes the fix.


5. HOW WE STAY OUT OF YOUR DISPATCHERS' WAY

READ_COMMITTED_SNAPSHOT is off on LME, so a slow read could make your users wait. So every
statement runs with:

  SET LOCK_TIMEOUT 5000              if a row is busy, we give up after 5 seconds; your user
                                     never waits on us
  SET DEADLOCK_PRIORITY LOW          if SQL Server has to choose, it cancels us, not them
  OPTION (MAXDOP 1)                  we never use more than one core
  READ COMMITTED, never NOLOCK       we'd rather wait a moment than read a half-written row
  15-second statement limit          our slowest statement takes 1.4 seconds
  one statement at a time            feeds run one after another, never in parallel
  automatic back-off                 three timeouts in a row and the connector pauses for 15
                                     minutes before trying again

One honest note: today's manual reads and the laptop roster sync don't set these yet. They've
been small enough (under 20 ms) that it hasn't mattered, but the VM connector won't be switched
on until every statement does, and the attached file shows them exactly as they will run.


6. WHAT WE NEED FROM YOU

  a) The Board VM (section 2).

  b) A few more read grants for the same login (silvicom_dispatch_ro):
     - reference_number: SELECT. That's where the pickup (PU) number lives; it's empty in orders
       and stop.
     - customer: SELECT on the id, name, city and state columns only. We don't need credit,
       billing or contact fields.
     - For the nightly finance run: gl_ledger, gl_ledger_hist, gl_account, billing_history,
       drs_settle_hist, drs_deduct_hist, voucher, voucher_hist, fuel_detail, fuel_detail_hist,
       equipment_item: SELECT.
     - Optional: SHOWPLAN, so we can check a statement's execution plan instead of guessing from
       timings.
     Once the finance run is on this login, the NikiAnalytics login can be disabled for us. It
     can read much more than we need (including driver SSNs), and we'd rather not have it.

  c) VIEW CHANGE TRACKING: thanks for granting it. We measured it, and at your size asking
     "what changed" costs your server more than simply reading the ~160 open loads (about 60 ms
     against 32 ms). So we plan not to use it. You can take it back, or leave it in case the board
     grows a lot.


7. QUESTIONS WE COULDN'T ANSWER FROM THE DATA

  1. Stop types VA/VP and SD/SP. SD/SP look like a split: the trailer is dropped (SD) at a yard,
     and a second movement picks it up (SP). VA/VP mostly sit at SAIA terminals on the Viking
     Packing dealer runs, and the arrival time usually equals the previous stop's departure. Does
     the truck physically stop there, or is it a routing point? And what's the difference between
     VA and VP? Until we know, we keep these stops but don't show them to drivers as deliveries.

  2. Movement status: are we right that A means available/not covered yet and P means dispatched,
     with D delivered and V void?

  3. Encryption: SQL Server offers its own self-signed certificate, so today we connect without
     encryption. Which do you prefer?
     a) you install a trusted certificate and give us the hostname it's issued for,
     b) we encrypt but accept the current self-signed certificate, or
     c) we stay unencrypted, since from the VM the traffic never leaves your network.
     We'd lean to (a) or (b), but it's your call.

  4. Dispatcher fleets: tractor.fleet_id matched the load's dispatcher on 95 of 97 dispatched
     loads we checked, so we plan to use it. Is it kept up to date when a truck moves to another
     dispatcher? And for the loads under "loadmaster" (17 when we checked): are those created
     automatically, for example by EDI?


8. WHAT HAPPENS NEXT

  1. You look over this letter and the SQL file, and tell us what to change or remove.
  2. We finish the connector changes above, and send you the final SQL file if anything moved.
  3. We install on the VM together, run each part once by hand, and compare the results to what
     we see today.
  4. Only then do we turn the schedule on, and switch off the laptop sync and the analytics login.

If you want any statement changed, limited differently or removed, just tell me and we'll change
it before anything is scheduled.

Thanks,
Miki
