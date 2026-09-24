-- 0370: load_dispatches — the office's act of sending a load to a driver, one row per send
-- (LOADS-MIRROR-PLAN.md LR-D1; D-LMR5, D-LMR6, D-LMR7).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- The owner's ruling (D-LMR5): a McLeod load reaches a driver when Silvicom's dispatcher presses
-- Dispatch, picks the driver (McLeod's pre-selected) and sends it. Since LR4b every sync overwrites
-- `loads` from McLeod (D-LMR2), so the dispatch cannot live on the load: a `loads.driver_id` or a
-- `loads.dispatched_at` written by the office would be put back to McLeod's value by the next sync
-- and the dispatch would vanish without anybody having undone it. It is its own row (D-LMR6), and
-- `loads.status` stays McLeod's (D-LMR7) — "Sent to …" / "Not sent" on the page is read from here,
-- a different fact from a different author.
--
-- ── WHY THIS SHAPE ───────────────────────────────────────────────────────────────────────────────
-- · Append-only. A re-send, or a send to a different driver, is a NEW row; the latest row for a load
--   is its current dispatch, and the earlier ones are its history. Nothing about a send is edited
--   after the fact — the one exception is `driver_id`, below.
-- · The outcome is recorded when the row is written, never assumed. SMS is dark today
--   (SMS_PROVIDER=none; Telnyx has no number — see sms-provider-is-telnyx), so LR-D2's every send
--   will record `not_sent` / `sms_not_configured`. The CHECK below makes the lie unwritable: an SMS
--   dispatch can only say `sent` if it names the number it went to and the provider's message id.
--   A delivery receipt arriving later is a later fact; it goes in its own table when Telnyx is live,
--   not as an edit here.
-- · `body` is the text as composed — what the driver was told. The load is overwritten by every
--   sync, so without it "what did we send" could not be answered a day later.
-- · `channel` is `sms` now and `app` once the driver app reads this table ("loads sent to me");
--   the distribution is prepared by construction rather than by a flag (D-LMR6).
-- · The org of the load and of the driver must be the row's org. The API writes with the service
--   role, which bypasses RLS, so the insert guard checks it rather than trusting the one caller.
--
-- ── FOREIGN KEYS, AND WHAT THEY REFUSE ───────────────────────────────────────────────────────────
-- · `load_id` is `on delete restrict`: a load that was sent to somebody cannot be deleted from under
--   the record that it was sent. (`load_events` has the same effect by trigger; here it is said by
--   the key, which names the problem in the error.)
-- · `driver_id` is `on delete restrict`, and a roster MERGE moves it: the row is listed in
--   `DRIVER_REASSIGNMENTS` (modules/roster/mergeDriver.ts, `lint:driver-references`). Two driver
--   records that turn out to be one human being received one dispatch, so the fact follows the
--   surviving record — which is why the guard below freezes every column EXCEPT `driver_id`, as
--   0238's AD010 and 0330's AC010 guards do. Not a refusal (MD010): a dispatch is not a signature.
-- · `sent_by` is `not null` with no delete action: a person who sent a load cannot be deleted out of
--   the record. `load_events.actor_user_id` already behaves this way in practice (its `set null`
--   would be an UPDATE, which its own trigger refuses), so this adds no new refusal to a dispatcher.
--
-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────
-- On, with no client policy: deny-all on purpose. The office reads and writes it through the API
-- with the service role (LR-D2), which org-filters itself.
--
-- ── WHAT THIS DOES NOT DO YET: THE DRIVER SCOPES ─────────────────────────────────────────────────
-- 0368 made a `tms` load invisible to its driver until `released_at` is set. Those scopes are meant
-- to read THIS table instead ("a dispatch to this driver exists") — and they are not changed here,
-- on purpose. `driverLoads.ts` reads with the service role and applies the same predicate, so the
-- policy and that reader must change in ONE merge, and a reader of this table cannot ship in the
-- merge that creates it (Railway serves the code ~2m44s before `migrate.yml` applies the schema).
-- So the scope change ships with LR-D2, once `information_schema` shows this table in production.
-- It will also need a driver-own-row select policy here, because the scope's `exists` runs under
-- the driver's RLS and deny-all would answer "never sent" for every load.
-- Until then nothing writes this table, and no McLeod load has been released (0 of 303, measured
-- for 0368), so no driver sees any McLeod load — the state 0368 established, unchanged.

create table if not exists load_dispatches (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  load_id             uuid not null references loads(id) on delete restrict,
  driver_id           uuid not null references drivers(id) on delete restrict,
  sent_by             uuid not null references auth.users(id),
  sent_at             timestamptz not null default now(),

  channel             text not null
                        constraint load_dispatches_channel_check check (channel in ('sms', 'app')),
  outcome             text not null
                        constraint load_dispatches_outcome_check check (outcome in ('sent', 'not_sent', 'failed')),
  -- Why it was not sent, in a stable code the page can word: `sms_not_configured`, `no_phone`,
  -- `no_sms_consent`, or the provider's error code. Required unless it was sent.
  outcome_reason      text,

  -- The number the text went to (E.164), as it was at the moment of sending: the driver's phone on
  -- the roster can change afterwards, and the record must say where THIS message went.
  recipient           text,
  body                text not null,
  provider_message_id text,

  constraint load_dispatches_reason_check check (
    (outcome = 'sent') = (outcome_reason is null)
  ),
  -- Never pretend it was sent: an SMS reads `sent` only with the number and the provider's receipt.
  constraint load_dispatches_sms_sent_check check (
    not (channel = 'sms' and outcome = 'sent')
    or (recipient is not null and provider_message_id is not null)
  )
);

-- The load's current dispatch is its latest row: the page's "Sent to …" and LR-D2's scope read it.
create index if not exists idx_load_dispatches_load_sent
  on load_dispatches (load_id, sent_at desc);
-- The driver's side, for the app channel later: "loads sent to me", newest first.
create index if not exists idx_load_dispatches_org_driver_sent
  on load_dispatches (org_id, driver_id, sent_at desc);

alter table load_dispatches enable row level security;

create or replace function load_dispatches_guard()
returns trigger
language plpgsql
as $$
declare
  v_load_org uuid;
  v_driver_org uuid;
begin
  if TG_OP = 'INSERT' then
    select org_id into v_load_org from loads where id = new.load_id;
    select org_id into v_driver_org from drivers where id = new.driver_id;
    if v_load_org is distinct from new.org_id or v_driver_org is distinct from new.org_id then
      raise exception 'a dispatch, its load and its driver must belong to one organization'
        using errcode = 'LD010';
    end if;
    return new;
  end if;

  if TG_OP = 'DELETE' then
    raise exception 'load_dispatches is append-only: a dispatch is never deleted'
      using errcode = 'LD011';
  end if;

  -- UPDATE: only a roster merge's move of `driver_id` (see the header), and only within the org.
  if old.id              is distinct from new.id
     or old.org_id       is distinct from new.org_id
     or old.load_id      is distinct from new.load_id
     or old.sent_by      is distinct from new.sent_by
     or old.sent_at      is distinct from new.sent_at
     or old.channel      is distinct from new.channel
     or old.outcome      is distinct from new.outcome
     or old.outcome_reason is distinct from new.outcome_reason
     or old.recipient    is distinct from new.recipient
     or old.body         is distinct from new.body
     or old.provider_message_id is distinct from new.provider_message_id
  then
    raise exception 'load_dispatches is append-only: a re-send is a new row'
      using errcode = 'LD011';
  end if;
  select org_id into v_driver_org from drivers where id = new.driver_id;
  if v_driver_org is distinct from new.org_id then
    raise exception 'a dispatch, its load and its driver must belong to one organization'
      using errcode = 'LD010';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_load_dispatches_guard on load_dispatches;
create trigger trg_load_dispatches_guard
  before insert or update or delete on load_dispatches
  for each row execute function load_dispatches_guard();

comment on table load_dispatches is
  'The office sending a load to a driver (D-LMR5/D-LMR6), one append-only row per send; the latest row is the load''s current dispatch. Never a column on loads: every McLeod sync overwrites loads.';
comment on column load_dispatches.outcome is
  'Recorded when the row is written, never assumed. An SMS is `sent` only with recipient and provider_message_id (load_dispatches_sms_sent_check).';
