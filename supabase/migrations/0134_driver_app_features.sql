-- FuelGuard — 0134 driver-app feature control (hardening plan Phase 4, decisions D-PM1..D-PM8)
--
-- WHY THIS EXISTS. Entitlements (0088 `org_modules`) answer "what did this tenant BUY" — a
-- commercial fact the platform owns. This migration adds the second and third layers of the
-- Samsara-style control plane: "what do this org's DRIVERS SEE, and how does it behave"
-- (org-level feature rows, owned by the org's admins through the dashboard) and "what about THIS
-- driver specifically" (per-driver overrides for pilots and exceptions). A feature can only ever
-- narrow within its owning module: the resolver enforces entitled AND org-enabled AND override.
--
-- SECURITY MODEL — deliberately different from most tables here: RLS is ENABLED with **no
-- in-tenant policies at all**. These tables are UI-visibility CONFIG, not driver data:
--   * Drivers never read them — the app receives one server-RESOLVED feature set on the bootstrap
--     (`GET /api/me/driver`), so a driver JWT hitting PostgREST directly sees zero rows.
--   * Dashboard reads/writes go through the API (service role) behind role guards
--     (policy page: fleet manage = admin/fleet_manager; overrides: dispatch manage adds
--     dispatcher — D-PM6), with every write audited.
-- Hiding a feature is never authorization: RLS on the underlying DATA (loads, hazmat, messages)
-- is unchanged and remains the boundary. Turning `tab.loads` off hides a tab; it opens nothing.
--
-- The feature vocabulary (keys, owning module, defaults, released state, config schemas) lives in
-- ONE place: `packages/shared/src/featureCatalog.ts`. The check constraint below mirrors its keys
-- the same way 0088's does MODULE_KEYS — extend both together, never one.
--
-- RLS-matrix note (Phase 9): add raw-PostgREST deny cases for BOTH tables × every role — the
-- expected answer is zero rows / refused writes for all of them.

create table if not exists driver_app_features (
  org_id      uuid not null references organizations(id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null,
  -- Per-feature settings (e.g. duty.odometer {"mode":"required"}). Validated against the
  -- catalog's config schema at the API door; stored verbatim here.
  config      jsonb not null default '{}',
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, feature_key),
  constraint driver_app_features_key_check check (feature_key in (
    'tab.loads', 'tab.score', 'hazmat.capture', 'messages', 'notifications',
    'duty.odometer', 'duty.takeover', 'nav.preview', 'training', 'core.app'
  ))
);

create table if not exists driver_app_feature_overrides (
  org_id      uuid not null references organizations(id) on delete cascade,
  driver_id   uuid not null references drivers(id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null,
  -- Why this driver differs (shown in the dashboard next to the toggle) — "hazmat pilot" beats
  -- an unexplained exception six months later.
  note        text,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, driver_id, feature_key),
  constraint driver_app_feature_overrides_key_check check (feature_key in (
    'tab.loads', 'tab.score', 'hazmat.capture', 'messages', 'notifications',
    'duty.odometer', 'duty.takeover', 'nav.preview', 'training', 'core.app'
  ))
);

create index if not exists idx_daf_overrides_driver on driver_app_feature_overrides (org_id, driver_id);

-- RLS on, zero policies: the API (service role) is the only door, for reads AND writes, for every
-- in-tenant role including org admins. See the security model above.
alter table driver_app_features enable row level security;
alter table driver_app_feature_overrides enable row level security;

-- No backfill, by design: an absent row means "the catalog default applies" (featureCatalog.ts),
-- which for every released feature preserves today's behavior exactly — unlike 0088 there is no
-- live capability to lose, so an empty table is the correct starting state for every org.
