-- 0537 — the ads module's tables (ADS-AGENT-BUILD-WORKFLOW.md step A2; D-AD16, D-AD17).
--
-- ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────────────────────────
-- The ads agent (docs/plans/recruitment/ADS-AGENT-PLAN.md) composes, renders, checks, creates and
-- monitors paid social ads, with a person launching every one (Q-AD2) and spending rules set on a
-- settings page (Q-AD7). This migration is its whole store and nothing else: thirteen new tables,
-- the bell's eight new categories, no function a client can call, no change to any existing table.
--
-- ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────────────────────────
-- The recruiting tables the workflow's A2 row listed (openings, hiring profiles, leads, contacts,
-- match verdicts, conversions, `recruiting_ai_outputs`) are recruiting's (D-AD17) and arrive in their
-- own migration at step D0, with `purge_applicant` and the roster merge list updated in the same PR:
-- `lead_conversions` points at a `drivers` row, and a drivers-referencing table the purge does not
-- own makes every purge of that applicant refuse (PA011, 0535) and a merge lose it (the merge-driver
-- cascade trap). No table below references `drivers`, an application, or a recruiting table: what an
-- ad advertises arrives as an opaque brief (`brief_source`, `brief_ref`, the facts frozen in
-- `brief_snapshot`), and a lead leaves through the `LeadSink` interface, never through a row here.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
--   configuration, versioned  ads_settings_versions · ad_brand_kits (+ _versions) · ad_concept_presets (+ _versions)
--   connections               ads_platform_connections (sealed tokens: Meta, TikTok, X, Higgsfield, simulator)
--   the work                  ads_campaigns · ads_creatives
--   the ledgers               ads_approvals · ads_actions · ad_generations · ads_outcome_events
--   pulled facts              ads_spend_hourly (re-derivable from the platform)
--
-- Every table: RLS on with no client policy (deny-all from a browser; the API reads and writes with
-- the service role and org-filters itself, `expectOrgScoped`). Every reference between these tables
-- is a composite `(org_id, …)` foreign key, so a row can never cite another carrier's campaign,
-- creative, connection or version — the database refuses it (23503) without a trigger.
--
-- ── THE LEDGERS ARE APPEND-ONLY FOR THE SERVICE ROLE TOO ─────────────────────────────────────────
-- IV011's shape (0331): BEFORE triggers that fire for every role, because the API holds the service
-- key and RLS alone would leave the ledgers editable by the one caller that matters. `ads_actions`
-- and `ad_generations` are written BEFORE a vendor call and completed after it, so their guard allows
-- exactly one move, from `started` to an outcome, touching only the outcome columns (AX011).
-- `ads_outcome_events` moves from `queued` (or a failed send) to a send result. `ads_approvals` and
-- the three version tables never change at all. Five of them are pinned in `RETENTION_FORBIDDEN`:
-- `ads_actions` (the money audit trail), `ads_approvals` (who allowed which spend), `ad_generations`
-- (what each model was asked and what it cost), `ads_settings_versions` (which caps were in force
-- when) and `ads_outcome_events` (what we told a platform about a person's progress). None is
-- re-derivable, and each is what a dispute asks for.
--
-- The person columns on immutable rows (`approved_by`, `actor_id`, `created_by` on a version) are a
-- uuid and a name with NO foreign key to auth.users: an `on delete set null` would be an UPDATE the
-- append-only guard refuses, so deleting a login would fail, and the name keeps the row readable
-- after the account is gone.
--
-- ── THE DATABASE'S OWN SPEND FENCE (AX020) ───────────────────────────────────────────────────────
-- The guard in code (`modules/ads/guard/budgetGuard.ts`, A5) is the enforcer. One fence is also here,
-- because it is a fact about one row and costs one lookup: an `ads_actions` row of kind `launch`,
-- `raise_budget` or `change_area` must cite a standing approval of the same org, campaign and kind.
-- A bug in a code path therefore cannot launch without a person's approval on record, nor launch or
-- raise while the kill switch is on (AX021); it can only fail loudly.
--
-- ── STATES ARE A LIST HERE; TRANSITIONS ARE THE MACHINE'S ────────────────────────────────────────
-- `ads_campaigns.state` and `ads_creatives.state` are checked for membership only. Which move is
-- legal is `campaignMachine` in packages/shared (A3), enumerated exhaustively in its tests; restating
-- the transition table in a trigger would be a second copy that drifts (CLAUDE.md, "Deriving beats
-- restating"). What the database does hold is the invariant a transition table cannot: a creative's
-- content is frozen once it leaves the workers (AX030), so what a person approved is what runs, and a
-- campaign's brief is frozen at creation (AX031), so the claim check always reads the facts the ad
-- was made from.
--
-- ── THE SQLSTATE REGISTER (AX: free on main 2026-11-01; AD010 is taken) ──────────────────────────
--   AX010  append-only ledger row updated or deleted
--   AX011  a started row's completion changed something other than its outcome, or moved twice
--   AX012  a settings / brand-kit / preset version updated or deleted
--   AX020  launch / raise / area change without a standing approval of this org, campaign and kind
--   AX021  launch / raise while the newest settings version has the kill switch on
--   AX030  a creative's content changed, or it was reopened, after it left the workers
--   AX031  a campaign's brief, connection or settings version changed after creation
--
-- cross-module-waiver: section 12 restates messaging's `notification_events` category CHECK to add the
-- eight ads and lead categories, as every new category has (0521 for chat); the contract moves with it.
--
-- raw-access-waiver: `ads_spend_hourly` is raw (the platform's own numbers, as pulled) and this is its
-- owner's migration creating it; the ads module is its own collector (D-AD17).
--
-- ⚠ DEPLOY WINDOW: thirteen new tables and a widened CHECK. The only code in this PR is the shared
-- contract's category list, which nothing sends yet, so the CHECK widens before any writer exists
-- (0521's order). New tables are exempt from the two-merge rule.

-- ── 0. the one refusal both immutable kinds share ────────────────────────────────────────────────
create or replace function public.ads_refuse_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_argv[0] = 'version' then
    raise exception '% is versioned: save a new version instead of changing one', tg_table_name
      using errcode = 'AX012';
  end if;
  raise exception '% is append-only: a correction is a new row', tg_table_name using errcode = 'AX010';
end;
$$;

-- ── 1. settings, versioned (plan §4b) ────────────────────────────────────────────────────────────
-- Every save of the settings page is a row; the newest per org is in force. The kill switch is a
-- column here rather than a flag elsewhere so that ONE indexed read answers "may anything spend?",
-- and every flip carries its actor and its reason (§4b: "with the reason required"). `settings` is
-- validated by the shared contract before it is written; the database holds only what must never
-- be false.
create table if not exists public.ads_settings_versions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  version         integer not null check (version >= 1),
  settings        jsonb not null check (jsonb_typeof(settings) = 'object'),
  kill_switch     boolean not null default false,
  kill_reason     text check (kill_reason is null or length(btrim(kill_reason)) between 1 and 500),
  created_by      uuid not null,
  created_by_name text not null check (length(btrim(created_by_name)) between 1 and 200),
  created_at      timestamptz not null default now(),
  unique (org_id, version),
  unique (org_id, id),
  check (not kill_switch or kill_reason is not null)
);
alter table public.ads_settings_versions enable row level security;
drop trigger if exists trg_ads_settings_versions_immutable on public.ads_settings_versions;
create trigger trg_ads_settings_versions_immutable before update or delete on public.ads_settings_versions
  for each row execute function public.ads_refuse_change('version');
comment on table public.ads_settings_versions is
  'A2 (0537): every save of Settings > Ads control; the newest per org is in force, kill switch included. Immutable (AX012); RETENTION_FORBIDDEN. Service-role only.';

-- ── 2. brand kit and concept presets, versioned (D-AD10, D-AD11) ─────────────────────────────────
-- The parent row is the identity a person names and archives; every edit is a new version, and a
-- creative records the versions it was made under, so a past ad can always be explained.
create table if not exists public.ad_brand_kits (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, id)
);
alter table public.ad_brand_kits enable row level security;

create table if not exists public.ad_brand_kit_versions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  kit_id          uuid not null,
  version         integer not null check (version >= 1),
  -- Colours, fonts, overlay templates per format with their safe zones, the visual-rule checklist,
  -- and assets BY sha256 (the bytes live in storage, C1). Shape: the shared brand-kit contract (A3).
  kit             jsonb not null check (jsonb_typeof(kit) = 'object'),
  created_by      uuid not null,
  created_by_name text not null check (length(btrim(created_by_name)) between 1 and 200),
  created_at      timestamptz not null default now(),
  unique (kit_id, version),
  unique (org_id, id),
  foreign key (org_id, kit_id) references public.ad_brand_kits (org_id, id) on delete restrict
);
alter table public.ad_brand_kit_versions enable row level security;

create table if not exists public.ad_concept_presets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  -- A stable handle the owner recognises ("P1" … "P5"); the name may change in a version, this never.
  key         text not null check (key ~ '^[A-Z][A-Z0-9_]{0,15}$'),
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, key),
  unique (org_id, id)
);
alter table public.ad_concept_presets enable row level security;

