-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHY IS "Driver (card)" STILL EMPTY?  Read-only. Supabase → SQL Editor → Run.
--
-- Four questions, in the order that narrows fastest. The first one that comes back wrong is the
-- answer; the rest are context.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

with

d as (
  select id, card_ref, driver_name, driver_name_source,
         regexp_replace(coalesce(card_ref,''), '\D', '', 'g') as card_digits
  from declined_transactions
),

p as (
  select regexp_replace(coalesce(card_num,''), '\D', '', 'g') as card_digits,
         driver_name, driver_ext_id
  from efs_transactions
),

checks as (

  -- ── 1. DID THE RESOLVER EVER RUN? ────────────────────────────────────────────────────────────
  -- If driver_name_source is null on every row, resolveDeclineDrivers() has not executed: the
  -- migration is applied (this query would error otherwise) but nothing has called it yet. It runs
  -- at reject ingest and inside scoreDeclinedOrg — i.e. the Rejections page's "Rescore" button.
  select 1 as ord, '1. did the resolver run?' as question,
         coalesce(driver_name_source, '(never set)') as answer, count(*)::bigint as rows
  from d group by 1, 3

  -- ── 2. DOES THE POSTED FEED CARRY DRIVER NAMES AT ALL? ───────────────────────────────────────
  -- This is the crux. The XLSX transaction export definitely carries DriverName (verified against
  -- data-samples/transexport-1.xlsx). The SOAP posted feed reads it from the `infos` array as
  -- infoValue(infos,"NAME") — if EFS does not populate that, efs_transactions.driver_name is null
  -- fleet-wide, the Transactions page's Driver column is empty too, and there is nothing to fall
  -- back to.
  union all
  select 2, '2. posted feed driver names',
         case when driver_name is null or btrim(driver_name) = '' then 'NULL / blank' else 'has a name' end,
         count(*)
  from efs_transactions group by 1, 3

  union all
  select 3, '2b. distinct drivers seen in posted rows', 'distinct non-null names',
         count(distinct driver_name) from efs_transactions where nullif(btrim(driver_name),'') is not null

  -- ── 3. DO THE TWO TABLES AGREE ON CARD FORMAT? ───────────────────────────────────────────────
  -- A full 19-digit PAN on one side and a masked last-4 on the other means the join silently
  -- matches nothing. Both sides should read "19".
  union all
  select 4, '3. card number length', 'declines: ' || length(card_digits) || ' digits', count(*)
  from d group by 1, 3
  union all
  select 5, '3. card number length', 'posted rows: ' || length(card_digits) || ' digits', count(*)
  from p group by 1, 3

  -- ── 4. HOW MANY BLANK DECLINES *COULD* BE FILLED FROM POSTED HISTORY, RIGHT NOW? ──────────────
  union all
  select 6, '4. fillable from posted history', 'blank declines whose exact card has a named posted row',
         count(*)
  from d
  where nullif(btrim(d.driver_name),'') is null
    and length(d.card_digits) >= 8
    and exists (
      select 1 from p
      where p.card_digits = d.card_digits
        and nullif(btrim(p.driver_name),'') is not null
    )

  union all
  select 7, '4. fillable from posted history', 'blank declines whose card has NO named posted row',
         count(*)
  from d
  where nullif(btrim(d.driver_name),'') is null
    and length(d.card_digits) >= 8
    and not exists (
      select 1 from p
      where p.card_digits = d.card_digits
        and nullif(btrim(p.driver_name),'') is not null
    )

  -- ── 5. THE CARD FROM THE TOP ROW OF YOUR SCREENSHOT ──────────────────────────────────────────
  -- 7083050030039077420 is BRYANT ALLEN in the sample transaction export. If this returns 0, the
  -- posted feed is not storing the name; if it returns rows, the resolver simply has not run.
  union all
  select 8, '5. one known card (…7420)', 'named posted rows for that exact card',
         count(*)
  from p where card_digits = '7083050030039077420'
    and nullif(btrim(driver_name),'') is not null

  union all
  select 9, '5. one known card (…7420)', 'rows in efs_cards mirror with that last4 + a driver_name',
         count(*)
  from efs_cards
  where card_last4 = '7420' and nullif(btrim(driver_name),'') is not null and absent_since is null
)

select question, answer, rows from checks order by ord, answer;
