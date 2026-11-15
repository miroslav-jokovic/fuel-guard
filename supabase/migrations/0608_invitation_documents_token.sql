-- 0608 — a link that opens only the documents list (APPLICATION-FIX-PLAN.md, owner's Q-AM19 ruling of
-- 2026-11-11: "the office can send a separate documents-only link at any time, opening just the photo
-- list").
--
-- ── WHAT THE GAP IS ───────────────────────────────────────────────────────────────────────────────
-- A driver who said "I don't have my CDL with me" (0605), or whose medical card arrives next week, has
-- one way to send the photograph: the application link, the whole of it. The office has no way to say
-- "just send me the card" — and the application's own link is the wrong thing to re-send for one
-- photograph: it is behind the date of birth, and it lapses with the application's clock.
--
-- ── THE SHAPE ─────────────────────────────────────────────────────────────────────────────────────
-- A FOURTH token on the invitation, beside the email's (`token_hash`), the signing link's
-- (`sign_token_hash`, 0345) and the text's (`sms_token_hash`, 0378):
--   docs_token_hash        sha-256 of the documents link's token; null until the office sends one
--   docs_link_expires_at   that link's own end
-- ⚠ Its OWN end, not the invitation's `expires_at`: the office sends this weeks after the application's
-- link has lapsed, and extending `expires_at` to carry it would re-open the three other links — one of
-- which reads back a date of birth and six signed instruments (the exposure M3 closed, 2026-10-20).
-- A token and its end are set together or not at all (the CHECK).
--
-- ── THE ROTATION, AS ONE GUARDED STATEMENT ────────────────────────────────────────────────────────
-- `rotate_invitation_docs_token`, as 0378's text token is rotated: each send mints a new token, so the
-- last link sent is the only one that works. Guarded in the statement, not by the caller: a revoked
-- invitation is never handed a working link. It does NOT refuse a lapsed or a submitted invitation —
-- that is the point of the link having its own end.
--
-- ── WHY ITS OWN MERGE ─────────────────────────────────────────────────────────────────────────────
-- Two columns on a table code already reads: the resolver that accepts the token, the office's Send
-- and the page that opens on the documents list ship in the next merges (`lint:migration-ordering`,
-- MIGRATION-DISCIPLINE.md §the-deploy-window). Nothing calls the function yet, and no existing token
-- lookup names these columns, so code on either side of this migration behaves as before.
--
-- cross-module-waiver: none — recruiting's table and recruiting's function.

alter table public.application_invitations
  add column if not exists docs_token_hash text
    constraint application_invitations_docs_token_hash_check check (docs_token_hash is null or docs_token_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists docs_link_expires_at timestamptz;

alter table public.application_invitations
  drop constraint if exists application_invitations_docs_link_pair_check;
alter table public.application_invitations
  add constraint application_invitations_docs_link_pair_check
  check ((docs_token_hash is null) = (docs_link_expires_at is null));

-- The resolver looks an invitation up BY the hash, so two rows sharing one would answer "invalid link"
-- to a driver holding a good one. Partial: only rows that were sent a documents link have one.
create unique index if not exists application_invitations_docs_token_hash_key
  on public.application_invitations (docs_token_hash)
  where docs_token_hash is not null;

comment on column public.application_invitations.docs_token_hash is
  'Q-AM19 (0608): SHA-256 of the FOURTH token — the documents-only link the office sends. Rotated by every send (rotate_invitation_docs_token), so only the last link sent works. Null until one is sent.';
comment on column public.application_invitations.docs_link_expires_at is
  'Q-AM19 (0608): the documents-only link''s own end, set with its token. Deliberately not expires_at: this link is sent after the application''s own link has lapsed, and must not revive the others.';

create or replace function public.rotate_invitation_docs_token(
  p_org        uuid,
  p_invitation uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'docs_token_hash_invalid' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'docs_link_expiry_invalid' using errcode = '22023';
  end if;

  update public.application_invitations
     set docs_token_hash = p_token_hash,
         docs_link_expires_at = p_expires_at
   where id = p_invitation
     and org_id = p_org
     and revoked_at is null;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.rotate_invitation_docs_token(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.rotate_invitation_docs_token(uuid, uuid, text, timestamptz) to service_role;

comment on function public.rotate_invitation_docs_token(uuid, uuid, text, timestamptz) is
  'Q-AM19 (0608): mint the documents-only link — set its token hash and its own end in one guarded statement. True when written; false for an invitation that is revoked, or not this org''s. Does not refuse a lapsed or submitted invitation: the link has its own end. Refuses a malformed hash or a past end (22023).';