create table if not exists public.ad_concept_preset_versions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  preset_id       uuid not null,
  version         integer not null check (version >= 1),
  -- On the version, not the preset, so switching a preset off is a recorded, attributed act too.
  enabled         boolean not null,
  -- The recipe: hook formula, copy structure, image-prompt template with named slots, motion and
  -- overlay templates, formats (D-AD11). The model fills the slots; it cannot change the recipe.
  recipe          jsonb not null check (jsonb_typeof(recipe) = 'object'),
  created_by      uuid not null,
  created_by_name text not null check (length(btrim(created_by_name)) between 1 and 200),
  created_at      timestamptz not null default now(),
  unique (preset_id, version),
  unique (org_id, id),
  foreign key (org_id, preset_id) references public.ad_concept_presets (org_id, id) on delete restrict
);
alter table public.ad_concept_preset_versions enable row level security;

drop trigger if exists trg_ad_brand_kit_versions_immutable on public.ad_brand_kit_versions;
create trigger trg_ad_brand_kit_versions_immutable before update or delete on public.ad_brand_kit_versions
  for each row execute function public.ads_refuse_change('version');
drop trigger if exists trg_ad_concept_preset_versions_immutable on public.ad_concept_preset_versions;
create trigger trg_ad_concept_preset_versions_immutable before update or delete on public.ad_concept_preset_versions
  for each row execute function public.ads_refuse_change('version');

