-- 0321: what we have already told this carrier about a stale feed, so we do not tell them hourly.
--
-- ── WHY AN ALARM NEEDS A TABLE AT ALL ────────────────────────────────────────────────────────────
-- SAM-S5's Done-when is that "a stalled feed pages somebody instead of quietly degrading every number
-- downstream". A stale feed is stale on EVERY tick, so an alarm computed from the feed's state alone
-- emails the carrier once per evaluation until somebody fixes it — which is how a warning becomes
-- wallpaper, and it is the same failure `targetUnreachable` prevents one level down. The alarm
-- therefore has to remember what it last said, and remembering is a table.
--
-- One row per (org, feed), holding the state we NOTIFIED about — never the state the feed is in. Those
-- are different facts: the second is recomputed from the ledgers every evaluation and belongs nowhere,
-- and confusing the two is how an alarm ends up reporting its own memory back to itself.
--
-- ── OPERATIONAL, NOT EVIDENCE ────────────────────────────────────────────────────────────────────
-- This records WHAT WE SAID, not what happened to the carrier's fuel. Losing a row costs one duplicate
-- email and no history, so — exactly as `samsara_feed_cursors` (0288) argues for itself — it is
-- deliberately NOT in RETENTION_FORBIDDEN, carries no append-only trigger, and is `layer=infra`.
-- The row keeps `lead`, the exact sentence sent, so the record of what a carrier was told lives here
-- rather than needing to be reconstructed from a code path that has since changed.
--
-- ── `feed` IS A VOCABULARY, NOT AN ENUM ──────────────────────────────────────────────────────────
-- Same argument 0288 makes for the same column: a new feed is a new collector tier, which is
-- application work, and making it also a migration would buy nothing. `SAMSARA_FEED_IDS` in
-- `@silvicom/shared` is the list, and it is the one both the writer and the surface read.
--
-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────
-- Enabled with NO policy, which is deny-all on purpose. There is no browser question this answers: an
-- operator wants to know whether a feed is fresh, and that is the freshness card computing it
-- server-side. A client that could WRITE here could silence a theft-detection outage by hand.

create table if not exists samsara_feed_alerts (
  org_id      uuid not null references organizations(id) on delete cascade,
  -- Which feed, from `SAMSARA_FEED_IDS`. Text with a non-empty check, per 0288's argument.
  feed        text not null check (length(trim(feed)) > 0),
  -- The state we last RAISED — 'late', 'failing' or 'never'. Never 'fresh': recovery is `cleared_at`,
  -- not a fourth value, so "is this alert standing?" is one nullable column and not a string compare.
  state       text not null check (state in ('late', 'failing', 'never')),
  -- When we last SAID ANYTHING about this feed, raise or recovery. The cooldown is measured from here.
  notified_at timestamptz not null default now(),
  /*
   * When we told them it recovered; null while the alert stands.
   *
   * ── WHY THE ROW SURVIVES A RECOVERY ────────────────────────────────────────────────────────────
   * Deleting on recovery was the first design and it reopens the hole this table exists to close.
   * A `late` feed cannot flap quickly — it can only go late again after its whole target window
   * passes with no delivery, so the bound guards itself. A `failing` feed has no such protection:
   * `failing` is driven by the most recent run's error, so a tier that fails, succeeds and fails
   * again — measured on production, `sync_idle` does exactly this, 268 failures against 486
   * successes — would email on every raise if the memory of the last one had been thrown away.
   * Keeping the row keeps `notified_at`, which is the only thing that can hold the next one back.
   */
  cleared_at  timestamptz,
  -- The exact sentence sent, so somebody reading this row later knows what the carrier was told and
  -- does not have to reconstruct it from a code path that has since changed.
  lead        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, feed)
);

drop trigger if exists trg_samsara_feed_alerts_updated on samsara_feed_alerts;
create trigger trg_samsara_feed_alerts_updated
  before update on samsara_feed_alerts
  for each row execute function set_updated_at();

alter table samsara_feed_alerts enable row level security;

comment on table samsara_feed_alerts is
  'module=samsara; layer=infra (0321, D-SAM6; scripts/table-modules.json is the machine-read source). '
  'What the freshness alarm has already told a carrier about a feed, so a standing outage is reported '
  'once rather than on every evaluation. A recovery sets cleared_at; the row survives so the cooldown does.';
comment on column samsara_feed_alerts.state is
  'The state we notified about, never the state the feed is in now — that is recomputed every run.';
