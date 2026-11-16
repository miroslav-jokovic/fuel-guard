-- Silvicom 360 — 0618 the 14 days of notice start when the notice does
-- (INSTALLED-APP-PLAN IA-S1; Q-IA12 (b), the owner's ruling of 2026-11-15)
--
-- 0617 gave every company a date 14 days after THAT migration applied — but nothing showed an admin a notice
-- then, because the notice, the page and the rule ship with this merge. Notice nobody was shown is not notice.
-- So the clock starts again here: this statement runs on staging when this merges and on production in the
-- release that carries the notice, and from that moment an admin sees "From <date>, admins sign in with a
-- code…" on every page for 14 days.
--
-- A data statement, no schema: one UPDATE of a column 0617 created, for every existing company. A company
-- created after this gets its own 14 days from the column's default (0617), unchanged.
--
-- ⚠ It moves the date LATER, never earlier, and only where nobody has been held to it yet: a company whose
-- date has already passed keeps it. On the day this is written no company's has (0617 is hours old), so the
-- guard changes nothing today; it is there so that re-running this file — a rebuilt staging, a restored
-- backup — can never hand a company that is already enforcing two-step sign-in a fresh two-week holiday.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: the code being replaced does not read this column at all.
--
-- Rollback: none needed — the previous value was the same kind of date, at most a release older.

update organizations
   set second_factor_required_from = now() + interval '14 days'
 where second_factor_required_from > now();