-- ── 3. platform connections (sealed) ─────────────────────────────────────────────────────────────
-- One row per org × provider × sandbox. Meta's system-user token and the Page token derived from it
-- (workflow §1.2-3) are `secretBox` envelopes with AAD = org + purpose; the CHECK is the envelope's
-- shape (`v1.<key id>.<iv>.<tag>.<ciphertext>`, `seal` in apps/api/src/lib/secretBox.ts), so a
-- pasted plaintext token cannot be stored by any code path. `simulator` is the staging stand-in
-- (§4R); whether it may be used is decided in code from the environment, fail-closed (§1.2-8).
create table if not exists public.ads_platform_connections (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  provider          text not null check (provider in ('meta', 'tiktok', 'x', 'higgsfield', 'simulator')),
  is_sandbox        boolean not null default false,
  account_ref       text check (account_ref is null or length(btrim(account_ref)) between 1 and 200),
  page_ref          text check (page_ref is null or length(btrim(page_ref)) between 1 and 200),
  token_sealed      text check (token_sealed is null
                      or token_sealed ~ '^v[0-9]+\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  page_token_sealed text check (page_token_sealed is null
                      or page_token_sealed ~ '^v[0-9]+\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  token_expires_on  date,
  scopes            text[] not null default '{}',
  status            text not null default 'disconnected' check (status in ('disconnected', 'connected', 'failing')),
  last_test_at      timestamptz,
  last_test         jsonb,
  last_error        text,
  connected_by      uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, provider, is_sandbox),
  unique (org_id, id),
  check (status = 'disconnected' or provider = 'simulator' or token_sealed is not null),
  check (page_token_sealed is null or provider = 'meta')
);
alter table public.ads_platform_connections enable row level security;
comment on table public.ads_platform_connections is
  'A2 (0537): one per org x provider x sandbox. Tokens are secretBox envelopes (shape-checked) — never plaintext, never logged, never returned to the SPA. Service-role only.';

