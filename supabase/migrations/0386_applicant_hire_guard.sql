-- 0386 — an applicant becomes an active driver only through the hire (APPLICATION-FLOW-V2-PLAN Q-AW21,
-- ruled by the owner 2026-09-29: "add the trigger", as its own migration after M2).
--
-- ── WHAT WAS OPEN ──────────────────────────────────────────────────────────────────────────────
-- A-9 (the 2026-09-25 audit): nothing in the DATABASE stops `drivers.status` going from 'applicant'
-- to 'active'. The hire's checks — every federal gate and the handbook — are `hireBlockers` over the
-- checklist, in TypeScript (`hireApplicant.ts`), and the api's other doors now refuse the move
-- (the roster PATCH answers 409 `use_hire` since C0c). But:
--   · 0213's `guard_driver_lifecycle` checks only the caller's JWT role, and lets admin, fleet_manager
--     and safety_manager set any status — through PostgREST as well as the api;
--   · the service role bypasses it entirely, so any future api writer, script or sweep that sets
--     `status = 'active'` on an applicant hires them with nothing checked.
--
-- ── WHAT THIS ENFORCES, AND WHAT IT DELIBERATELY DOES NOT RESTATE ──────────────────────────────
-- The trigger does NOT re-derive the hire's requirements in SQL. They live in the shared checklist
-- (`hiringChecklist.ts`, `hireBlockers`), and a second copy here would drift from it — the copy
-- CLAUDE.md calls a workaround with a delay fuse, and the trap 0218's header already refused for the
-- §391.23 rules. What it enforces instead is the DOOR: `applicant → active` happens only inside
-- `hire_applicant` (0218), which the api calls only after `hireBlockers` came back empty. So every
-- hire passes the one statement of the rules, and nothing can go around it.
--
-- ── THE FLAG (the `purging_applicant` pattern, 0380) ────────────────────────────────────────────
-- `hire_applicant` sets `fuelguard.hiring_applicant` to the DRIVER'S ID, transaction-local, for its
-- one UPDATE, and clears it after. The exemption is for that one driver in that one transaction, not a
-- switch. `hiring_applicant(uuid)` is the one reading of it. `set_config` is not reachable through
-- PostgREST (pg_catalog is not an exposed schema), and `hire_applicant` is service_role only.
--
-- ── SCOPE: applicant → active, and nothing else ────────────────────────────────────────────────
-- Q-AW21 asked about the hire. Other moves out of 'applicant' are left as they are, on purpose:
-- an applicant can be terminated or made inactive by a lifecycle role (restricted-records pins
-- "fleet_manager may still terminate" an applicant), and McLeod's retirement sweep writes only its
-- retirement statuses, never 'active'. Whether those should also be refused is a separate question
-- nobody has asked. Moves INTO 'applicant', and inserts, are untouched — a row created 'active' is a
-- roster driver who never was an applicant.
--
-- Measured before writing (production `pg_proc`, 2026-09-29): the only function that sets
-- `drivers.status` is `hire_applicant`; `submit_driver_application` and `merge_driver` update
-- `drivers` without touching `status`. No api writer sets an applicant 'active' (the Samsara sync
-- deactivates `status = 'active'` rows only; member removal sets 'inactive').
--
-- cross-module-waiver: `hire_applicant` is re-created with 0218's body — roster's status flip and
-- evidence's §391.23 records in ONE transaction, which is 0218's whole reason to exist (its header: "both
-- or neither"). This migration adds two set_config lines to it and moves no write between modules.
--
-- ⚠ DEPLOY WINDOW: this refuses a move no deployed code makes outside `hire_applicant`, and
-- `hire_applicant` is replaced in the same transaction, so either side of the merge is served safely.

-- ── 1. The one reading of the flag ─────────────────────────────────────────────────────────────
create or replace function public.hiring_applicant(p_driver uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('fuelguard.hiring_applicant', true) = p_driver::text, false);
$$;

comment on function public.hiring_applicant(uuid) is
  'Q-AW21 (0386): true only inside hire_applicant, for the driver it is hiring. The one reading of fuelguard.hiring_applicant.';

-- ── 2. The guard ──────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_applicant_hire()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'applicant' and new.status = 'active' and not public.hiring_applicant(old.id) then
    raise exception 'applicant_hired_outside_hire: driver % becomes active only through hire_applicant', old.id
      using errcode = 'HA011',
            hint = 'Use Hire, which checks what the hire needs (hireApplicant.ts).';
  end if;
  return new;
end;
$$;

comment on function public.guard_applicant_hire() is
  'Q-AW21 (0386): refuses drivers.status applicant -> active outside hire_applicant (HA011), for every writer including the service role. The hire''s requirements are hireBlockers in TypeScript; this guards the door, it does not restate them.';

drop trigger if exists trg_guard_applicant_hire on public.drivers;
create trigger trg_guard_applicant_hire
  before update of status on public.drivers
  for each row
  execute function public.guard_applicant_hire();

-- ── 3. hire_applicant opens the door for its own driver, and closes it ─────────────────────────
-- 0218's body, unchanged except for the two set_config lines around its UPDATE.
create or replace function public.hire_applicant(
  p_org       uuid,
  p_driver    uuid,
  p_hire_date date,
  p_actor     uuid,
  p_records   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_filed  int;
begin
  -- FOR UPDATE, because "is this person still an applicant" has to still be true when we act on it.
  -- Two operators pressing Hire at the same moment is not exotic — it is what happens when a hiring
  -- decision is announced — and without the lock both pass the check and both file the evidence.
  select status into v_status
    from public.drivers
   where id = p_driver and org_id = p_org
   for update;

  if v_status is null then
    raise exception 'hire_applicant: driver % not found in org %', p_driver, p_org;
  end if;

  -- Not an error condition to be smoothed over: hiring somebody already hired would re-stamp their
  -- hire date, which moves the §391.21(b)(10) window their whole employment history is judged
  -- against and restarts the §391.51(c) retention clock.
  if v_status <> 'applicant' then
    raise exception 'hire_applicant_not_applicant: driver % has status %', p_driver, v_status
      using errcode = 'HA010';
  end if;

  -- Q-AW21 (0386): the one door `trg_guard_applicant_hire` opens, for this driver only.
  perform set_config('fuelguard.hiring_applicant', p_driver::text, true);
  update public.drivers
     set status = 'active',
         hire_date = p_hire_date,
         updated_at = now()
   where id = p_driver and org_id = p_org;
  perform set_config('fuelguard.hiring_applicant', '', true);

  -- The `not exists` guard makes a re-run a no-op rather than a second copy of one screening. The
  -- API also plans against the records already on file; this is the half that survives a retry after
  -- a dropped response, where the API's read happened before the first attempt's write.
  insert into public.qualification_records
    (org_id, driver_id, kind, occurred_on, result, performed_by, reference, detail, created_by)
  select p_org, p_driver, r.kind, r.occurred_on, r.result, r.performed_by, r.reference,
         coalesce(r.detail, '{}'::jsonb), p_actor
    from jsonb_to_recordset(coalesce(p_records, '[]'::jsonb)) as r(
           kind         text,
           occurred_on  date,
           result       text,
           performed_by text,
           reference    text,
           detail       jsonb
         )
   where r.detail ->> 'employment_id' is not null
     and not exists (
           select 1
             from public.qualification_records q
            where q.org_id = p_org
              and q.driver_id = p_driver
              and q.kind = r.kind
              and q.detail ->> 'employment_id' = r.detail ->> 'employment_id'
         );
  get diagnostics v_filed = row_count;

  return jsonb_build_object('status', 'active', 'hire_date', p_hire_date, 'filed', v_filed);
end;
$$;

revoke all on function public.hire_applicant(uuid, uuid, date, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.hire_applicant(uuid, uuid, date, uuid, jsonb) to service_role;
