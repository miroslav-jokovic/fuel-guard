-- 0584 — Ask AI records what every answer spent, and adds it to the carrier's monthly AI counter
-- (F21 R2, docs/plans/product-readiness/F21-ask-ai/PLAN.md Step 1a; owner's Q-AI1 ruling 2026-11-10).
--
-- THE GAP THIS CLOSES (AUDIT P2). The assistant has answered 20 questions for 3 people since July and
-- nothing knows what they cost: no row, no counter, no log line. Every other AI spender in the product
-- adds its tokens to `org_usage_month` (hazmat runs 0130, document reads 0451, chat catch-ups 0549),
-- which is the counter the carrier's "Monthly AI usage limit" is compared with — so the assistant was
-- the one spender that limit could not see. And the owner's cap (Q-AI1: $50 per carrier per month)
-- needs a per-answer ledger to be measured against, because tokens are not money once prompt caching
-- makes a cache read a tenth of an input token.
--
-- ── 1. `ai_assistant_usage`: ONE ROW PER ANSWER, NO TEXT ─────────────────────────────────────────────
-- Tokens by kind (uncached input, cache read, cache write, output), the dollars they come to at list
-- price (micro-dollars, computed by `requestCostMicroUsd` in @silvicom/shared), model rounds, latency,
-- the tools called and how the answer ended. NOT the question and NOT the answer: those stay on the
-- `ai.ask` audit row, so this ledger can be kept for cost history after any text is gone (Q-AI4's
-- recommendation, 13 months for cost — not yet ruled, so no retention rule is declared here).
-- `user_id` carries no foreign key: a person's departure must not erase what their questions cost.
--
-- ── 2. `record_assistant_answer`: THE ONLY WRITER, AND THE COUNTER IN THE SAME TRANSACTION ─────────
-- 0130's argument for the third time: the ledger row and the counter increment are one call, so they
-- cannot drift, and no second write exists to forget. All prompt tokens count toward the counter —
-- uncached, cache read and cache write — because it is a TOKEN counter and a cached token is still a
-- token the model read; the dollar difference is this ledger's to state, not the counter's. `runs`
-- keeps its 0130 meaning (hazmat runs) and is not incremented. An answer that spent nothing (the model
-- was never reached) writes its ledger row and no counter row.
--
-- ── 3. `assistant_month_spend`: WHAT THE CAP IS COMPARED WITH ─────────────────────────────────────────
-- A sum over this ledger from the first instant of the carrier's month (the caller resolves it on
-- `organizations.operating_hours->>'tz'`, D-PREC6). An RPC rather than a client-side sum because a busy
-- month passes PostgREST's 1,000-row page (memory: postgrest-caps-every-response-at-1000).
--
-- ── 4. A BELL CATEGORY FOR THE 80% WARNING ────────────────────────────────────────────────────────────
-- `ai_assistant_budget`, Q-AI1's "admin alert at 80%". Added now so the sender can ship in the next
-- merge; nothing writes it until then (the CHECK and the contract move together, as 0563 and 0575).
--
-- cross-module-waiver: the writes outside insights are org's `org_usage_month`, the org-wide token
-- counter, written exactly as 0130/0451/0549 write it, and messaging's `notification_events` category
-- CHECK, restated to add one category as every new category has (0521, 0537, 0559, 0563, 0575, 0581).
--
-- ADDITIVE. A new table, two new functions, one CHECK widened. Code that calls the functions ships in
-- this merge: new objects are lint:migration-ordering's exemption, and in the minutes on staging before
-- this applies, a failed record is logged and the answer is still returned (never a refused question).
-- Rollback: drop the two functions and the table; restore 0581's category CHECK.

create table if not exists public.ai_assistant_usage (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  user_id            uuid,
  asked_at           timestamptz not null default now(),
  model              text not null,
  rounds             integer not null default 0 check (rounds >= 0),
  input_tokens       integer not null default 0 check (input_tokens >= 0),
  cache_read_tokens  integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  output_tokens      integer not null default 0 check (output_tokens >= 0),
  cost_micro_usd     bigint not null default 0 check (cost_micro_usd >= 0),
  latency_ms         integer not null default 0 check (latency_ms >= 0),
  tools              text[] not null default '{}',
  outcome            text not null check (outcome in ('answered', 'step_limit', 'refusal', 'max_tokens', 'error'))
);