-- ── 4. campaigns ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.ads_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  connection_id       uuid not null,
  -- D-AD17: the brief's origin, opaque to ads (e.g. 'recruiting_opening' + '<id>@v<version>').
  brief_source        text not null check (brief_source ~ '^[a-z][a-z0-9_]{1,62}$'),
  brief_ref           text not null check (length(btrim(brief_ref)) between 1 and 200),
  -- The facts the copy may claim, frozen at creation (AX031): the claim check reads THIS, so a later
  -- change to the opening cannot make a live ad's figures wrong — it needs a new campaign.
  brief_snapshot      jsonb not null check (jsonb_typeof(brief_snapshot) = 'object'),
  name                text not null check (length(btrim(name)) between 1 and 200),
  state               text not null default 'draft' check (state in (
                        'draft', 'composing', 'review', 'approved', 'creating', 'paused',
                        'launching', 'live', 'pausing', 'archived', 'failed')),
  state_changed_at    timestamptz not null default now(),
  -- D-AD11: the seeded draw (seed, eligible preset versions, chosen order), so "why this preset" is
  -- answerable from the row.
  preset_draw         jsonb check (preset_draw is null or jsonb_typeof(preset_draw) = 'object'),
  -- The caps in force when the campaign was made; a launch re-reads the newest version.
  settings_version_id uuid not null,
  daily_budget_cents  bigint check (daily_budget_cents is null or daily_budget_cents > 0),
  lifetime_cap_cents  bigint check (lifetime_cap_cents is null or lifetime_cap_cents > 0),
  platform_refs       jsonb not null default '{}'::jsonb check (jsonb_typeof(platform_refs) = 'object'),
  platform_status     text,
  last_error          text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, connection_id) references public.ads_platform_connections (org_id, id) on delete restrict,
  foreign key (org_id, settings_version_id) references public.ads_settings_versions (org_id, id) on delete restrict
);
alter table public.ads_campaigns enable row level security;
-- The orchestrator's tick: every campaign of an org not at rest.
create index if not exists ix_ads_campaigns_active on public.ads_campaigns (org_id, state)
  where state not in ('archived', 'failed');

create or replace function public.guard_ads_campaigns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.brief_source <> old.brief_source or new.brief_ref <> old.brief_ref
     or new.brief_snapshot <> old.brief_snapshot or new.connection_id <> old.connection_id
     or new.settings_version_id <> old.settings_version_id or new.created_at <> old.created_at then
    raise exception 'ads_campaigns: the brief, connection and settings version are fixed at creation — make a new campaign'
      using errcode = 'AX031';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_ads_campaigns on public.ads_campaigns;
create trigger trg_guard_ads_campaigns before update on public.ads_campaigns
  for each row execute function public.guard_ads_campaigns();

-- ── 5. creatives ─────────────────────────────────────────────────────────────────────────────────
-- One per preset per campaign (plan v4), plus a new row for each "Regenerate this one" / "Edit copy",
-- which names the creative it supersedes. The workers fill a creative while it is `generating` or
-- `checking`; from then on its content is frozen (AX030) and only its state and platform fields move.
create table if not exists public.ads_creatives (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  campaign_id          uuid not null,
  preset_version_id    uuid not null,
  -- Null when no brand kit exists yet (G3's fallback: no logo overlay).
  brand_kit_version_id uuid,
  supersedes_id        uuid,
  state                text not null default 'generating' check (state in (
                         'generating', 'checking', 'check_failed', 'ready', 'approved', 'rejected',
                         'live', 'paused', 'archived')),
  copy                 jsonb check (copy is null or jsonb_typeof(copy) = 'object'),
  -- One entry per format: { format, sha256, path, width, height }.
  assets               jsonb not null default '[]'::jsonb check (jsonb_typeof(assets) = 'array'),
  -- The three checks of D-AD12 (copy, visual, render), each with its verdict and reasons.
  checks               jsonb check (checks is null or jsonb_typeof(checks) = 'object'),
  regenerations        smallint not null default 0 check (regenerations between 0 and 5),
  platform_refs        jsonb not null default '{}'::jsonb check (jsonb_typeof(platform_refs) = 'object'),
  platform_status      text,
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, id),
  -- A creative a person could approve has everything a person must see.
  check (state not in ('ready', 'approved', 'live', 'paused')
         or (copy is not null and checks is not null and jsonb_array_length(assets) > 0)),
  foreign key (org_id, campaign_id) references public.ads_campaigns (org_id, id) on delete restrict,
  foreign key (org_id, preset_version_id) references public.ad_concept_preset_versions (org_id, id) on delete restrict,
  foreign key (org_id, brand_kit_version_id) references public.ad_brand_kit_versions (org_id, id) on delete restrict,
  foreign key (org_id, supersedes_id) references public.ads_creatives (org_id, id) on delete restrict
);
alter table public.ads_creatives enable row level security;
create index if not exists ix_ads_creatives_campaign on public.ads_creatives (org_id, campaign_id, created_at);

