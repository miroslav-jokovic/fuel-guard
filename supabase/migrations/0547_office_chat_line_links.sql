-- Silvicom 360 — 0547 office chat: load and truck numbers in a line become links
-- (docs/plans/messaging/CHAT-REDESIGN-PLAN.md Q-CHATUI6, ruled (a) as recommended 2026-11-02)
--
-- "Can you approve the detention on load 0137581?" — the office writes load and truck numbers all day,
-- and until now a reader copied the number into the Loads search. Q-CHATUI6 (a): a SERVER-side resolver
-- answers which words of a line are records, organisation-scoped, so the web never guesses and one reader
-- decides. This file is that reader; the API and the web are the next merge.
--
--   1. WHAT IS A LOAD. Measured on production before this file: every `loads.ref` is McLeod's order id,
--      seven digits, zero-padded ("0137581", 9,579 loads, one length). A line names one either as a
--      seven-digit word, or as "load 137581" / "load #137581" / "order 137581" — padded to seven. Either
--      way it is a link only if it IS a load reference of ours, so "call me at 555-0137" stays words.
--   2. WHAT IS A TRUCK. Units are short numbers ("506", 272 of them) — the same shape as every other
--      number in a sentence — so only a number after "truck", "unit" or "tractor" is read as one, and it
--      must be a unit of this organisation: exactly, or as a retired unit is written ("183 - SOLD"). A
--      number two trucks could be is no link (ambiguous is not a guess).
--   3. ONLY WHAT THE READER COULD READ. Lines of conversations the caller is in now, never a retracted
--      line, never a driver conversation; and only records of the caller's organisation. A load and a
--      truck are readable by every office member (`loads_select`, `vehicles_select` check the
--      organisation only), so no section gate is needed past that.
--   4. THE ANSWER IS THE WORDS, NOT AN OFFSET. Each row is the matched text as it stands in the line,
--      with the record it names; the web links every occurrence of that text. Character offsets would
--      count differently in Postgres and in a browser's UTF-16 the moment a line holds an emoji.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: one new function; nothing existing changes.
--
-- Rollback: drop the function. The next merge's route calls it and must be reverted first.

create or replace function chat_line_links(p_org uuid, p_user uuid, p_messages uuid[])
returns table (message_id uuid, text text, kind text, record_id uuid)
language sql stable security definer set search_path = ''
as $$
  with readable as (
    select m.id, m.body
      from public.messages m
      join public.message_threads t on t.id = m.thread_id and t.org_id = p_org and t.kind <> 'driver'
      join public.thread_participants p on p.thread_id = t.id and p.user_id = p_user and p.left_at is null
     where m.id = any (coalesce(p_messages, '{}'::uuid[])) and m.deleted_at is null
       and m.body is not null
     limit 200
  ),
  -- Loads: a seven-digit number as a word of its own, or a number after "load"/"order". Only a real load
  -- reference of ours survives the join, so a phone number never becomes one.
  load_tokens as (
    select r.id as message_id, x[1] as text, x[1] as ref
      from readable r, regexp_matches(r.body, '(?<![0-9A-Za-z])([0-9]{7})(?![0-9A-Za-z])', 'g') x
    union
    select r.id, x[1], lpad(x[2], 7, '0')
      from readable r, regexp_matches(r.body, '(?i)((?:load|order)\s*#?\s*([0-9]{4,7}))(?![0-9])', 'g') x
  ),
  loads as (
    select distinct t.message_id, t.text, 'load'::text as kind, l.id as record_id
      from load_tokens t
      join public.loads l on l.org_id = p_org and l.ref = t.ref
  ),
  -- Trucks: only a number after "truck", "unit" or "tractor", and only one unit it can be.
  truck_tokens as (
    select r.id as message_id, x[1] as text, x[2] as unit
      from readable r, regexp_matches(r.body, '(?i)((?:truck|unit|tractor)\s*#?\s*([0-9]{1,6}))(?![0-9])', 'g') x
  ),
  trucks as (
    select t.message_id, t.text, 'vehicle'::text as kind, min(v.id::text)::uuid as record_id
      from truck_tokens t
      join public.vehicles v on v.org_id = p_org and (v.unit_number = t.unit or v.unit_number like t.unit || ' - %')
     group by t.message_id, t.text
    having count(distinct v.id) = 1
  )
  select * from loads
  union all
  select * from trucks;
$$;

revoke all on function chat_line_links(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function chat_line_links(uuid, uuid, uuid[]) to service_role;
