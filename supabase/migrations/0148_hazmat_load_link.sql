-- 0148 — link a hazmat record to the dispatch load it describes (hazmat consolidation, H-C1).
--
-- THE PROBLEM THIS ENDS. `loads` (0085) and `hazmat_loads` (0092) are two parallel load entities with
-- nothing between them. `loads.hazmat` is a boolean nobody can act on, and the hazmat workspace lives
-- on its own route over its own list, so the same shipment exists twice with no way to say the two
-- rows are the same shipment. That is the structural reason hazmat grew a navigation section of its
-- own rather than becoming a property of a load — and a sellable module is not a navigation section.
--
-- One nullable column, and the direction is deliberate: the hazmat record points at the dispatch
-- load, not the reverse. A hazmat record can exist before dispatch has a load for it (the driver
-- captures a BOL at the shipper), and `loads` must not grow a column that only one module can fill.
--
-- SAME-TENANT IS ENFORCED, NOT ASSUMED. The foreign key is composite — (load_id, org_id) against
-- loads(id, org_id) — so a bug in a service-role code path cannot link one carrier's hazmat record to
-- another carrier's load. A plain FK on load_id alone would have permitted exactly that, silently,
-- and RLS would not have caught it because the service role bypasses RLS.
--
-- ONE CURRENT HAZMAT RECORD PER LOAD, and `link_hazmat_load` is what makes that survivable. The
-- partial unique index says a dispatch load is claimed by at most one hazmat record; but a cleared
-- hazmat load is immutable and a correction is a NEW row citing `supersedes_load_id`, so a naive
-- unique index would make every correction unlinkable. The function moves the link forward along the
-- supersede chain — and refuses to move it from anywhere else, which is what stops an unrelated
-- record from quietly stealing a load's hazmat history.

-- ── the composite FK target ───────────────────────────────────────────────────────────────────────
-- Redundant as a uniqueness claim (id is already the primary key) and required as an FK target: a
-- composite foreign key needs a unique constraint over exactly its referenced columns.
do $$ begin
  alter table public.loads add constraint loads_id_org_key unique (id, org_id);
exception when duplicate_table or duplicate_object then null;
end $$;

alter table public.hazmat_loads add column if not exists load_id uuid;

do $$ begin
  alter table public.hazmat_loads
    add constraint hazmat_loads_dispatch_load_fk
    foreign key (load_id, org_id) references public.loads(id, org_id)
    -- Column-scoped SET NULL: org_id is NOT NULL, so an unqualified SET NULL would fail on delete.
    -- Deleting a dispatch load must never delete the hazmat record — that record is evidence, and
    -- §172.201(e) retention outlives whatever dispatch does with its own row.
    on delete set null (load_id);
exception when duplicate_object then null;
end $$;

create unique index if not exists idx_hazmat_loads_dispatch_load
  on public.hazmat_loads (load_id) where load_id is not null;

comment on column public.hazmat_loads.load_id is
  'The dispatch load this hazmat record describes (H-C1). At most one CURRENT hazmat record per load;
   a correction supersedes the prior record and the link moves forward with it via link_hazmat_load().';

-- ── link ──────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.link_hazmat_load(p_org uuid, p_hazmat_load uuid, p_load uuid)
returns table (linked uuid, unlinked uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holder uuid;
begin
  -- Existence is checked per side so the caller learns WHICH one is wrong. Both are org-scoped: a
  -- cross-tenant id must be indistinguishable from one that does not exist.
  if not exists (select 1 from public.hazmat_loads h where h.id = p_hazmat_load and h.org_id = p_org) then
    raise exception 'Hazmat record not found' using errcode = 'HZ001';
  end if;
  if not exists (select 1 from public.loads l where l.id = p_load and l.org_id = p_org) then
    raise exception 'Load not found' using errcode = 'HZ002';
  end if;

  -- FOR UPDATE: two dispatchers linking the same load at once must serialise here rather than race
  -- into the unique index and surface as an opaque constraint violation.
  select h.id into v_holder
    from public.hazmat_loads h
   where h.org_id = p_org and h.load_id = p_load
   for update;

  if v_holder is not null and v_holder <> p_hazmat_load then
    -- Only a record THIS one supersedes may hand the link over. Without this, any hazmat record
    -- could claim any load and silently detach the history the office is relying on.
    if not exists (
      with recursive chain as (
        select h.id, h.supersedes_load_id
          from public.hazmat_loads h
         where h.id = p_hazmat_load and h.org_id = p_org
        union all
        select prior.id, prior.supersedes_load_id
          from public.hazmat_loads prior
          join chain c on prior.id = c.supersedes_load_id
         where prior.org_id = p_org
      )
      select 1 from chain where chain.id = v_holder
    ) then
      raise exception 'That load is already linked to a different hazmat record' using errcode = 'HZ003';
    end if;
    update public.hazmat_loads set load_id = null where id = v_holder and org_id = p_org;
  end if;

  update public.hazmat_loads set load_id = p_load
   where id = p_hazmat_load and org_id = p_org;

  -- Keep the boolean dispatch already reads in step with the fact. This is what makes "just mark
  -- hazmat on the load" true rather than aspirational: the Loads column and the hazmat record can no
  -- longer disagree. Deliberately one-way — unlinking does NOT clear it, because dispatch may have
  -- marked a load hazmat for its own reasons and this function does not get to overrule that.
  update public.loads set hazmat = true
   where id = p_load and org_id = p_org and hazmat is distinct from true;

  return query select p_hazmat_load, (case when v_holder = p_hazmat_load then null else v_holder end);
end;
$$;

comment on function public.link_hazmat_load(uuid, uuid, uuid) is
  'Point a dispatch load at its CURRENT hazmat record (H-C1). Moves the link forward along the
   supersede chain; refuses to take it from an unrelated record (HZ003).';

-- Service-role only, like every other RPC in this schema: the API server-derives the org from the
-- caller''s JWT and passes it in. No client ever calls this with an org id of its choosing.
revoke all on function public.link_hazmat_load(uuid, uuid, uuid) from public;
grant execute on function public.link_hazmat_load(uuid, uuid, uuid) to service_role;
