-- 0171 — the EFS card mirror: vendor truth about every card, as EFS reports it.
--
-- WHAT THIS IS FOR. FuelGuard has never known what a fuel card is actually configured to do. It
-- infers: `fuel_cards` rows are produced by learnCardAssignments (five attributed fills and a 70%
-- single-vehicle majority) and `fuel_cards.status` is free text unrelated to anything EFS says. That
-- is enough to attribute a transaction after the fact and not enough to answer "is this card locked?"
-- This table holds what `getCardv2` returns, so the question has an answer.
--
-- WHY A NEW TABLE AND NOT COLUMNS ON fuel_cards. Three reasons, any one sufficient:
--   1. `fuel_cards.card_ref` is a cardIdentityKey — the full PAN when we have one, otherwise
--      "<last4>|<controlId>". The second form cannot be used to call getCardv2, so a mirror keyed on
--      it could not refresh half its own rows.
--   2. A card can exist in EFS and have no `fuel_cards` row at all, because it has never transacted.
--      Those are exactly the cards an operator most wants to see — issued, active, unused.
--   3. `fuel_cards` is written by the attribution learner on a 60-day sweep. Putting vendor state in
--      the same row means the learner and the mirror can silently overwrite each other.
-- The link is a nullable FK, and the mirror NEVER writes back to fuel_cards.
--
-- WHY THE CARD NUMBER IS SEALED AND ALSO HMAC'd. We need the PAN itself: getCardv2 and setCardV2 both
-- take it, and asking an operator to retype a card number per action is not a product. So it is
-- AES-256-GCM sealed by lib/secretBox.ts, AAD-bound to (org_id, 'efs_card_pan') so a ciphertext
-- lifted into another tenant's row will not open. But a sealed value cannot be indexed, and the sweep
-- has to upsert 400 cards without decrypting all of them — hence a SECOND representation:
-- HMAC-SHA256 over org_id || ':' || pan with a subkey derived from SECRETS_ENCRYPTION_KEY. Keyed, so
-- it is not brute-forceable the way a bare SHA-256 would be (a card number with a known BIN and known
-- last four is a few million guesses); org-bound, so the same card in two tenants does not correlate;
-- deterministic, so it can carry the unique index. Neither column is ever selected into a response.
--
-- WHY RLS IS ON WITH NO POLICIES. Same posture as 0091 (efs_soap_credentials) and 0106 (client
-- certs): deny-all for client roles, service-role only. The row carries the sealed PAN and the whole
-- card document; a SELECT policy would hand both to every authenticated member of the org. The web
-- app reads this through /api/fuel-cards, which is the sanctioned transport for anything
-- secret-bearing and the only place capabilities and masking are applied.

create table if not exists efs_cards (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  -- Best-effort link to the attribution row. NULLABLE and `on delete set null`: a card can exist in
  -- EFS before it ever transacts, and deleting an attribution row must not delete vendor truth.
  fuel_card_id              uuid references fuel_cards(id) on delete set null,

  card_last4                text not null check (card_last4 ~ '^[0-9]{4}$'),
  -- HMAC-SHA256(HKDF(SECRETS_ENCRYPTION_KEY,'efs-card-ref'), org_id || ':' || pan). See header.
  card_ref_hmac             text not null,
  -- The PAN, AES-256-GCM sealed with AAD (org_id,'efs_card_pan'). Never in an API response.
  card_number_sealed        text not null,

  -- ── Header fields, verbatim from getCardv2 (guide p38-40) ─────────────────────────────────────
  -- 'Fraud' is NOT in the getCard status enum; it appears only as the `U` search code in
  -- getCardSummaries (p44). A card can genuinely be in it, so it is accepted here and never written.
  status                    text not null
                              check (status in ('Active','Inactive','Hold','Deleted','Fraud')),
  original_status           text,
  payroll_status            text,
  payroll_use               text,
  policy_number             int check (policy_number is null or policy_number between 1 and 99),
  company_xref              text,
  hand_enter                text check (hand_enter is null or hand_enter in ('ALLOW','DISALLOW','POLICY')),
  -- Whether prompts / limits / locations / time restrictions come from the card, the policy or both.
  -- getCardv2 returns CARD-level records only even under BOTH (p36), so these decide whether the
  -- detail page has to call getPolicy to show the operator what the pump will really enforce.
  info_source               text check (info_source is null or info_source in ('POLICY','CARD','BOTH')),
  limit_source              text check (limit_source is null or limit_source in ('POLICY','CARD','BOTH')),
  location_source           text check (location_source is null or location_source in ('POLICY','CARD','BOTH')),
  time_source               text check (time_source is null or time_source in ('POLICY','CARD','BOTH')),
  -- `override` is typed boolean(1) in the guide but the Overrides appendix (p194) puts a 1-9 count of
  -- REMAINING USES in it. Stored as the count, because "true" throws away the number that matters.
  override_uses             int check (override_uses is null or override_uses between 0 and 9),
  override_all_locations    boolean,
  -- Likewise typed boolean(1) but carrying a 6-digit EFS location id when a single-location override
  -- is active. A bare 0/1 means "no single-location override" and is stored as null, not as an id.
  location_override_id      text,

  -- ── Denormalised for search. Derived from the infos array; not a second source of truth. ───────
  driver_id_prompt          text,   -- DRID matchValue
  unit_prompt               text,   -- UNIT matchValue
  driver_name               text,
  last_used_date            timestamptz,
  last_transaction          text,

  -- The typed view (wsCardSchema) — prompts, limits, location groups, blocked locations, time
  -- restrictions. Renders the detail page without a vendor round trip. NOT the source for a write:
  -- every mutation re-reads getCardv2 first, because a document from ten minutes ago echoed back is
  -- a document that undoes whatever changed in the WEX portal since (setCardV2 is a full-document
  -- write, p137).
  document                  jsonb not null,
  -- Optimistic-concurrency token over the mutable configuration, excluding volatile fields
  -- (lastUsedDate changes on every fill). EFS offers no ETag, no lastModified and no row version, so
  -- this is the only defence against two people editing one card. See lib/efsCardXml.ts::cardVersion.
  card_version              text not null,
  -- Forensic only, PAN-REDACTED, for a human reading an incident report. The echo is NEVER built from
  -- this — that is what resolves "keep the raw bytes" against "never store a card number".
  last_response_xml_redacted text,

  synced_at                 timestamptz not null default now(),
  sync_error                text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  unique (org_id, card_ref_hmac)
);

-- The list page's default sort and its status filter.
create index if not exists idx_efs_cards_org_status on efs_cards (org_id, status);
-- The staleness banner and the sweep's "what have I not refreshed lately" query.
create index if not exists idx_efs_cards_org_synced on efs_cards (org_id, synced_at);
create index if not exists idx_efs_cards_org_last4  on efs_cards (org_id, card_last4);
-- Partial: most rows link, but the ones that do not are the interesting ones and stay out of the index.
create index if not exists idx_efs_cards_fuel_card  on efs_cards (fuel_card_id)
  where fuel_card_id is not null;
-- Finding a card by the driver or unit an operator actually knows.
create index if not exists idx_efs_cards_org_driver on efs_cards (org_id, driver_id_prompt)
  where driver_id_prompt is not null;
create index if not exists idx_efs_cards_org_unit   on efs_cards (org_id, unit_prompt)
  where unit_prompt is not null;

alter table efs_cards enable row level security;
-- NO POLICIES. Deny-all for client roles; service role only. See the header for why.

drop trigger if exists trg_efs_cards_updated on efs_cards;
create trigger trg_efs_cards_updated before update on efs_cards
  for each row execute function set_updated_at();
