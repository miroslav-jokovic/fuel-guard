-- 0113: HOS duty segments — link historical rows + index the duty-split read path.
--
-- Context: the table grew past 500k rows (a deep historical backfill ran before driver matching was
-- improved), leaving ~2/3 of rows with driver_id null even though the driver now exists with that
-- samsara_driver_id. The sync only re-links rows inside its rolling window, so older rows stayed unlinked
-- and useless to the Idling page's rest/on-duty split. This one-time backfill links them.
update hos_duty_segments s
set driver_id = d.id,
    updated_at = now()
from drivers d
where s.driver_id is null
  and d.org_id = s.org_id
  and d.samsara_driver_id = s.samsara_driver_id;

-- The duty-split query reads (org via RLS) + started_at range + driver_id is not null, ordered on
-- (started_at, id). A partial index serves exactly that page shape without sorting the full window.
create index if not exists idx_hos_seg_org_time_linked
  on hos_duty_segments (org_id, started_at, id)
  where driver_id is not null;

-- NOTE (run separately, outside a transaction, after applying this migration):
--   vacuum (analyze) hos_duty_segments;
-- The old sync rewrote the full 30-day window (~100k rows) every 6 hours, so the table and its indexes
-- carry heavy bloat; the sync now diffs before writing, and a one-time vacuum reclaims the dead space.
