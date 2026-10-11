-- 0409: what an idling engine burns, measured per truck and temperature band (IE4, D-IE5)
--
-- D-IE5 prices an idle hour at a PRIOR (0.72 gal/h: our Samsara events measured 0.705–0.743, inside
-- Argonne's 0.64–1.0) until the fleet's own engines have said otherwise: a rate learned per
-- equipment cohort × temperature band, taken once a cell holds at least 50 running hours, shown
-- beside the prior and the configured rate until the owner accepts the switch. IE2a found the
-- engine's own total-fuel counter on every truck (`fuelConsumedMilliliters`, equal to Samsara's
-- per-event idle fuel to the millilitre on three of four events), and the collector already books
-- its delta over each park to `idle_engine_stops.fuel_ml`. A parked truck burns fuel only by
-- running, so a park's gallons over its running hours IS its idle burn rate — no Samsara idling
-- events are read.
--
-- ── A MEASUREMENT, NO VERDICT ─────────────────────────────────────────────────────────────────────
-- Per truck and band: parks, running seconds, millilitres. The band edges are a PARAMETER with no
-- default, so the one definition of the bands stays in `packages/shared` (`IDLE_BURN_BAND_EDGES_F`)
-- and cannot drift here; which cohort a truck is in (its DECLARED equipment, IE1) and whether a
-- cell has enough hours to be believed are TypeScript's (`sql-returns-measurement-ts-owns-verdict`).
-- Per truck, not per cohort, for the same reason: the declaration rule is `declaredEquipment`, and
-- a SQL copy of it would be a second one.
--
-- Bands by `width_bucket` over ascending edges: 0 below the first, i between edges i and i+1
-- (lower edge inclusive), n at or above the last. A park with no ambient reading is band NULL —
-- counted, never guessed into a band. A park without a fuel delta (no counter reading brackets
-- it) or without running seconds says nothing about a burn rate and is left out, both halves
-- together, so a ratio of the sums never pairs one park's gallons with another's hours.
--
-- Aggregated because PostgREST caps a response at 1,000 rows and 60 days of parks is ~20,000;
-- this returns at most trucks × (bands + 1). Service role only, org-filtered by its own parameter
-- (the API bypasses RLS).
--
-- ── MEASURED BEFORE WRITING (production, read-only, 2026-10-02 ~19:50Z, 447 ie2-v1 parks) ──────────
-- Gallons per running hour by declared equipment × band, the same sums this returns:
--   battery APU  50–75 °F 0.799 (16.8 h) · 75–90 °F 0.767 (22.9 h) · 90 °F+ 0.830 (11.1 h)
--   no APU       50–75 °F 0.774 (56.9 h) · 75–90 °F 0.796 (81.9 h) · 90 °F+ 0.746 (46.2 h)
-- Two cells already pass 50 h after a day and a half. 46 parks have no ambient reading and hold
-- 0.5 running hours between them. The configured `idle_settings.idle_gal_per_hour` is 0.80.
--
-- Ships ALONE (a function and its first reader go in two merges, `deploy-window-nine-minutes`):
-- the learner, its route and the Idling page's side-by-side follow in the next merge.
--
-- Rollback: drop function public.idle_engine_burn_inputs(uuid, timestamptz, timestamptz, integer[]);

create function public.idle_engine_burn_inputs(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_band_edges_milli_c integer[]
)
returns table (vehicle_id uuid, band integer, parks integer, running_sec bigint, fuel_ml bigint)
language sql
stable
set search_path = ''
as $$
  select s.vehicle_id,
         case when s.ambient_milli_c is null then null
              else width_bucket(s.ambient_milli_c, p_band_edges_milli_c) end,
         count(*)::int,
         sum(s.running_sec)::bigint,
         sum(s.fuel_ml)::bigint
    from public.idle_engine_stops s
   where s.org_id = p_org
     and s.started_at >= p_from
     and s.started_at < p_to
     and s.fuel_ml is not null
     and s.running_sec > 0
   group by 1, 2
   order by 1, 2 nulls last
$$;

comment on function public.idle_engine_burn_inputs(uuid, timestamptz, timestamptz, integer[]) is
  'IE4, D-IE5: per truck and ambient band, parks, running seconds and engine-counter millilitres over
   parks that have both. A measurement — the bands, the cohorts and the 50-hour bar live in packages/shared.';

revoke all on function public.idle_engine_burn_inputs(uuid, timestamptz, timestamptz, integer[])
  from public, anon, authenticated;
grant execute on function public.idle_engine_burn_inputs(uuid, timestamptz, timestamptz, integer[])
  to service_role;
