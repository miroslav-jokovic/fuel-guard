-- 0052: store an INDEPENDENT idle measure per truck (CP6) — the total engine-on idle seconds from the raw
-- engine-state (park-session) analysis, over the capability window. The Data Confidence panel cross-validates
-- this against the Samsara idle-events total; two independent signals agreeing is strong evidence the idle
-- numbers are real. Written by the idle-capability sync.
alter table vehicles add column if not exists idle_states_sec         bigint;
alter table vehicles add column if not exists idle_states_window_days int;
alter table vehicles add column if not exists idle_states_at          timestamptz;
