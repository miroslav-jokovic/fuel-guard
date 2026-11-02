-- Silvicom 360 — 0542 office chat: search (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH8)
--
-- The plan chose Postgres full text search over a search service (§2, "Elasticsearch later — agreed:
-- Postgres FTS"): a person finds a line in the conversations they can read, across all of them from the
-- rail or inside one from its header (CHAT-REDESIGN-PLAN Q-CHATUI7). This file is the index and the one
-- function; the API and the web are the next merge, so no reader runs ahead of its schema.
--
--   1. WHAT IS INDEXED: every line's current words, as `chat_search_vector(body)` — an EXPRESSION
--      index, not a stored column, so no column is added (nothing to backfill, no reader to order behind
--      it) and the index can never disagree with the body. Measured before this file: production holds 4
--      office lines (120 kB for the whole `messages` table), so the index builds in the migration itself.
--      `simple`, not `english`: an office searches load numbers (L-20481), unit numbers (702), names and
--      Spanish as often as English words, and stemming would fold or drop exactly those; every word is
--      matched as a PREFIX instead, so "load" finds "loaded" and "2048" finds "L-20481". Hyphens and
--      dashes are read as spaces first, in the line and in the search alike: measured, the parser takes
--      "L-20481" as the word `l` and the NEGATIVE number `-20481`, so "20481" would never have found it.
--   2. WHAT A PERSON SEES: lines in office conversations (never a driver conversation — those are 0096's,
--      with their own readers) they are in now, as `chat_member_thread` means it everywhere else; never a
--      retracted line. Every word must match. Newest first, keyset-paged on (created_at, id), as 0512.
--   3. NOT LEDGERED. A person reading their own conversations is not a compliance act; the console's
--      org-wide search (0516) stays ledgered and stays on `ilike` over every prior version, which this
--      index does not hold — moving it is recorded as an open item, not done here.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: one new index and one new function; nothing existing changes.
--
-- Rollback: drop the function and the index. The next merge's route calls the function and must be
-- reverted first.

-- A line's words as the search reads them. One definition for the index and the query, so the
-- planner's expression match can never drift from the function's.
create or replace function chat_search_vector(p_body text) returns tsvector
language sql immutable set search_path = ''
as $$ select to_tsvector('simple'::regconfig, translate(coalesce(p_body, ''), '-‐‑–—', '     ')) $$;

create index if not exists idx_messages_search on messages using gin (public.chat_search_vector(body));

-- The query: each word of the search as a prefix, all of them required. The words are the parser's own
-- lexemes of the search text (so "L-20481" is searched as the body was indexed), each quoted for
-- `to_tsquery`, so no input is ever read as tsquery syntax: `&`, `|`, `!`, `:` and `*` are separators to
-- the parser and never reach a lexeme, nor do quotes or backslashes (measured: "o'brien" is `o`, `brien`;
-- the matrix's input rows send each). Null when the search holds no words, which matches nothing.
create or replace function chat_search_query(p_q text) returns tsquery
language sql immutable set search_path = ''
as $$
  select to_tsquery('simple'::regconfig, string_agg(
           '''' || l.lexeme || ''':*', ' & ' order by l.lexeme))
    from unnest(public.chat_search_vector(left(coalesce(p_q, ''), 200))) l;
$$;

-- Lines matching `p_q` that `p_user` can read — in one conversation when `p_thread` is given (not in it:
-- CH001, as every chat reader), else across all of theirs. Newest first; `p_before_at` + `p_before_id`
-- page back.
create or replace function chat_search(
  p_org uuid, p_user uuid, p_q text, p_thread uuid, p_before_at timestamptz, p_before_id uuid, p_limit integer
) returns table (
  id uuid, thread_id uuid, kind text, subject text, space_id uuid, parent_id uuid, seq bigint,
  sender_user_id uuid, sender_name text, body text, created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_q tsquery := public.chat_search_query(p_q);
begin
  if p_thread is not null then
    perform public.chat_member_thread(p_org, p_user, p_thread);
  end if;
  return query
    select m.id, m.thread_id, t.kind, t.subject, t.space_id, m.parent_id, m.seq,
           m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id), m.body, m.created_at
      from public.messages m
      join public.message_threads t on t.id = m.thread_id and t.org_id = p_org and t.kind <> 'driver'
      join public.thread_participants p on p.thread_id = t.id and p.user_id = p_user and p.left_at is null
     where m.deleted_at is null
       and public.chat_search_vector(m.body) @@ v_q
       and (p_thread is null or m.thread_id = p_thread)
       and (p_before_at is null or (m.created_at, m.id) < (p_before_at, p_before_id))
     order by m.created_at desc, m.id desc
     limit least(greatest(coalesce(p_limit, 25), 1), 50);
end;
$$;

revoke all on function chat_search_vector(text) from public, anon, authenticated;
revoke all on function chat_search_query(text) from public, anon, authenticated;
revoke all on function chat_search(uuid, uuid, text, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function chat_search(uuid, uuid, text, uuid, timestamptz, uuid, integer) to service_role;
