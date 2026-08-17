-- FuelGuard — 0200 cache the account's prompt vocabulary (execution plan Step 9.1)
--
-- ── What this replaces ──────────────────────────────────────────────────────────────────────────
-- `EFS_EDITABLE_INFO_IDS` is a list this codebase chose: two ids, DRID and UNIT. `getPromptTypes`
-- is the list the ACCOUNT owns — 40 on production and 41 on QA, captured live on 2026-08-16. Every
-- id between the two was configurable in the WEX portal and unreachable through this product.
--
-- Step 9.1 resolves the editable set at runtime instead, from the intersection of what the account
-- offers with the guide's own Info IDs table (p168-169), less the ids we deny. These two columns are
-- where the account's half of that intersection lives between reads.
--
-- ── Why a cache rather than a call on the write path ────────────────────────────────────────────
-- `getPromptTypes` is a vendor SOAP call, and this vendor's rate limiter is keyed on IP rather than
-- on the account it protects (Step 5.6) — fifteen paced calls in sequence already trips it, which is
-- how `getPolicyRefreshingLimits` came back `rate_limited` twice on production (`docs/25` Q6).
-- Putting a vendor call in front of every prompt edit would spend that budget on a vocabulary that
-- changes roughly never, and would make a rate-limited account an account whose prompts cannot be
-- edited at all. The write path reads THIS table; only the account-inventory walk fills it.
--
-- ── Why it lives on efs_card_control_settings ───────────────────────────────────────────────────
-- Because that table is already the org-keyed record of what we have OBSERVED about this account's
-- card control — `probe_result`, `probed_at`, `probed_identity_hash`, `probed_document_shape`. A
-- vocabulary read from the vendor is the same kind of fact, and a second org-keyed table holding one
-- array would be a join for nothing.
--
-- ── There is deliberately NO staleness rule ─────────────────────────────────────────────────────
-- No TTL, and nothing expires a row back to null. A cache that narrowed the editable set from 24 to
-- the 2-id fallback because a timer elapsed would take working controls away from an operator with
-- no event behind it and no way to tell why. `prompt_types_at` is therefore evidence for a human and
-- for the inventory walk, not an input to the resolver: staleness is SHOWN, never enforced.
--
-- Both columns are additive and nullable. A null `prompt_types` is the honest state for every org
-- until its first inventory walk, and the resolver's documented fallback is exactly that case.

alter table efs_card_control_settings
  add column if not exists prompt_types    text[],
  add column if not exists prompt_types_at timestamptz;

-- An account that answered `getPromptTypes` with nothing is not the same fact as an account we never
-- asked, but it is not a fact worth storing either: the resolver treats both as "fall back", and an
-- empty array here would only invite a reader to believe the account genuinely offers no prompts.
-- Null or non-empty, never `'{}'` — and `cardinality`, not `array_length`, because `array_length` on
-- an empty array is NULL, `NULL >= 1` is NULL, and a CHECK only rejects on FALSE. That exact mistake
-- has already shipped once in this schema, in 0173's non-empty scopes constraint (`docs/22` H15).
alter table efs_card_control_settings
  drop constraint if exists efs_card_control_settings_prompt_types_non_empty;
alter table efs_card_control_settings
  add constraint efs_card_control_settings_prompt_types_non_empty
  check (prompt_types is null or cardinality(prompt_types) >= 1);

-- The timestamp and the value travel together or the timestamp is a lie about a value that is not
-- there. Enforced rather than trusted to the one writer, because the next writer is the one that
-- will get it wrong.
alter table efs_card_control_settings
  drop constraint if exists efs_card_control_settings_prompt_types_dated;
alter table efs_card_control_settings
  add constraint efs_card_control_settings_prompt_types_dated
  check ((prompt_types is null) = (prompt_types_at is null));

comment on column efs_card_control_settings.prompt_types is
  'Info IDs this EFS account offers, exactly as getPromptTypes returned them — the account''s whole vocabulary, not the subset this product may edit. The editable set is resolveEditableInfoIds() applied to this: intersected with the guide''s Info IDs table and less the denied ids. Null means the account has never been walked, and the resolver falls back to DRID/UNIT.';
comment on column efs_card_control_settings.prompt_types_at is
  'When prompt_types was last read from the vendor. Evidence of staleness for a human and for the inventory walk; deliberately NOT an expiry — nothing narrows the editable set on a timer.';
