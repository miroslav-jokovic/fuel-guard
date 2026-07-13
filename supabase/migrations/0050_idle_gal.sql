-- 0050: store the RESOLVED idle gallons per event (CP3) so cost and gallon totals stay precise + consistent.
-- fuel_gal is Samsara's MEASURED value (null when not measured); idle_gal is the value actually used: measured
-- when present, otherwise the learned per-truck, temperature-adjusted estimate (US DOE 0.6-1.5 gal/hr band).
alter table idle_events add column if not exists idle_gal numeric(9,3);
