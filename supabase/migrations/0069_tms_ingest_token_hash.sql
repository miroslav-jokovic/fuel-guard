-- Harden the TMS ingest token: store only a SHA-256 HASH at rest, never the plaintext. A DB read (backup
-- leak, rogue query) then never yields a usable token; the plaintext is shown to the admin exactly once at
-- creation. `ingest_token_prefix` lets the settings UI identify which token is active without revealing it.
alter table org_integrations drop column if exists ingest_token;
alter table org_integrations add column if not exists ingest_token_hash   text;
alter table org_integrations add column if not exists ingest_token_prefix text;

-- The ingest endpoints look a token up by its hash on every request → index it.
create index if not exists idx_org_integrations_token_hash
  on org_integrations (ingest_token_hash) where ingest_token_hash is not null;
