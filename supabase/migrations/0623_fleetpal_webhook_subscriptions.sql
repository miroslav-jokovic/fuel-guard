-- 0623 — FleetPal webhook subscriptions (FLEETPAL-INTEGRATION-PLAN.md step F15; D-FP10, §2.8).
--
-- ── WHY A TABLE ─────────────────────────────────────────────────────────────────────────────────
-- FleetPal returns a subscription's signing secret ONCE, in the response to `POST
-- /v1/webhook-subscriptions`, and never again. One subscription is one event key, so the eight events
-- F15 listens to are eight secrets — and a delivery can only be verified by the secret of the
-- subscription it came from (`X-Fleetpal-Event` names which). The secret is sealed with secretBox
-- under an org-and-purpose AAD in the same request that created the subscription; a secret that is not
-- written there is lost, and the subscription is then deleted at FleetPal rather than left delivering
-- events nobody can verify.
--
-- ── WHAT IT DOES NOT HOLD ───────────────────────────────────────────────────────────────────────
-- Any payload. A webhook is a wake-up signal (D-FP10): the receiver verifies, claims the delivery in
-- `fleetpal_webhook_deliveries` (0334), and starts the ordinary sweep, which re-reads through the
-- authenticated API. Nothing a delivery carries reaches a staging table, so ordering between
-- deliveries cannot overwrite newer state — there is no state in them to write.
--
-- Service-role only: RLS on, no client policy (deny-all on purpose). A new table, so its reader may
-- ship in the same merge (MIGRATION-DISCIPLINE.md §the-deploy-window).

create table if not exists fleetpal_webhook_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  -- FleetPal's own subscription id, opaque.
  subscription_id  text not null check (length(btrim(subscription_id)) between 1 and 64),
  event_key        text not null check (length(btrim(event_key)) between 1 and 64),
  target_url       text not null check (length(target_url) between 1 and 400),
  -- secretBox envelope, never a bare secret.
  secret_sealed    text not null check (length(secret_sealed) > 0),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fleetpal_webhook_subscriptions_org_sub_key unique (org_id, subscription_id)
);

-- One active subscription per event per org: the receiver looks the secret up by event key, and two
-- live secrets for one event would make "which one signed this" a guess.
create unique index if not exists fleetpal_webhook_subscriptions_one_active
  on fleetpal_webhook_subscriptions (org_id, event_key) where is_active;

comment on table fleetpal_webhook_subscriptions is
  'FleetPal webhook subscriptions (F15): one per event key, with its signing secret sealed (secretBox, org+purpose AAD). The secret is returned by FleetPal once. Service-role only.';

drop trigger if exists trg_fleetpal_webhook_subscriptions_updated on fleetpal_webhook_subscriptions;
create trigger trg_fleetpal_webhook_subscriptions_updated
  before update on fleetpal_webhook_subscriptions
  for each row execute function set_updated_at();

drop trigger if exists trg_fleetpal_webhook_subscriptions_org_immutable on fleetpal_webhook_subscriptions;
create trigger trg_fleetpal_webhook_subscriptions_org_immutable
  before update on fleetpal_webhook_subscriptions
  for each row execute function forbid_org_change();

alter table fleetpal_webhook_subscriptions enable row level security;
-- No client policies → deny-all → the API is the only reader and writer.
