-- 0241: provenance the office can rely on, on every path that writes (D-MR14)
--
-- D-MR6 hands the carrier's TMS authority over the licence, medical, plate, registration and
-- insurance fields, refreshed on EVERY sweep rather than written once when empty. That is only safe
-- because of the escape hatch it names: "editing an identity field claims the row to `manual`, after
-- which McLeod stops writing it."
--
-- The escape hatch does not work. Three separate holes, each verified against this repo and against
-- production on 2026-08-24:
--
--   1. `identity_source` DEFAULTS TO 'samsara' on all three tables. Every row a human creates in the
--      UI — `useCreateDriver`, `useCommitVehicleImport`, `useCreateTrailer` — is therefore labelled
--      as telematics-sourced. Production holds 194 vehicles and 211 trailers and every single one
--      reads 'samsara'; not one row on either table is 'manual', although both have had an edit UI
--      for a year. A sync is entitled to overwrite what it believes it wrote itself, so under D-MR6
--      a hand-built vehicle record is McLeod's to erase.
--
--   2. VEHICLES AND TRAILERS HAVE NO CLAIM PATH AT ALL. `resolveDriverUpdate` is drivers-only, and
--      there is no vehicles or trailers route in `apps/api` — `apps/web` writes both tables straight
--      through PostgREST under the `vehicles_write` / `trailers_write` policies. Nothing in that path
--      has ever set `identity_source`, and nothing could.
--
--   3. DRIVERS HAVE THE SAME HOLE ON THE PAGE MOST EDITS COME FROM. `resolveDriverUpdate` runs in
--      `PATCH /api/roster/drivers/:id`, but `DriversPage.vue` still edits through `useUpdateDriver`,
--      which writes `drivers` directly through PostgREST. 0213's own header warned about exactly this
--      path for `status`; it is just as true for `full_name` and `phone`. So the DQ1 failure that
--      rule exists to prevent — an admin corrects a misspelled name and watches it revert the next
--      morning — is still reachable today, and McLeod would make it reliable rather than occasional.
--
-- ── WHY A TRIGGER, AND WHY NOT MORE APPLICATION CODE ────────────────────────────────────────────
-- The same argument 0213 made, and it has only got stronger. The rule has to hold for every writer,
-- and the writers are not all in one place: an Express route, a Vue composable talking to PostgREST,
-- a CSV import, and a human in the SQL editor. Adding the claim to `resolveDriverUpdate` a second
-- time would fix one of four. RLS cannot express it either — a policy compares a row to a predicate,
-- never OLD to NEW, and this rule is entirely about a field CHANGING.
--
-- `auth_role() is null` is the SERVICE ROLE, and that exemption is the point rather than a loophole:
-- the service role IS every sync (Samsara, McLeod, EFS), plus `resolveDriverUpdate`, which already
-- sets `identity_source` itself and must not be second-guessed. Verified: `apps/web` makes no
-- `.rpc()` calls at all, so `merge_driver` and `hire_applicant` — both of which touch identity
-- columns — only ever run under the service role and are exempt for the same reason.

create or replace function public.claim_identity_for_office()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  col   text;
  old_j jsonb;
  new_j jsonb;
