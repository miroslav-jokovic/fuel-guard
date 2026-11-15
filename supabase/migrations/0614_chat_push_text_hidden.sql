-- Silvicom 360 — 0614 office chat on the phone: a person may keep message text off the lock screen
-- (INSTALLED-APP-PLAN IA-S4; Q-IA4 (a), ruled by the owner 2026-11-15)
--
-- A chat push carries who wrote, where, and the first 80 characters of the line (D-WP4), and a phone shows all
-- of it while locked. The owner ruled that hiding the text is EACH PERSON'S OWN switch, beside Do not disturb:
-- with it on, their devices are told only that a message came and from whom. This file is the schema half; the
-- route, the control and the reworded push are the next merge (a column and its first reader ship in two
-- merges, lint:migration-ordering).
--
-- 1. WHERE IT LIVES. `notification_preferences` (0089) — the row that already holds a person's nightly window
--    and, since 0603, their pause. One boolean beside them, `hide_push_text`, false for everybody: nobody's
--    notifications change until they turn it on. Per PERSON, as the pause is: set on the PC, it holds on the
--    phone, because the phone is where it matters and the PC is where settings get changed.
--
-- 2. WHAT IS DECIDED HERE, AND WHAT IS NOT. Only WHO hides. What a hidden push says is worded where every push
--    is worded (`@silvicom/shared` chatPushContract), so the phone and the in-tab alert cannot disagree. And
--    WHO IS PUSHED is untouched: `chat_push_targets` (0603) is not redefined — a hidden push is still a push,
--    to the same people at the same moment.
--
-- 3. ONE READER FOR ONE PERSON AND FOR MANY. `chat_push_text_hidden_for` takes a list and answers the people in
--    it who hide — the delivery asks about a line's recipients in one call, the control asks about the caller
--    with a list of one. A person with no row has never chosen, and is not in the answer: they see the text,
--    as everybody does today. Somebody who is not an active office member of that organisation is not in it
--    either — the question is not theirs to have answered. (A read that FAILS is a different case and is the
--    caller's to decide; the delivery hides, because the cost of hiding wrongly is one vaguer notification.)
--
-- 4. One writer, through a function (an upsert of a partial payload is refused by lint:upserts), refusing
--    anybody who is not an active office member (WP001, as 0599 and 0603).
--
-- WHY THE OLD CODE MEETS THIS SAFELY: one NOT NULL column with a default that nothing reads yet; every existing
-- insert into `notification_preferences` omits it and gets false; no existing function is changed.
--
-- Rollback: drop the two functions and the column — after the next merge's route and control are reverted.

-- ── 1. The switch ─────────────────────────────────────────────────────────────────────────────────
alter table notification_preferences add column if not exists hide_push_text boolean not null default false;

-- ── 2. Who hides ──────────────────────────────────────────────────────────────────────────────────
create or replace function chat_push_text_hidden_for(p_org uuid, p_users uuid[])
returns table (user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select p.user_id
    from public.notification_preferences p
    join public.memberships mb on mb.org_id = p_org and mb.user_id = p.user_id
                              and mb.suspended_at is null and mb.role <> 'driver'
   where p.user_id = any (p_users)
     and p.hide_push_text
   order by p.user_id;
$$;

-- ── 3. Set it ─────────────────────────────────────────────────────────────────────────────────────
-- Returns what is now stored. `null` is refused rather than read as off: a caller that lost the value must not
-- quietly put a person's message text back on their lock screen.
create or replace function chat_push_hide_text(p_org uuid, p_user uuid, p_hide boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.memberships mb
                  where mb.org_id = p_org and mb.user_id = p_user and mb.suspended_at is null and mb.role <> 'driver') then
    raise exception 'not an active office member of this organisation' using errcode = 'WP001';
  end if;
  if p_hide is null then
    raise exception 'hide is true or false' using errcode = '22023';
  end if;
  insert into public.notification_preferences as p (user_id, org_id, hide_push_text, updated_at)
  values (p_user, p_org, p_hide, now())
  on conflict (user_id) do update set hide_push_text = excluded.hide_push_text, updated_at = now();
  return p_hide;
end;
$$;

-- ── Grants: service role only ─────────────────────────────────────────────────────────────────────
revoke all on function chat_push_text_hidden_for(uuid, uuid[]) from public, anon, authenticated;
revoke all on function chat_push_hide_text(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function chat_push_text_hidden_for(uuid, uuid[]) to service_role;
grant execute on function chat_push_hide_text(uuid, uuid, boolean) to service_role;
