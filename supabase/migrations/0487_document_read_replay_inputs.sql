-- 0487 — a document read keeps what is needed to judge it again (READER-CORRECTNESS-PLAN RC2, D-RC2).
--
-- THE GAP THIS CLOSES. A read stores pass A's document whole (`result`) and, for every other witness, only
-- the values `evidence` aligned to pass A's paths. Pass B's own document — its lines in its own order, a line
-- pass A never saw — and the OCR engine's words are gone once the worker finishes. So when the code that pairs
-- the readers, weighs the witnesses, consults the table, audits the paper or fills the calculator changes, no
-- stored read can be judged again: each fix is checked on the one BOL that exposed it, and nothing shows what
-- it does to the others (owner, 2026-10-19: "work every time, not this one case"). The text layer needs no
-- column: it is already stored per page (`document_pages.text_layer`, 0448).
--
-- `replay_inputs` holds { passB: <pass B's document> | null, ocr: <OcrPage[]> | null } exactly as the worker
-- handed them to the evidence builder. Null on every read before this migration's writer (a second merge,
-- `lint:migration-ordering`) and on a cache hit, which replays an earlier read's evidence and judged nothing.
-- Size: ≈ 50 KB of OCR per page; production finished 7 reads in its first week. It grows with `document_reads`
-- and goes where they go.
--
-- `document_read_transition` stays the one writer of a read's outcome (0448's guard): it gains
-- `p_replay_inputs`, defaulting to null, and is otherwise 0451's function. The old signature is dropped so a
-- named call cannot find two overloads; code that does not pass the new argument — every caller until the
-- writer merges, and old code in the deploy window — matches the new function through the default.
--
-- cross-module-waiver: the re-created function keeps 0451's one write outside document-reading, org's
-- `org_usage_month` token counter, unchanged — a read's terminal move still counts what it spent.
--
-- ADDITIVE for every existing row (a nullable column; a function re-created with one defaulted argument).

alter table public.document_reads add column if not exists replay_inputs jsonb;

comment on column public.document_reads.replay_inputs is
  'What the witnesses were given, so the read can be judged again (READER-CORRECTNESS-PLAN RC2, 0487): '
  '{ passB, ocr } — pass B''s whole document and the OCR words per page. Null before 0487''s writer and on a '
  'cache hit. Written only by document_read_transition.';

drop function if exists public.document_read_transition(uuid, uuid, text, text, jsonb, jsonb, text[], text, text, text, text, integer, integer);

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
  p_replay_inputs            jsonb default null
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
    output_tokens           = coalesce(p_output_tokens, v_old.output_tokens),
    replay_inputs           = coalesce(p_replay_inputs, v_old.replay_inputs)
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

revoke all on function public.document_read_transition(uuid, uuid, text, text, jsonb, jsonb, text[], text, text, text, text, integer, integer, jsonb)
  from public, anon, authenticated;
