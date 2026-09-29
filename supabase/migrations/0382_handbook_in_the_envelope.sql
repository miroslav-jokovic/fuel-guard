-- 0382 — the handbook opens with the packet's envelope (APPLICATION-FLOW-V2-PLAN D-AW16), and 0381's
-- sign-code columns go (Q-AW25 withdrawn by the owner, 2026-09-29; plan §8.6 items 1 and 6).
--
-- ── WHAT BLOCKS D-AW16 TODAY ───────────────────────────────────────────────────────────────────
-- D-AW16 is one envelope at step 13: packet places → certification (files the packet) → handbook
-- places → the office countersigns. The office's Send for signing (C3s3a) opens the packet by
-- stamping `signing_opened_at` (0369). The handbook still waits for a SECOND office press:
--
--   · `handbook_marks_guard` refuses every handbook mark until `handbook_signing_opened_at` is set
--     (HB023, 0374; 0380's copy), and
--   · `application_invitations_handbook_order_check` refuses the handbook's filing unless that same
--     stamp is set.
--
-- So the driver who has just filed the packet on their phone stops, and the office presses "Open
-- handbook signing" before they can go on. This migration lets the sent envelope count as the
-- opening, in both places, and changes nothing else about the order.
--
-- ── WHAT STAYS EXACTLY AS IT WAS ───────────────────────────────────────────────────────────────
--   · HB022 — no handbook mark before the packet is filed. D-AW16's order is packet, certification,
--     THEN handbook, so this is the order the envelope walks, not an obstacle to it. (The plan's first
--     draft of D-AW16 loosened HB022 to "signing opened or filed"; that would let a handbook be signed
--     before the application it belongs to, which D-AW16 itself orders against. Not done.)
--   · HB020, HB021, HB024, HB011 and 0380's purge branch — copied unchanged.
--   · The order check's first two clauses: `handbook_signing_opened_at` still needs a filed application
--     and a named opener. An invitation opened the old way keeps working until C3s4b retires that
--     button (§8.6 item 5); nothing here reads or writes the stamp.
--
-- ── WHY `signing_opened_at` AND NOT A NEW STAMP ────────────────────────────────────────────────
-- It is the envelope's opening already: one press, one link (D-AW14), and it is set once and never
-- cleared (0369). A second column saying the same thing would be the copy CLAUDE.md calls a workaround.
--
-- ── 0381's COLUMNS ─────────────────────────────────────────────────────────────────────────────
-- 0381 added `sign_code_hash`, `sign_code_expires_at` and `sign_code_failures` for Q-AW25's 6-digit
-- code; the owner withdrew the code the day after it was applied. Nothing has ever read or written them
-- (0 rows with a code in production, 2026-09-29; no TypeScript names them), so dropping them cannot
-- break a request in the deploy window. `drop column` removes their constraints with them.
--
-- ⚠ No reader in this merge is needed for the handbook half: it only ACCEPTS more. C3s4b is the page
-- that walks straight from the packet into the handbook, after this is verified applied.

-- ── 1. handbook_marks_guard: the envelope opens the handbook ─────────────────────────────────
create or replace function public.handbook_marks_guard()
returns trigger
language plpgsql
as $$
declare
  inv record;
begin
  if TG_OP = 'DELETE' and public.purging_applicant_invitation(old.invitation_id) then
    return old;
  end if;
  if TG_OP <> 'INSERT' then
    raise exception 'handbook_marks is append-only' using errcode = 'HB011';
  end if;

  select org_id, expires_at, revoked_at, submitted_at, signing_opened_at, handbook_signing_opened_at, handbook_filed_at
    into inv
    from application_invitations
   where id = new.invitation_id;

  if not found or inv.org_id <> new.org_id then
    raise exception 'handbook_invitation_not_found' using errcode = 'HB020';
  end if;
  if inv.revoked_at is not null or inv.expires_at <= now() then
    raise exception 'handbook_invitation_unusable' using errcode = 'HB021';
  end if;
  if inv.submitted_at is null then
    raise exception 'handbook_application_not_filed' using errcode = 'HB022';
  end if;
  -- D-AW16 (0382): the envelope the office sent (`signing_opened_at`) opens the handbook too. The
  -- separate opening (`handbook_signing_opened_at`) is still honoured until C3s4b retires it.
  if inv.signing_opened_at is null and inv.handbook_signing_opened_at is null then
    raise exception 'handbook_signing_not_opened' using errcode = 'HB023';
  end if;
  if inv.handbook_filed_at is not null then
    raise exception 'handbook_already_filed' using errcode = 'HB024';
  end if;
  return new;
end;
$$;

-- ── 2. The order check: filed once opened, by either door ────────────────────────────────────
alter table public.application_invitations drop constraint if exists application_invitations_handbook_order_check;
alter table public.application_invitations add constraint application_invitations_handbook_order_check check (
  (handbook_signing_opened_at is null or submitted_at is not null)
  and ((handbook_signing_opened_at is null) = (handbook_signing_opened_by is null))
  and (handbook_filed_at is null or handbook_signing_opened_at is not null or signing_opened_at is not null)
);

-- ── 3. 0381's sign-code columns (Q-AW25 withdrawn) ───────────────────────────────────────────
alter table public.application_invitations
  drop column if exists sign_code_hash,
  drop column if exists sign_code_expires_at,
  drop column if exists sign_code_failures;
