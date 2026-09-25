Hi Miki,
 
Per our conversation from yesterday we have now updated the analytics database with the latest snapshot ,you should have all the data up to 11PM today.
 
We have also created access for you to the main (live) database as follows:
 
Server: 10.0.1.171
Database: lme
 
You can run any discovery queries on the live data but when you are ready to publish a routine that will query the live database systematically as we agreed please sent this to us first for a quick review.
 
Thanks,
Alex


Good morning,
 
User with the permissions requested is now ready:
 
silvicom_dispatch_ro
[password removed 2026-09-17 — it lives in tools/mcleod-agent/.env, which is gitignored]
 
 
BTW the script that you have provided had issues but we corrected them and it is all good.
 
Everything else looks good – there is a Board dedicated VM where you can run your connector please email me next week and I will set you up with access to this machine.


---

**Alex, 2026-09-24 — reply to the letter, the VM notes and the SQL file** (the approval the connector
is built to; summarised in COLLECTOR-AUDIT-2026-09-24.md and LOADS-MIRROR-PLAN.md)

Hi Miki,

Thanks for the letter, the VM notes, and the SQL file. That is the right way to bring this in: exact statements, measured cost, one read-only login, and nothing connecting into our network.

I am good with the approach. McLeod stays the system of record. Silvicom 360 can be a read-only mirror. The connector can run on our side as one program, one connection, SELECTs only.

VM We will stand up a small Linux VM. Node.js 22+, outbound to LME on 10.0.1.171:1433 and HTTPS 443 to fleetguardapi-production.up.railway.app, no inbound access. We will own the box. You send the folder and the two secrets separately. We can install together once it is up.

Login and grants silvicom_dispatch_ro stays read-only. No insert, update, or delete.

I will grant SELECT on:

reference_number
customer (id, name, city, state)
gl_ledger
gl_ledger_hist
gl_account
billing_history
drs_settle_hist
drs_deduct_hist
voucher
voucher_hist
fuel_detail
fuel_detail_hist
equipment_item

Finance stays on the analytics copy first. After we watch one full night and the counts look right, the same grants go on LME. SHOWPLAN only if you still need it after that night; I do not want it left on. Once finance is on this login, NikiAnalytics is no longer needed for this work.

Schedule Do not put it on a timer until we have done these together:

Dry run: node --env-file=connector.env agent.mjs --loads --dry-run
One-time close of the loads Silvicom 360 still shows open that McLeod has already delivered or voided
Start the service and watch the first few minutes of the log
Switch off the roster sync on your laptop

After that, the cadence in your letter is fine: open loads every minute, closing loads every 10 minutes, roster every 15 minutes, finance at 2:00 AM Central. Keep LOCK_TIMEOUT 5000, DEADLOCK_PRIORITY LOW, READ COMMITTED, OPTION (MAXDOP 1), the 15-second cap, and the 15-minute pause after three timeouts.

Your questions

VA/VP and SD/SP SD/SP are split-trailer stops. The same trailer work is split across two movements. VA/VP on the Viking Packing / SAIA runs are routing or interline points, not customer pickup or delivery. Leaving VA/VP off the board is the right call for now. SD/SP can stay off the live board if they clutter the map; include them later if you need the trailer path.

Statuses Yes, for how we use the board:
A = available / not covered yet
P = planned / dispatched
D = delivered
V = void
A load that drops off the open board is not finished until LME says D or V. Looking it up by movement id, as you do in statements 4 and 5, is correct.

Encryption Use encryption. The current self-signed certificate is fine on the LAN for the first cut. If we put a proper certificate on 1433 later, I will send the trust settings. Do not run unencrypted.

Dispatchers and loadmaster Use movement.dispatcher_user_id and the users join you already have. That is the dispatcher on the load. tractor.fleet_id is the fleet or group. It often matches, but it is not the person. Loadmaster loads are real McLeod loads, including EDI. Do not filter them out.

A few conditions

Part 5 stays manual.
The name_of_spouse email convention stays on your side. Do not write it back to McLeod. Logs should stay counts, times, and McLeod ids. No addresses or licence numbers.
Treat the attached SQL file as the version we review. When you add stop location name, actual arrival/departure, ETA, stop contact, PO number, customer code, weight, and pieces, send the new SQL file before it goes live.
Keep matching company_id on every join. The settled-movements fix stays in.

Next step Send me two times this week for 30 minutes. We will do the dry run, confirm the open-load count against the McLeod board, and I will issue the extra grants on the analytics copy.

Thanks,
