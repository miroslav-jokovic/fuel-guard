-- FuelGuard — 0091 EFS SOAP integration credentials (docs/plans/EFS-SOAP-INTEGRATION-PLAN.md §5.3)
--
-- Per-org credentials for the in-house EFS SOAP webservice (posted transactions + rejected authorization
-- attempts, one credential set for both feeds). Follows the Samsara pattern (0012): one dedicated table
-- per outbound integration provider, service-role-only (no client RLS policies) since it holds a
-- password.
--
-- Runtime state stored here:
--   • endpoint_url + environment           — SOAP endpoint + sandbox|production selection
--   • soap_username + soap_password        — custom CardManagementWS login credentials
--   • account_id                           — optional account metadata; not sent in transaction requests
--   • posted_last_cursor / rejected_last_cursor — last completed date-time window end, stored as text
--       because the SOAP contract uses date ranges rather than an opaque server cursor
--   • posted_last_polled_at / rejected_last_polled_at — freshness for the UI + monitoring
--   • enabled                              — kill switch; scheduler skips this org when false
--
-- Design decisions:
--   • Separate cursors per feed so a slow posted-backfill can never rewind rejected polling (and vice
--     versa).
--   • Text cursors preserve the last completed ISO date-time window end and allow a 48-hour overlap.
--   • `environment` supports sandbox and production without changing the credential shape.
--   • No RLS policies → service-role only → the API is the only reader/writer, matching how the API
--     already handles the Samsara token in integration_credentials.
--
-- Rollback: drop table efs_soap_credentials.

create table if not exists efs_soap_credentials (
  org_id                    uuid primary key references organizations(id) on delete cascade,
  environment               text not null default 'sandbox'
                              check (environment in ('sandbox', 'production')),
  endpoint_url              text not null,
  soap_username             text not null,
  soap_password             text not null,
  account_id                text,
  posted_last_cursor        text,
  rejected_last_cursor      text,
  posted_last_polled_at     timestamptz,
  rejected_last_polled_at   timestamptz,
  posted_last_success_at    timestamptz,
  rejected_last_success_at  timestamptz,
  posted_last_error         text,
  rejected_last_error       text,
  enabled                   boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table efs_soap_credentials is
  'Per-org EFS SOAP webservice credentials + delta-poll cursors. Service-role only (no client RLS).';

create trigger trg_efs_soap_credentials_updated
  before update on efs_soap_credentials
  for each row execute function set_updated_at();

alter table efs_soap_credentials enable row level security;
-- No client policies → only the service role (API) can read/write the password + cursors.