begin
  -- The service role: every sync, and the API routes that resolve provenance themselves.
  if public.auth_role() is null then
    return new;
  end if;

  -- A row a person typed is 'manual', whatever the payload claimed. Provenance is an assertion about
  -- WHERE DATA CAME FROM, so it must not be client-settable: a UI that posted
  -- identity_source = 'mcleod' would be asserting the carrier's TMS vouches for a row it has never
  -- seen. Every JWT-bearing insert into these tables is a human creating a record — the driver app
  -- writes none of them, and `vehicles_driver_insert` denies the `driver` role outright.
  if tg_op = 'INSERT' then
    new.identity_source := 'manual';
    return new;
  end if;

  -- An explicit change to identity_source is the caller's decision, not ours. This is the UN-CLAIM
  -- path and it has to stay open: handing a corrected row back to McLeod is how an org recovers from
  -- a claim it did not mean to make, and there is no other way to do it.
  if new.identity_source is distinct from old.identity_source then
    return new;
  end if;

  if old.identity_source = 'manual' then
    return new;
  end if;

  -- The claimable columns arrive as trigger arguments rather than being named here, so one function
  -- serves three tables whose owned-field lists differ and so the list stays readable as DATA at the
  -- point it is attached. `to_jsonb` rather than named comparisons for the same reason.
  old_j := to_jsonb(old);
  new_j := to_jsonb(new);
  foreach col in array tg_argv loop
    if new_j -> col is distinct from old_j -> col then
      -- Claiming the ROW, not the column. That is deliberate and it matches how drivers have always
      -- behaved: `resolveDriverUpdate` flips the whole row on a single identity edit. Claiming one
      -- column at a time would need per-column provenance, which is a much larger idea than the
      -- problem justifies, and it would leave the row half-owned by two systems.
      new.identity_source := 'manual';
      return new;
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.claim_identity_for_office() is
  'BEFORE INSERT OR UPDATE on drivers/vehicles/trailers: a write carrying a user JWT marks the row
   office-owned, so no sync overwrites it afterwards (D-MR6''s escape hatch). Service-role writes —
   every sync, and the API routes that set identity_source themselves — are exempt. The claimable
   column list is passed per table as trigger arguments.';

-- ── The column lists ─────────────────────────────────────────────────────────────────────────────
--
-- Each list is EXACTLY the set of columns the McLeod sync writes to that table
-- (`apps/api/src/tms/rosterFields.ts`), because that is precisely the set an office edit needs
-- protecting from. A column McLeod never writes does not belong here: claiming on it would freeze the
-- rest of the row's refresh for an edit that was never in danger. `samsaraVehicleSync.linkOnly` and
-- `rosterFields.claimableColumns` are checked against these lists by a unit test, so the two cannot
-- drift apart silently.
--
-- `status` is deliberately ABSENT from all three. Retiring a truck in the UI is a lifecycle act, not
-- an identity correction, and it must not be the reason McLeod stops refreshing that row's plate
-- forever. Retirement has its own path (`/api/tms/roster/*/retire`) and its own rules.

-- Drivers: DRIVER_IDENTITY_FIELDS from packages/shared/src/rosterContract.ts, so the PostgREST path
-- and `resolveDriverUpdate` reach the same verdict on the same edit. Deliberately NOT widened to the
-- licence and medical dates: D-MR6 decided those revert, and that a clerk who corrects a licence
-- here rather than in McLeod should see it reverted. Widening the list would quietly overturn a
-- decision that was made on purpose.
drop trigger if exists trg_claim_driver_identity on public.drivers;
create trigger trg_claim_driver_identity
  before insert or update on public.drivers
  for each row
  execute function public.claim_identity_for_office(
    'full_name', 'first_name', 'middle_name', 'last_name', 'phone');

drop trigger if exists trg_claim_vehicle_identity on public.vehicles;
create trigger trg_claim_vehicle_identity
  before insert or update on public.vehicles
  for each row
  execute function public.claim_identity_for_office(
    'vin', 'make', 'model', 'year', 'plate', 'plate_state',
    'registration_expires_at', 'dot_annual_inspection_expires_at');

drop trigger if exists trg_claim_trailer_identity on public.trailers;
create trigger trg_claim_trailer_identity
  before insert or update on public.trailers
  for each row
  execute function public.claim_identity_for_office(
    'vin', 'make', 'year', 'plate', 'plate_state', 'is_reefer');

-- ── The default stays 'samsara', and that is not an oversight ────────────────────────────────────
-- Changing it would be a second, weaker version of the INSERT branch above: the default only applies
-- when a caller omits the column, so it cannot distinguish a human from a sync, which is the only
-- distinction that matters. The trigger makes the default unreachable for client inserts and the
-- syncs that rely on it (samsaraVehicleSync, samsaraTrailerSync, samsaraDriverSync all insert
-- without naming the column) keep working unchanged. Backfilling the 405 existing rows is NOT done
-- here either: 'samsara' is a true statement about how almost all of them arrived, and no
-- migration can tell which of the handful that were typed by hand actually were.
