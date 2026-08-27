-- merge_driver stops forcing cross-module migrations (D-SEP5,
-- docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md P2.5).
--
-- The function has been re-issued EIGHT times (0110, 0155, 0203, 0234, 0235, 0236, 0238, 0239)
-- — once for every module that added a driver FK — and 0239's own header records that its first
-- draft silently reverted four of those amendments by copying the wrong body. The recurring
-- part is entirely mechanical: `update <table> set <col> = canonical where <col> = source`.
-- The semantic part — refusals, identity-link coalescing, temporal certification supersede,
-- per-week dedup, the 0235 hard-delete guard — has been stable since 0239.
--
-- v2 splits them: the mechanical reassignment list arrives AS A PARAMETER (p_simple_moves,
-- computed by modules/roster/mergeDriver.ts from its DRIVER_REASSIGNMENTS list), the semantic
-- body stays here. A new table with a driver FK now needs one TypeScript list entry — no
-- migration, no re-issue — and `check-driver-references.mjs` fails the build when a migration
-- adds a drivers(id) FK that no list accounts for, closing the cascade trap 0234 and 0236
-- could only warn about in comments.
--
-- Atomicity is why this stays SQL at all: one rpc() call is one transaction; ~25 sequential
-- supabase-js updates from TypeScript would leave a half-merged driver on any mid-flight
-- failure. Injection safety: every table/column name in p_simple_moves is validated against
-- information_schema before any dynamic SQL runs — an unknown name aborts the whole merge.
--
-- v1 (merge_driver) remains defined — applied migrations are never edited — but has no callers
-- after this ships; its comment below marks it superseded.
--
-- cross-module-waiver: the function touches every driver-referencing module by design — that
-- is the recurring cost v2 exists to END; the moves live in roster's TypeScript from here on.

create or replace function public.merge_driver_v2(
  p_org uuid,
  p_source uuid,
  p_canonical uuid,
  p_simple_moves jsonb
)
returns void
language plpgsql
as $$
declare
  v_efs text;
  v_phone text;
  v_emp text;
  v_mcleod text;
  v_mcleod_co text;
  mv jsonb;
  v_table text;
  v_column text;
  v_org_scoped boolean;