create or replace function public.guard_ads_creatives()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.campaign_id <> old.campaign_id or new.preset_version_id <> old.preset_version_id
     or new.brand_kit_version_id is distinct from old.brand_kit_version_id
     or new.supersedes_id is distinct from old.supersedes_id or new.created_at <> old.created_at then
    raise exception 'ads_creatives: a creative''s campaign, preset, brand kit and lineage never change'
      using errcode = 'AX030';
  end if;
  if old.state not in ('generating', 'checking') then
    if new.state in ('generating', 'checking') then
      raise exception 'ads_creatives: a creative that left the workers is never reopened — regenerate as a new creative'
        using errcode = 'AX030';
    end if;
    if new.copy is distinct from old.copy or new.assets <> old.assets
       or new.checks is distinct from old.checks or new.regenerations <> old.regenerations then
      raise exception 'ads_creatives: content is frozen once it leaves the workers — what a person approved is what runs'
        using errcode = 'AX030';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_ads_creatives on public.ads_creatives;
create trigger trg_guard_ads_creatives before update on public.ads_creatives
  for each row execute function public.guard_ads_creatives();

-- ── 6. approvals (append-only) ───────────────────────────────────────────────────────────────────
-- A person's yes (or no) to one thing the agent may not do alone (plan §5). A withdrawal is a new
-- row naming the one it withdraws; nothing is edited.
create table if not exists public.ads_approvals (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  campaign_id         uuid not null,
  creative_id         uuid,
  kind                text not null check (kind in (
                        'approve_creative', 'reject_creative', 'launch', 'raise_budget', 'change_area', 'withdraw')),
  daily_budget_cents  bigint check (daily_budget_cents is null or daily_budget_cents > 0),
  lifetime_cap_cents  bigint check (lifetime_cap_cents is null or lifetime_cap_cents > 0),
  withdraws_id        uuid,
  -- The caps in force when the person said yes.
  settings_version_id uuid not null,
  reason              text check (reason is null or length(btrim(reason)) between 1 and 1000),
  approved_by         uuid not null,
  approved_by_name    text not null check (length(btrim(approved_by_name)) between 1 and 200),
  created_at          timestamptz not null default now(),
  unique (org_id, id),
  check (kind not in ('launch', 'raise_budget') or daily_budget_cents is not null),
  check ((kind = 'withdraw') = (withdraws_id is not null)),
  check (kind not in ('approve_creative', 'reject_creative') or creative_id is not null),
  foreign key (org_id, campaign_id) references public.ads_campaigns (org_id, id) on delete restrict,
  foreign key (org_id, creative_id) references public.ads_creatives (org_id, id) on delete restrict,
  foreign key (org_id, withdraws_id) references public.ads_approvals (org_id, id) on delete restrict,
  foreign key (org_id, settings_version_id) references public.ads_settings_versions (org_id, id) on delete restrict
);
alter table public.ads_approvals enable row level security;
create index if not exists ix_ads_approvals_campaign on public.ads_approvals (org_id, campaign_id, kind, created_at desc);
drop trigger if exists trg_ads_approvals_append_only on public.ads_approvals;
create trigger trg_ads_approvals_append_only before update or delete on public.ads_approvals
  for each row execute function public.ads_refuse_change('ledger');

