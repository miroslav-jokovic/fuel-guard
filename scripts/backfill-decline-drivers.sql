-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- BACKFILL the Rejections "Driver (card)" column from posted-transaction history.
--
-- WHY BY HAND RATHER THAN THE RESCORE BUTTON. Rescore calls scoreDeclinedOrg, which loops
-- scoreDeclinedAttempt over EVERY decline — 3,251 rows, each doing a live Samsara reconciliation.
-- That is the right path for SCORING and the wrong one for filling a name: this resolution is a pure
-- join over data already in your database and finishes in one statement. New declines are resolved
-- at ingest from now on, so this is a one-time catch-up.
--
-- THE RULE. An EXACT full-PAN match, and only where every posted row for that card names the SAME
-- person. A card used by two drivers resolves to nobody — a blank cell is a fact; a wrong name on a
-- fraud page is an accusation. Mirrors declineDriverResolution.ts (posted_history branch).
--
-- Run the blocks ONE AT A TIME (Supabase shows only the last statement's result).
-- Nothing is written until BLOCK 2.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCK 1 — DRY RUN. What Block 2 would do. Writes nothing.                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════════════╝

with posted as (
  select regexp_replace(coalesce(card_num,''), '\D', '', 'g') as card_digits,
         btrim(driver_name)                                    as driver_name,
         -- driverMatchKey() in SQL: lowercase, drop punctuation, keep tokens of 2+ chars, sort them.
         -- This is what lets two spellings of one name compare equal instead of looking like two people.
         (select string_agg(t, ' ' order by t)
            from unnest(string_to_array(lower(regexp_replace(driver_name, '[^a-zA-Z]', ' ', 'g')), ' ')) t
           where length(t) > 1)                                as match_key
  from efs_transactions
  where nullif(btrim(driver_name), '') is not null
),
-- Cards whose every posted row names the SAME person. A card used by two drivers appears nowhere below.
card_agree as (
  select card_digits
  from posted
  where length(card_digits) >= 8
  group by card_digits
  having count(distinct match_key) = 1
),
-- Of the spellings that person appears under, display the most common one, preferring the natural
-- "FIRST LAST" form over "LAST, FIRST" — otherwise an alphabetical pick shows the comma form.
spelling as (
  select p.card_digits,
         p.driver_name,
         count(*)                                                as n,
         case when p.driver_name like '%,%' then 1 else 0 end    as comma_form
  from posted p
  join card_agree a on a.card_digits = p.card_digits
  group by p.card_digits, p.driver_name
),
card_driver as (
  select distinct on (card_digits) card_digits, driver_name
  from spelling
  order by card_digits, comma_form, n desc, driver_name
),
target as (
  select d.id, c.driver_name
  from declined_transactions d
  join card_driver c on c.card_digits = regexp_replace(coalesce(d.card_ref,''), '\D', '', 'g')
  where nullif(btrim(d.driver_name), '') is null
)
select
  (select count(*) from declined_transactions where nullif(btrim(driver_name),'') is null) as blank_now,
  (select count(*) from target)                                                            as will_fill,
  (select count(*) from declined_transactions where nullif(btrim(driver_name),'') is null)
    - (select count(*) from target)                                                        as will_stay_blank,
  (select count(distinct driver_name) from target)                                         as distinct_drivers;


-- ╔═══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCK 1b — SAMPLE. The actual names it would write, so you can sanity-check a few.            ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════════════╝

with posted as (
  select regexp_replace(coalesce(card_num,''), '\D', '', 'g') as card_digits,
         btrim(driver_name)                                    as driver_name,
         -- driverMatchKey() in SQL: lowercase, drop punctuation, keep tokens of 2+ chars, sort them.
         -- This is what lets two spellings of one name compare equal instead of looking like two people.
         (select string_agg(t, ' ' order by t)
            from unnest(string_to_array(lower(regexp_replace(driver_name, '[^a-zA-Z]', ' ', 'g')), ' ')) t
           where length(t) > 1)                                as match_key
  from efs_transactions
  where nullif(btrim(driver_name), '') is not null
),
-- Cards whose every posted row names the SAME person. A card used by two drivers appears nowhere below.
card_agree as (
  select card_digits
  from posted
  where length(card_digits) >= 8
  group by card_digits
  having count(distinct match_key) = 1
),
-- Of the spellings that person appears under, display the most common one, preferring the natural
-- "FIRST LAST" form over "LAST, FIRST" — otherwise an alphabetical pick shows the comma form.
spelling as (
  select p.card_digits,
         p.driver_name,
         count(*)                                                as n,
         case when p.driver_name like '%,%' then 1 else 0 end    as comma_form
  from posted p
  join card_agree a on a.card_digits = p.card_digits
  group by p.card_digits, p.driver_name
),
card_driver as (
  select distinct on (card_digits) card_digits, driver_name
  from spelling
  order by card_digits, comma_form, n desc, driver_name
),
target as (
  select d.unit, d.declined_at, right(regexp_replace(coalesce(d.card_ref,''), '\D','','g'), 4) as card_last4,
         c.driver_name
  from declined_transactions d
  join card_driver c on c.card_digits = regexp_replace(coalesce(d.card_ref,''), '\D', '', 'g')
  where nullif(btrim(d.driver_name), '') is null
)
select * from target order by declined_at desc limit 25;


-- ╔═══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCK 2 — THE WRITE. Idempotent: it only ever touches rows that are still blank.              ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════════════╝

with posted as (
  select regexp_replace(coalesce(card_num,''), '\D', '', 'g') as card_digits,
         btrim(driver_name)                                    as driver_name,
         -- driverMatchKey() in SQL: lowercase, drop punctuation, keep tokens of 2+ chars, sort them.
         -- This is what lets two spellings of one name compare equal instead of looking like two people.
         (select string_agg(t, ' ' order by t)
            from unnest(string_to_array(lower(regexp_replace(driver_name, '[^a-zA-Z]', ' ', 'g')), ' ')) t
           where length(t) > 1)                                as match_key
  from efs_transactions
  where nullif(btrim(driver_name), '') is not null
),
-- Cards whose every posted row names the SAME person. A card used by two drivers appears nowhere below.
card_agree as (
  select card_digits
  from posted
  where length(card_digits) >= 8
  group by card_digits
  having count(distinct match_key) = 1
),
-- Of the spellings that person appears under, display the most common one, preferring the natural
-- "FIRST LAST" form over "LAST, FIRST" — otherwise an alphabetical pick shows the comma form.
spelling as (
  select p.card_digits,
         p.driver_name,
         count(*)                                                as n,
         case when p.driver_name like '%,%' then 1 else 0 end    as comma_form
  from posted p
  join card_agree a on a.card_digits = p.card_digits
  group by p.card_digits, p.driver_name
),
card_driver as (
  select distinct on (card_digits) card_digits, driver_name
  from spelling
  order by card_digits, comma_form, n desc, driver_name
)
update declined_transactions d
   set driver_name        = c.driver_name,
       driver_name_source = 'posted_history'
  from card_driver c
 where c.card_digits = regexp_replace(coalesce(d.card_ref,''), '\D', '', 'g')
   and nullif(btrim(d.driver_name), '') is null;


-- ╔═══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCK 3 — link the driver RECORD, so the Driver filter and search work.                       ║
-- ║ Its own statement and its own guard: a link is evidence of a different kind from a name and    ║
-- ║ must not overwrite attribution set at ingest. Two people sharing a key link to neither.        ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════════════╝

with dk as (
  select id,
         (select string_agg(t, ' ' order by t)
            from unnest(string_to_array(lower(regexp_replace(full_name, '[^a-zA-Z]', ' ', 'g')), ' ')) t
           where length(t) > 1) as match_key
  from drivers
),
unique_driver as (
  select match_key, (array_agg(id order by id))[1] as driver_id   -- min() has no uuid overload
  from dk
  where match_key is not null
  group by match_key
  having count(*) = 1
)
update declined_transactions d
   set driver_id = u.driver_id
  from unique_driver u
 where d.driver_id is null
   and d.driver_name_source = 'posted_history'
   and u.match_key = (
     select string_agg(t, ' ' order by t)
       from unnest(string_to_array(lower(regexp_replace(d.driver_name, '[^a-zA-Z]', ' ', 'g')), ' ')) t
      where length(t) > 1
   );


-- ╔═══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCK 4 — verify.                                                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════════════╝

select coalesce(driver_name_source, '(still blank)') as source,
       count(*)                                      as rows,
       count(driver_id)                              as linked_to_a_driver_record
from declined_transactions
group by 1
order by 2 desc;
