-- 0468 — ordering a Med-Stop test from the product: its own switch, and whose contact the order carries
-- (MEDSTOP-PLAN.md §7A.4, §7A.10 — D-MSUX2, D-MSUX5; batch UX3).
--
-- ── WHY A SECOND SWITCH ─────────────────────────────────────────────────────────────────────────
-- `enabled` (0463) already gates the hourly READ, and it is on. Ordering is a different act: every
-- order is billed to the carrier and places a real electronic collection order — Med-Stop has no test
-- host (Q-MS2), so an order from staging is as real as one from production. The owner ruled (answer 2)
-- that the first order is made only once everything is built, on a real person who needs one, with the
-- owner watching. So ordering ships OFF, per org and per database: staging stays off, and production is
-- switched on by an admin in Settings › Med-Stop on the day of that first order.
--
-- ── WHY A CONTACT ON THE CREDENTIAL ─────────────────────────────────────────────────────────────
-- Owner answer 5: never text or e-mail a driver. Med-Stop's request form REQUIRES `tosms` and
-- `toemail`, and measured 2026-10-13 its prefilled form already carries the driver's phone in `tosms`.
-- D-MSUX5: every order sends `sendsms=N`, `sendemail=N`, and overwrites both fields with the ORDERING
-- OFFICE's contact (the DER's), so even a Med-Stop default we cannot see lands in the office. Nothing in
-- the product holds that contact today; it belongs beside the key it is used with. An order is refused
-- while either is empty.
--
-- ── WHY ITS OWN MERGE ───────────────────────────────────────────────────────────────────────────
-- New columns on a table code already reads: the first reader ships in the next merge
-- (`lint:migration-ordering`, docs/MIGRATION-DISCIPLINE.md §the-deploy-window).
alter table public.medstop_credentials
  add column if not exists orders_enabled boolean not null default false,
  add column if not exists order_contact_email text
    check (order_contact_email is null or order_contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column if not exists order_contact_phone text
    check (order_contact_phone is null or order_contact_phone ~ '^[0-9]{10}$');

comment on column public.medstop_credentials.orders_enabled is
  'Ordering tests from the product (UX3). Off by default; every order is billed and real — there is no Med-Stop test host.';
comment on column public.medstop_credentials.order_contact_email is
  'The office (DER) e-mail sent as toemail on every order — never the driver''s (D-MSUX5).';
comment on column public.medstop_credentials.order_contact_phone is
  'The office (DER) phone, 10 digits, sent as tosms on every order — never the driver''s (D-MSUX5).';
