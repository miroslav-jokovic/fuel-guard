-- FuelGuard — 0195 record HOW a card was linked, and why it was not (execution plan Step 7.7)
--
-- `linkFuelCards` decided identity with `cardRefsMatch`, whose own doc comment forbids exactly that:
--
--   "⚠️ This is a COMPATIBILITY test, not an identity test. Two different drivers' cards sharing a
--    last-4 are 'compatible' and this returns true for them. Anything that decides 'these two rows
--    are the SAME card' must use ... `cardIdentityKey`s instead."
--
-- On the production fleet that is not a hypothetical: 40 last-4 groups hold more than one live card,
-- covering 144 of 197. So the linker could only ever do one of two things — refuse (143 cards left
-- unlinked, and fuel attribution running on a quarter of the fleet) or guess (attribute a fill to the
-- wrong truck). It refused, which was the right half of a wrong design.
--
-- ── Why the outcome needs a column and not a log line ───────────────────────────────────────────
-- Step 7.7's Verify asks that a row which still cannot be linked "names which cards it could not tell
-- apart". That is a per-row fact with a lifetime, not an event: it is the answer to "why is this
-- truck's fuel unattributed?", asked weeks later by somebody looking at a report.
--
-- It is deliberately NOT `sync_error`. That column already carries two unrelated meanings — a REFRESH
-- failure and a LINKING outcome — because `linkFuelCards` runs last in the sweep and overwrites what
-- the earlier passes set, so a successful refresh displays as "Last refresh reported:
-- ambiguous_fuel_card_link" (Step 7.5). Writing a richer linking verdict into the same column would
-- deepen the overload this repository has already named. The linker stops writing `sync_error`
-- entirely; 7.5 remains responsible for the refresh half.
--
-- ── Shape ──────────────────────────────────────────────────────────────────────────────────────
--   { "status": "linked" | "ambiguous" | "no_candidate" | "unidentifiable",
--     "method": "pan_exact" | "pan_suffix" | "last4_unit" | null,
--     "candidates": ["<fuel_card uuid>", ...],   -- what it could not tell apart, or what it chose
--     "at": "<iso8601>" }
--
-- `candidates` holds fuel_card IDs, never a PAN and never a last-4 — this column is read to draw a
-- page, and standing rule 13 keeps card numbers out of anything that renders.

alter table efs_cards
  add column if not exists fuel_card_link jsonb;

comment on column efs_cards.fuel_card_link is
  'Step 7.7 linking evidence: {status, method, candidates[], at}. status=linked names the method that identified it; ambiguous lists the fuel_card ids it could not tell apart; no_candidate means nothing matched; unidentifiable means this row carries no usable identity (no sealed PAN and no unit). Never contains a PAN or a last-4. Distinct from sync_error, which is the REFRESH outcome (Step 7.5).';

-- Partial index: the operator question is "what is still not linked, and why", and that is a small
-- slice of a growing table. Rows that linked cleanly are never queried through this column.
create index if not exists idx_efs_cards_unlinked_reason
  on efs_cards (org_id)
  where fuel_card_id is null;
