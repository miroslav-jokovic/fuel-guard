-- FleetGuard — 0013 Tank-fill reconciliation (docs/10 §8 — soft / advisory signal)
-- Records the Samsara tank-level check on each scored transaction: how many gallons the tank actually
-- rose across the fueling moment, and how far short of the billed gallons that came (if any). The
-- sensor is coarse, so the `tank_fill_short` rule is low-severity and uses a generous tolerance.

alter table fuel_transactions
  add column samsara_tank_observed_gal numeric(10,1),  -- observed tank rise across the fill
  add column samsara_tank_short_gal    numeric(10,1);  -- gallons billed beyond the observed rise (>0 = short)
