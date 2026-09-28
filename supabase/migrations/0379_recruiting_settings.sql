-- 0379 — the carrier's own answers about an application link's lifetime and its reminder
-- (APPLICATION-FLOW-V2-PLAN.md S1, Q-AW41 ruled (a) by the owner 2026-09-28).
--
-- WHAT GAP. Both are constants today: a link lives 14 days and is extended by 14 on every send,
-- reminder and signing opened (`INVITE_TTL_DAYS_DEFAULT`), and the one reminder per part goes after 48
-- hours without progress (`STALE_DRAFT_HOURS`). The owner: drivers often finish over a couple of days,
-- and the carrier wants control. S2 is the reader — Settings → Recruiting, the api reading these instead
-- of the constants, and a per-invite override in the invite drawer. This migration is schema only: a
-- migration and its first reader never share a merge (MIGRATION-DISCIPLINE.md §the-deploy-window).
--
-- WHY A TABLE OF ITS OWN, ONE ROW PER ORG, and not columns on `organizations`: it is the shape every
-- other settings surface in this schema took (0044, 0053, 0173), it keeps a recruiting module's facts in
-- a recruiting table (`table-modules.json`), and it needs no backfill.
--
-- WHY NO ROW MEANS "THE PRODUCT'S DEFAULTS", AND THE COLUMNS CARRY NO DEFAULT. The defaults already have
-- one home, the two shared constants above. A `default 14` here would be a second home that drifts the
-- first time either is changed — and only an org that has SAVED its settings has a row, so the column
-- default would never even be the value in force. S2's reader falls back to the constants when the row
-- is absent, and its writer always writes all three answers (never a partial upsert, lint:upserts).
--
-- THE BOUNDS, and why each is here and not only in the contract:
--   * invite_ttl_days 1–60: the ruling's range, and `INVITE_TTL_DAYS_MAX` (60) is what the invite
--     route's `expires_in_days` already accepts. Restated because a CHECK cannot import a constant; S2's
--     contract reads the shared one. That the two agree is pinned by recruiting-settings.test.mjs's
--     "a link of INVITE_TTL_DAYS_MAX + 1 days is refused", which reads the constant from its source.
--   * reminder_after_hours 24–1440: the reminder sweep runs every six hours (dqAlertScheduler.ts), so a
--     reminder can land up to six hours late — a quarter of a one-day delay, and more of anything shorter;
--     and 1440 hours is the longest link.
--     These are this migration's choice, not the owner's — the ruling said "a reminder delay in hours" and
--     no range. Widening a CHECK later is a one-line migration; narrowing one over live rows is not.
--   * a reminder that is on must come before the link dies. The sweep skips an expired invitation
--     (applicationNudge.ts), so a 72-hour reminder on a 2-day link would be a switch that does nothing.
--     Off, the delay is kept (so turning it back on restores the carrier's number) and is not checked
--     against the lifetime.
-- The 72 hours a phone keeps unsent answers (Q-AW39) is NOT a setting: it is a privacy rule.
--
-- RLS: enabled, no policies — service-role only, as 0173. The api is the one door, gated on the
-- recruitment section like the rest of Settings → Recruiting.

create table if not exists recruiting_settings (
  org_id               uuid primary key references organizations(id) on delete cascade,
  invite_ttl_days      integer not null check (invite_ttl_days between 1 and 60),
  reminders_enabled    boolean not null,
  reminder_after_hours integer not null check (reminder_after_hours between 24 and 1440),
  updated_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint recruiting_settings_reminder_within_link
    check (not reminders_enabled or reminder_after_hours < invite_ttl_days * 24)
);

alter table recruiting_settings enable row level security;
-- NO POLICIES. See the header.

drop trigger if exists trg_recruiting_settings_updated on recruiting_settings;
create trigger trg_recruiting_settings_updated before update
  on recruiting_settings
  for each row execute function set_updated_at();
