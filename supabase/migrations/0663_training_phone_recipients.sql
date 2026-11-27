-- Silvicom 360 — a safety-training link may go to a person by phone number, not only to a driver on
-- the roster (SEGMENT-QUIZ-2026-11-25.md progress log 2026-11-27, owner: "we should be able to send
-- this directly to some phone number as option instead just to drivers from list"; "do as proposed").
--
-- An assignment now belongs to EXACTLY ONE of: a driver of the carrier (as before), or a recipient
-- the office names and gives a phone number. The check below makes "neither" and "both" impossible,
-- so no reader ever has to guess which it is. The number is held as E.164 (+1 and ten digits, a
-- US/Canada number): the API normalises what the office types before it writes, and the CHECK is the
-- authority. Who a link was sent to is part of what was sent, so both fields join 0648's TR021 list
-- and never change after the insert; a mistyped number is a new send and the old link revoked.
--
-- Texting such a number is NOT enabled by this: the only verified texting number is the applicant
-- one, which may not carry training texts (Q-TR9 (c), refused). Until the driver-operations number
-- (Q-TR9 (a)) is verified, the office copies the link (`last_sent_via = 'copy'`).
--
-- Deploy window (docs/MIGRATION-DISCIPLINE.md): dropping NOT NULL and adding two nullable columns is
-- safe for the code already deployed, which always writes `driver_id` and never reads the new
-- columns. Their first reader ships in the NEXT merge (lint:migration-ordering).

alter table public.training_assignments alter column driver_id drop not null;

alter table public.training_assignments
  add column if not exists recipient_name text,
  add column if not exists recipient_phone text;

alter table public.training_assignments
  add constraint training_assignments_one_recipient check (
    (driver_id is not null and recipient_name is null and recipient_phone is null)
    or (driver_id is null and recipient_name is not null and recipient_phone is not null)
  ),
  add constraint training_assignments_recipient_name_check check (
    recipient_name is null or char_length(btrim(recipient_name)) between 1 and 120
  ),
  add constraint training_assignments_recipient_phone_check check (
    recipient_phone is null or recipient_phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'
  );

-- The office's Progress tab lists a carrier's phone-number recipients; find a person sent twice.
create index if not exists ix_training_assignments_recipient_phone
  on public.training_assignments (org_id, recipient_phone) where recipient_phone is not null;

-- 0648's guard, with the recipient added to what an assignment keeps (TR021), and TR022 read for a
-- driver only: moving a phone recipient's assignment onto a driver, or a driver's onto nobody, is
-- refused by the one-recipient CHECK and by TR021, never by a lookup that a null would pass.
create or replace function public.training_assignment_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from organizations o where o.id = old.org_id) then
      raise exception 'a training assignment is revoked, never deleted' using errcode = 'TR020';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.course_id is distinct from old.course_id
     or new.lesson_ids is distinct from old.lesson_ids or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.recipient_name is distinct from old.recipient_name or new.recipient_phone is distinct from old.recipient_phone
     or (old.driver_id is null) <> (new.driver_id is null) then
    raise exception 'a training assignment keeps what was sent; send a new one' using errcode = 'TR021';
  end if;
  if new.driver_id is distinct from old.driver_id
     and not exists (select 1 from drivers d where d.id = new.driver_id and d.org_id = old.org_id) then
    raise exception 'a training assignment moves only to a driver of the same carrier' using errcode = 'TR022';
  end if;
  if old.revoked_at is not null and (new.revoked_at is distinct from old.revoked_at or new.token_hash is distinct from old.token_hash) then
    raise exception 'a revoked training link stays revoked' using errcode = 'TR023';
  end if;
  return new;
end;
$$;
