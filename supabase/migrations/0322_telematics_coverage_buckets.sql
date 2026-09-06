-- 0322: the all-time telematics coverage figure is counted where the rows are (SAM-S5 D-SAM7, Q-SAM8).
--
-- ── WHAT WAS BLOCKED, AND WHY IT WAS NOT THE THING EVERYBODY THOUGHT ────────────────────────────
-- S5's fourth bullet gives the Dashboard coverage tile an ALL-TIME denominator beside its windowed
-- one. It has been blocked since 2026-09-05, first on a permission (Q-SAM7) and then — once the
-- permission was answered and removed — on something the permission had been hiding: cost.
--
-- `readTelematicsCoverage` pages `fuel_transactions` 1,000 rows at a time in a SEQUENTIAL loop and
-- hands the rows to `computeTelematicsCoverage`. Measured in production 2026-09-05: **16 round trips
-- over 15,948 rows**, growing by roughly one more every two weeks at this fleet's ~65 fills a day.
-- Its own header says what that is for — *"a settings diagnostic that a person opens occasionally —
-- not from a hot path"* — and the Dashboard is the landing page for every authenticated member. A
-- figure that costs sixteen round trips cannot go there, whoever is allowed to see it.
--
-- ── WHAT THIS RETURNS, AND WHAT IT REFUSES TO KNOW (D-AG1, and 0289 said it first) ──────────────
-- **THIS COUNTS. IT DOES NOT DERIVE.** Q-SAM7 rejected its own candidate (c) — recomputing coverage
-- in the browser — because S4 spent real effort getting the three-state predicate right (*attempted*
-- is the STAMP, not the status, and 124 production rows disagree) and a second implementation of it
-- is a second source of truth with a delay fuse. Expressing that predicate HERE instead would be the
-- same mistake moved server-side, so this function does not express it.
--
-- It returns a HISTOGRAM of raw column states:
--
--     month | samsara_recon_at is not null | samsara_recon_status | fills
--
-- No bucket is named. Nothing is called pending, reconciled or no-data; nothing is dropped for being
-- unplaceable; no percentage is computed. Every one of those is a judgement and every one stays in
-- `coverageFromBuckets` in `@silvicom/shared`, which the row-based `computeTelematicsCoverage` also
-- runs — so there is exactly one place a column state becomes a verdict, and
-- `agrees with itself whether it counted the rows or was handed the counts` fails if that stops
-- being true.
--
-- The result is bounded by construction: months × 2 × the handful of distinct statuses. Production
-- holds eight months and three statuses, so this is under fifty rows in one round trip against
-- 15,950 fills.
--
-- ── THE POPULATION IS EXACTLY THE ONE THE PAGING READ USED ──────────────────────────────────────
-- `vehicle_id is not null`, and nothing else. A fill with no truck was never a candidate for per-fill
-- telematics — there is nothing to fetch history FOR — so counting it as uncovered would report a
-- fleet-mapping problem as a collection problem, and no amount of collecting would ever move the
-- number. That is `readTelematicsCoverage`'s own argument and its own filter, copied deliberately.
--
-- ⚠ It does NOT filter `is_canonical`, because the paging read does not either, and a step whose
-- purpose is "the same number, cheaper" may not quietly change the number. Measured today the two
-- populations are identical — 15,950 fills with a vehicle, 0 of them non-canonical — so this is a
-- statement about which function owns that decision, not about a difference. If duplicate fills
-- should be excluded, that is a change to what the figure MEANS and belongs to a step that says so.
--
-- ── D-FC1: CALLABLE BY A BROWSER ────────────────────────────────────────────────────────────────
-- The Dashboard reads Supabase directly under RLS and calls no API for this at all, which is what
-- made Q-SAM7 a question in the first place — adding an API route would introduce a gate where the
-- page has none. An RLS-scoped RPC dissolves that: `security invoker` so the caller's own policies
-- apply, and `p_org` LAST with a DEFAULT so PostgREST can resolve the call the browser makes, which
-- omits it (`lint:rpc-org-default`; three functions shipped dead on exactly this in 0258 and every
-- test passed, because only a browser omits the argument). The org filter is written out anyway —
-- the same belt-and-braces the service-role rule demands everywhere else, and it costs nothing.

create or replace function telematics_coverage_buckets(p_org uuid default null)
returns table (
  month     text,
  attempted boolean,
  status    text,
  fills     int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    -- UTC, matching `monthKey` in shared. NOT the station-local business date: this measures a
    -- COLLECTOR, and what it collected against is the instant Samsara serves history for, not the
    -- day a carrier books. Null when the fill has no instant — the cell is still returned, and the
    -- judge decides it cannot be reported.
    to_char(t.fueled_at at time zone 'utc', 'YYYY-MM'),
    t.samsara_recon_at is not null,
    t.samsara_recon_status,
    count(*)::int
    from fuel_transactions t
   where t.org_id = coalesce(p_org, auth_org_id())
     and t.vehicle_id is not null
   group by 1, 2, 3
$$;

comment on function telematics_coverage_buckets is
  'SAM-S5 D-SAM7 / Q-SAM8 — the all-time telematics coverage figure as a histogram of RAW column '
  'states, in one round trip instead of sixteen pages. Deliberately names no bucket and computes no '
  'percentage: the three-state predicate is judgement (D-AG1) and lives once, in '
  'coverageFromBuckets in @silvicom/shared.';
