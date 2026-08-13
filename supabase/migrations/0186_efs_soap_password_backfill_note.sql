-- FuelGuard — 0186 document the sealed-password backfill ordering.
--
-- Migration 0185 adds the sealed column. Apply 0185, deploy the API that reads sealed-or-legacy,
-- then run the backfill. The dry run is the default and writes nothing; use --apply only after the
-- deployed API's SECRETS_ENCRYPTION_KEY has been verified against existing sealed material.
comment on column efs_soap_credentials.soap_password_sealed is
  'AES-256-GCM secretBox envelope, AAD fuelguard:efs_soap_password.v1:<org_id>; null only for legacy rows or disabled credentials. Backfill with pnpm backfill:efs-soap-passwords (dry run by default; use --apply to write) after applying 0185 and deploying the sealed-read API.';

comment on column efs_soap_credentials.soap_password is
  'Legacy plaintext fallback during the 0185 migration; new writes blank this column after sealing. Ordering: apply 0185, deploy the sealed-read API, then run pnpm backfill:efs-soap-passwords.';
