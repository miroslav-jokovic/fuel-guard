-- 0060: cache HERE turn-by-turn maneuvers alongside the route geometry so the Fuel Planning page can show
-- directions without a second HERE call. Nullable + additive: older cache rows (pre-actions) simply have
-- null and are recomputed once the engine version bumps. Global read, same policy as route_geometries.
alter table route_geometries
  add column if not exists actions jsonb;
