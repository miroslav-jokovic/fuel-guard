-- FuelGuard — 0106 EFS SOAP client certificates (mutual TLS)
--
-- Per-org client certificates for the EFS CardManagementWS endpoint, with staged rotation and
-- history. Complements 0091 (efs_soap_credentials): that table holds WHO we log in as, this one holds
-- WHAT CERTIFICATE we present at the TLS layer. They are separate because their lifecycles are
-- separate — a password rotates on our schedule, a certificate rotates on the issuer's, and a
-- certificate must be stage-then-activate (you cannot atomically swap a TLS identity by editing a
-- column and hoping the next request works).
--
-- ── Why a table and not columns on efs_soap_credentials ─────────────────────────────────────────
--   • Rotation needs TWO live rows: the certificate currently presenting, and the next one being
--     validated against the live endpoint before it takes over. Columns force a destructive swap.
--   • Rollback needs the previous row to still exist. `retired` rows are kept, so a bad activation is
--     undone in one call instead of a re-upload under pressure.
--   • The retired rows ARE the audit trail an assessor asks for: which certificate was presenting on
--     a given date, who installed it, when it was retired and why.
--
-- ── Secret handling ─────────────────────────────────────────────────────────────────────────────
-- `cert_pem` and `ca_pem` are PUBLIC material — stored as-is, and deliberately so: an operator must
-- be able to read back exactly what is installed.
--
-- `key_sealed` and `key_passphrase_sealed` hold the PRIVATE key, AES-256-GCM sealed by the API
-- (lib/secretBox.ts) under SECRETS_ENCRYPTION_KEY, which lives in the deploy environment and never in
-- this database. The seal is bound (via GCM additional authenticated data) to this org id and to the
-- purpose string, so a ciphertext lifted into another org's row fails to open rather than decrypting.
-- Consequence, and the point of the exercise: a database dump, a logical replica, or a read-only
-- analytics grant does NOT yield a usable client certificate.
--
-- RLS is enabled with NO policies — service-role only, same posture as 0091. Even so, the private key
-- is never in plaintext at rest, because "only the service role can read it" is a statement about
-- access control, not about backups.
--
-- ── Rollback ────────────────────────────────────────────────────────────────────────────────────
--   drop table efs_soap_client_certs;
-- The API treats an absent table as "no client certificate configured" and falls back to the
-- deploy-wide env vars, then to ordinary TLS — so dropping it is safe and non-breaking.

create table if not exists efs_soap_client_certs (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references organizations(id) on delete cascade,

  -- pending  → uploaded and validated, NOT presenting yet (test it, then activate)
  -- active   → the certificate presented on every EFS SOAP call for this org (at most one)
  -- retired  → superseded or withdrawn; kept for history and one-call rollback
  status                 text not null default 'pending'
                           check (status in ('pending', 'active', 'retired')),

  -- Public material, stored verbatim so an operator can read back what is installed.
  cert_pem               text not null,   -- leaf first, then any intermediates
  ca_pem                 text,            -- extra trust anchors for EFS's server cert, if needed

  -- Private material, sealed. Format: v1.<key-id>.<iv>.<tag>.<ciphertext> (lib/secretBox.ts).
  key_sealed             text not null,
  key_passphrase_sealed  text,

  -- Denormalised, non-secret certificate facts. Kept as columns (not re-parsed on read) so expiry
  -- monitoring, the settings UI and the audit trail are plain SQL and stay queryable after the PEM
  -- itself is gone.
  fingerprint_sha256     text not null,
  subject                text not null,
  issuer                 text not null,
  serial_number          text not null,
  key_type               text,
  not_before             timestamptz not null,
  not_after              timestamptz not null,

  -- Handshake outcome, written by the SOAP client. This is what turns "EFS is broken" into
  -- "our certificate was rejected at 04:12, here is the TLS alert".
  last_handshake_at      timestamptz,
  last_handshake_ok      boolean,
  last_handshake_error   text,

  -- Lifecycle + attribution.
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id),
  activated_at           timestamptz,
  activated_by           uuid references auth.users(id),
  retired_at             timestamptz,
  retired_by             uuid references auth.users(id),
  retired_reason         text,
  updated_at             timestamptz not null default now()
);

comment on table efs_soap_client_certs is
  'Per-org EFS SOAP client certificates (mTLS) with staged rotation. Private keys are AES-256-GCM sealed under SECRETS_ENCRYPTION_KEY; service-role only.';
comment on column efs_soap_client_certs.key_sealed is
  'AES-256-GCM envelope (lib/secretBox.ts), AAD-bound to org_id + purpose. NEVER returned by any API.';
comment on column efs_soap_client_certs.fingerprint_sha256 is
  'Lowercase, colon-free SHA-256 of the leaf DER. The identifier used in audit logs, connection-pool keys and operator-facing UI.';

-- At most ONE active and ONE pending certificate per org. These two indexes are the whole safety
-- model of the rotation flow: they make "two certificates presenting at once" unrepresentable rather
-- than something the application layer has to remember to prevent.
create unique index if not exists idx_efs_soap_cert_one_active
  on efs_soap_client_certs (org_id) where status = 'active';
create unique index if not exists idx_efs_soap_cert_one_pending
  on efs_soap_client_certs (org_id) where status = 'pending';

-- Expiry sweep: "every active certificate expiring before X".
create index if not exists idx_efs_soap_cert_expiry
  on efs_soap_client_certs (not_after) where status = 'active';

-- History lookups for one org, newest first.
create index if not exists idx_efs_soap_cert_org_created
  on efs_soap_client_certs (org_id, created_at desc);

create trigger trg_efs_soap_client_certs_updated
  before update on efs_soap_client_certs
  for each row execute function set_updated_at();

alter table efs_soap_client_certs enable row level security;
-- No client policies → service role only. The private key never leaves the API process.

-- Expiry-warning bookkeeping lives on the credentials row (one EFS integration per org), so the
-- daily sweep can be idempotent and not re-email every run.
alter table efs_soap_credentials
  add column if not exists tls_expiry_warned_at   timestamptz,
  add column if not exists tls_expiry_warned_for  text;  -- fingerprint the warning was sent about
