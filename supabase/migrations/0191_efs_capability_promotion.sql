-- FuelGuard — 0191 EFS capability proofs and promotions (execution plan Step 4.1)
--
-- A capability is code that can change a real fuel card at a real vendor. Today the only thing
-- standing between "it compiles" and "it writes to production" is `write_entitlement`, which is one
-- flag for the whole account and says nothing about whether THIS capability has ever been observed
-- to work. These two tables are the difference between believing and having checked.
--
-- `efs_capability_proofs`   — an EVIDENCE record. What a live run observed, once, at a moment.
-- `efs_capability_promotions` — a DECISION record. Which capability a person allowed, on which org,
--                               citing which proof.
--
-- ── Why two tables and not one state column ─────────────────────────────────────────────────────
-- Evidence and permission have different lifetimes and different writers. A proof is immutable the
-- instant it is written — it is what the vendor did on a Tuesday, and rewriting it would destroy the
-- only account of the run. A promotion changes whenever a human changes it, and must be able to cite
-- which proof convinced them. Folding both into one row would mean either mutating evidence or
-- losing the citation, and the citation is the entire audit answer to "why was this allowed".
--
-- It also makes suspension cheap and instant, which is the property that matters at 2am: flipping a
-- promotion row to `suspended` refuses the next call without touching, or re-deriving, any evidence.
--
-- ── RLS: enabled, no policies, service-role only ────────────────────────────────────────────────
-- Neither table is tenant-reachable. RLS is enabled with NO policies, which is deny-all for every
-- client role; the service role bypasses RLS and is the only writer. That is the same posture as
-- `efs_soap_credentials` (0091) and for the same reason — a tenant that could read its own promotion
-- state learns which capabilities are unguarded, and a tenant that could write it promotes itself.
-- `scripts/check-rls.mjs` treats "enabled, zero policies" as a valid intentional deny-all.
--
-- ── Nothing here grants anything ────────────────────────────────────────────────────────────────
-- This migration creates the tables and backfills NOTHING. Step 4.2 introduces the gate that reads
-- them and, in the SAME migration as the gate, backfills the five capabilities that are already live
-- as `enabled`. Doing the backfill here instead would put rows in a table nothing reads yet; doing
-- the gate without the backfill would refuse every card operation in production between two merges.
-- The order is deliberate and is stated in Step 4.2.

-- ── Proofs ──────────────────────────────────────────────────────────────────────────────────────

create table if not exists efs_capability_proofs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,

  -- The FINE key from the capability registry (`override_grant`), not the coarse audit intent. A
  -- proof is a statement about one descriptor's behaviour; two capabilities sharing an intent do not
  -- share evidence. No CHECK constraint: the registry is the authority on which keys exist, and a
  -- constraint here would have to be widened by migration every time a capability is added, which is
  -- a second place to forget.
  capability_key     text not null check (length(btrim(capability_key)) between 1 and 100),

  -- ── The OEG results (docs/24 §3.2). Nullable because a run can end before reaching a gate, and a
  -- null is "not reached", which is NOT the same as false. Only 2b/3/4/5 are run here: OEG-2a is the
  -- local echo scan, which needs no write and is proven separately across the whole fleet.
  oeg1_entitled      boolean,   -- the account may call the operations at all
  oeg2b_noop_stable  boolean,   -- cardVersion unchanged after a no-op dispatch. QA ONLY — needs a write
  oeg3_change_landed boolean,   -- the change was observed on re-read, within the verify delays
  oeg4_vocabulary    boolean,   -- byte-match on every vocabularyField. The H1 lesson
  oeg5_revert_landed boolean,   -- the card was put back, proven by re-read

  -- Milliseconds from dispatch to the first re-read that saw the change. ~533ms on this account as of
  -- 2026-08-12; recorded per run so a drift in apply latency is visible rather than inferred.
  apply_latency_ms   int check (apply_latency_ms is null or apply_latency_ms >= 0),

  -- ── What the proof was taken AGAINST. A proof is only evidence for the environment that produced
  -- it, and Step 4.6 refuses promotion when the target org's shape differs from the one proved.
  endpoint_host      text,
  environment        text check (environment is null or environment in ('sandbox', 'production')),
  document_shape     text,      -- 'flat' | 'nested:header' — see documentShape() in efsCardXml.ts
  vocabulary         jsonb,     -- the raw spellings observed during the run, per vocabularyField

  -- PAN-REDACTED, capped, same contract as efs_card_mutations' wire columns. redactCardXml() runs
  -- before either is written; a card number reaching this table would be a bug.
  request_xml_redacted  text,
  response_xml_redacted text,

  -- Last four ONLY. Standing rule 13: no QA card numbers in this database or this repo.
  card_last4         text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),

  -- Why the run ended where it did. Free text, because the interesting failures are the ones nobody
  -- enumerated in advance — a void run (before-state already equalled the target) says so here.
  outcome            text not null default 'running'
                       check (outcome in ('running', 'proven', 'denied', 'void', 'error')),
  outcome_detail     text,

  run_by             uuid references auth.users(id) on delete set null,
  run_at             timestamptz not null default now(),
  completed_at       timestamptz
);

