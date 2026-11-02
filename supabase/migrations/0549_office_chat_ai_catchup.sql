-- Silvicom 360 — 0549 office chat: AI catch-up (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH12; D-CHAT16,
-- D-CHAT37, D-CHAT38; Q-CHAT13 ruled (b): build it off by default)
--
-- "Catch me up": a person back from a day off asks for the unread lines of one conversation, summarised.
-- D-CHAT16 set the rules — off by default, on demand only (never in the background), over lines the
-- caller may read, a per-person daily cap, ledgered — and this file is the database's half of them. The
-- model call, the switch and the button are the next merge.
--
--   1. THE SWITCH (D-CHAT37) is a module, `chat_ai`: absent is off (`org_module_enabled`, 0088), the
--      platform console turns it on per carrier, so the cost of a model is never switched on by the side
--      door. The Permissions page is for SCREENS, each with a route; a button inside /chat has none.
--   2. WHAT IT READS (D-CHAT38). D-CHAT16 said "messages the caller already read"; read literally that
--      summarises what they need no summary of. It was written meaning what the caller MAY read — the
--      plan's own rule everywhere else — and is built so: `chat_catchup_lines` answers the lines after
--      the caller's read boundary in a conversation they are in now, oldest first, retracted lines left
--      out, at most `CHAT_CATCHUP_MAX_LINES` (200) — the newest ones if there are more. Asking marks
--      nothing read.
--   3. THE CAP: 20 catch-ups a person in any 24 hours (`CHAT_CATCHUP_DAILY_CAP`, held equal to the
--      shared contract by `chatCatchupCheck.test.ts`). `chat_catchup_left` answers what remains before
--      the model is asked; `chat_catchup_record` checks again when the answer is recorded and refuses the
--      21st (CH017) — two at once can each pass the first check, never the second.
--   4. LEDGERED: an `ai_catchup` row naming the conversation, the seq range read, how many lines, the
--      model, the tokens, and the SHA-256 of the summary — not the summary, which is the model's words
--      about the lines the ledger already holds. Its tokens count in the carrier's month
--      (`org_usage_month`, the budget gate's one source), as a document read's do.
--
-- Error codes (the API maps them in chat.ts):
--   CH017  the person has used today's catch-ups (→ 429)
--
-- WHY THE OLD CODE MEETS THIS SAFELY: two CHECKs widened, new functions only.
--
-- Rollback: drop the three functions; restore 0540's ledger CHECK and 0088's module CHECK (after
-- deleting any `chat_ai` module rows). The next merge's route calls them and must be reverted first.

alter table org_modules drop constraint if exists org_modules_key_check;
alter table org_modules add constraint org_modules_key_check check (module_key = any (array[
  'hazmatguard', 'training', 'messages', 'notifications', 'dispatch', 'navigation', 'chat_ai'
]));

alter table chat_ledger drop constraint if exists chat_ledger_action_check;
alter table chat_ledger add constraint chat_ledger_action_check check (action in (
  'conversation_created', 'conversation_renamed', 'conversation_archived', 'conversation_restored',
  'member_added', 'member_left', 'member_rejoined', 'member_removed', 'member_role_changed',
  'message_sent', 'message_edited', 'message_retracted',
  'compliance_search', 'compliance_view', 'compliance_export',
  'hold_set', 'hold_released', 'retention_changed', 'retention_purged',
  'team_created', 'team_renamed', 'team_archived',
  'team_member_added', 'team_member_left', 'team_member_removed', 'team_member_rejoined', 'team_role_changed',
  'reaction_added', 'reaction_removed', 'message_pinned', 'message_unpinned',
  'file_attached',
  'ai_catchup'
));

-- The unread lines of one conversation the caller is in, oldest first, at most 200 (the newest 200).
create or replace function chat_catchup_lines(p_org uuid, p_user uuid, p_thread uuid)
returns table (seq bigint, sender_name text, body text, created_at timestamptz, parent_id uuid, file_count integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_read bigint;
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  select p.read_seq into v_read from public.thread_participants p
   where p.thread_id = p_thread and p.user_id = p_user and p.left_at is null;
  return query
    select x.seq, x.sender_name, x.body, x.created_at, x.parent_id, x.file_count from (
      select m.seq, public.chat_display_name(p_org, m.sender_user_id) as sender_name, m.body, m.created_at, m.parent_id,
             (select count(*)::integer from public.chat_attachments f where f.message_id = m.id) as file_count
        from public.messages m
       where m.thread_id = p_thread and m.org_id = p_org and m.seq > coalesce(v_read, 0) and m.deleted_at is null
       order by m.seq desc
       limit 200
    ) x
    order by x.seq;
end;
$$;

-- How many catch-ups the person has left in the last 24 hours.
create or replace function chat_catchup_left(p_org uuid, p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select greatest(20 - count(*)::integer, 0)
    from public.chat_ledger l
   where l.org_id = p_org and l.actor_user_id = p_user and l.action = 'ai_catchup'
     and l.occurred_at > now() - interval '24 hours';
$$;

-- Record one catch-up, after the summary is written: the cap checked again, the ledger row, the tokens
-- counted in the carrier's month. Answers what remains.
create or replace function chat_catchup_record(
  p_org uuid, p_user uuid, p_thread uuid, p_from_seq bigint, p_to_seq bigint, p_lines integer,
  p_model text, p_input_tokens integer, p_output_tokens integer, p_summary_sha256 text
) returns integer
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  if public.chat_catchup_left(p_org, p_user) <= 0 then
    raise exception 'today''s catch-ups are used' using errcode = 'CH017';
  end if;
  if p_summary_sha256 is null or p_summary_sha256 !~ '^[0-9a-f]{64}$' or coalesce(p_lines, 0) < 1
     or coalesce(p_input_tokens, -1) < 0 or coalesce(p_output_tokens, -1) < 0 or nullif(btrim(p_model), '') is null then
    raise exception 'a catch-up names what it read, the model and its tokens' using errcode = 'CH006';
  end if;
  perform set_config('silvicom.chat_actor', p_user::text, true);
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, body_sha256, detail)
  values (p_org, p_user, 'ai_catchup', p_thread, p_summary_sha256,
          jsonb_build_object('from_seq', p_from_seq, 'to_seq', p_to_seq, 'lines', p_lines, 'model', p_model,
                             'input_tokens', p_input_tokens, 'output_tokens', p_output_tokens));
  insert into public.org_usage_month (org_id, yyyymm, input_tokens, output_tokens, runs)
  values (p_org, to_char(now(), 'YYYY-MM'), p_input_tokens, p_output_tokens, 0)
  on conflict (org_id, yyyymm) do update
    set input_tokens  = public.org_usage_month.input_tokens  + excluded.input_tokens,
        output_tokens = public.org_usage_month.output_tokens + excluded.output_tokens,
        updated_at    = now();
  return public.chat_catchup_left(p_org, p_user);
end;
$$;

comment on table public.org_usage_month is
  'Materialised per-org monthly model-token usage (D17). Written ONLY by record_hazmat_run() (0130, with the '
  'hazmat_runs insert), document_read_transition() (0451, with a read''s terminal move) and '
  'chat_catchup_record() (0549, with its ledger row), each in its own transaction. `runs` counts hazmat runs '
  'only. The budget gate reads this, never scans the runs or the reads.';

revoke all on function chat_catchup_lines(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_catchup_left(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_catchup_record(uuid, uuid, uuid, bigint, bigint, integer, text, integer, integer, text) from public, anon, authenticated;
grant execute on function chat_catchup_lines(uuid, uuid, uuid) to service_role;
grant execute on function chat_catchup_left(uuid, uuid) to service_role;
grant execute on function chat_catchup_record(uuid, uuid, uuid, bigint, bigint, integer, text, integer, integer, text) to service_role;
