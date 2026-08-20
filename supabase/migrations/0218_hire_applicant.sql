-- 0218 — hiring an applicant, as one transaction (HIRING-PLAN.md H8, D-HIRE2).
--
-- Recruitment PRODUCES the evidence DQF files. On hire two things must become true together: the
-- person stops being an applicant and starts being a driver, and the §391.23(a)(2) inquiry state
-- that `driver_employment_history` carries as three mutable columns becomes dated, append-only
-- §391.51(b) evidence.
--
-- WHY A FUNCTION AND NOT TWO API CALLS. Those two halves cannot be allowed to disagree. A status
-- flip that lands without its records leaves a driver whose file is missing evidence the carrier
-- demonstrably holds — the exact gap a §391.51 audit is looking for — and records that land without
-- the flip attach hiring evidence to somebody the system still calls an applicant. PostgREST gives
-- one statement one transaction, so the only place "both or neither" can be expressed is here.
--
-- WHAT THIS FUNCTION DELIBERATELY DOES NOT DECIDE. The rules — which employer produces which record,
-- what a documented non-response is worth (§391.23(d)), and the refusal to invent a date for an
-- inquiry marked sent with no `inquiry_sent_on` — all live in `packages/shared/src/hireHandoff.ts`
-- and are unit-tested there. This takes the drafts as jsonb and applies them. Restating the rules in
-- SQL would give the product two versions of §391.23 that drift, which is the trap 0174's header
-- describes from the other direction.
--
-- SERVICE ROLE ONLY, on the 0174/0178/0183 convention: the function takes a tenant id and acts on
-- it, so it must never be reachable from a browser session where `p_org` would be the caller's to
-- choose. The API is the only caller and it enforces `canWriteDriverLifecycle` before getting here —
-- the same rule 0213's trigger enforces on the PostgREST path, and the reason hiring is not a
-- recruiter's act even though the applicant is.

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

  update public.drivers
     set status = 'active',
         hire_date = p_hire_date,
         updated_at = now()
   where id = p_driver and org_id = p_org;

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

comment on function public.hire_applicant(uuid, uuid, date, uuid, jsonb) is
  'H8: applicant -> active plus the §391.23(a)(2) evidence the recruitment file implies, in one transaction. Refuses a driver who is not an applicant (HA010). Record rules live in packages/shared/src/hireHandoff.ts; this applies them.';
