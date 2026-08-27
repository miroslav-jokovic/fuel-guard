-- Ownership lands in the catalog for every table that never had a comment (D-SEP2,
-- docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md P2.6). scripts/table-modules.json is the
-- machine-read source of ownership; these comments are its rendering into the one place
-- pg_dump, psql \d+ and a DBA at 2am all look. GENERATED from the manifest by the P2.6 PR —
-- the 31 tables that already carry a curated comment are deliberately untouched
-- (COMMENT ON TABLE replaces, and clobbering incident-bought prose to add two tags is a bad
-- trade); their ownership lives in the manifest like everyone else's.
--
-- cross-module-waiver: comments-only, no DDL and no DML — it names every module's tables
-- because that is the point.
-- raw-access-waiver: comments-only; the raw tables named below are labelled, not read.

comment on table anomalies is 'module=anomalies; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table anomaly_thresholds is 'module=anomalies; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table application_invitations is 'module=recruiting; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table audit_logs is 'module=org; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table case_pattern_reports is 'module=anomalies; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table certifications is 'module=evidence; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table declined_transactions is 'module=fuel; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table device_push_tokens is 'module=messaging; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table driver_app_feature_overrides is 'module=driver-app; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table driver_app_features is 'module=driver-app; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table driver_applications is 'module=recruiting; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table driver_duty_sessions is 'module=driver-app; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table driver_performance_settings is 'module=performance; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table driver_performance_weeks is 'module=performance; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table driver_scores is 'module=performance; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table driver_time_off is 'module=roster; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table driver_vehicle_assignments is 'module=roster; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table drivers is 'module=roster; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table duty_equipment_segments is 'module=driver-app; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table efs_card_control_approvers is 'module=efs; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table efs_card_control_settings is 'module=efs; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table efs_cards is 'module=efs; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table efs_processing_runs is 'module=efs; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table efs_transactions is 'module=efs; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table financial_entries is 'module=financial; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_cards is 'module=fuel; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_discount_rules is 'module=fuel; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_events is 'module=samsara; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_exception_events is 'module=fuel-spend; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_exceptions is 'module=fuel-spend; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_plans is 'module=routing; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_price_days is 'module=fuel; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_prices is 'module=posted-prices; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_prices_posted is 'module=posted-prices; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_recon_runs is 'module=fuel-spend; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_spend_days is 'module=fuel-spend; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_statement_lines is 'module=fuel-spend; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_statements is 'module=fuel-spend; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_stations is 'module=fuel; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table fuel_transactions is 'module=fuel; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table geocode_cache is 'module=routing; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table hazmat_documents is 'module=hazmat; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table hazmat_loads is 'module=hazmat; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table hazmat_policies is 'module=hazmat; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table hazmat_reviews is 'module=hazmat; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table hazmat_runs is 'module=hazmat; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table idle_events is 'module=idle; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table idle_park_sessions is 'module=idle; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table idle_settings is 'module=idle; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table idle_telemetry_windows is 'module=idle; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table import_rows is 'module=efs; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table imports is 'module=efs; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table integration_credentials is 'module=org; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table invites is 'module=org; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table jobs is 'module=org; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table load_events is 'module=loads; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table load_stop_photos is 'module=loads; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table load_stops is 'module=loads; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table loads is 'module=loads; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table mcleod_ap_vouchers is 'module=mcleod; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table mcleod_billing is 'module=mcleod; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table mcleod_settlements is 'module=mcleod; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table memberships is 'module=org; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table message_reports is 'module=messaging; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table message_threads is 'module=messaging; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table messages is 'module=messaging; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table migration_markers is 'module=org; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table notification_events is 'module=messaging; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table notification_preferences is 'module=messaging; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table notification_reads is 'module=messaging; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table org_integrations is 'module=org; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table org_modules is 'module=org; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table organizations is 'module=org; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table pattern_sweep_requests is 'module=anomalies; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table platform_admins is 'module=org; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table platform_audit_log is 'module=org; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table qualification_records is 'module=evidence; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table route_fuel_settings is 'module=routing; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table route_geometries is 'module=routing; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table samsara_ifta_fetches is 'module=samsara; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table samsara_ifta_jurisdiction_miles is 'module=samsara; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table station_geocode_learned is 'module=fuel; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table support_impersonation_grants is 'module=org; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table thread_participants is 'module=messaging; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table tms_movements is 'module=mcleod; layer=raw (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table trailers is 'module=roster; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table vehicle_engine_days is 'module=idle; layer=derived (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table vehicles is 'module=roster; layer=core (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
comment on table weather_cache is 'module=idle; layer=infra (0265, D-SEP2; scripts/table-modules.json is the machine-read source).';
