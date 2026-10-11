-- 0402 — 0399's make/model rule becomes a function the trigger AND the fleet-parity check call
-- (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md FL2, D-FL1, D-FL2).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- FL2 compares McLeod's tractor list with our rows after every roster sweep, and make/model must be
-- compared on the DERIVED values (owner, 2026-10-01): McLeod types `FRHT` / `CA`, we store
-- `Freightliner` / `Cascadia`, and those agree. To derive McLeod's spelling the API needs 0399's rule,
-- and 0399 wrote it inside a trigger body where nothing else can reach it. Restating it in TypeScript
-- would be a second copy of the rule beside the catalogue — the copy-with-a-delay-fuse this repo
-- forbids. So the rule moves, unchanged, into `vehicle_make_model_for`, and the trigger calls it.
--
-- ── WHAT DOES NOT CHANGE ────────────────────────────────────────────────────────────────────────
-- The trigger's behaviour, byte for byte: the reported values are recorded exactly as before, then
-- derived by the same four steps (VIN body → VIN manufacturer → reported spelling → the report kept).
-- `vehicle-make-model-derived.test.mjs` (0399's matrix) runs every migration, this one included, and
-- is the proof; it is unedited. Nothing is backfilled — every stored value already IS this function's
-- output.
--
-- ── THE BATCH FORM ──────────────────────────────────────────────────────────────────────────────
-- `vehicle_make_model_derive(p_rows)` takes the sweep's tractors as one JSON array and returns one
-- derived pair per `key`, so a ~250-truck comparison is one round trip, not 250. It returns a
-- MEASUREMENT; the parity check in TypeScript decides what a difference means.
--
-- ── A DEFECT IN 0399 THIS FIXES: AN OFFICE EDIT WAS NEVER DERIVED ──────────────────────────────
-- 0399's trigger ran as whoever wrote the row. The catalogue is deny-all to clients (RLS on, no
-- policies), so for an office user editing a truck through the browser — role `authenticated` — every
-- catalogue lookup returned nothing and the row kept exactly what was typed: `LT-625` stayed `LT-625`,
-- and a VIN edit derived nothing. 0399's matrix could not see it: PGlite runs every statement as the
-- superuser, and setting JWT claims does not change the role. The trigger function is now
-- `security definer` (owner reads the catalogue past RLS) with an empty search_path, and this
-- migration's matrix edits a truck AS `authenticated` to prove it.
--
-- Not org-scoped: the catalogue is global (NO_ORG_COLUMN) and the function reads nothing else, so
-- there is no p_org to default. Callable by the service role only — the catalogue is deny-all to
-- clients (0399) and a browser has no reason to ask.
--
-- Rollback: re-create 0399's `derive_vehicle_make_model()` body, then drop both functions.

create function public.vehicle_make_model_for(p_vin text, p_make text, p_model text,
                                              out make text, out model text)
language plpgsql stable
set search_path = ''
as $$
declare
  vin_key text := public.vehicle_catalog_key(p_vin);
  c public.vehicle_make_model_catalog;
begin
  select * into c from public.vehicle_make_model_catalog
   where match_on = 'vin_body' and match_key = left(vin_key, 8) and length(vin_key) >= 8;
  if found then
    make := c.make;
    model := c.model;
    return;
  end if;

  make := coalesce(
    (select k.make from public.vehicle_make_model_catalog k
      where k.match_on = 'vin_wmi' and k.match_key = left(vin_key, 3)),
    (select k.make from public.vehicle_make_model_catalog k
      where k.match_on = 'make_spelling' and k.match_key = public.vehicle_catalog_key(p_make)),
    nullif(btrim(p_make), ''));
  model := coalesce(
    (select k.model from public.vehicle_make_model_catalog k
      where k.match_on = 'model_spelling' and k.match_key = public.vehicle_catalog_key(p_model)),
    nullif(btrim(p_model), ''));
end
$$;

comment on function public.vehicle_make_model_for(text, text, text) is
  'D-FL1: the derived make/model for a VIN and a reported make/model — the one rule, read by the
   vehicles trigger (0399) and by the fleet-parity check (FL2). Global catalogue, no org.';

create or replace function public.derive_vehicle_make_model() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A write that changed make or model REPORTED a value; a write that left it alone did not, and the
  -- stored report stands. (An UPDATE that sets the column to what is already stored — the office form
  -- re-saving `Freightliner` — is not a new report either.)
  if tg_op = 'INSERT' or new.make is distinct from old.make then
    new.make_reported := new.make;
  end if;
  if tg_op = 'INSERT' or new.model is distinct from old.model then
    new.model_reported := new.model;
  end if;

  select d.make, d.model into new.make, new.model
    from public.vehicle_make_model_for(new.vin, new.make_reported, new.model_reported) d;
  return new;
end
$$;

create function public.vehicle_make_model_derive(p_rows jsonb)
returns table (key text, make text, model text)
language sql stable
set search_path = ''
as $$
  select r ->> 'key', d.make, d.model
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r,
         lateral public.vehicle_make_model_for(r ->> 'vin', r ->> 'make', r ->> 'model') d
$$;

comment on function public.vehicle_make_model_derive(jsonb) is
  'FL2: vehicle_make_model_for over a JSON array of {key, vin, make, model}; one row per key. A
   measurement — the parity check decides what a difference means. Service role only.';

revoke all on function public.vehicle_make_model_for(text, text, text) from public, anon, authenticated;
revoke all on function public.vehicle_make_model_derive(jsonb) from public, anon, authenticated;
grant execute on function public.vehicle_make_model_for(text, text, text) to service_role;
grant execute on function public.vehicle_make_model_derive(jsonb) to service_role;
