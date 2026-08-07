-- FuelGuard — 0144 give existing trailers a type
--
-- `trailers.trailer_type` has existed since `0100` and was dead in the application: no TypeScript
-- declared it, no query selected it, no form set it. D-H4 makes it the real equipment type, which the
-- hazmat engine reads to decide whether a load is bulk (`cargo_tank`) or not.
--
-- The one fact we already hold about existing trailers is `is_reefer`, set through the Trailers page
-- and its bulk actions since `0032`. Carry it across. Everything else stays NULL, which the resolver
-- treats as "unknown, assume a cargo tank" — deliberately over-restrictive rather than risking an
-- under-placarded bulk load (see `resolveVehicleKind`). A NULL here is a prompt to set the type, not a
-- silent default, and the Trailers page now shows it as "Not set".
--
-- Deliberately does NOT guess `dry_van` for the rest. "Probably a dry van" is exactly the kind of
-- assumption that put a hard-coded `cargo_tank` in the analysis path in the first place.

update trailers
   set trailer_type = 'reefer',
       updated_at = now()
 where trailer_type is null
   and is_reefer;

comment on column trailers.trailer_type is
  'Equipment type. `tanker` means bulk packaging for hazmat placarding (D-H4). NULL = not yet set; the engine assumes a cargo tank and says so (0144).';
