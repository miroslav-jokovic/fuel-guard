-- LEARNED per-truck TRUE fill capacity, in gallons — a robust high percentile (p95) of the vehicle's own
-- recent single-fill billed gallons (see learnObservedMaxFill). For a dual/saddle-tank tractor that has one
-- fuel-level sensor and regularly fills BOTH tanks, this converges to the true COMBINED capacity, which an
-- entered single-tank nameplate understates. The capacity / over-fuel checks reconcile against
-- effectiveCapacityGal = max(tank_capacity_gal, observed_max_fill_gal), so this value can only RAISE the
-- effective capacity above an under-entered nameplate, never lower it — killing false "exceeds tank capacity"
-- / "cumulative overfuel" alerts on legitimate both-tank fills. Null until ≥12 fills accumulate (cold-start:
-- the checks fall back to the entered capacity, i.e. current behaviour).
alter table vehicles add column if not exists observed_max_fill_gal numeric(6,1);

comment on column vehicles.observed_max_fill_gal is
  'Learned p95 of recent single-fill gallons ≈ true (combined, for dual-tank) capacity. Raises effective capacity above an under-entered nameplate; never lowers it. Null until enough history.';
