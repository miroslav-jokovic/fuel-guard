-- FuelGuard — 0022 declined-attempt theft scoring
-- A declined fuel-card attempt can itself be a theft attempt (card used where the truck isn't, repeated
-- tries, or a decline followed by an approval elsewhere). Store a suspicion assessment on each decline.
alter table declined_transactions add column if not exists suspicion_level            text;   -- clear | review | alert
alter table declined_transactions add column if not exists suspicion_reasons          jsonb not null default '[]';
alter table declined_transactions add column if not exists samsara_location_matched   boolean;
alter table declined_transactions add column if not exists samsara_location_confidence text;   -- gps_confirmed | in_state | mismatch | unknown
alter table declined_transactions add column if not exists station_lat                numeric(9,6);
alter table declined_transactions add column if not exists station_lng                numeric(9,6);
alter table declined_transactions add column if not exists scored_at                  timestamptz;
create index if not exists idx_declined_suspicion on declined_transactions (org_id, suspicion_level);
