-- Silvicom 360 — 0259 drop terminals
--
-- 0097 created `terminals` as the roster's home-base registry and 0098/0099/0100 pointed three
-- `home_terminal_id` FKs at it. No producer was ever built: in 162 migrations since, nothing
-- inserts a terminal, nothing reads one, and the only code reference was a schema probe. The
-- 2026-08-26 audit flagged it ("an FK column exposed through a shipped API pointing at a table
-- nothing can populate"), and the roster carve-out is where docs/ARCHITECTURE.md §3 said the
-- build-or-drop decision lands. Measured against production before writing this file:
-- 0 terminals rows, 0 drivers/vehicles/trailers carrying a home_terminal_id. Nothing is lost.
--
-- Dropped rather than built because a table with no producer is a promise nobody is keeping —
-- and since `lint:table-producers` (2026-08-26), a future terminals feature cannot ship schema
-- without its producer in the same PR, which is the ordering 0097 should have had. This drop
-- also retires the gate's `terminals` waiver: the ratchet moves down, not sideways.

alter table drivers drop column if exists home_terminal_id;
alter table vehicles drop column if exists home_terminal_id;
alter table trailers drop column if exists home_terminal_id;

drop table if exists terminals;
