-- 0451 — a document read spends from the organization's monthly token counter, and a read has a way
-- to end when the model never answered or reading was switched off (DOCUMENT-READER-PLAN.md Step 1.6).
--
-- THE GAP THIS CLOSES. Step 1.6 puts the reader on the queue, so for the first time a document read
-- spends model tokens in production. Two things 0448 left out would each fail quietly there:
--
--   1. NOTHING COUNTS A READ'S TOKENS. The per-org budget gate (D17, 0130) reads ONE indexed row of
--      `org_usage_month`, and 0130 made `record_hazmat_run` that row's only writer, in the same
--      transaction as the run insert, so the counter can never drift from the runs it summarises. A
--      read recorded its tokens on `document_reads` and nowhere else — so a carrier could read
--      documents without limit while the budget they set showed nothing spent.
--   2. A READ CAN BE STRANDED IN `reading`. The queue retries a transient model error (429, 5xx,
--      timeout) with backoff (§2 Queue), and a job's attempts are finite. When the last attempt fails,
--      the job is marked failed in `jobs` — and the read, already `reading`, had no code to end with,
--      so the dispatcher's page would poll a read that can never finish. The same holds for a read
--      whose consumer module is switched off between the click and the worker reaching it.
--
-- ── 1. THE TRANSITION COUNTS THE TOKENS, IN ITS OWN TRANSACTION ─────────────────────────────────────
-- `document_read_transition` is already the one writer of a read's outcome, and a read reaches a
-- terminal state exactly once (0448's guard refuses done → anything and failed → anything). So the
-- terminal transition adds the tokens it records to `org_usage_month` in the same statement's
-- transaction — 0130's argument, applied to the second spender: one atomic call, no second write to
-- forget, no retry that can count twice (the second terminal call raises DO014 before reaching it).
-- A failure counts too: a `max_tokens` read spent its tokens (0448's comment on the RPC).
--   `runs` is NOT incremented. It has meant "hazmat runs recorded" since 0130, and a read is not one;
--   a reader of `runs` keeps its meaning. A terminal transition that spent nothing (a cache hit, or a
--   failure before any model call) writes no usage row at all.
--   Rejected: a separate `record_document_read_usage` RPC called after the transition — two calls the
--   worker could be killed between, which is the drift 0130 exists to make impossible.
--
-- ── 2. TWO OPERATIONAL FAILURE CODES ─────────────────────────────────────────────────────────────────
--   model_unavailable  the last queue attempt ended on a transient model error.
--   reading_disabled   the consumer module's entitlement or kill switch was off when the worker began.
-- Both are `operational` in READ_FAILURE_KIND: neither says anything about how well the reader reads,
-- so `doc:score` leaves them out of the four numbers. The CHECK is re-issued from the contract's
-- READ_FAILURE_CODES; the matrix compares the applied catalog with that array item for item.
--
-- cross-module-waiver: the one write outside document-reading is org's `org_usage_month`, the org-wide
-- token counter D17's budget gate reads — written here exactly as hazmat's record_hazmat_run (0130)
-- writes it, because a counter only one of two spenders feeds is a budget the other spends around.
--
-- ADDITIVE for every existing row (a CHECK widened; a function re-created with the same signature).
-- Nothing in apps/ moves a read before this migration's code ships with it, and 0448 has no production
-- reads to strand.

alter table public.document_reads drop constraint if exists document_reads_failure_code_check;
alter table public.document_reads add constraint document_reads_failure_code_check
  check (failure_code in ('refusal', 'max_tokens', 'schema_invalid', 'unusable_image', 'no_readable_page',
                          'budget_exhausted', 'integrity_mismatch', 'model_unavailable', 'reading_disabled'));

create or replace function public.document_read_transition(
  p_org                      uuid,
  p_read                     uuid,
  p_to                       text,
  p_failure_code             text default null,
  p_result                   jsonb default null,
  p_evidence                 jsonb default null,
  p_models                   text[] default null,
  p_prompt_version           text default null,
  p_schema_hash              text default null,
  p_acceptance_rule_version  text default null,
  p_cache_key                text default null,
  p_input_tokens             integer default null,
  p_output_tokens            integer default null
)
returns public.document_reads
language plpgsql
set search_path = ''
as $$
declare
  v_old public.document_reads;
  v_new public.document_reads;
begin
  select * into v_old from public.document_reads r where r.id = p_read and r.org_id = p_org for update;
  if not found then
    raise exception 'document read % not found in this organization', p_read using errcode = 'DO015';
  end if;
  if (p_to = 'failed') <> (p_failure_code is not null) then
    raise exception 'a failed read needs a failure code, and only a failed read has one' using errcode = 'DO014';
  end if;
  if p_result is not null and p_to <> 'done' then
    raise exception 'only a done read has a result' using errcode = 'DO014';
  end if;
  -- reading → reading is the queue's retry re-claiming a read (0448); it changes nothing.
  if v_old.status = 'reading' and p_to = 'reading' then
    return v_old;
  end if;

  perform set_config('silvicom.document_read_transition', 'on', true);
  update public.document_reads set
    status                  = p_to,
    failure_code            = p_failure_code,
    started_at              = case when p_to = 'reading' then now() else v_old.started_at end,
    finished_at             = case when p_to in ('done', 'failed') then now() else v_old.finished_at end,
    result                  = coalesce(p_result, v_old.result),
    evidence                = coalesce(p_evidence, v_old.evidence),
    models                  = coalesce(p_models, v_old.models),
    prompt_version          = coalesce(p_prompt_version, v_old.prompt_version),
    schema_hash             = coalesce(p_schema_hash, v_old.schema_hash),
    acceptance_rule_version = coalesce(p_acceptance_rule_version, v_old.acceptance_rule_version),
    cache_key               = coalesce(p_cache_key, v_old.cache_key),
    input_tokens            = coalesce(p_input_tokens, v_old.input_tokens),
    output_tokens           = coalesce(p_output_tokens, v_old.output_tokens)
  where id = p_read and org_id = p_org
  returning * into v_new;
  perform set_config('silvicom.document_read_transition', '', true);

  -- 0451 §1: the terminal move counts what the read spent, once, in this transaction. The guard above
  -- (0448's trigger) has already refused a second terminal move, so this line runs at most once per read.
  if p_to in ('done', 'failed') and coalesce(v_new.input_tokens, 0) + coalesce(v_new.output_tokens, 0) > 0 then
    insert into public.org_usage_month (org_id, yyyymm, input_tokens, output_tokens, runs)
    values (p_org, to_char(now(), 'YYYY-MM'), coalesce(v_new.input_tokens, 0), coalesce(v_new.output_tokens, 0), 0)
    on conflict (org_id, yyyymm) do update
      set input_tokens  = public.org_usage_month.input_tokens  + excluded.input_tokens,
          output_tokens = public.org_usage_month.output_tokens + excluded.output_tokens,
          updated_at    = now();
  end if;
  return v_new;
end;
$$;

comment on function public.document_read_transition(uuid, uuid, text, text, jsonb, jsonb, text[], text, text, text, text, integer, integer) is
  '0448/0451: the only writer of a document read''s outcome — queued → reading → done | failed (failed carries a '
  'READ_FAILURES code; both terminal). The terminal move adds the read''s tokens to org_usage_month in the same '
  'transaction (0451). Service-role only. Raises DO014 on an illegal move, DO015 on no such read.';

comment on table public.org_usage_month is
  'Materialised per-org monthly model-token usage (D17). Written ONLY by record_hazmat_run() (0130, with the '
  'hazmat_runs insert) and document_read_transition() (0451, with a read''s terminal move), each in its own '
  'transaction. `runs` counts hazmat runs only. The budget gate reads this, never scans the runs or the reads.';

revoke all on function public.document_read_transition(uuid, uuid, text, text, jsonb, jsonb, text[], text, text, text, text, integer, integer)
  from public, anon, authenticated;
