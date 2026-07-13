-- 0047: faithful station-local transaction time on efs_transactions.
--
-- The Transactions page must show the time EXACTLY as the EFS report printed it (station-local wall clock).
-- Previously it derived the time from `fueled_at`, which is stored in UTC (the station-local time is converted
-- to UTC on import via the location's timezone), so the page showed the UTC hour — off by the tz offset
-- (e.g. 00:14 Central printed → 05:14 UTC shown). `tran_time` stores the printed "HH:MM" verbatim so display
-- never round-trips through a timezone conversion and cannot drift. Null for date-only reports.
alter table efs_transactions add column if not exists tran_time text;

comment on column efs_transactions.tran_time is
  'Station-local time-of-day (HH:MM) exactly as printed on the EFS report — faithful display, no tz conversion.';
