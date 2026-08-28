-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_billing gains the F1-measured columns 0257 could not know about
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Recon F1 ran against the sandbox on 2026-08-27 and answered billing_history's real column set;
-- four of its columns matter to staging and did not exist in 0257's shape:
--
--   `canceled` / `rebilled` — flags whose VOCABULARY IS STILL UNMEASURED (recon F3 is written and
--   waiting for the next VPN window). They are staged VERBATIM because the raw layer stores what
--   the source asserts and judges nothing; no reader may filter on them until F3 answers what the
--   values mean. What discriminates real revenue TODAY is documented elsewhere: June 2026 had
--   1,640 billing rows of which exactly 1,595 posted one-line-per-invoice to GL module BILL
--   (0257's measurement) — so the projection's canonical predicate is "the GL booked it"
--   (post_key present, post_module = 'BILL'), the control-total doctrine (D-MC12) applied to
--   revenue. The 45 unposted rows stay here, visible, uncounted.
--
--   `billing_loaded_distance` / `billing_empty_distance` — billing's OWN mileage assertion,
--   independent of movement.move_distance and of Samsara. Stored because a third measurement of
--   the same trip is reconciliation material (which basis a report divides by remains the
--   harness's stated per-report decision — D-FS7's posture).
alter table mcleod_billing
  add column if not exists canceled                 text,
  add column if not exists rebilled                 text,
  add column if not exists billing_loaded_distance  numeric(10,1),
  add column if not exists billing_empty_distance   numeric(10,1);

-- raw-access-waiver: this migration widens the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
