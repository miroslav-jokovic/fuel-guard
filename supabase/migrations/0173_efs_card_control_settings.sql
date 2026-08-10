-- 0173 — who may change a fuel card, and whether EFS will even let us.
--
-- WHAT THIS IS FOR. Reading cards (0171) is safe and ships on its own. CHANGING one is not: a
-- setCardV2 is a full-document write that EFS accepts without complaint even when it silently deletes
-- a driver assignment, and an override is free fuel. This table is the set of facts that must ALL be
-- true before any of that is reachable.
--
-- WHY write_entitlement IS A COLUMN AND NOT AN ASSUMPTION. The WEX guide documents the write
-- operations but says nothing about which service accounts may call them, and nobody has confirmed
-- ours can. Rather than find out in production, the entitlement is a recorded fact with three states,
-- set only by running the probe against the QA endpoint first and production second. 'unknown' is the
-- default and behaves exactly like 'denied' at the gate — the difference is only what the UI says,
-- because "an admin needs to run the write check" and "EFS has not enabled this for your account"
-- send a person to two different places.
--
-- The probe has to prove SIX things, not one, and the sixth is the one that matters: after a NO-OP
-- echo, a follow-up getCardv2 must return the SAME cardVersion. setCardV2 can succeed while our echo
-- has quietly stripped an <infos> record — a write that "worked" and destroyed data. If the version
-- moves after a no-op, the gate fails even though EFS said yes.
--
-- WHY require_approver DEFAULTS TO TRUE. rolesThatManage('fuel') is admin + fleet_manager, and a
-- forty-truck fleet has three or four fleet managers. Switching card control on must not silently
-- hand write access to all of them; an admin has to name at least one person, which is itself an
-- audited act. `scopes` exists because the most-requested split is real: let a yard manager lock a
-- stolen card at 2am without letting them grant fuel exceptions.
--
-- WHY THERE IS NO MODULE KEY. Card control is not a separate product; it is what the EFS integration
-- the customer already pays for does once EFS allows it. Gating on entitlements.MODULE_KEYS would
-- mean a customer with SOAP wired up and write access confirmed still gets a `module_disabled` 403
-- for an unrelated reason. The gate is four ANDed facts instead — EFS_CARD_CONTROL_ENABLED (deploy),
-- efs_soap_credentials.enabled, this table's `enabled`, and write_entitlement = 'confirmed'. If
-- commercial gating is ever wanted a module key becomes a fifth AND and nothing else changes; this
-- omission is a decision, not an oversight.
--
-- RLS: enabled, no policies. Service-role only, same posture as 0091 / 0106 / 0171. These rows decide
-- who may spend money; they are not editable through PostgREST by anyone, however senior.

create table if not exists efs_card_control_settings (
  org_id            uuid primary key references organizations(id) on delete cascade,
  -- Org opt-in. Default OFF: reading cards must never imply permission to change them.
  enabled           boolean not null default false,
  write_entitlement text not null default 'unknown'
                      check (write_entitlement in ('unknown','confirmed','denied')),
  -- The full probe result, redacted: six step outcomes, fault codes, the observed success shape of a
  -- setCardV2 (the guide says a successful call "may or may not return a specific response", p9, so
  -- the classifier is tightened to whatever the probe actually saw). Never contains a card number.
  probe_result      jsonb,
  probed_at         timestamptz,
  probed_by         uuid references auth.users(id) on delete set null,
  require_approver  boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Named individuals, on top of the role. Both must hold.
create table if not exists efs_card_control_approvers (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Subset of ('lock','unlock','override','prompts'). Unlocking is the safe direction and is often
  -- granted more widely than the ability to grant an exception.
  scopes     text[] not null default array['lock','unlock','override','prompts'],
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (org_id, user_id),
  constraint efs_card_control_approver_scopes_valid
    check (scopes <@ array['lock','unlock','override','prompts']::text[] and array_length(scopes, 1) >= 1)
);

create index if not exists idx_efs_card_approvers_user on efs_card_control_approvers (user_id);

alter table efs_card_control_settings enable row level security;
alter table efs_card_control_approvers enable row level security;
-- NO POLICIES on either. See the header.

drop trigger if exists trg_efs_card_control_settings_updated on efs_card_control_settings;
create trigger trg_efs_card_control_settings_updated before update
  on efs_card_control_settings
  for each row execute function set_updated_at();
