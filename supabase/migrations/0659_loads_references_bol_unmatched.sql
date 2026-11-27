-- 0659: a McLeod load's BOL number and unmatched equipment codes, and its stops' reference numbers,
-- on the core tables (spec B §3.2 M-B, docs/plans/mcleod/v2/T1-driver-and-data.md N-2).
--
-- The core half of 0658, which gave the raw mirror `mcleod_dispatch_stops.reference_numbers`; the
-- gap, the measurement and the shape are there. Two files because the tables belong to two modules
-- (`lint:table-modules`).
--
-- ── THE THREE COLUMNS ────────────────────────────────────────────────────────────────────────────
-- · `loads.bol_number` — McLeod's `orders.blnum` (Q-LMR10, D-MKN4.1). It reaches raw today
--   (`mcleod_dispatch_movements.blnum`, 0364) and the projection never reads it. A column, not a
--   key: `blnum` collides 2,020 times in 134,315 orders, so `ref` stays `orders.id`.
-- · `loads.external_unmatched` — the McLeod truck/trailer/driver codes on this load that resolve to
--   no row of ours (N6, D-MKN6.3). It lives on the LOAD, not in an exceptions table, because it is a
--   projection of the load's raw codes: rewritten on every projection, so it cannot drift, and the
--   `unmatched_assignment` exception (D-MKN6.4) derives from it and resolves itself when the roster
--   is fixed (spec B §4.1). A jsonb array; null = not projected yet.
-- · `load_stops.reference_numbers` — every reference on the stop, as raw holds them
--   (D-MKN4.3): a driver at a dock is asked for whichever number that shipper uses, and the office
--   cannot know in advance which. Null = not read yet, `[]` = none. Named `reference_numbers`
--   because REFERENCES is reserved.
--
-- ── SCHEMA ONLY, AND IN ITS OWN MERGE ────────────────────────────────────────────────────────────
-- Nothing names these columns in this merge (`lint:migration-ordering`); the projection, the
-- resolver and the readers follow (N-5/N-6/N-10/N-12). Nullable with no default — the 0366 rule:
-- a manual load has no McLeod facts, and a McLeod load reads null until the next projection.
-- Each jsonb column carries an array CHECK, so its readers never meet an object or a scalar.

alter table loads
  add column if not exists bol_number        text,   -- orders.blnum (Q-LMR10, D-MKN4.1)
  add column if not exists external_unmatched jsonb  -- N6, D-MKN6.3
    constraint loads_external_unmatched_array
    check (external_unmatched is null or jsonb_typeof(external_unmatched) = 'array');
alter table load_stops
  add column if not exists reference_numbers jsonb
    constraint load_stops_reference_numbers_array
    check (reference_numbers is null or jsonb_typeof(reference_numbers) = 'array');
