-- 0529 — a document read records how long each of its stages took (TWO-CLICK-READER-PLAN TC0.2, D-TC4).
--
-- THE GAP THIS CLOSES. A read stores created/started/finished and its tokens, nothing in between. On 2026-10-29
-- read 1f251e08 (two pages) took 88 s against a median of ≈21 s, and nothing stored could say whether the time went
-- to the page classifier, fetching and sizing the pages, either reader, or the OCR witness starting cold
-- (TWO-CLICK-READER-PLAN §2.4). Every speed step that follows (TC0.3 warm OCR, TC2.1 sizing, TC2.6 effort) is
-- decided on this number, so it is recorded before any of them changes anything.
--
-- `stage_timings` is a JSON object of stage name → milliseconds (classify, fetch, passA, passB, ocr, evidence, as
-- the worker names them). The NAMES are the worker's vocabulary and live in its code, not in a CHECK: a new stage
-- is a code change, not a migration. The CHECK holds only what every reader relies on — an object whose every
-- value is a non-negative number. Null on every read before this migration's writer (a second merge,
-- `lint:migration-ordering`).
--
-- `document_read_transition` stays the one writer of a read (0448's guard) and gains `p_stage_timings`, merged
-- into what the row already holds (`||`, later keys win). It is otherwise 0487's function, with one widening:
-- reading → reading WITH timings writes them, so the worker can record a stage as it finishes and the screen can
-- name the stage the read is in now ("the screen's stage text reads the real stage", D-TC4). Without timings that
-- move is still the queue's retry re-claiming a read and changes nothing, as in 0448. `started_at` is stamped
-- only on queued → reading — before this, a mid-read write would have restarted the read's clock.
--
-- The old signature is dropped so a named call cannot find two overloads; code that does not pass the new
-- argument — every caller until the writer merges, and old code in the deploy window — matches through the default.
--
-- cross-module-waiver: the re-created function keeps 0451's one write outside document-reading, org's
-- `org_usage_month` token counter, unchanged — a read's terminal move still counts what it spent.
--
-- ADDITIVE for every existing row (a nullable column whose CHECK passes null; a function re-created with one
-- defaulted argument).

alter table public.document_reads add column if not exists stage_timings jsonb;

alter table public.document_reads drop constraint if exists document_reads_stage_timings_shape;
alter table public.document_reads add constraint document_reads_stage_timings_shape check (
  stage_timings is null
  or (jsonb_typeof(stage_timings) = 'object'
      and not jsonb_path_exists(stage_timings, '$.* ? (@.type() != "number" || @ < 0)'))
);

comment on column public.document_reads.stage_timings is
  'Milliseconds per stage of the read (TWO-CLICK-READER-PLAN TC0.2, D-TC4, 0529): { classify, fetch, passA, passB, '
  'ocr, evidence } as the worker names them; written as each stage finishes, so a read still reading names the '
  'stages it has passed. Null before 0529''s writer. Written only by document_read_transition.';

drop function if exists public.document_read_transition(uuid, uuid, text, text, jsonb, jsonb, text[], text, text, text, text, integer, integer, jsonb);

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
  p_output_tokens            integer default null,
  p_replay_inputs            jsonb default null,
  p_stage_timings            jsonb default null
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
  if p_replay_inputs is not null and p_to <> 'done' then
    raise exception 'only a done read has replay inputs' using errcode = 'DO014';
  end if;
  -- reading → reading without timings is the queue's retry re-claiming a read (0448); it changes nothing.
  if v_old.status = 'reading' and p_to = 'reading' and p_stage_timings is null then
    return v_old;
  end if;

  perform set_config('silvicom.document_read_transition', 'on', true);
  update public.document_reads set
    status                  = p_to,
    failure_code            = p_failure_code,
    started_at              = case when p_to = 'reading' and v_old.status = 'queued' then now() else v_old.started_at end,
    finished_at             = case when p_to in ('done', 'failed') then now() else v_old.finished_at end,
    result                  = coalesce(p_result, v_old.result),
    evidence                = coalesce(p_evidence, v_old.evidence),
    models                  = coalesce(p_models, v_old.models),
    prompt_version          = coalesce(p_prompt_version, v_old.prompt_version),
    schema_hash             = coalesce(p_schema_hash, v_old.schema_hash),
    acceptance_rule_version = coalesce(p_acceptance_rule_version, v_old.acceptance_rule_version),
    cache_key               = coalesce(p_cache_key, v_old.cache_key),
    input_tokens            = coalesce(p_input_tokens, v_old.input_tokens),
    output_tokens           = coalesce(p_output_tokens, v_old.output_tokens),
    replay_inputs           = coalesce(p_replay_inputs, v_old.replay_inputs),
    stage_timings           = case when p_stage_timings is null then v_old.stage_timings
                                   else coalesce(v_old.stage_timings, '{}'::jsonb) || p_stage_timings end
  where id = p_read and org_id = p_org
  returning * into v_new;
  perform set_config('silvicom.document_read_transition', '', true);

  -- 0451 §1: the terminal move counts what the read spent, once, in this transaction.
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

revoke all on function public.document_read_transition(uuid, uuid, text, text, jsonb, jsonb, text[], text, text, text, text, integer, integer, jsonb, jsonb)
  from public, anon, authenticated;
