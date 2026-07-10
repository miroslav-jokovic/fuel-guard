-- How each trailer's tractor pairing (assigned_vehicle_id) was established, so the automatic sources never
-- clobber a human's manual pairing, and the UI can show provenance/confidence:
--   'manual'   – set by a fleet manager in the Trailers UI (highest trust; never overwritten by a sync)
--   'samsara'  – from Samsara's own trailer↔tractor assignment feed (driver selected the trailer / powered AG)
--   'inferred' – GPS co-location: the reefer's Asset-Gateway GPS consistently tracked this truck (see
--                inferTrailerPairing). pairing_confidence is the share of samples co-located (0–1).
alter table trailers add column if not exists pairing_source     text;
alter table trailers add column if not exists pairing_confidence numeric(4,3);

comment on column trailers.pairing_source is
  'How assigned_vehicle_id was set: manual | samsara | inferred (GPS co-location). manual is never overwritten by a sync.';
