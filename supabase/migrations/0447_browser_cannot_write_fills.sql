-- 0447 — the browser can no longer write a fill (F02-F04 PLAN.md chunk 12b, Q-F6; owner's ruling 2026-10-07).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- `fuel_transactions` is the fuel ledger, and every row in it comes from the EFS feed through the API's
-- service role: 18,517 of 18,517 fills on production are `source = 'fuel_card'` (re-measured 2026-10-09).
-- Yet a fuel manager's browser token held INSERT, UPDATE and DELETE on it (0004, reshaped by 0294/0300):
--   · INSERT was the "Log fill-up" drawer, used 0 times, and it wrote no audit row. 12a removed it, and since
--     then no web code writes this table (`table-writers.json`).
--   · UPDATE let a token rewrite a billed amount, a time or a truck from the address bar — on the ledger
--     every spend figure, IFTA return and fuel case is computed from.
--   · DELETE cascaded to the fill's alerts. 0437 now refuses the cascade onto a reviewed alert, but an
--     unreviewed one still went, and the fill with it.
-- None of the three was ever used for its purpose. Each was a way to change the ledger that leaves no
-- trace in `audit_logs`, which is what a door with no audit is.
--
-- ── WHAT IT DOES ────────────────────────────────────────────────────────────────────────────────
-- Drops the three permissive write policies. With row-level security on and no permissive policy for a
-- command, that command is refused for every role but the service role, which bypasses RLS — so every
-- API writer (`table-writers.json`: EFS ingest and sync, scoring, the flag reconcile, attribution,
-- station resolution, weather, the audit route) is unchanged.
--
-- And the two RESTRICTIVE insert policies for drivers (`ftxn_driver_insert`, 0083; `fuel_tx_driver_insert`,
-- 0135). A restrictive policy only narrows a permissive one; with none left they admit nothing and narrow
-- nothing. Left in place they would describe a path that does not exist — "a driver may log a manual fill
-- of their own" — which is the reason 0300 §D gave for taking `driver` out of `ftxn_insert`.
--
-- Reads are untouched: `ftxn_select` (0004), `ftxn_section_read` (0417) and the two driver read scopes.
--
-- ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────────
-- · It does not revoke the table GRANTs. Supabase grants every table to `authenticated`; the policy set is
--   what decides, and this repo states access there (as 0412 does for functions).
-- · It does not drop the columns only the form wrote (`payment_method`, `receipt_path`, `entered_by`).
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) ─────────────────────────────
-- Policies only. 12a, which removed the browser's last writer, merged first. If both ride one release,
-- this applies a few minutes before the code: in that window the old page's "Log fill-up" would be
-- refused with an error toast — a button with 0 uses in 18,517 fills.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- Re-run 0300 §D (`ftxn_insert`), 0294's `ftxn_update` and `ftxn_delete`, 0083's `ftxn_driver_insert` and
-- 0135's `fuel_tx_driver_insert`.
--
-- ── VERIFY AFTER IT APPLIES ─────────────────────────────────────────────────────────────────────
--   select policyname, cmd, permissive from pg_policies where tablename = 'fuel_transactions' order by cmd;
--   -- expect four SELECT policies (ftxn_select, ftxn_section_read, ftxn_driver_select,
--   -- fuel_tx_driver_scope) and nothing for INSERT, UPDATE or DELETE.

drop policy if exists ftxn_insert on public.fuel_transactions;
drop policy if exists ftxn_update on public.fuel_transactions;
drop policy if exists ftxn_delete on public.fuel_transactions;
drop policy if exists ftxn_driver_insert on public.fuel_transactions;
drop policy if exists fuel_tx_driver_insert on public.fuel_transactions;
