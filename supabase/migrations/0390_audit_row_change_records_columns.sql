-- 0390: an audited UPDATE records WHICH columns changed (DATA-LIFECYCLE-PLAN.md §8, 2026-09-30, Q1 (b))
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHAT WAS MEASURED, 2026-09-30, production
--
-- `audit_row_change()` (0009, then 0352) inserts `org_id, actor_id, action, entity, entity_id` and never
-- `meta`, so every `vehicle.update` and `driver.update` it has ever written reads `meta = '{}'` — all
-- 5,059,909 of the pre-0352 rows, and every row since. Such a row says that SOMETHING on truck 754
-- changed at 14:02. It cannot say whether that was the VIN, the plate or the annual-inspection date,
-- which is the question anyone opening the Audit log is asking. That emptiness is also why Q1 was
-- re-ruled (b): 5 M rows that answer nothing are not evidence worth 1.2 GB.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- COLUMN NAMES, NOT VALUES — and why that is the whole of this migration
--
-- The obvious completion is `{"vin": {"from": …, "to": …}}`, and it is deliberately NOT built here.
-- The values on these two tables sit behind other permissions: `drivers` carries date_of_birth, the home
-- address, phone, email, cdl_number, pay_rate and emergency contacts (the roster section);
-- `vehicles` carries purchase_cost, insurance_policy and title_number. `audit_logs` has no per-column
-- permission — whoever holds the Audit log screen reads every row's `meta` — so copying a value here
-- would hand a driver's date of birth to anyone the admin gave the Audit log. That is a second copy
-- of the data outside the permission that guards the first, which is the workaround shape CLAUDE.md
-- rules out. Values need a per-column classification the repo does not have; that is recorded as an
-- open question in the plan (Q10), not invented here as a hand-kept list.
--
-- A column NAME exposes nothing the schema does not already publish, and it answers "what changed".
--
-- Shape: `meta = {"changed": ["plate", "vin"]}`, sorted, never including a column in the trigger's
-- ignore list (so never `updated_at`, which `set_updated_at()` bumps on every UPDATE). INSERT and
-- DELETE are unchanged and keep `{}`: the whole row is the change.
--
-- Everything else in 0352 is kept byte-for-byte in behaviour: the ignore lists, "fire only if a
-- non-ignored column changed", the one-argument 0009 mode, the actor from the JWT. The triggers are
-- not recreated — their arguments are unchanged — so this is one `create or replace`.
--
-- Rollback: re-run 0352's `create or replace function` (its body is the one without `v_changed`).

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_org     uuid;
  v_id      uuid;
  v_actor   uuid;
  v_ignored text[];
  v_changed text[];
  v_meta    jsonb := '{}'::jsonb;
begin
  -- tg_argv[1] is optional: a trigger created with one argument audits every column, which keeps the
  -- 0009 behaviour for any future table that wants it and makes the filter opt-in per trigger.
  v_ignored := case
                 when tg_nargs > 1 then string_to_array(tg_argv[1], ',')
                 else array[]::text[]
               end;

  if (tg_op = 'UPDATE') then
    -- One pass over both rows as jsonb (0352's comparison), kept this time rather than only tested
    -- for existence. A column added to the table later is compared, and recorded, by default.
    select coalesce(array_agg(n.key order by n.key), array[]::text[])
      into v_changed
      from jsonb_each(to_jsonb(new)) as n(key, value)
      join jsonb_each(to_jsonb(old)) as o(key, value) on o.key = n.key
     where n.value is distinct from o.value
       and not (n.key = any (v_ignored));

    -- Fire only if at least one NON-ignored column actually changed (0352).
    if (array_length(v_ignored, 1) is not null and cardinality(v_changed) = 0) then
      return new;
    end if;

    v_meta := jsonb_build_object('changed', to_jsonb(v_changed));
  end if;

  if (tg_op = 'DELETE') then
    v_org := old.org_id; v_id := old.id;
  else
    v_org := new.org_id; v_id := new.id;
  end if;
  v_actor := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (v_org, v_actor, tg_argv[0] || '.' || lower(tg_op), tg_table_name, v_id, v_meta);

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$function$;
