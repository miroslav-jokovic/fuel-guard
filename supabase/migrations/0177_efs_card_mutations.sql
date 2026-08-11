-- 0177 — the card mutation ledger: every attempt to change a fuel card, and what came of it.
--
-- WHAT THIS IS FOR. `setCardV2` is a full-document write (guide p137): anything absent from the
-- request is DELETED, and EFS accepts a well-formed request that strips a driver assignment without
-- complaint. An override is free fuel. Both of those are things somebody will ask about six months
-- from now, and neither leaves a trace in EFS that we can query. This table is the trace.
--
-- WHY A ROW IS WRITTEN BEFORE THE CALL, NOT AFTER. The row is inserted `pending` and only then is
-- anything dispatched. If the process dies mid-write — a deploy, an OOM, a Railway restart — what
-- remains is a visible `pending` row naming the card, the intent and the person, rather than silence.
-- The alternative (write the outcome when it arrives) loses exactly the cases worth investigating.
--
-- WHY `sent` IS A TERMINAL STATUS AND NOT A TRANSIENT ONE. A `setCardV2` timeout is NOT a failure:
-- the write may have landed. It is dispatched with retry disabled and reconciled by re-reading the
-- card. When even the re-read fails we know nothing, and the honest record of "we know nothing" is
-- `sent` — surfaced to operators as "Unverified" so a human goes and looks. Collapsing it into
-- `failed` would tell somebody a card is unchanged when it may not be.
--
-- WHY before_document AND after_document. `before_document` makes a revert replayable: it is the
-- card exactly as EFS reported it in the same operation that changed it. Phase C builds
-- POST /mutations/:id/revert on top; the column exists now so that costs no migration later.
-- `drift` records fields that moved which we did not touch — someone in the WEX portal, or our own
-- echo misbehaving. EFS wins, the mirror updates, and the ledger says it happened.
--
-- WHY approved_by EXISTS WITH NOTHING WRITING IT. Maker-checker is Phase C. The seam is
-- planCardMutation / applyCardMutation (services/efsCardControl.ts), which are already separate
-- functions with a re-validated `expected_version` between them. Adding the column now means that
-- change is a route and a UI, not a schema migration on a table with history in it.
--
-- NUMBERING. 0177, not the 0172 the plan sketched. The Supabase ledger identifies migrations by
-- version STRING: 0172, 0174 and 0175 are already recorded there against other migrations, and a
-- file numbered with one of them is silently skipped by `supabase db push` while
-- `applied_schema_version()` still reports "current" (docs/22-EFS-CARD-CONTROL.md, 2026-08-11 §4).
-- Verified before writing this file: the ledger's max version is 0175, so 0177 and 0178 are free.
--
-- RLS: enabled, no policies. Service-role only, same posture as 0091 / 0106 / 0171 / 0173. These rows
-- carry redacted vendor XML and the full before/after card documents; a SELECT policy would hand both
-- to every authenticated member of the org. The web app reads the history through
-- GET /api/fuel-cards/:id/history, which is where masking and capabilities are applied.