comment on table public.ai_assistant_usage is
  'One row per Ask AI answer: tokens by kind, list-price cost in micro-dollars, rounds, latency, tools, outcome (0584, F21 R2). No question or answer text — that is the ai.ask audit row. Written ONLY by record_assistant_answer().';

create index if not exists ai_assistant_usage_org_asked_idx on public.ai_assistant_usage (org_id, asked_at desc);

-- Service-role-only surface: RLS on, no policies => the JWT/PostgREST door reads and writes nothing.
alter table public.ai_assistant_usage enable row level security;

create or replace function public.record_assistant_answer(
  p_org                uuid,
  p_user               uuid,
  p_model              text,
  p_rounds             integer,
  p_input_tokens       integer,
  p_cache_read_tokens  integer,
  p_cache_write_tokens integer,
  p_output_tokens      integer,
  p_cost_micro_usd     bigint,
  p_latency_ms         integer,
  p_tools              text[],
  p_outcome            text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id     uuid;
  v_prompt bigint := coalesce(p_input_tokens, 0) + coalesce(p_cache_read_tokens, 0) + coalesce(p_cache_write_tokens, 0);
begin
  insert into public.ai_assistant_usage (
    org_id, user_id, model, rounds, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
    cost_micro_usd, latency_ms, tools, outcome
  ) values (
    p_org, p_user, p_model, coalesce(p_rounds, 0), coalesce(p_input_tokens, 0), coalesce(p_cache_read_tokens, 0),
    coalesce(p_cache_write_tokens, 0), coalesce(p_output_tokens, 0), coalesce(p_cost_micro_usd, 0),
    coalesce(p_latency_ms, 0), coalesce(p_tools, '{}'), p_outcome
  ) returning id into v_id;

  -- §2: the counter moves in this transaction, by what was spent, or not at all.
  if v_prompt + coalesce(p_output_tokens, 0) > 0 then
    insert into public.org_usage_month (org_id, yyyymm, input_tokens, output_tokens, runs)
    values (p_org, to_char(now(), 'YYYY-MM'), v_prompt, coalesce(p_output_tokens, 0), 0)
    on conflict (org_id, yyyymm) do update
      set input_tokens  = public.org_usage_month.input_tokens  + excluded.input_tokens,
          output_tokens = public.org_usage_month.output_tokens + excluded.output_tokens,
          updated_at    = now();
  end if;
  return v_id;
end;
$$;

create or replace function public.assistant_month_spend(p_org uuid, p_since timestamptz)
returns table (cost_micro_usd bigint, answers integer)
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(u.cost_micro_usd), 0)::bigint, count(*)::integer
  from public.ai_assistant_usage u
  where u.org_id = p_org and u.asked_at >= p_since;
$$;

revoke all on function public.record_assistant_answer(uuid, uuid, text, integer, integer, integer, integer, integer, bigint, integer, text[], text) from public, anon, authenticated;
revoke all on function public.assistant_month_spend(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_assistant_answer(uuid, uuid, text, integer, integer, integer, integer, integer, bigint, integer, text[], text) to service_role;
grant execute on function public.assistant_month_spend(uuid, timestamptz) to service_role;

comment on table public.org_usage_month is
  'Materialised per-org monthly model-token usage (D17). Written ONLY by record_hazmat_run() (0130, with the '
  'hazmat_runs insert), document_read_transition() (0451, with a read''s terminal move), '
  'chat_catchup_record() (0549, with its ledger row) and record_assistant_answer() (0584, with its '
  'ai_assistant_usage row), each in its own transaction. `runs` counts hazmat runs only. The budget gates '
  'read this, never scan the runs, the reads or the answers.';

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
  'ads_overspend', 'ads_rejected', 'ads_no_leads', 'ads_external_change', 'ads_token_expiring', 'ads_brief', 'ads_pause_failed',
  'lead_new', 'lead_uncontacted', 'lead_intake_failing',
  'ads_lead_quality',
  'ads_creative_retired',
  'ai_assistant_budget'
));
