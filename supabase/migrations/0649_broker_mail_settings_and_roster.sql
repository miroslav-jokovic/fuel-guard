-- Silvicom 360 — 0649 broker mail P2: the company's setting, the admin's mailbox roster, "left out on purpose"
-- (docs/plans/dispatch-loads/BROKER-MAIL-READER-PLAN.md §9 P2, D-BMR5, D-BMR14, Q-BMR11)
--
-- P2 is the first time a PERSON reads what the gateway wrote (0643): the Broker mail page, and
-- Settings › Broker mail with the admin's mailbox list. This migration adds the three things those
-- screens need that the database must own.
--
-- ── 1. WHY THE ROSTER IS A FUNCTION, AND WHY THE DERIVED LIST NOW READS IT ───────────────────────
-- The admin's list has to answer "why is Aneta's mailbox not read?" — not linked to a 360 user, not
-- a member, suspended, a sign-in address outside our mail domains, or left out on purpose. Each of
-- those is a clause of D-BMR5, which 0643 wrote once, inside `mailgw_derived_mailboxes`. Writing the
-- reasons again in the API would be a second copy of the rule that decides whose mail is read, and
-- the first time one copy changed the admin would be told something the gateway does not do. So the
-- rule moves into ONE function that gives every active, non-system McLeod dispatcher a `reason`
-- (null = read), and the derived list becomes "the roster rows whose reason is null". Same signature,
-- same answer: the 0643 matrix's "derived list = Ann only" case runs unchanged against the new body.
--
-- ── 2. WHY broker_mail_settings HOLDS ONE VALUE IN P2 ────────────────────────────────────────────
-- §6.3 of the analysis names the company row (on/off, first time, second time). Only the first time
-- means anything before the texts exist (P3): the page marks a row past it. A switch and a backup
-- time that changed nothing for weeks would be settings that lie, so they arrive with the texts that
-- read them, as added columns. The gateway's own switches (`enabled`, `body_reading`) stay on
-- `mail_gateway_config` and stay owner-run (`infra/mail-gateway/db-login.sh on|off|body`): turning
-- mail reading on is an act on Microsoft's side as well as ours, and the page only shows them.
--
-- ── 3. WHY "LEAVE OUT" IS A FUNCTION ─────────────────────────────────────────────────────────────
-- Q-BMR11: an admin may leave a linked dispatcher out of mail reading on purpose; audited, shown as
-- a choice and never as a refusal. One atomic array edit, refused for a user who is not a member of
-- the config row's org, so a bad id cannot sit in the list unseen. The API writes the audit row.
--
-- raw-access-waiver: `mailgw_mailbox_roster` reads mcleod's raw `tms_dispatchers`, as 0643's derived
-- list did, in one statement and read-only (D-BMR5: the list must live in the database).
-- cross-module-waiver: the roster READS org's `memberships` and mcleod's `tms_dispatchers`; the
-- functions WRITE only broker-mail's `mail_gateway_config`.
--
-- Old code meets this safely: a new table, two new functions, and a body change of a function whose
-- result is identical. Rollback: restore 0643's body of `mailgw_derived_mailboxes`, then
-- `drop function mailgw_mailbox_roster(uuid), broker_mail_set_left_out(uuid, uuid, boolean);
-- drop table broker_mail_settings;`.

-- ── 1. the company row ──────────────────────────────────────────────────────────────────────────
create table if not exists broker_mail_settings (
  org_id                 uuid primary key references organizations(id) on delete cascade,
  -- A broker email unanswered longer than this is overdue on the page; from P3, the dispatcher's
  -- text goes at this time too (Q-BM7 default 20). Five minutes is the floor: under it the gateway's
  -- one-minute cycle and Outlook's own delay make "overdue" a coin toss.
  answer_within_minutes  int not null default 20 check (answer_within_minutes between 5 and 240),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id) on delete set null
);
alter table broker_mail_settings enable row level security;
comment on table broker_mail_settings is
  '0649 (BROKER-MAIL-READER-PLAN P2): one row per org, written from Settings › Broker mail by an admin. P2 holds only answer_within_minutes; P3 adds the text switches as columns. No row = the defaults. Service-role only.';

-- ── 2. the roster: every McLeod dispatcher, and why their mailbox is or is not read ─────────────
-- One row per linked 360 user (two McLeod logins of one person are one row, as in 0643), plus one
-- row per McLeod login linked to nobody. `reason` null = the gateway reads this mailbox. The order of
-- the reasons is the order an admin fixes them in: membership before address before choice.
create or replace function mailgw_mailbox_roster(p_org uuid)
returns table (user_id uuid, mcleod_logins text[], email text, reason text)
language sql stable security definer set search_path = ''
as $$
  with d as (
    select t.user_id, t.external_id
      from public.tms_dispatchers t
     where t.org_id = p_org and t.is_active and not t.is_system
  ),
  c as (
    select mail_domains, excluded_user_ids from public.mail_gateway_config where org_id = p_org
  )
  select d.user_id,
         array_agg(d.external_id order by d.external_id),
         lower(u.email)::text,
         case
           when m.user_id is null then 'not_member'
           when m.suspended_at is not null then 'suspended'
           when u.email is null then 'no_email'
           -- No config row, or empty mail_domains: nobody is read (Q-BMR10 fails closed).
           when not exists (select 1 from c, unnest(c.mail_domains) x
                             where lower(x) = split_part(lower(u.email), '@', 2)) then 'other_domain'
           when exists (select 1 from c where d.user_id = any (c.excluded_user_ids)) then 'left_out'
         end
    from d
    join auth.users u on u.id = d.user_id
    left join public.memberships m on m.user_id = d.user_id and m.org_id = p_org
   where d.user_id is not null
   group by d.user_id, u.email, m.user_id, m.suspended_at
  union all
  select null::uuid, array[d.external_id], null::text, 'not_linked'
    from d
   where d.user_id is null;
$$;

-- D-BMR5, now read from the roster rather than restated (header §1). Signature and grants unchanged.
create or replace function mailgw_derived_mailboxes(p_org uuid)
returns table (mailbox text, owner_user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select r.email, r.user_id
    from public.mailgw_mailbox_roster(p_org) r
   where r.reason is null
   order by r.user_id;
$$;

-- ── 3. leave a dispatcher out on purpose, or take them back (Q-BMR11) ───────────────────────────
-- Returns the list after the change. Refuses (P0002) without a config row for this org, and (22023)
-- for a user who is not a member of it.
create or replace function broker_mail_set_left_out(p_org uuid, p_user uuid, p_left_out boolean)
returns uuid[]
language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid[];
begin
  if not exists (select 1 from public.memberships where org_id = p_org and user_id = p_user) then
    raise exception 'broker mail: % is not a member of this org', p_user using errcode = '22023';
  end if;
  update public.mail_gateway_config
     set excluded_user_ids = case
           when p_left_out then array(select distinct x from unnest(array_append(excluded_user_ids, p_user)) x order by x)
           else array_remove(excluded_user_ids, p_user)
         end,
         updated_at = now()
   where org_id = p_org
  returning excluded_user_ids into v;
  if not found then raise exception 'broker mail: no mail gateway config for this org' using errcode = 'P0002'; end if;
  return v;
end $$;

-- ── 4. grants: the API's service role only; the gateway login reaches neither ───────────────────
revoke all on function mailgw_mailbox_roster(uuid) from public, anon, authenticated, service_role;
revoke all on function broker_mail_set_left_out(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function mailgw_mailbox_roster(uuid) to service_role;
grant execute on function broker_mail_set_left_out(uuid, uuid, boolean) to service_role;