begin
  if p_source is null or p_canonical is null or p_source = p_canonical then
    return;
  end if;
  if not exists (select 1 from public.drivers where id = p_source and org_id = p_org)
     or not exists (select 1 from public.drivers where id = p_canonical and org_id = p_org) then
    raise exception 'merge_driver: source % or canonical % not found in org %', p_source, p_canonical, p_org;
  end if;

  -- ── validate the move list BEFORE any write — an unknown name aborts the whole merge ─────────
  for mv in select * from jsonb_array_elements(coalesce(p_simple_moves, '[]'::jsonb)) loop
    v_table := mv->>'table';
    v_column := mv->>'column';
    if v_table is null or v_column is null
       or not exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = v_table and column_name = v_column
       ) then
      raise exception 'merge_driver_v2: move % is not a known public column', mv
        using errcode = 'MD020';
    end if;
  end loop;

  -- ── REFUSE RATHER THAN DESTROY (0234/0238 semantics, unchanged) ──────────────────────────────
  if exists (select 1 from public.driver_applications where driver_id = p_source and org_id = p_org)
     or exists (select 1 from public.esign_consents where driver_id = p_source and org_id = p_org)
     or exists (select 1 from public.sms_consents where driver_id = p_source and org_id = p_org)
  then
    raise exception
      'merge_driver: driver % has signed evidence that cannot be moved (a certified application, an e-sign consent or an SMS consent). Archive the duplicate instead of merging it.',
      p_source
      using errcode = 'MD010';
  end if;

  -- ── identity links: clear-then-claim so the partial unique indexes cannot abort (0203/0239) ──
  select efs_driver_id, phone, employee_id, mcleod_driver_id, mcleod_company_id
    into v_efs, v_phone, v_emp, v_mcleod, v_mcleod_co
    from public.drivers where id = p_source;
  update public.drivers set efs_driver_id = null, mcleod_driver_id = null where id = p_source;
  update public.drivers
     set efs_driver_id = coalesce(efs_driver_id, v_efs),
         phone = coalesce(phone, v_phone),
         employee_id = coalesce(employee_id, v_emp),
         mcleod_driver_id = coalesce(mcleod_driver_id, v_mcleod),
         mcleod_company_id = coalesce(mcleod_company_id, v_mcleod_co)
   where id = p_canonical and org_id = p_org;

  -- ── the mechanical moves, from the caller's validated list ───────────────────────────────────
  for mv in select * from jsonb_array_elements(coalesce(p_simple_moves, '[]'::jsonb)) loop
    v_table := mv->>'table';
    v_column := mv->>'column';
    v_org_scoped := coalesce((mv->>'org_scoped')::boolean, false);
    if v_org_scoped then
      execute format(
        'update public.%I set %I = $1 where %I = $2 and org_id = $3',
        v_table, v_column, v_column
      ) using p_canonical, p_source, p_org;
    else
      execute format(
        'update public.%I set %I = $1 where %I = $2',
        v_table, v_column, v_column
      ) using p_canonical, p_source;
    end if;
  end loop;

  -- ── per-week stores: keep the canonical's row on collision (0110 semantics) ──────────────────
  delete from public.driver_scores s
   where s.driver_id = p_source
     and exists (select 1 from public.driver_scores c
                  where c.driver_id = p_canonical and c.org_id = s.org_id and c.week_start = s.week_start);
  update public.driver_scores set driver_id = p_canonical where driver_id = p_source;

  delete from public.driver_performance_weeks s
   where s.driver_id = p_source
     and exists (select 1 from public.driver_performance_weeks c
                  where c.driver_id = p_canonical and c.org_id = s.org_id and c.week_start = s.week_start);
  update public.driver_performance_weeks set driver_id = p_canonical where driver_id = p_source;

  -- ── temporal certifications: supersede on collision, then move (0203 semantics) ──────────────
  update public.certifications s
     set superseded_by = c.id,
         superseded_at = coalesce(s.superseded_at, now()),
         updated_at = now()
    from public.certifications c
   where s.org_id = p_org
     and s.subject_type = 'driver'
     and s.subject_id = p_source
     and s.superseded_by is null
     and c.org_id = p_org
     and c.subject_type = 'driver'
     and c.subject_id = p_canonical
     and c.superseded_by is null
     and c.kind = s.kind
     and coalesce(c.qualifier, '') = coalesce(s.qualifier, '');
  update public.certifications
     set subject_id = p_canonical,
         updated_at = now()
   where org_id = p_org and subject_type = 'driver' and subject_id = p_source;

  -- ── filed scans follow the driver (0203) — polymorphic subject, not a driver FK ──────────────
  update public.documents
     set subject_id = p_canonical
   where org_id = p_org and subject_type = 'driver' and subject_id = p_source;

  -- ── duty sessions: never two open shifts (semantics unchanged) ──────────────────────────────
  delete from public.driver_duty_sessions s
   where s.driver_id = p_source and s.ended_at is null
     and exists (select 1 from public.driver_duty_sessions c
                  where c.driver_id = p_canonical and c.ended_at is null);
  update public.driver_duty_sessions set driver_id = p_canonical where driver_id = p_source;

  -- ── per-driver feature overrides: canonical's override wins on collision ────────────────────
  -- PK (org_id, driver_id, feature_key), on delete cascade — before v2 a merge silently DELETED
  -- the source driver's overrides. Found by check-driver-references.mjs on its first run.
  delete from public.driver_app_feature_overrides s
   where s.driver_id = p_source and s.org_id = p_org
     and exists (select 1 from public.driver_app_feature_overrides c
                  where c.org_id = s.org_id and c.driver_id = p_canonical and c.feature_key = s.feature_key);
  update public.driver_app_feature_overrides set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;

  -- ── the one delete the 0235 guard lets through (semantics unchanged) ────────────────────────
  perform set_config('fuelguard.merging_driver', 'on', true);
  delete from public.drivers where id = p_source and org_id = p_org;
  perform set_config('fuelguard.merging_driver', 'off', true);
end;
$$;

comment on function public.merge_driver_v2(uuid, uuid, uuid, jsonb) is
  'Atomically folds a duplicate driver into the canonical driver (D-SEP5, 0264). The mechanical '
  'reassignment list arrives as p_simple_moves from modules/roster/mergeDriver.ts — a new driver FK '
  'is one TypeScript entry, not a function re-issue; check-driver-references.mjs enforces the pairing. '
  'Semantic body (MD010 refusals, link coalescing, certification supersede, per-week dedup, the 0235 '
  'guard) carried unchanged from the 0239 issue of merge_driver.';

comment on function public.merge_driver(uuid, uuid, uuid) is
  'SUPERSEDED by merge_driver_v2 (0264, D-SEP5) — no callers since modules/roster/mergeDriver.ts '
  'took over; kept because applied migrations are never edited. Do not amend this body again.';
