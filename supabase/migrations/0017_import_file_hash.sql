-- Add SHA-256 file hash to imports so the same physical file can be detected on re-upload.
alter table imports add column if not exists file_hash text;

create index if not exists idx_imports_file_hash
  on imports (org_id, file_hash)
  where file_hash is not null;
