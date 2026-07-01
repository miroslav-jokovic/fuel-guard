-- FuelGuard — 0015 Driver ↔ Samsara mapping
-- Mirrors vehicles.samsara_vehicle_id: lets the driver sync (GET /fleet/drivers) match and upsert
-- drivers by their Samsara id, so telematics-linked driver data stays consistent across syncs.

alter table drivers add column samsara_driver_id text;
