-- 0381 — storage for the sign link's 6-digit code (APPLICATION-FLOW-V2-PLAN Q-AW25, Q-AW47 (a), owner
-- 2026-09-28).
--
-- ── WHAT IS MISSING ────────────────────────────────────────────────────────────────────────────
-- D-AW14 puts a 6-digit code, on by default, beside the date of birth on the link the office sends for
-- signing: the date of birth is printed on the CDL photographed in Part 1, so once a link travels it
-- cannot be the only secret. 0376 built the sent link's other two guards (`sign_link_expires_at`,
-- `unlock_failures`, read and written since C3s3a, #1116) and nothing for the code — no digest, no end,
-- no count. A code held only in the api process dies with every deploy and is not seen by the second
-- Railway service, so there is nowhere honest to keep one without this.
--
-- ── WHY THREE COLUMNS ON THE INVITATION, AND NOT A TABLE (Q-AW47) ─────────────────────────────
-- One invitation has one live sign link (every Send for signing rotates it, 0369), so it has one live
-- code: a new send replaces the code exactly as it replaces the link, and the columns sit beside the two
-- D-AW14 already put there. A table of codes, one row per send, was the rejected candidate (b): it keeps
-- a history nobody has asked for, and each send already writes an audit row.
--
--   sign_code_hash        the code's digest, 64 hex. ⚠ A 6-digit code has a million values, so a plain
--                         SHA-256 of it is reversed from a leaked row in well under a second; C3s3b
--                         writes a KEYED digest (HMAC-SHA-256 under a server secret), which this column
--                         cannot tell apart and does not need to. It is never looked up BY value — the
--                         invitation is found by its token first — so no index.
--   sign_code_expires_at  when the code stops being accepted. Paired with the digest by a CHECK: a code
--                         with no end is the one state this guard exists to prevent, and an end with no
--                         code is a row two writers disagree about.
--   sign_code_failures    wrong codes presented. Its own count, not `unlock_failures`: the two guards
--                         fail for different reasons (a mistyped birthday, a mistyped code), and the page
--                         and the office's panel say which one stopped the link.
--
-- ── COLUMNS ONLY. THE READER IS THE NEXT MERGE (C3s3b) ────────────────────────────────────────
-- Railway serves a merge before `migrate.yml` has applied its schema (`lint:migration-ordering`,
-- docs/MIGRATION-DISCIPLINE.md §the-deploy-window). Not one line of TypeScript reads or writes these
-- until C3s3b, which is written only after this is verified applied in production. What C3s3b decides —
-- which channel carries the code, how long it lives, how many wrong codes stop the link, and the key —
-- is not fixed here: the constraints below hold for every answer the plan's Q-AW49 lists.
--
-- ⚠ No client policy is added: `application_invitations` has none (0220), so it stays service-role
-- only, and the digest is as unreachable from a browser as the three token hashes beside it.
alter table public.application_invitations
  add column if not exists sign_code_hash       text,
  add column if not exists sign_code_expires_at timestamptz,
  add column if not exists sign_code_failures   smallint not null default 0;

alter table public.application_invitations drop constraint if exists application_invitations_sign_code_hash_check;
alter table public.application_invitations add constraint application_invitations_sign_code_hash_check
  check (sign_code_hash is null or sign_code_hash ~ '^[0-9a-f]{64}$');

alter table public.application_invitations drop constraint if exists application_invitations_sign_code_pair_check;
alter table public.application_invitations add constraint application_invitations_sign_code_pair_check
  check ((sign_code_hash is null) = (sign_code_expires_at is null));

alter table public.application_invitations drop constraint if exists application_invitations_sign_code_failures_check;
alter table public.application_invitations add constraint application_invitations_sign_code_failures_check
  check (sign_code_failures >= 0);

comment on column public.application_invitations.sign_code_hash is
  'Q-AW25/Q-AW47 (0381): keyed digest (HMAC-SHA-256, 64 hex) of the 6-digit code that guards the link sent for signing, beside the date of birth. Replaced on every Send for signing. Never a plain SHA-256: a million possible codes are reversed from one in under a second. Null when no code is live.';
comment on column public.application_invitations.sign_code_expires_at is
  'Q-AW25/Q-AW47 (0381): when the sign code stops being accepted. Set exactly when sign_code_hash is (application_invitations_sign_code_pair_check).';
comment on column public.application_invitations.sign_code_failures is
  'Q-AW25/Q-AW47 (0381): wrong sign codes presented on the sent link. Separate from unlock_failures (wrong dates of birth) so the page and the office can say which guard stopped the link. Reset on every Send for signing.';
