-- 0111: current HOS status per driver, from Samsara /fleet/hos/clocks (the live "current duty status for all
-- drivers" feed the fuel planner already uses). Written by the HOS sync so the Drivers page + Assignments board
-- can show who is Off Duty / Sleeper / Driving / On Duty right now, and which truck they're on — without a
-- second historical pull. Purely display state; refreshed each sync, never entered by hand.
alter table drivers add column if not exists current_hos_status text;      -- off_duty|sleeper|driving|on_duty|yard_move|personal_conveyance|unknown
alter table drivers add column if not exists current_hos_vehicle text;     -- current truck unit name from Samsara
alter table drivers add column if not exists current_hos_at timestamptz;   -- when this snapshot was taken

comment on column drivers.current_hos_status is 'Live HOS duty status from Samsara /fleet/hos/clocks. Display only; refreshed by the HOS sync.';