-- ── 7. actions (append-only, one completion) ─────────────────────────────────────────────────────
-- Every act that can move money or delivery, and every state transition, written BEFORE the vendor
-- call (`started`) and completed after it. `refused` is the guard saying no before any call, which
-- is recorded too — a refusal nobody can see is a cap nobody can trust. `request` is what was sent,
-- redacted by the client (never a token).
create table if not exists public.ads_actions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  campaign_id     uuid,
  creative_id     uuid,
  connection_id   uuid,
  kind            text not null check (kind in (
                    'transition', 'create_paused', 'launch', 'pause', 'lower_budget', 'raise_budget',
                    'change_area', 'archive', 'kill', 'external_change', 'rules_sync', 'connection_test',
                    'reconcile')),
  actor_kind      text not null check (actor_kind in ('person', 'agent', 'platform')),
  actor_id        uuid,
  actor_name      text not null check (length(btrim(actor_name)) between 1 and 200),
  approval_id     uuid,
  -- Why: the rule that paused, the kill reason, the state the transition left.
  cause           text check (cause is null or length(cause) <= 1000),
  idempotency_key text check (idempotency_key is null or length(btrim(idempotency_key)) between 1 and 200),
  request         jsonb not null default '{}'::jsonb,
  status          text not null default 'started' check (status in ('started', 'succeeded', 'failed', 'refused')),
  response        jsonb,
  error_code      text,
  platform_refs   jsonb,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  unique (org_id, id),
  unique (org_id, idempotency_key),
  check ((status = 'started') = (finished_at is null)),
  check ((actor_kind = 'person') = (actor_id is not null)),
  foreign key (org_id, campaign_id) references public.ads_campaigns (org_id, id) on delete restrict,
  foreign key (org_id, creative_id) references public.ads_creatives (org_id, id) on delete restrict,
  foreign key (org_id, connection_id) references public.ads_platform_connections (org_id, id) on delete restrict,
  foreign key (org_id, approval_id) references public.ads_approvals (org_id, id) on delete restrict
);
alter table public.ads_actions enable row level security;
create index if not exists ix_ads_actions_campaign on public.ads_actions (org_id, campaign_id, started_at desc);
-- The reconcile's and the failed-jobs page's read: what was started and never finished.
create index if not exists ix_ads_actions_open on public.ads_actions (org_id, started_at) where status = 'started';

-- AX020: the database's own fence. Only for an act actually attempted — a `refused` row is the guard
-- recording that it said no, and must be writable precisely when there is no approval.
create or replace function public.guard_ads_actions_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind in ('launch', 'raise_budget', 'change_area') and new.status <> 'refused' then
    if new.approval_id is null or new.campaign_id is null or not exists (
         select 1 from public.ads_approvals a
          where a.id = new.approval_id and a.org_id = new.org_id
            and a.campaign_id = new.campaign_id and a.kind = new.kind
            and not exists (select 1 from public.ads_approvals w
                             where w.org_id = a.org_id and w.withdraws_id = a.id)) then
      raise exception 'ads_actions: % needs a standing approval of this campaign and kind', new.kind
        using errcode = 'AX020';
    end if;
  end if;
  -- The kill switch is the newest settings version's; nothing that spends more starts while it is on.
  if new.kind in ('launch', 'raise_budget') and new.status <> 'refused' and coalesce((
       select v.kill_switch from public.ads_settings_versions v
        where v.org_id = new.org_id order by v.version desc limit 1), false) then
    raise exception 'ads_actions: the kill switch is on — % refused', new.kind using errcode = 'AX021';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_ads_actions_insert on public.ads_actions;
create trigger trg_guard_ads_actions_insert before insert on public.ads_actions
  for each row execute function public.guard_ads_actions_insert();

create or replace function public.guard_ads_actions_complete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ads_actions is append-only: a correction is a new row' using errcode = 'AX010';
  end if;
  if old.status <> 'started' or new.status not in ('succeeded', 'failed')
     or (to_jsonb(new) - array['status', 'response', 'error_code', 'platform_refs', 'finished_at'])
        <> (to_jsonb(old) - array['status', 'response', 'error_code', 'platform_refs', 'finished_at']) then
    raise exception 'ads_actions: a started action completes once, and only its outcome is written'
      using errcode = 'AX011';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_ads_actions_complete on public.ads_actions;
create trigger trg_guard_ads_actions_complete before update or delete on public.ads_actions
  for each row execute function public.guard_ads_actions_complete();

