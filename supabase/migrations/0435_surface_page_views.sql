-- 0435 — a daily page-view count per screen and role (product readiness X1, ruled Q-PR4 2026-10-06).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
-- "Is this page used?" has no answer today for any page that only reads. Fuel Costs, IFTA, the Fleet
-- report, the Dashboard and Idling write no row when somebody looks at them, and the API's
-- `[metrics]` line keeps only the busiest routes (Railway returned nothing for it on 2026-10-06). The
-- product readiness programme (docs/plans/product-readiness/FEATURE-INVENTORY.md §1.2, §5 X1) cannot
-- rule keep / simplify / hide for a read-only page without it.
--
-- ── SHAPE, AND WHAT IS LEFT OUT ON PURPOSE ───────────────────────────────────────────────────────
-- One row per (org, day, screen, role) holding a count. NO user id and NO path or query string, as
-- the ruling says: the question is "is this screen read, and by which kind of user", never "what did
-- this person look at". A query string can carry a driver's name or a card number; a role cannot.
--   • `surface_key` is a key from SURFACES (packages/shared/src/surfaceCatalogue.ts). The API checks
--     it against that catalogue before calling here; the CHECK below only bounds the shape, so free
--     text cannot land even if a caller skips the API.
--   • `role` is the caller's role as the API's auth middleware read it. Not a CHECK list of roles:
--     USER_ROLES lives in packages/shared, and a second list here would be a copy (CLAUDE.md §No
--     workarounds). The API is the only writer.
--   • `day` is the org's calendar day (`todayInZone`, packages/shared/src/calendarDay.ts), computed
--     by the API, because "used on Monday" means the office's Monday, not UTC's.
--
-- ── WRITES ───────────────────────────────────────────────────────────────────────────────────────
-- `record_surface_views` adds a batch in one statement: the browser sends the screens it opened since
-- its last send, and repeats in a batch are counted, not deduplicated. `on conflict … views + n` is
-- an increment, not a partial upsert of a row's other columns (every column is in the key or is the
-- count), so lint:upserts' NOT NULL trap cannot apply. Service role only.
--
-- ── DEPLOY WINDOW ────────────────────────────────────────────────────────────────────────────────
-- New table and a new function, nothing else changes. The writer (API route + router hook) ships in a
-- SEPARATE later merge, so no code ever calls a function staging has not applied yet.
--
-- Rollback: drop the function, then the table. Nothing else reads either.

create table if not exists public.surface_page_views (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  day         date not null,
  surface_key text not null check (surface_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  role        text not null check (role ~ '^[a-z_]{1,32}$'),
  views       integer not null default 0 check (views >= 0),
  primary key (org_id, day, surface_key, role)
);

alter table public.surface_page_views enable row level security;
-- No policies: service role only. Counts are read by the owner through SQL until a screen needs them.

comment on table public.surface_page_views is
  'module=org; layer=core; daily page-view count per (org, day, surface_key, role). No user id, no path, no query string (product readiness X1, Q-PR4, 0435).';

create or replace function public.record_surface_views(
  p_org  uuid,
  p_day  date,
  p_role text,
  p_keys text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into public.surface_page_views as v (org_id, day, surface_key, role, views)
  select p_org, p_day, k.key, p_role, count(*)::int
    from unnest(coalesce(p_keys, '{}'::text[])) as k(key)
   group by k.key
  on conflict (org_id, day, surface_key, role)
  do update set views = v.views + excluded.views;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.record_surface_views(uuid, date, text, text[]) from public, anon, authenticated;
grant execute on function public.record_surface_views(uuid, date, text, text[]) to service_role;
comment on function public.record_surface_views(uuid, date, text, text[]) is
  'Adds one view per element of p_keys to (p_org, p_day, key, p_role); repeats count. Returns the number of (key) rows touched (0435, X1).';
