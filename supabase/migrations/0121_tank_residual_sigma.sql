-- 0121: per-truck tank-sensor noise (WP-BEH — precision-scaled tank-short detection).
--
-- tank_fill_short ran a blanket 30%-of-bill tolerance because sensors vary — meaning a ~29-gal skim on
-- a 100-gal bill was invisible by design (the documented WP5 detection floor). Each truck's sensor
-- noise is now MEASURED: the std deviation of its observed-rise ÷ billed ratios
-- (learnTankSensorReliability.ratioSigma), persisted here by the per-vehicle learner. The rule's
-- tolerance becomes 3σ of THIS truck's history clamped to 8–30% (never below the J1939-resolution
-- floor, never wider than the legacy blanket), and the new tank_chronic_short rule uses the same σ to
-- size its sustained-shortfall threshold. Null = not learned yet → legacy 30% (unchanged behavior).

alter table vehicles add column if not exists tank_residual_sigma numeric;

comment on column vehicles.tank_residual_sigma is
  'Std deviation of the truck''s observed-rise ÷ billed fill ratios (WP-BEH learnTankSensorReliability.ratioSigma). Sizes the precision-scaled tank_fill_short tolerance (3σ clamped 8–30%) and the tank_chronic_short threshold. Null = not learned.';
