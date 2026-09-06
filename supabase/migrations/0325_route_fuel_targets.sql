-- 0325: the policy gets targets, so a policy figure can stop being a bare count (C8, D-FUI10).
--
-- ── WHY HERE AND NOT IN A NEW TABLE ─────────────────────────────────────────────────────────────
-- D-FUI10: targets ship with the POLICY, not with the report. `route_fuel_settings` already holds
-- `avoid_states`, `avoid_brands` and `preferred_brands` — the rules these three numbers qualify — and
-- a separate `fuel_targets` table would be a second place to look for one carrier's fuelling policy.
-- Each target sits beside the list it grades, on the same Settings page, in the same row.
--
-- ── ⚠ NULLABLE, WHICH BREAKS THIS TABLE'S OWN CONVENTION, AND DELIBERATELY ──────────────────────
-- Every other column here is NOT NULL with a default, because every other column is a PLANNING
-- input the router must have an answer for: it cannot route without a reserve percentage, so a
-- sensible default is better than a failure. A target is not that. It is a management commitment,
-- and the whole point of C8 is to stop a policy figure being a number with no standard attached to
-- it. Defaulting `target_on_network_pct` to 90 would mean every carrier is measured against a
-- threshold nobody in their office chose, and "12 points below target" would be a sentence this
-- product made up. That is worse than no target, not better.
--
-- So NULL means UNSET, a figure with no target renders as it does today, and setting one is an
-- explicit act on Settings → Planned Fueling. ⚠ It follows that C8's Done-when — "no policy figure
-- renders as a bare count" — cannot be reached by code alone, and that is a property of the
-- requirement rather than a gap in the work: the product cannot invent a carrier's own standard.
--
-- ── THE THREE, AND WHICH DIRECTION EACH ONE IS ──────────────────────────────────────────────────
-- Two are FLOORS and one is a CEILING, which is why they are three columns and not one shape:
--   · on-network share      — at LEAST this % of gallons at brands the policy prefers
--   · discount capture      — at LEAST this % of the discount available was actually taken
--   · avoided-state gallons — at MOST this many gallons bought in `avoid_states`
-- Getting the direction wrong inverts the variance, so each column's own comment carries it rather
-- than leaving a reader to infer it from a name.
--
-- Percentages are stored 0-100 rather than 0-1, matching `reserve_pct` and `fill_cap_pct` on this
-- same table — a second convention for the same idea in one row is how a 90 becomes a 0.9.
--
-- Rollback:
--   alter table route_fuel_settings
--     drop column target_on_network_pct,
--     drop column target_discount_capture_pct,
--     drop column target_avoided_state_gal;

alter table route_fuel_settings
  add column if not exists target_on_network_pct numeric,
  add column if not exists target_discount_capture_pct numeric,
  add column if not exists target_avoided_state_gal numeric;

-- Bounds, not defaults. A percentage outside 0-100 is a typo rather than a policy, and negative
-- gallons is not a ceiling anybody meant; NULL passes every one of these because unset is legal.
alter table route_fuel_settings
  drop constraint if exists route_fuel_settings_target_on_network_pct_range;
alter table route_fuel_settings
  add constraint route_fuel_settings_target_on_network_pct_range
  check (target_on_network_pct is null or (target_on_network_pct >= 0 and target_on_network_pct <= 100));

alter table route_fuel_settings
  drop constraint if exists route_fuel_settings_target_discount_capture_pct_range;
alter table route_fuel_settings
  add constraint route_fuel_settings_target_discount_capture_pct_range
  check (target_discount_capture_pct is null or (target_discount_capture_pct >= 0 and target_discount_capture_pct <= 100));

alter table route_fuel_settings
  drop constraint if exists route_fuel_settings_target_avoided_state_gal_min;
alter table route_fuel_settings
  add constraint route_fuel_settings_target_avoided_state_gal_min
  check (target_avoided_state_gal is null or target_avoided_state_gal >= 0);

comment on column route_fuel_settings.target_on_network_pct is
  'FLOOR. At least this % of gallons should be bought at brands the policy prefers. NULL = no target set (0325, C8).';
comment on column route_fuel_settings.target_discount_capture_pct is
  'FLOOR. At least this % of the available discount should actually be captured. NULL = no target set (0325, C8).';
comment on column route_fuel_settings.target_avoided_state_gal is
  'CEILING. At most this many gallons bought in avoid_states. NULL = no target set (0325, C8).';
