-- 0583 — what the carrier's phone provider says about a lead's number (ADS-LEAD-INTAKE-PLAN.md LQ8a; audit
-- F-LA3; Q-AD62 ruled 2026-11-09: every lead with a phone, once per number, flag never filter). The reader
-- — `recruiting/leads/phoneLookup.ts`, Telnyx Number Lookup — is the NEXT merge (LQ8b).
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- A lead's phone is checked by SHAPE only (`normalisePhone`: ten US digits). Meta's form verifies the number
-- by SMS (LQ1); Indeed Apply and Tenstreet do not, and a typed-in lead never is. Nothing knows whether a
-- number is a mobile, a landline or a VoIP line, or who carries it, before a recruiter dials — and "wrong
-- number" is one of the two lead-quality measures (LQ3). Every CRM lead-quality product does this lookup
-- first; the carrier already runs on Telnyx for SMS, whose Number Lookup returns line type and carrier.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- One row per (org, E.164 number) — the record is the NUMBER's, as the do-not-contact hold is
-- (`sms_suppressions`): the same person re-submitting on another channel is matched by phone already
-- (`recruiting_lead_matches`), so a second lookup would buy nothing and cost a cent. `recruiting_leads` gets no
-- column; the queue joins by `phone_e164`. The row is REPLACED by a later lookup (an UPDATE, never a partial
-- upsert — lint:upserts), because a number's line type can change when it is ported; `looked_up_at` says
-- when, and the reader re-looks after `PHONE_LOOKUP_STALE_DAYS`.
--   line_type   what Telnyx's `carrier.type` says, folded to four words (`mobile` | `landline` | `voip` |
--               `unknown`); Telnyx's own word is kept in `raw` ("fixed line", "toll free", …)
--   carrier     `carrier.normalized_carrier`, else `carrier.name`
--   valid       Telnyx's `valid_number`; false = the number cannot ring anywhere
--   raw         Telnyx's `data` object whole (D-PSP2: the raw beside the projection), no name/address — the
--               lookup asks `type=carrier` only, never `caller-name` or `caller-identity`
--
-- ── RETENTION ──────────────────────────────────────────────────────────────────────────────────
-- 400 days from `looked_up_at` (`RETENTION_RULES`, dataRetentionPolicy.ts — the lifecycle gate holds the two
-- together): a lookup older than a year says little about a number, and the lead it served is itself prunable
-- (D-LS7). Pruning a row re-looks the number if it turns up again, nothing more.
--
-- cross-module-waiver: none — recruiting's table, written by recruiting's reader.
--
-- ⚠ DEPLOY WINDOW: a new table nothing reads or writes. Old code meets the new schema unchanged.

create table if not exists public.phone_lookups (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  phone_e164    text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  provider      text not null check (provider in ('telnyx', 'simulator')),
  line_type     text not null check (line_type in ('mobile', 'landline', 'voip', 'unknown')),
  carrier       text check (carrier is null or length(btrim(carrier)) between 1 and 120),
  valid         boolean,
  raw           jsonb not null default '{}'::jsonb check (jsonb_typeof(raw) = 'object'),
  looked_up_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (org_id, phone_e164)
);
alter table public.phone_lookups enable row level security;
create index if not exists ix_phone_lookups_age on public.phone_lookups (org_id, looked_up_at);

comment on table public.phone_lookups is
  'LQ8a (0583): the phone provider''s reading of a lead''s number — line type (mobile/landline/voip/unknown), carrier, validity — one row per (org, E.164), replaced when re-looked, pruned at 400 days. A flag for the queue and the quality alert, never a filter (Q-AD62).';
