-- 0362: a load's `ref` is unique among the loads an office TYPES, not among loads a TMS sends.
--
-- ── THE OUTAGE THIS CLOSES ───────────────────────────────────────────────────────────────────────
-- 2026-09-23 19:02 UTC, the first `--loads` push after L4 deployed: `POST /api/tms/loads` answered
-- HTTP 500 three times running with `duplicate key value violates unique constraint
-- "idx_loads_org_ref"`, and NO load was written — 143 new loads refused because of one.
--
-- The one was McLeod order 0135136. It is a SPLIT: the trailer is dropped at a yard on movement
-- 291013 (stop type SD) and picked up by a second movement, 291798 (stop type SP). The ingest maps a
-- movement to a load — rightly, a movement is what a driver runs — and uses the ORDER number as
-- `ref`, because that is the number the office and the customer quote. So one order is two loads
-- with one ref, and 0085's `(org_id, ref)` index refuses the second. Measured on live `lme` the same
-- morning (LIVE-MAP-PLAN.md §8, probe P5): **853 SD stops, every one of them with its SP on another
-- movement of the same order.** The 2026-09-17 pull succeeded only because no split happened to be
-- on the board that day.
--
-- ── WHY THE INDEX NARROWS INSTEAD OF THE REF CHANGING ────────────────────────────────────────────
-- A TMS load already has an identity, and it is not `ref`: `idx_loads_provider_ext` makes
-- `(org_id, provider, external_id)` unique, and the ingest matches on exactly that. `ref` on a TMS
-- load is a LABEL copied from the TMS, and two loads carrying the same order number is simply true
-- of a split. Rejected, with reasons:
--   · suffixing the movement (`0135136/291798`) — renames all 158 production loads, and shows the
--     dispatcher a number McLeod never shows them;
--   · skipping the colliding load and reporting it — the second half of every split would never
--     reach the board. A workaround in this repo's sense, and it would be permanent.
--
-- What `ref` uniqueness was FOR is untouched: 0085 made it "human-scoped per org" so that a
-- dispatcher cannot type the same load number twice. Loads with `source = 'manual'` keep exactly
-- that guarantee. `source` is NOT NULL with a check of ('manual', 'tms'), so the predicate has no
-- NULL case to fall through (the 0344 MATCH SIMPLE lesson). A typed load may share a number with a
-- TMS load — that was already possible across two TMS loads the moment a split arrived, and a
-- dispatcher typing a McLeod order by hand is a question for the board, not for an index.
--
-- Read before shipping: nothing looks a load up by `ref`. Every reader in apps/ and every SQL
-- function selects it by load id as a display label (checked 2026-09-23: no `.eq("ref"`, no
-- `onConflict` on it, no `where ref =` in any migration's function body).
--
-- ── DEPLOY WINDOW ────────────────────────────────────────────────────────────────────────────────
-- Index-only: no column, no reader, no writer changes. Code served before this applies behaves
-- exactly as today (the ingest simply keeps failing on a split), and the agent is not re-run until
-- this is confirmed applied in production.

-- The replacement FIRST, so there is no instant at which manual loads are unconstrained.
create unique index if not exists idx_loads_org_ref_manual
  on loads (org_id, ref)
  where source = 'manual';

drop index if exists idx_loads_org_ref;
