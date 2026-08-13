-- FuelGuard — 0185 seal EFS SOAP passwords at rest
--
-- New writes use `soap_password_sealed` with AES-256-GCM and AAD
-- `fuelguard:efs_soap_password.v1:<org_id>`. Existing `soap_password` values remain readable by the
-- API during the deploy window and are cleared by the one-shot backfill:
--   pnpm exec tsx scripts/backfill-efs-soap-passwords.ts
--
-- The deploy encryption key is intentionally not available to Postgres, so the backfill runs through
-- the service-role API code rather than attempting unauthenticated SQL encryption.

alter table efs_soap_credentials
  add column if not exists soap_password_sealed text;

comment on column efs_soap_credentials.soap_password_sealed is
  'AES-256-GCM secretBox envelope, AAD fuelguard:efs_soap_password.v1:<org_id>; null only for legacy rows or disabled credentials';

comment on column efs_soap_credentials.soap_password is
  'Legacy plaintext fallback during the 0185 migration; new writes blank this column after sealing';
