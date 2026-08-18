-- FuelGuard — 0202 cache the account's LIMIT vocabulary (execution plan Step 10.3)
--
-- The sibling of 0200, one phase later and for the same reason: Step 9.1 found the browser offering
-- 2 prompt ids while the API accepted 24, because nothing carried the account's vocabulary to it.
-- Phase 10.3's product picker is the same shape — build it first and it gets fed from
-- `EFS_LIMIT_LABELS`, which is our transcription of the guide's table, not this account's set.
--
-- ── ⚠ getProductGroups, NOT getProducts ─────────────────────────────────────────────────────────
-- Both handoffs name `getProducts`. The guide settles it against them, on the getProductGroups
-- output: "groupId — string (4) — The product group ID. See Limit IDs for valid values." No such
-- cross-reference exists on `getProducts.code`, which is documented as "The product code ID" and
-- whose records each carry the `group` they roll up to instead.
--
-- Measured against this account on 2026-08-17: ten ids in the guide's own Limit IDs table — DSL,
-- GAS, JET, DSLM, DEFC, GASM, GASP, RFRM, AMDS, EVCH — appear in `getProductGroups` and in NO
-- product record. **DSL is the one that matters**: WEX's Overrides guide says a diesel override
-- needs both DSL and ULSD because truck stops ring up different product codes, so a picker fed from
-- products would have declined half the network on every diesel exception it wrote.
--
-- ── Why jsonb and not text[] ────────────────────────────────────────────────────────────────────
-- 0200 stores bare codes because `getPromptTypes` returns bare codes. `getProductGroups` returns
-- `description` and `isFuel` alongside each id, and both are load-bearing: the description is the
-- wording the operator already sees in the WEX portal, and `isFuel` is what decides gallons versus
-- dollars (p36) — a rule this codebase currently answers from a hardcoded set that has APRO and
-- HYDR wrong on this very account. Storing the ids alone would throw away the two fields that make
-- the vocabulary usable and force a second vendor call to get them back.
--
-- ── No staleness rule, deliberately, exactly as in 0200 ─────────────────────────────────────────
-- Nothing expires this back to null. A cache that narrowed an operator's product list because a
-- timer elapsed would take working controls away with no event behind it and no way to tell why.
-- `product_groups_at` is evidence for a human, never an input to the resolver.

alter table efs_card_control_settings
  add column if not exists product_groups    jsonb,
  add column if not exists product_groups_at timestamptz;

-- Null or a non-empty ARRAY, never `'[]'` and never a bare object. An account that answered with
-- nothing is not a fact worth storing: the resolver treats it and "never asked" identically, and an
-- empty array here would only invite a reader to believe this account genuinely has no products.
--
-- `jsonb_typeof` is checked as well as the length, because `jsonb_array_length` ERRORS rather than
-- returning null on a non-array, which would turn a malformed write into a 500 instead of a refusal.
alter table efs_card_control_settings
  drop constraint if exists efs_card_control_settings_product_groups_non_empty;
alter table efs_card_control_settings
  add constraint efs_card_control_settings_product_groups_non_empty
  check (
    product_groups is null
    or (jsonb_typeof(product_groups) = 'array' and jsonb_array_length(product_groups) >= 1)
  );

-- The timestamp and the value travel together or the timestamp is a lie about a value that is not
-- there. Enforced rather than trusted to the one writer, because the next writer is the one that
-- will get it wrong. Same constraint as 0200's, for the same reason.
alter table efs_card_control_settings
  drop constraint if exists efs_card_control_settings_product_groups_dated;
alter table efs_card_control_settings
  add constraint efs_card_control_settings_product_groups_dated
  check ((product_groups is null) = (product_groups_at is null));

comment on column efs_card_control_settings.product_groups is
  'Product groups this EFS account offers, exactly as getProductGroups returned them: [{groupId, description, isFuel}]. This is the LIMIT vocabulary — the guide points groupId at its Limit IDs table, while getProducts.code is a finer-grained catalogue that does not contain DSL, GAS or JET at all. Null means the account has never been walked, and resolveLimitVocabulary falls back to the guide''s transcribed table.';
comment on column efs_card_control_settings.product_groups_at is
  'When product_groups was last read from the vendor. Evidence of staleness for a human and for the inventory walk; deliberately NOT an expiry — nothing narrows the product list on a timer.';
