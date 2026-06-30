-- FleetGuard — 0001 extensions & enums
-- Mirrors docs/02-DATA-MODEL.md §2 (with §10 v1.1 amendments).

-- pgcrypto provides gen_random_uuid() on older Postgres; harmless on newer.
create extension if not exists pgcrypto;

create type user_role        as enum ('admin', 'fleet_manager', 'driver', 'auditor');
create type fuel_type        as enum ('diesel', 'gasoline', 'def', 'electric', 'other');
create type vehicle_status   as enum ('active', 'maintenance', 'retired');
create type anomaly_status   as enum ('open', 'investigating', 'resolved', 'dismissed', 'superseded');
create type anomaly_severity as enum ('low', 'medium', 'high', 'critical');
create type invite_status    as enum ('pending', 'accepted', 'revoked', 'expired');
