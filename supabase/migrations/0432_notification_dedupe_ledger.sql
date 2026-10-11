-- 0432 — the notification dedupe ledger leaves the inbox (DATA-LIFECYCLE-PLAN Q11, ruled (b) 2026-10-05).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
-- `notification_events` was two things with opposite lifecycles in one table:
--   • an INBOX — the bell lists the newest 100 per person, and nothing reads a row weeks old;
--   • an IDEMPOTENCY LEDGER — `uq_notification_dedupe` makes "one buzz per fact" true, and three
--     schedulers decide what is NEW by asking which `dedupe_key`s already exist
--     (`dqAlertScheduler.sentKeys`, `fuelSweepFreshness.alreadySent`, `financialFreshness.alreadySent`).
-- So the inbox could never be pruned: delete a row and its alert re-arms. Measured 2026-10-05: 3,182
-- rows since 08-09 (every one keyed), ~2,100 in 30 days, 590 in the busiest inbox. The same argument
-- D-LIFE4 made for `audit_logs` — split by what the row IS, not by age.
--
-- And the ledger reads were unbounded: `sentKeys` selected every `dq:%` row (400 on 10-05, one per
-- recipient) and PostgREST answers at most 1,000. Past that the scheduler sees a truncated set and
-- re-sends expiries it already sent. `notification_keys_sent` below returns ONE row — an array — so
-- the cap cannot apply, and the caller passes the keys it is asking about instead of reading them all.
--
-- ── SHAPE ────────────────────────────────────────────────────────────────────────────────────────
-- `notification_dedupe_keys (org_id, audience_user_id, dedupe_key, first_sent_at)`. Per RECIPIENT,
-- because that is what `uq_notification_dedupe` guarantees today and what `emit_notification`
-- callers rely on: the same key to six office users is six rows, a retry of any one is a no-op.
-- No FK to `notification_events`: outliving the event is the point. FKs to organizations and
-- auth.users cascade, so an org or a login going takes its keys with it (nothing to re-arm for).
--
-- `emit_notification` now claims the key HERE first; only a fresh claim writes the event. Same
-- transaction, so a failed event insert un-claims. `uq_notification_dedupe` stays as a second guard:
-- an emit that raced this migration's backfill (old function, committed after our snapshot) is
-- caught by it, and the result is still exactly one row.
--
-- Semantics are UNCHANGED on purpose: a suppressed emit (module off, muted, quiet hours) claims no
-- key, exactly as it wrote no event before. Measured 2026-10-05: zero notification_preferences rows
-- in production, so mutes and quiet hours suppress nothing today.
--
-- ── WHAT WAS REJECTED ────────────────────────────────────────────────────────────────────────────
-- (a) Prune only events whose key encodes a non-recurring instance (job id, day, hour): leaves the
--     1,000-row defect, and needs a per-category list kept in step with every new alert.
-- An org-level ledger (one row per key, not per recipient): would change what a retry to ONE user
--     means; not this migration's call.
--
-- ── DEPLOY WINDOW ────────────────────────────────────────────────────────────────────────────────
-- New table + backfill + a `create or replace` of a function whose signature does not change, plus
-- one new function. The readers move to the ledger in a SEPARATE, later merge (a new table is
-- exempt from lint:migration-ordering, but staging can serve a merge before migrate-staging applies
-- it, so the reader waits by hand). Between the two, old readers still read `notification_events`,
-- which still carries every key — nothing is pruned until that later merge adds the rule.
--
-- Rollback: restore 0154's `emit_notification` body; drop `notification_keys_sent`; drop the table.
-- No event row is changed or deleted here.

create table if not exists public.notification_dedupe_keys (
  org_id           uuid not null references public.organizations(id) on delete cascade,
  audience_user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key       text not null,
  first_sent_at    timestamptz not null default now(),
  primary key (org_id, audience_user_id, dedupe_key)
);
-- The schedulers' question is per ORG ("did anyone get this key?"), which the PK cannot answer
-- without scanning every user's keys.
create index if not exists idx_notification_dedupe_keys_org_key
  on public.notification_dedupe_keys (org_id, dedupe_key);

alter table public.notification_dedupe_keys enable row level security;
-- No policies: service role only. A browser has no reason to know which alerts were ever sent.

comment on table public.notification_dedupe_keys is
  'Idempotency ledger for notify(): one row per (org, recipient, dedupe_key) ever emitted. Outlives notification_events so the inbox can be pruned without re-arming alerts (0432, DATA-LIFECYCLE-PLAN Q11).';

insert into public.notification_dedupe_keys (org_id, audience_user_id, dedupe_key, first_sent_at)
select org_id, audience_user_id, dedupe_key, min(created_at)
  from public.notification_events
 where dedupe_key is not null
 group by org_id, audience_user_id, dedupe_key
on conflict do nothing;

-- The retention scan (`org_id = $1 and created_at < cutoff`, oldest first) once a rule exists. The
-- only index today leads with audience_user_id.
create index if not exists idx_notification_events_org_created
  on public.notification_events (org_id, created_at);

create or replace function public.emit_notification(
  p_org uuid,
  p_user uuid,
  p_category text,
  p_title text,
  p_body text default null,
  p_severity text default 'info',
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_deep_link text default null,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_claimed int;
begin
  if not public.notification_allowed(p_org, p_user, p_category, p_severity) then
    return null;
  end if;
  if p_dedupe_key is not null then
    insert into public.notification_dedupe_keys (org_id, audience_user_id, dedupe_key)
    values (p_org, p_user, p_dedupe_key)
    on conflict do nothing;
    get diagnostics v_claimed = row_count;
    if v_claimed = 0 then
      return null; -- already sent to this person: one buzz per fact
    end if;
  end if;
  insert into public.notification_events
    (org_id, audience_user_id, category, title, body, severity, entity_type, entity_id, deep_link, dedupe_key)
  values
    (p_org, p_user, p_category, p_title, p_body, p_severity, p_entity_type, p_entity_id, p_deep_link, p_dedupe_key)
  on conflict (org_id, audience_user_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.emit_notification(uuid, uuid, text, text, text, text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.emit_notification(uuid, uuid, text, text, text, text, text, uuid, text, text)
  to service_role;

-- "Which of these keys has this org already sent?" One row back, an array, so PostgREST's 1,000-row
-- cap cannot truncate the answer. `p_since` lets a caller ignore keys first sent before a date —
-- the DQ planner's transition off its old key format uses it (see dqAlerts.ts).
create or replace function public.notification_keys_sent(
  p_org uuid,
  p_keys text[],
  p_since timestamptz default null
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct k.dedupe_key), '{}'::text[])
    from public.notification_dedupe_keys k
   where k.org_id = p_org
     and k.dedupe_key = any (coalesce(p_keys, '{}'::text[]))
     and (p_since is null or k.first_sent_at >= p_since);
$$;

revoke all on function public.notification_keys_sent(uuid, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.notification_keys_sent(uuid, text[], timestamptz) to service_role;
comment on function public.notification_keys_sent(uuid, text[], timestamptz) is
  'Of p_keys, the ones already emitted to anyone in p_org (optionally first sent on/after p_since). Returns one array, so no response cap applies (0432).';
