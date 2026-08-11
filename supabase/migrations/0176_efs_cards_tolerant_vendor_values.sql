-- 0175 — the EFS card mirror stops asserting it knows every value EFS can send.
--
-- WHAT HAPPENED. 0171 wrote the guide's documented value lists into CHECK constraints: five statuses,
-- three hand-enter modes, three config sources, policy numbers 1–99, override uses 0–9. The read
-- schema in packages/shared/src/cardControlContract.ts asserted the same lists with z.enum. Then
-- production returned a card whose `status` was outside the five, and `getCardv2` failed outright —
-- not the field, the whole document, and with it the whole card page. The error did not even name the
-- value it had rejected.
--
-- WHY THE GUIDE IS NOT A CONTRACT. It types these fields `string (8)` and `int` and then names some
-- example values (p35–38). It never says the lists are closed, WEX ships changes without notice, and
-- the fleets we mirror are configured in the WEX portal by people who are not us. Every one of these
-- values is something we DISPLAY. None of them is something the product decides.
--
-- THE RULE THIS ENCODES: reads are tolerant, writes are strict. Nothing here loosens what FuelGuard is
-- willing to SET — EFS_WRITABLE_STATUSES is still three values, an override is still 1–9, and
-- policyNumberSchema still refuses anything outside 1–99 when WE choose the number. Those checks live
-- on the write path, where being wrong means sending a bad request. Here, being "wrong" means a card
-- that exists cannot be shown, which is strictly worse than showing a status we have no label for —
-- and the UI already renders an unrecognised status verbatim (cardControlModel.cardStatusLabel).
--
-- WHAT IS DELIBERATELY KEPT. `card_last4`'s regex stays: we derive that value ourselves, so a
-- malformed one is our bug, not vendor news. `status not null` stays, because a mirror row with no
-- status is meaningless. The replacement checks below bound LENGTH rather than enumerate values —
-- integrity without a closed world.
--
-- NUMBERING. Takes the next free number after 0174_idle_session_evidence_writes. The Phase B ledger
-- and write counters, which the plan sketched as 0172/0174, will land later — nothing depends on
-- those numbers, and 0174 is already spoken for.

-- Drop by lookup rather than by name. 0171 declared these inline and unnamed, so their names are
-- PostgreSQL's own (`efs_cards_status_check` and friends). Deriving them here instead of hardcoding
-- means this migration still works if any of them was ever recreated with an explicit name.
do $$
declare
  target_columns constant text[] := array[
    'status', 'policy_number', 'hand_enter',
    'info_source', 'limit_source', 'location_source', 'time_source',
    'override_uses'
  ];
  con record;
begin
  for con in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where t.relname = 'efs_cards'
       and n.nspname = 'public'
       and c.contype = 'c'
       and exists (
         select 1
           from unnest(c.conkey) as k(attnum)
           join pg_attribute a
             on a.attrelid = c.conrelid and a.attnum = k.attnum
          where a.attname = any (target_columns)
       )
  loop
    execute format('alter table public.efs_cards drop constraint %I', con.conname);
  end loop;
end
$$;

-- Bound the shape, not the vocabulary. EFS types each of these `string (8)` (p35–38); 32 leaves room
-- for a value longer than documented while still refusing a response body pasted into a column.
alter table efs_cards
  add constraint efs_cards_status_shape_check
  check (status <> '' and length(status) <= 32);

alter table efs_cards
  add constraint efs_cards_hand_enter_shape_check
  check (hand_enter is null or (hand_enter <> '' and length(hand_enter) <= 32));

alter table efs_cards
  add constraint efs_cards_sources_shape_check
  check (
    (info_source     is null or length(info_source)     <= 32) and
    (limit_source    is null or length(limit_source)    <= 32) and
    (location_source is null or length(location_source) <= 32) and
    (time_source     is null or length(time_source)     <= 32)
  );

-- Still non-negative: a negative policy number or override count is not a WEX configuration we have
-- no label for, it is corrupt data, and the mirror should refuse it.
alter table efs_cards
  add constraint efs_cards_policy_number_range_check
  check (policy_number is null or policy_number >= 0);

alter table efs_cards
  add constraint efs_cards_override_uses_range_check
  check (override_uses is null or override_uses >= 0);

comment on column efs_cards.status is
  'Card status EXACTLY as EFS reports it. Active/Inactive/Hold/Deleted are documented and Fraud comes '
  'from the getCardSummariesV2 U search code, but the set is NOT closed — see migration 0175. Display '
  'verbatim; never branch on it without a default.';
comment on column efs_cards.policy_number is
  'Documented 1-99, stored as reported. Validate the range where we CHOOSE a policy number, not here.';
comment on column efs_cards.override_uses is
  'Documented 0-9, stored as reported. The 1-9 bound applies to overrides we GRANT (grantOverrideSchema).';
