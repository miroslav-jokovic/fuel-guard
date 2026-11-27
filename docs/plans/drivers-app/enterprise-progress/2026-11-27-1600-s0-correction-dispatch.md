# 2026-11-27 — correction: a load reaches a driver when the office presses Dispatch → Send (D-LMR5 stands)

**The 1500 entry was wrong.** It said that DF-1 supersedes D-LMR5's send gate. It does not.

- **Owner, 2026-11-27, confirming the 2026-09-24 ruling D-LMR5 (`mcleod/LOADS-MIRROR-PLAN.md:338`):** a load becomes visible
  to a driver when a dispatcher clicks **Dispatch** in Silvicom 360 and **Sends** it.
- **DF-1** ("see my load as soon as dispatch assigns it; today it stays hidden until the first stop departs") is about the
  **status** gate, not the send gate. Read together:

**The rule S1.1 builds:** once the latest `load_dispatches` row for a load names the driver, the driver sees the load
**whatever its McLeod status** (`pending_approval`, `approved`, `in_transit`; and `delivered` for 14 days, DF-7). Before a
Send, they never see it.

**What already works** (code read, origin/main):

- `dispatchToDriver.ts` writes one append-only `load_dispatches` row per Send.
- `driverLoads.ts:88-110` (`loadsDispatchedTo`) makes the **latest** dispatch per load decide who holds it, whatever the
  row's SMS outcome.
- Every row today is `channel='sms', outcome='not_sent'`. The SMS half is held on Q-LMR9 (no dispatch-text consent).

**What is missing:**

1. **The status gate.** `DRIVER_VISIBLE_STATUSES` and the 0371 driver scopes still drop `pending_approval` and `approved`.
   So a load sent before its first stop departs stays hidden. That is DF-1.
2. **The app delivery.** A Send records only the held SMS.
   - It should also notify the driver's app (push: "New load from dispatch").
   - It should record the app outcome as its own row, `channel='app'`, outcome `sent`, `not_sent` or `failed`.
     `load_dispatches_channel_check` (0370) already allows `'app'`.
   - The Send modal should say "Sent to the driver's app" instead of only "Text held".
3. **The co-driver (O-3).** A Send to the driver also shows the load to `loads.co_driver_id`, McLeod's second seat.
   - The modal names both seats.
   - Three active loads have a co-driver today.
4. **Re-dispatch.** When a Send names another driver, the earlier driver's queued evidence returns `late_evidence`
   (D-MK20). It is never lost.

**Usage today:** 0 `load_dispatches` rows ever, so no dispatcher has pressed Send in production. Before drivers rely on
it, the dispatchers need to be told that the button is how a load reaches the phone. That is part of the D-MK34 go-live
briefing (register Q-9 names who reads it).
