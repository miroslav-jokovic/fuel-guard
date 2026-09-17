-- 0344: who dispatches a load in the TMS (LIVE-MAP-PLAN.md LM2, LOADS-GO-LIVE-PLAN.md L3).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- Measured on the live board, 2026-09-17: `movement.dispatcher_user_id` is populated on **110 of 110
-- dispatched loads (100%)**. The agent already reads it, `tmsLoadInputSchema` already carries
-- `dispatcher_external_id` and `dispatcher_name`, and the ingest has been **silently discarding both
-- since the first production pull** — because there was nowhere to put them. LM2 specified this table
-- and this column; only its `vehicle_positions` half shipped (0341/0342). This is the other half.
--
-- ── WHY A TABLE AND NOT A COLUMN ─────────────────────────────────────────────────────────────────
-- Because a dispatcher is a PERSON who will eventually be one of our users, and the mapping between
-- a McLeod account and a Silvicom membership is an office act, not a feed's opinion. Measured
-- 2026-09-10: McLeod has 15 active dispatcher accounts against 2 Silvicom dispatcher memberships, so
-- most rows here will have `user_id is null` for a long time and that is the normal state, not a
-- backlog. A text column on `loads` alone could name a dispatcher but could never be linked to a
-- person, which is the whole point of LM11.
--
-- ── `user_id` IS NULLABLE, AND NOTHING MAY WRITE IT FROM THE FEED ────────────────────────────────
-- D-LM4. The link is made by an admin on the Settings → Integrations → McLeod page (LM11). A re-sync
-- that touched `user_id` would silently unlink a person an office had deliberately mapped, which is
-- the same class of mistake as overwriting an approved load. `on delete set null` rather than
-- cascade: deleting a Silvicom user must not delete the record that a McLeod dispatcher exists.
--
-- ── `is_system`: TWO OF THESE ACCOUNTS ARE NOT PEOPLE ────────────────────────────────────────────
-- `loadmaster` and `lmeadm`, both displaying as "McLeod Administrator", held 21 of 109 active loads
-- between them on 2026-09-10 (14 of 157 on 2026-09-17). Their loads have no human dispatcher and the
-- product must be able to SAY so rather than offer a user picker for a robot. The flag is decided by
-- the agent from configuration and never inferred from a display name here — a carrier may rename
-- them, and a rule that reads names would silently start mapping a person's loads to a system row.
--
-- ── NO FOREIGN KEY FROM `loads.dispatcher_external_id`, DELIBERATELY ─────────────────────────────
-- The obvious constraint — `(org_id, provider, dispatcher_external_id)` referencing this table —
-- is NOT added, and the reason is arrival order. Loads and dispatchers are two separate pushes from
-- the agent, so a board naming a dispatcher we have not yet received would be REJECTED WHOLESALE by
-- an FK: one unknown account would fail a 157-load batch. The value is a key into a list that syncs
-- alongside it, not a promise that the list is already complete. LM3's ingest reports an unresolved
-- dispatcher the way `entityLookup` already reports an unresolved driver.
--
-- ── RLS: ENABLED, NO POLICY, DENY-ALL ON PURPOSE ─────────────────────────────────────────────────
-- Same reasoning as 0341. This is read through the API, which uses the service role and therefore
-- BYPASSES RLS — so the org filter is the service's job and `expectOrgScoped` is what proves it.
--
-- ── NOT EVIDENCE ─────────────────────────────────────────────────────────────────────────────────
-- A dispatcher roster is current state, re-derivable from McLeod on the next sweep. Losing it costs
-- one poll cycle and the hand-made `user_id` links, which is why the links are the only thing here
-- the feed may not write. It is deliberately NOT in RETENTION_FORBIDDEN and carries no append-only
-- trigger — the same class as `vehicle_positions`, not the class the audit tables are in.
--
-- ── SCHEMA ONLY. NO READER, NO WRITER ────────────────────────────────────────────────────────────
-- `loads.dispatcher_external_id` is a new COLUMN, and Railway serves a merge ~2m44s before
-- `migrate.yml` applies its migration. Its first writer is L3's successor, in a separate merge
-- (`lint:migration-ordering`). The two new tables are exempt from that rule; the column is not.

-- raw-access-waiver: this migration CREATES the mcleod raw table it names — the owning collector's
-- own DDL, no cross-module read.
-- cross-module-waiver: this migration creates `mcleod`'s own dispatcher table and adds ONE nullable
-- column plus an index to `loads`, which the `loads` module owns. The column has to live there
-- because whose load it is, is a property of the LOAD — it is read on the board beside `status` and
-- `driver_id`, and holding it anywhere else would mean a join on every dispatcher-filtered read of
-- the rail. The touch on `loads` changes no existing column, no row and no other module's behaviour;
-- it is additive and nullable, and its first writer arrives in a separate merge because the deploy
-- window serves code before schema. Precedent: 0341 took the same shape in the other direction, when
-- samsara's positions table needed an additive constraint on roster's `vehicles`.
create table if not exists tms_dispatchers (
  org_id       uuid not null references organizations(id) on delete cascade,
  -- Matches `loads.provider` / `org_integrations.provider` — 'mcleod' today. Part of the key rather
  -- than assumed, because a carrier running two TMS instances would otherwise collide their ids.
  provider     text not null,
  -- McLeod's `users.id`, e.g. 'loadmaster'. char(32) there, trimmed by the agent before it is sent.
  external_id  text not null,

  -- What the TMS calls them, for labelling a load before an admin has mapped anybody. Nullable: the
  -- account may exist with no name, and an absent name is not the empty string (the D-LM12 lesson).
  display_name text,

  -- The Silvicom user this dispatcher IS, once an office says so. Never written by the feed (D-LM4).
  user_id      uuid references auth.users(id) on delete set null,

  -- Not a person: 'loadmaster', 'lmeadm'. Set by the agent from configuration, never guessed here.
  is_system    boolean not null default false,
  -- McLeod's `users.is_active = 'Y'`, already mapped to a boolean by the agent.
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  primary key (org_id, provider, external_id)
);

alter table tms_dispatchers enable row level security;

-- The board read is "this org's loads, in this status, for this dispatcher" (LM8's rail filter), so
-- the index leads with the columns that are always equality-filtered and carries the dispatcher last.
alter table loads add column if not exists dispatcher_external_id text;

create index if not exists loads_org_status_dispatcher_idx
  on loads (org_id, status, dispatcher_external_id);
