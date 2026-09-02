-- 0288: where a Samsara delta feed left off (SAM-S2, D-SAM4).
--
-- ── WHY A CURSOR HAS TO BE A TABLE ───────────────────────────────────────────────────────────────
-- `listAllPages` already walks `pagination.endCursor`, but `after` is a LOCAL VARIABLE: it is reset on
-- every run and never survives the process. That is intra-request paging, and it is the whole of this
-- product's cursor usage today — `GET /fleet/vehicles/stats/feed` has zero references in the codebase
-- (SAMSARA-COLLECTION-PLAN §0.2).
--
-- A snapshot poll shows where a value IS, never where it WAS. A truck that fuels at 10:07 and leaves at
-- 10:19 is invisible between the 10:00 and 10:20 `/fleet/vehicles/stats` snapshots. At 195 vehicles that
-- is not a cost problem — it is a COMPLETENESS problem, and completeness is the one property a collector
-- is supposed to have (§1.3: "a collector is complete by construction, or it is a best-effort script").
--
-- A cursor the vendor hands back and we STORE is what converts "we poll often" into "we lost nothing".
-- The distinction §1.1 draws is that a snapshot poll fails silently and invisibly, while a cursor feed
-- fails loudly — the cursor stalls, and a stalled cursor is a number S5 can put a threshold on. That
-- guarantee is worth exactly as much as the durability of the cursor, so the cursor lives in the
-- database rather than in a scheduler process's memory.
--
-- ── AT-LEAST-ONCE, NEVER AT-MOST-ONCE (D-SAM4) ───────────────────────────────────────────────────
-- The row advances only after a page has been FULLY APPLIED. A crash between fetching a page and
-- applying it therefore re-delivers that page on the next tick — the same samples arrive twice, and the
-- appliers are idempotent, so the cost is a wasted write. Advancing the cursor first would make the
-- opposite trade: a crash would skip a page permanently, silently, and with the cursor looking healthy.
-- That is the failure mode this table exists to end, so it must not be reintroduced by the write order.
--
-- ── ONE ROW PER (ORG, FEED), AND `feed` IS A VOCABULARY ──────────────────────────────────────────
-- SAM-S2 stores exactly one feed, `vehicle_stats`. It is not a single-row table because the same
-- mechanism is what a later feed gets, and because a per-feed row is what S5 reads to answer "when did
-- THIS feed last advance" — D-SAM6's per-feed staleness, not a global adjective. `feed` is deliberately
-- text with a non-empty check rather than an enum or a pinned IN-list: a new feed is a new collector
-- tier, which is application work, and making it also a migration would buy nothing.
--
-- ── OPERATIONAL, NOT EVIDENCE ────────────────────────────────────────────────────────────────────
-- This table records WHERE WE ARE, never WHAT HAPPENED. Losing a row costs one re-seed and no history,
-- so it is deliberately NOT in RETENTION_FORBIDDEN, carries no append-only trigger, and is `layer=infra`
-- in scripts/table-modules.json — the same class as route_geometries, not the evidence class that
-- fuel_recon_runs is in.
--
-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────
-- Enabled with NO policy at all, which is deny-all on purpose. There is no browser question this table
-- answers: an operator wants to know whether the feed is fresh, and that is S5's surfaced staleness
-- figure computed server-side, not a cursor string. A client that could WRITE one could silently skip a
-- window of the carrier's telematics, which is the sabotage version of the bug we are fixing.

create table if not exists samsara_feed_cursors (
  org_id     uuid not null references organizations(id) on delete cascade,
  -- Which feed. Vocabulary today: 'vehicle_stats' (GET /fleet/vehicles/stats/feed).
  feed       text not null check (length(trim(feed)) > 0),
  -- Samsara's `pagination.endCursor`, verbatim. Named for the vendor field rather than shortened to
  -- `cursor`: the value is opaque, we never parse it, and a column called `cursor` reads like something
  -- this system owns and could recompute. It cannot — only Samsara can mint one.
  end_cursor text not null check (length(trim(end_cursor)) > 0),
  -- Last time the cursor ADVANCED, which for this feed is also the last successful run: Samsara mints a
  -- fresh endCursor on every call, including one that returns no samples. S5's "last cursor advance"
  -- reads this column.
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (org_id, feed)
);

drop trigger if exists trg_samsara_feed_cursors_updated on samsara_feed_cursors;
create trigger trg_samsara_feed_cursors_updated
  before update on samsara_feed_cursors
  for each row execute function set_updated_at();

alter table samsara_feed_cursors enable row level security;

comment on table samsara_feed_cursors is
  'module=samsara; layer=infra (0288, D-SAM4; scripts/table-modules.json is the machine-read source). '
  'Where each Samsara delta feed left off. Advanced only after a page is fully applied — at-least-once.';
comment on column samsara_feed_cursors.end_cursor is
  'Samsara pagination.endCursor, opaque. Never parsed, never constructed here.';
