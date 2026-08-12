-- 0181 — Phase 3 hardening. Three unrelated, additive changes.
--
-- ── 1. The reason CHECK that broke B1 (CRITICAL) ────────────────────────────────────────────────
-- 0177 declared `reason text not null check (length(btrim(reason)) between 3 and 200)`. 0180 made
-- reason optional (default '', dropped NOT NULL) for the B1 product decision — but LEFT that CHECK
-- in place, so an empty reason (`length 0`) violates `between 3 and 200` and every reason-less
-- mutation fails at INSERT. The web already stopped sending a reason, so this would have been the
-- first thing a locked card hit in production. Replace the constraint: empty is allowed, and a reason
-- that IS given still has to say something (3–200 chars) so a stray "a" is not evidence.

alter table efs_card_mutations drop constraint if exists efs_card_mutations_reason_check;
alter table efs_card_mutations
  add constraint efs_card_mutations_reason_check
  check (btrim(coalesce(reason, '')) = '' or length(btrim(reason)) between 3 and 200);

-- ── 2. Ledger size backstops (audit P2) ─────────────────────────────────────────────────────────
-- The 60KB caps on the redacted XML columns live only in application code (wireColumns,
-- efsCardReconcile.ts). Any other writer — a future revert path, a manual fix, a migration — would
-- bypass them and a 200KB card echo could land in a table the hourly-cap COUNT and the history panel
-- both scan. A DB-side check makes the bound structural, not a convention. Generous (128KB) so it is
-- a backstop against pathology, not a second cap the app has to stay under.

alter table efs_card_mutations
  add constraint efs_card_mutations_request_xml_len check (request_xml_redacted is null or length(request_xml_redacted) <= 131072) not valid,
  add constraint efs_card_mutations_response_xml_len check (response_xml_redacted is null or length(response_xml_redacted) <= 131072) not valid;
-- `not valid`: enforce on new/updated rows immediately, without a full-table scan of existing rows
-- (which are already app-capped at 60KB and cannot violate this). Validate lazily off-hours if ever
-- wanted; correctness for new writes does not require it.

-- ── 3. Tombstone for cards that leave the roster (audit P2) ──────────────────────────────────────
-- A card removed in the WEX portal simply stops appearing in getCardSummaries. The mirror only ever
-- upserts cards it SEES, so a removed card sat as `Active` forever, still linkable to fuel_cards and
-- still offered for mutation (which could only fault). This column lets the sweep mark a card the
-- roster no longer returns, without a hard delete — efs_card_mutations cascades from efs_cards, and
-- the history of a card that once existed is exactly what an auditor asks for later.

alter table efs_cards add column if not exists absent_since timestamptz;

comment on column efs_cards.absent_since is
  'Set by the mirror sweep when a card the roster previously returned stops appearing (removed in the '
  'WEX portal). Null = present in the last successful roster pass. Never hard-deleted: the mutation '
  'ledger cascades from this row and the card''s history must survive its removal.';
