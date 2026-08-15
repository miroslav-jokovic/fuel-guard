-- FuelGuard — 0192 mark the card mutations a proof run made (execution plan Step 4.5)
--
-- The live prover exercises a capability against a real QA card: apply, re-read, revert, re-read.
-- Every one of those writes goes through the SAME orchestrator production uses — that is the whole
-- point, because proving anything else proves nothing — so every one of them opens a row in
-- `efs_card_mutations` and is counted by the org-wide hourly cap.
--
-- ── Why an exemption is needed, and why it must be visible ──────────────────────────────────────
-- The cap is 50 mutations per org per hour. A full proof sweep is six capabilities × (apply +
-- revert), and Phase 8 onward re-proves on every promotion, so a sweep runs into the ceiling and
-- starts failing with `org_hourly_cap_reached` — a 429 that is indistinguishable, in the proof
-- record, from the vendor refusing the write. A harness that cannot tell "we hit our own cap" from
-- "WEX said no" produces evidence nobody should trust.
--
-- The exemption is therefore NOT a flag on the request. It is this column: a mutation is exempt
-- because it belongs to a proof, and the proof it belongs to is named. That makes every exempted
-- write auditable after the fact — `select count(*) from efs_card_mutations where proof_run_id is
-- null` is still the honest answer to "how many real changes did this org make", and the exempted
-- ones can be listed, attributed and counted separately rather than being invisible.
--
-- `on delete set null` rather than cascade: deleting a proof must never delete the record that a
-- card was written to. The mutation happened whatever became of the evidence.

alter table efs_card_mutations
  add column if not exists proof_run_id uuid references efs_capability_proofs(id) on delete set null;

comment on column efs_card_mutations.proof_run_id is
  'The capability proof run this mutation belongs to, when it was made by the live prover rather than by a person. Null for every real operator change. Exempt from the org hourly cap BECAUSE this is set, so an exempted write is always attributable to a named proof.';

-- The cap counts rows in a one-hour window and must now exclude proof runs, so it filters on this
-- column. Partial on `proof_run_id is null` because that is the branch the hot path takes: the cap
-- query runs before EVERY card write in the product, and proof rows are the rare case.
create index if not exists idx_efs_card_mutations_org_real
  on efs_card_mutations (org_id, created_at desc)
  where proof_run_id is null;
