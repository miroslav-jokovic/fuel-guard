-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- ONE-TIME BACKFILL — populate tran_time on existing efs_transactions WITHOUT re-uploading any reports.
--
-- Run AFTER apply_0047.sql. This derives the station-local "HH:MM" from the already-stored UTC fueled_at +
-- state, which is EXACTLY what a fresh import would compute (the tz conversion is a clean round-trip, and
-- minutes are never affected by timezone). So this fully replaces re-importing your daily reports for the
-- time fix. Date-only rows (noon-UTC sentinel) are skipped — they have no real time-of-day.
-- Idempotent: only fills rows where tran_time is still NULL.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
update efs_transactions e
set tran_time = to_char(
  (e.fueled_at at time zone coalesce(
    case upper(e.state)
      when 'CT' then 'America/New_York' when 'DE' then 'America/New_York' when 'FL' then 'America/New_York'
      when 'GA' then 'America/New_York' when 'IN' then 'America/New_York' when 'KY' then 'America/New_York'
      when 'MA' then 'America/New_York' when 'MD' then 'America/New_York' when 'ME' then 'America/New_York'
      when 'MI' then 'America/New_York' when 'NC' then 'America/New_York' when 'NH' then 'America/New_York'
      when 'NJ' then 'America/New_York' when 'NY' then 'America/New_York' when 'OH' then 'America/New_York'
      when 'PA' then 'America/New_York' when 'RI' then 'America/New_York' when 'SC' then 'America/New_York'
      when 'VA' then 'America/New_York' when 'VT' then 'America/New_York' when 'WV' then 'America/New_York'
      when 'DC' then 'America/New_York'
      when 'ON' then 'America/Toronto'  when 'QC' then 'America/Toronto'
      when 'NB' then 'America/Halifax'  when 'NS' then 'America/Halifax'  when 'PE' then 'America/Halifax'
      when 'NL' then 'America/St_Johns'
      when 'AL' then 'America/Chicago'  when 'AR' then 'America/Chicago'  when 'IA' then 'America/Chicago'
      when 'IL' then 'America/Chicago'  when 'KS' then 'America/Chicago'  when 'LA' then 'America/Chicago'
      when 'MN' then 'America/Chicago'  when 'MO' then 'America/Chicago'  when 'MS' then 'America/Chicago'
      when 'ND' then 'America/Chicago'  when 'NE' then 'America/Chicago'  when 'OK' then 'America/Chicago'
      when 'SD' then 'America/Chicago'  when 'TN' then 'America/Chicago'  when 'TX' then 'America/Chicago'
      when 'WI' then 'America/Chicago'
      when 'MB' then 'America/Winnipeg' when 'SK' then 'America/Regina'
      when 'AZ' then 'America/Phoenix'
      when 'CO' then 'America/Denver'   when 'ID' then 'America/Denver'   when 'MT' then 'America/Denver'
      when 'NM' then 'America/Denver'   when 'UT' then 'America/Denver'   when 'WY' then 'America/Denver'
      when 'AB' then 'America/Edmonton'
      when 'CA' then 'America/Los_Angeles' when 'NV' then 'America/Los_Angeles'
      when 'OR' then 'America/Los_Angeles' when 'WA' then 'America/Los_Angeles'
      when 'BC' then 'America/Vancouver'
      when 'AK' then 'America/Anchorage' when 'HI' then 'Pacific/Honolulu'
      when 'NT' then 'America/Yellowknife' when 'NU' then 'America/Iqaluit' when 'YT' then 'America/Whitehorse'
      else null
    end, 'UTC')),
  'HH24:MI')
where e.tran_time is null
  and e.fueled_at is not null
  and (e.fueled_at at time zone 'UTC')::time <> '12:00:00';  -- skip date-only (noon-UTC) rows

-- Verify (should match your report exactly, e.g. Kansas City 749 → 00:14):
-- select unit, tran_date, tran_time, state, fueled_at from efs_transactions
-- where tran_time is not null order by fueled_at desc limit 20;