-- ── 8. generations (append-only, one completion) — the ads module's AI provenance (D-AD13) ────────
-- Every Claude and Higgsfield call: which agent, which prompt version, which model, the input hash,
-- the idempotency key (= this row's purpose, so a replay spends nothing), the cost, the stored
-- asset. `budget_exhausted` is written instead of a call when the month's budget is spent.
create table if not exists public.ad_generations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  campaign_id         uuid,
  creative_id         uuid,
  agent               text not null check (agent ~ '^[a-z][a-z_]{1,40}$'),
  provider            text not null check (provider in ('anthropic', 'higgsfield', 'internal')),
  model               text check (model is null or length(btrim(model)) between 1 and 120),
  prompt_version      text check (prompt_version is null or length(btrim(prompt_version)) between 1 and 120),
  input_hash          text check (input_hash is null or input_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key     text not null check (length(btrim(idempotency_key)) between 1 and 200),
  request             jsonb not null default '{}'::jsonb,
  status              text not null default 'started' check (status in ('started', 'succeeded', 'failed', 'budget_exhausted')),
  output              jsonb,
  provider_request_id text,
  cost_units          numeric(14, 4) check (cost_units is null or cost_units >= 0),
  cost_unit           text check (cost_unit is null or cost_unit in ('tokens', 'credits')),
  asset_sha256        text check (asset_sha256 is null or asset_sha256 ~ '^[0-9a-f]{64}$'),
  asset_path          text,
  error_code          text,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  unique (org_id, id),
  unique (org_id, idempotency_key),
  check ((status = 'started') = (finished_at is null)),
  check ((cost_units is null) = (cost_unit is null)),
  foreign key (org_id, campaign_id) references public.ads_campaigns (org_id, id) on delete restrict,
  foreign key (org_id, creative_id) references public.ads_creatives (org_id, id) on delete restrict
);
alter table public.ad_generations enable row level security;
create index if not exists ix_ad_generations_creative on public.ad_generations (org_id, creative_id, started_at);
-- The monthly budget fold reads a month of an org's generations.
create index if not exists ix_ad_generations_month on public.ad_generations (org_id, provider, started_at);

create or replace function public.guard_ad_generations_complete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ad_generations is append-only: a correction is a new row' using errcode = 'AX010';
  end if;
  if old.status <> 'started' or new.status not in ('succeeded', 'failed')
     or (to_jsonb(new) - array['status', 'output', 'provider_request_id', 'cost_units', 'cost_unit',
                               'asset_sha256', 'asset_path', 'error_code', 'finished_at'])
        <> (to_jsonb(old) - array['status', 'output', 'provider_request_id', 'cost_units', 'cost_unit',
                                  'asset_sha256', 'asset_path', 'error_code', 'finished_at']) then
    raise exception 'ad_generations: a started generation completes once, and only its outcome is written'
      using errcode = 'AX011';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_ad_generations_complete on public.ad_generations;
create trigger trg_guard_ad_generations_complete before update or delete on public.ad_generations
  for each row execute function public.guard_ad_generations_complete();

-- ── 9. outcome events (append-only, send result) — what we tell a platform (D-AD14) ──────────────
-- One row per stage a lead reached, from the `LeadSink`'s stage row (`source_event_ref` = the
-- Conversions API `event_id`, so a replay can never double-send). It carries the platform's lead id
-- and the stage, nothing about the person.
create table if not exists public.ads_outcome_events (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  campaign_id       uuid,
  provider          text not null check (provider in ('meta', 'tiktok', 'x')),
  platform_lead_ref text not null check (length(btrim(platform_lead_ref)) between 1 and 200),
  stage             text not null check (stage in ('contacted', 'qualified', 'applied', 'hired', 'lost')),
  source_event_ref  text not null check (length(btrim(source_event_ref)) between 1 and 200),
  status            text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts          smallint not null default 0 check (attempts between 0 and 20),
  response          jsonb,
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  unique (org_id, provider, source_event_ref),
  check ((status = 'sent') = (sent_at is not null)),
  foreign key (org_id, campaign_id) references public.ads_campaigns (org_id, id) on delete restrict
);
alter table public.ads_outcome_events enable row level security;
create index if not exists ix_ads_outcome_events_due on public.ads_outcome_events (org_id, created_at)
  where status in ('queued', 'failed');

