-- 0488 — a trailer's pairing says when it was last true (TRAILER-LINK-PLAN TL2, D-TL1).
--
-- THE GAP THIS CLOSES. `trailers.assigned_vehicle_id` is the truck a trailer travels with, set by GPS
-- co-location, by Samsara's assignment feed, or by a person. Nothing records WHEN. The audit of 2026-10-19
-- found every one of the 157 pairings inferred, the inference last run by hand on 2026-08-04, and no row
-- touched since 2026-09-08 — two months old and indistinguishable from today's. Under D-TL1 the screens that
-- ask "what is physically hitched" (Trailers page, reefer coverage) keep reading the pairing, so they must
-- be able to say how old it is.
--
-- `pairing_confirmed_at` is the last time a writer SAW the pairing hold, not the first time it was made: the
-- daily inference re-confirms a pairing it finds again (TRAILER-LINK-PLAN Q-TL2), and an age is what a
-- reader needs. Rejected: `updated_at`, which moves on every McLeod roster write and so would make a
-- months-old pairing look fresh.
--
-- WHO WRITES IT.
--   · The machine writers (`recordInferredTrailerPairing`, the Samsara assignment step) set it themselves —
--     in a SECOND merge (`lint:migration-ordering`): code that writes a column must not reach a database
--     that lacks it.
--   · A person creating a paired trailer or changing `assigned_vehicle_id` (the Trailers form writes the row
--     from the browser) gets it from the trigger below, so a hand pairing is never ageless. The trigger
--     leaves a statement that sets the column itself alone, and clears it when the pairing is cleared.
--
-- No backfill: no row knows when its pairing was last true, and a guess (`updated_at`) is the error this
-- column exists to stop. Null reads as "age unknown", and the daily inference fills every pairing it still
-- finds within a day of its writer merging.
--
-- ADDITIVE: a nullable column and a BEFORE INSERT/UPDATE trigger that only fills it.

alter table public.trailers add column if not exists pairing_confirmed_at timestamptz;

comment on column public.trailers.pairing_confirmed_at is
  'When the pairing in assigned_vehicle_id was last seen to hold (TRAILER-LINK-PLAN TL2, 0488). Set by the GPS '
  'inference and the Samsara assignment step on every pairing they find, and by trigger when a person changes '
  'the pairing. Null = age unknown (every pairing before 0488).';

create or replace function public.trailers_pairing_confirmed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assigned_vehicle_id is null then
    new.pairing_confirmed_at := null;
  elsif tg_op = 'INSERT' then
    new.pairing_confirmed_at := coalesce(new.pairing_confirmed_at, now());
  elsif new.assigned_vehicle_id is distinct from old.assigned_vehicle_id
        and new.pairing_confirmed_at is not distinct from old.pairing_confirmed_at then
    new.pairing_confirmed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.trailers_pairing_confirmed_at() from public, anon, authenticated;

drop trigger if exists trg_trailers_pairing_confirmed_at on public.trailers;
create trigger trg_trailers_pairing_confirmed_at
  before insert or update of assigned_vehicle_id, pairing_confirmed_at on public.trailers
  for each row execute function public.trailers_pairing_confirmed_at();
