-- 0560 — a phone number written with its `+` keeps its own country (2026-11-03 lead-path audit, M5).
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- 0554's `phone_e164` (and `normalisePhone`, its TypeScript twin) dropped the `+` before testing the
-- length, so a 10-digit international number written in full — `+49 30 123456` — was US-defaulted to
-- `+14930123456`: a different person's number, inside a dedupe that matches people by phone (D-LS10).
-- And an international number written with spaces — `+52 1 55 1234 5678` — became null, so a person who
-- typed their number correctly could not be matched at all.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- `phone_e164` redefined whole: a value that starts with `+` (after trimming) is the person's own
-- E.164 — its digits, spaces, dashes and brackets dropped, kept if valid E.164 and never US-defaulted;
-- everything else is read as before (10 digits → +1, 11 digits starting 1 → +). A bare value that is
-- neither is null, as before. `normalisePhone` changes in the same PR, value for value; the parity
-- matrix (`recruiting-lead-functions.test.mjs`) gains the cases.
--
-- ⚠ DEPLOY WINDOW: a function body only. In the minutes between, old TypeScript and new SQL (or the
-- reverse) disagree only on a `+` number that is 10 digits or carries spaces — a lead that would be
-- matched one way or the other, never refused or lost. Rows already stored are not rewritten.

create or replace function public.phone_e164(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when t like '+%' then case when d ~ '^[1-9][0-9]{7,14}$' then '+' || d else null end
    when length(d) = 10 then '+1' || d
    when length(d) = 11 and left(d, 1) = '1' then '+' || d
    else null
  end
  from (select btrim(coalesce(p_raw, '')) as t, regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g') as d) x;
$$;

revoke all on function public.phone_e164(text) from public, anon, authenticated;
