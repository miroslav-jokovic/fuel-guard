-- Per-fill closest approach (miles) of the truck's GPS to the fuel station's geocoded coordinate that day.
-- Persisted so we can look ACROSS a station's fills and detect a systematically wrong station pin: when every
-- fill at a station shows the truck a CONSISTENT non-zero distance away, the coordinate is off (city-centroid,
-- chain HQ, bad geocode) — a data error, not theft (see isSystematicStationOffset; WEX documents this exact
-- pitfall). A genuine "card used where the truck wasn't" varies trip to trip. Used only to SUPPRESS a would-be
-- location mismatch (route it to data-quality); never to raise one. Null when the station wasn't geocoded.
alter table fuel_transactions add column if not exists samsara_nearest_station_miles numeric(7,1);

comment on column fuel_transactions.samsara_nearest_station_miles is
  'Truck GPS closest approach (mi) to the station pin that day. Clustering across a station''s fills flags a wrong pin (data error), suppressing a false location mismatch.';
