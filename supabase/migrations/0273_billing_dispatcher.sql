-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_billing gains the dispatcher who booked the load
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- The owner asked, 2026-08-28, to see the dispatch name on every load and earnings per dispatcher.
-- McLeod holds it and we were not staging it, so this is a real gap rather than a derived view.
--
-- WHICH column, and why it matters more than it looks. Three fields could plausibly answer "who
-- dispatched this", and they were measured against June 2026 before one was chosen:
--
--   `orders.operations_user`   — the operations/dispatch user on the order. 1,640 of 1,640 June
--                                bills resolve to a name, and the join is 1:1.
--   `billing_history.entered_user_id` — also 100%, but it names whoever KEYED the invoice, which
--                                is a billing clerk's act, not a dispatcher's.
--   `movement.dispatcher_user_id` — 98.5% populated across 73 users and semantically the closest
--                                name, but reaching it from a bill goes through `movement_order`,
--                                and THAT JOIN FANS OUT: June's 1,640 bills become 3,408 rows and
--                                $5,490,961.97 of revenue becomes $11,486,355.54. An earnings-per-
--                                dispatcher report built on it would have shown the carrier
--                                double its own money, plausibly, with no error anywhere.
--
-- So the dispatcher is `orders.operations_user`, resolved to `users.name` by the collector because
-- the id is a login handle ("vladi") and the name is what a person reads ("Vladi Popov"). Both are
-- stored: the id is McLeod's stable key and survives a rename, the name is for display. Neither is
-- inferred — this is McLeod's own assertion on its own order, which is what D-MC12 requires.
--
-- Nullable on purpose. A bill whose order carries no operations user is a fact about the carrier's
-- data entry, and the reports show it as its own "(unassigned)" bucket rather than dropping the
-- money or spreading it across the named dispatchers.
alter table mcleod_billing
  add column if not exists dispatcher_user_id text,
  add column if not exists dispatcher_name    text;

-- The earnings-per-dispatcher report groups by dispatcher inside an org and a bill-date window;
-- without this it is a full scan of every staged bill the carrier has ever had.
create index if not exists idx_mcleod_billing_dispatcher
  on mcleod_billing (org_id, dispatcher_user_id, bill_date);

-- raw-access-waiver: this migration widens the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
