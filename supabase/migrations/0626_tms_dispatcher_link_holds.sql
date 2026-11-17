-- 0626 — A McLeod login the office unlinked from a person stays unlinked
-- (LUMPER-REVISED-RC-PLAN §4 "the wrong person is reminded"; DISPATCH-BOARD-PLAN LM11, D-LM4).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- A McLeod login reaches a person only through `tms_dispatchers.user_id`, which an office sets on
-- Settings › McLeod fleets. Measured 2026-11-17: 2 of 16 non-system logins were linked. On 2026-10-15
-- the owner linked them all, but the strict `/api/integrations` limiter refused 13 of the person links
-- (since moved off it), and nothing said so. The lumper reminder goes to the order's dispatcher through
-- this link, so with 2 of 16 linked, 4 of the first 94 lumper cases could reach their dispatcher.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- From 0626 a login is linked AUTOMATICALLY when the data proves who it is: exactly one active office
-- member whose login email's name (before the @) is the McLeod login, and who is linked to no other
-- login (`autoLinkDispatchers`, run by the ten-minute McLeod job, audited). The office can still link
-- by hand and REMOVE any link. This table is what makes a removal stick: when the office unlinks a
-- login, a row here holds it, and the automatic linker never touches a held login again. Linking the
-- login by hand releases the hold.
--
-- ── WHAT WAS REJECTED ────────────────────────────────────────────────────────────────────────────
-- A column on `tms_dispatchers`: that table is the feed's (D-LM4) and its re-sync writes whole rows;
-- an office decision kept beside the feed's facts in the same row is one careless upsert from erasure.
-- Matching by display name: McLeod names are free text the carrier edits ("Asen" is a login whose 360
-- account is named "Asen Manager" with the email alex@), and a rule that reads names would sooner or
-- later route a dispatcher's reminders to the wrong person.
--
-- ⚠ DEPLOY WINDOW: a new table; until it exists the automatic linker's read fails and it links
-- nothing (it fails closed), and an unlink in that window fails with its error and can be repeated.
--
-- Rollback: drop the table.

create table if not exists public.tms_dispatcher_link_holds (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  provider    text not null,
  external_id text not null,                       -- the McLeod login the office unlinked
  user_id     uuid,                                -- who it was linked to when unlinked, for the record
  held_by     uuid references auth.users(id) on delete set null,
  held_at     timestamptz not null default now(),
  primary key (org_id, provider, external_id)
);

alter table public.tms_dispatcher_link_holds enable row level security;

comment on table public.tms_dispatcher_link_holds is
  'LUMPER-REVISED-RC-PLAN §4 / LM11 (0626): a McLeod login the office unlinked from a person; the automatic linker never relinks it. Released when the office links it by hand. Service-role only (RLS, no policies).';