comment on table efs_capability_proofs is
  'Immutable evidence from one live capability proof run: the OEG results, the environment it was taken against, and the vendor bytes. Never rewritten — a proof is what happened, not what is currently true. Service-role only.';
comment on column efs_capability_proofs.oeg2b_noop_stable is
  'OEG-2b: cardVersion unchanged after a no-op dispatch. Obtainable on QA only, because it requires a write; a production promotion carries its absence as a named residual risk.';
comment on column efs_capability_proofs.outcome is
  'running until the harness settles it. void means the run proved nothing — most often because the before-state already equalled the target state, which would report success for a silently ignored write (the H1 failure).';

-- The promotion gate's lookup: newest green proof for one org and capability.
create index if not exists idx_efs_capability_proofs_lookup
  on efs_capability_proofs (org_id, capability_key, run_at desc);

alter table efs_capability_proofs enable row level security;

-- ── Promotions ──────────────────────────────────────────────────────────────────────────────────

create table if not exists efs_capability_promotions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  capability_key     text not null check (length(btrim(capability_key)) between 1 and 100),

  -- `proving` is a real state, not a transient: the harness sets it before it writes to a card, so a
  -- run that dies mid-flight leaves a row saying a proof was in progress rather than a row that looks
  -- untouched. `enabled` is reachable ONLY through Step 4.6's endpoint, never by the harness.
  state              text not null default 'not_promoted'
                       check (state in ('not_promoted', 'proving', 'proven', 'denied', 'enabled', 'suspended')),

  -- The proof that convinced a person. Null while unpromoted, and `on delete set null` rather than
  -- cascade: losing the evidence must never silently delete the record that something was allowed.
  proof_id           uuid references efs_capability_proofs(id) on delete set null,

  promoted_by        uuid references auth.users(id) on delete set null,
  promoted_at        timestamptz,
  -- Required whenever a human moves this row, enforced in the API's zod schema (3..500). The column
  -- is nullable because the default `not_promoted` row is written by no one.
  reason             text check (reason is null or length(btrim(reason)) between 3 and 500),
  suspended_reason   text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One row per org per capability. The gate reads it on EVERY call — no cache, because instant
-- suspension is the whole point (Step 4.2) — so this index is the hot path, not an optimisation.
create unique index if not exists uq_efs_capability_promotions_org_capability
  on efs_capability_promotions (org_id, capability_key);

comment on table efs_capability_promotions is
  'Which capability a person has allowed on which org, and the proof they cited. One row per org per capability. Read on every card write with no cache, so that suspension takes effect on the next call. Service-role only.';
comment on column efs_capability_promotions.state is
  'not_promoted is the safe default for a capability nobody has decided about. enabled is reachable only through the promotion endpoint (Step 4.6) — the proof harness may set proving, proven or denied and never enabled, so evidence can never promote itself.';

alter table efs_capability_promotions enable row level security;

-- ── What the account itself was observed to be ──────────────────────────────────────────────────
-- Step 4.6 refuses promotion when the proof's document shape does not match the TARGET org's shape,
-- which means the target's shape has to be recorded somewhere that is not a proof. These two columns
-- are that place: written by the config scan (Step 4.4) and the mirror sweep, read by the gate.
alter table efs_card_control_settings
  add column if not exists observed_document_shape text,
  add column if not exists observed_vocabulary jsonb;

comment on column efs_card_control_settings.observed_document_shape is
  'Document shape this org''s own cards are observed to return — flat or nested:header. Null means no scan has recorded one yet, which blocks promotion rather than defaulting to a guess.';
comment on column efs_card_control_settings.observed_vocabulary is
  'Raw spellings this org emits per vocabulary field, from the Step 4.4 config scan. Null means unscanned; an empty object means scanned and nothing observed, and those are different facts.';