create table if not exists efs_card_mutations (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  -- The card this was aimed at. `cascade`: a mirror row is only ever deleted when the org is, and a
  -- mutation with no card is not evidence of anything.
  efs_card_id        uuid not null references efs_cards(id) on delete cascade,

  -- One value per INTENT, never a generic "update". The audit question is "who granted an override",
  -- and a generic patch row cannot answer it without diffing two documents.
  intent             text not null
                       check (intent in ('lock','unlock','override_grant','override_clear','prompts_set')),
  status             text not null default 'pending'
                       check (status in ('pending','sent','succeeded','failed','drift_detected')),

  -- Required, 3-200 chars, enforced again in the zod schema. The cheapest column in the schema and
  -- the most valuable one the next time somebody asks why a card was locked on a Tuesday night.
  reason             text not null check (length(btrim(reason)) between 3 and 200),
  requested_by       uuid references auth.users(id) on delete set null,
  -- Reserved for maker-checker (Phase C). Nothing writes it yet; see the header.
  approved_by        uuid references auth.users(id) on delete set null,
  -- True when the caller had to re-authenticate for this action (DRID removal, unlock from Fraud,
  -- a large override). Recorded because "they proved it was them" is part of the evidence.
  step_up            boolean not null default false,

  -- The concurrency token the CLIENT rendered, and the one the server actually read moments before
  -- writing. A mismatch is a 409 and no row reaches 'sent'.
  expected_version   text,
  before_version     text,
  after_version      text,
  -- The version observed by the reconciling re-read. Differs from after_version only when the
  -- re-read itself was retried or the card moved again in between.
  reconciled_version text,

  -- The typed VIEW of the card either side of the write, plus the edit list actually applied. Never
  -- the raw document: the echo is always built from a fresh getCardv2 inside the operation, so a
  -- stored document can never be mistaken for something to send.
  before_document    jsonb,
  after_document     jsonb,
  edits              jsonb,
  -- Fields that changed which no edit named. Populated only for 'drift_detected'.
  drift              jsonb,

  -- PAN-REDACTED XML, capped. Forensics for "what exactly did we send them". redactCardXml() runs
  -- before any of these is written; a card number reaching this table would be a bug, and
  -- efsCardControl.test.ts scans every recorded payload for a 12+ digit run to prove it does not.
  request_xml_redacted  text,
  response_xml_redacted text,

  efs_fault_code     text,
  efs_fault_message  text,

  -- Client-supplied Idempotency-Key. A double-submitted override is a driver getting two free tanks,
  -- so replay protection is enforced by the partial unique index below rather than by a
  -- read-then-write in the API, which is a race by construction.
  idempotency_key    text,
  -- Dispatch attempts. Expected to be 0 or 1 — a write is NEVER retried (a timed-out write may have
  -- landed). A row above 1 means something re-entered the apply path and is worth a look.
  attempts           int not null default 0 check (attempts >= 0),

  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  updated_at         timestamptz not null default now()
);

-- The card-detail history panel: newest first, one card.
create index if not exists idx_efs_card_mutations_card on efs_card_mutations (efs_card_id, created_at desc);
-- The org-wide ledger watch (§ rollout: "watch the mutation ledger for a week") AND the hourly
-- blast-radius cap, which counts an org's rows inside a one-hour window.
create index if not exists idx_efs_card_mutations_org on efs_card_mutations (org_id, created_at desc);
-- Partial: rows nobody has resolved. Tiny by design — this is the "needs a human" query, and it is
-- also how an in-flight idempotency replay is detected.
create index if not exists idx_efs_card_mutations_unresolved on efs_card_mutations (org_id, created_at desc)
  where status in ('pending','sent');
-- Replay protection. Partial so the overwhelming majority of rows (no key supplied) do not collide.
create unique index if not exists uq_efs_card_mutations_idempotency on efs_card_mutations (org_id, idempotency_key)
  where idempotency_key is not null;

alter table efs_card_mutations enable row level security;
-- NO POLICIES. Deny-all for client roles; service role only. See the header for why.

drop trigger if exists trg_efs_card_mutations_updated on efs_card_mutations;
create trigger trg_efs_card_mutations_updated before update on efs_card_mutations
  for each row execute function set_updated_at();

comment on table efs_card_mutations is
  'Every attempted change to an EFS fuel card: intent, reason, who, the before/after card documents, '
  'the redacted request/response XML and the reconciled outcome. Written pending BEFORE dispatch so a '
  'crash leaves evidence rather than silence. Service-role only (RLS deny-all).';
comment on column efs_card_mutations.status is
  'pending = written, not yet dispatched. sent = dispatched, outcome UNKNOWN (timeout, or the '
  'reconciling re-read failed) — terminal and shown as "Unverified". succeeded / failed / '
  'drift_detected = reconciled by a fresh getCardv2.';
comment on column efs_card_mutations.before_document is
  'The card as EFS reported it inside this operation. Makes a Phase C revert replayable.';
comment on column efs_card_mutations.drift is
  'Fields that moved which no edit named — the WEX portal, or our own echo. EFS wins; this records it.';
comment on column efs_card_mutations.attempts is
  'Dispatch count. Always 0 or 1: writes are never retried, because a timed-out setCardV2 may have landed.';
