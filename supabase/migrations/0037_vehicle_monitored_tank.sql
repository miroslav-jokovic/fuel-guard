-- Per-vehicle "monitored tank capacity": the capacity (in gallons) of the SINGLE tank that the Samsara
-- fuel-level sensor actually reads. NULL (the default) means unknown / dual-tank / not yet configured, and
-- in that case the advisory tank-fill-short check is SUPPRESSED for the vehicle.
--
-- Why: the check computes an observed rise as (fuel% delta) x capacity and compares it to the billed
-- gallons. On a Class 8 tractor with two saddle tanks where Samsara senses only one, the observed rise is
-- roughly HALF the billed fill, so every full fill looked "short" -> false anomalies. Reconciling against
-- the tank the sensor covers (set this = tank_capacity_gal for a genuine single-tank truck, or the sensed
-- tank's capacity) makes the check reliable; leaving it NULL keeps the truck out of the check entirely.
alter table vehicles add column if not exists monitored_tank_capacity_gal numeric(7,2);

comment on column vehicles.monitored_tank_capacity_gal is
  'Capacity (gal) of the single tank the Samsara fuel sensor reads. NULL = dual-tank/unknown -> tank-fill-short check suppressed.';