create or replace function public.guard_ads_outcome_events()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ads_outcome_events is append-only: a correction is a new row' using errcode = 'AX010';
  end if;
  -- queued → any result; a failed send may be retried; a sent or skipped event is final.
  if old.status not in ('queued', 'failed') or new.status = 'queued'
     or (to_jsonb(new) - array['status', 'attempts', 'response', 'sent_at'])
        <> (to_jsonb(old) - array['status', 'attempts', 'response', 'sent_at']) then
    raise exception 'ads_outcome_events: only a queued or failed event is sent, and only its send result is written'
      using errcode = 'AX011';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_ads_outcome_events on public.ads_outcome_events;
create trigger trg_guard_ads_outcome_events before update or delete on public.ads_outcome_events
  for each row execute function public.guard_ads_outcome_events();

-- ── 10. spend by hour (pulled; re-derivable) ─────────────────────────────────────────────────────
-- What the platform reported for a campaign's hour, in its currency's minor unit. Re-pulled until the
-- platform's numbers settle, so rows are rewritten by a set-based UPDATE-or-INSERT (B5), never a
-- partial upsert (`lint:upserts`). The D-AD5 fold sums these; the settings page and the ads page
-- read the same fold, so they cannot disagree.
create table if not exists public.ads_spend_hourly (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  hour        timestamptz not null check (date_trunc('hour', hour at time zone 'UTC') = hour at time zone 'UTC'),
  spend_cents bigint not null default 0 check (spend_cents >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks      bigint not null default 0 check (clicks >= 0),
  leads       integer not null default 0 check (leads >= 0),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  pulled_at   timestamptz not null default now(),
  primary key (campaign_id, hour),
  foreign key (org_id, campaign_id) references public.ads_campaigns (org_id, id) on delete restrict
);
alter table public.ads_spend_hourly enable row level security;
create index if not exists ix_ads_spend_hourly_org_hour on public.ads_spend_hourly (org_id, hour);

-- ── 11. the mutable tables: updated_at and an org that never changes ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['ad_brand_kits', 'ad_concept_presets', 'ads_platform_connections',
                           'ads_campaigns', 'ads_creatives'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                      for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['ad_brand_kits', 'ad_concept_presets', 'ads_platform_connections',
                           'ads_campaigns', 'ads_creatives', 'ads_spend_hourly'] loop
    execute format('drop trigger if exists trg_%1$s_org_immutable on public.%1$I', t);
    execute format('create trigger trg_%1$s_org_immutable before update on public.%1$I
                      for each row execute function public.forbid_org_change()', t);
  end loop;
end;
$$;

-- ── 12. the bell's eight categories (plan §4.3) ──────────────────────────────────────────────────
-- 0521's list restated whole, plus the six ads alerts and the two lead alerts recruiting will send
-- (D1/D2). Widened before any writer, with `NOTIFICATION_CATEGORIES` in the same PR.
alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received', 'duty_auto_closed',
  'performance_week', 'training_due', 'system', 'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale',
  'dq_expiring', 'dq_expired', 'dq_missing', 'dq_license_status', 'dq_mvr_received',
  'application_stalled', 'application_ready_to_screen', 'card_status_changed', 'drug_alcohol_result',
  'roadside_feed_stale', 'medstop_connection', 'roadside_repair_due', 'roadside_report_needs_review',
  'unit_file_expiring', 'unit_file_expired',
  'chat_mention', 'chat_reply',
  'ads_overspend', 'ads_rejected', 'ads_no_leads', 'ads_external_change', 'ads_token_expiring', 'ads_brief',
  'lead_new', 'lead_uncontacted'
));

-- ── grants: no client may call these ─────────────────────────────────────────────────────────────
revoke all on function public.ads_refuse_change() from public, anon, authenticated;
revoke all on function public.guard_ads_campaigns() from public, anon, authenticated;
revoke all on function public.guard_ads_creatives() from public, anon, authenticated;
revoke all on function public.guard_ads_actions_insert() from public, anon, authenticated;
revoke all on function public.guard_ads_actions_complete() from public, anon, authenticated;
revoke all on function public.guard_ad_generations_complete() from public, anon, authenticated;
revoke all on function public.guard_ads_outcome_events() from public, anon, authenticated;
