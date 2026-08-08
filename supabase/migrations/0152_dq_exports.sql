-- 0152 — the audit binder's output and its ledger (DQ-BINDER-PLAN, D-BD4 / D-BD9 / D-BD12).
--
-- WHAT THIS IS FOR. A DOT auditor names a sample of drivers and asks for their §391.51 files, printed
-- or emailed. `dq_binder` assembles them into ONE PDF (D-BD2) and puts it here. The same table also
-- records the single-document export — a broker asking for one driver's CDL before releasing a load
-- (D-BD10) — which is streamed rather than stored, so it leaves a ledger row and no bytes.
--
-- WHY THE OUTPUT GETS ITS OWN BUCKET AND ITS OWN CLOCK (D-BD4). A source scan is retained for years
-- because the regulation says so. A finished binder is a different object: a PII AGGREGATE — fifteen
-- drivers' licences, medical certificates, addresses and dates of birth in one file that exists only
-- to be sent. Filing it in `compliance-docs` would inherit a multi-year retention it must not have.
-- It lives in `compliance-exports`, private, with NO client policy of any kind — not even insert. The
-- job writes it with the service role and the API hands out a short signed URL. Bytes are swept after
-- seven days; regenerating is one click.
--
-- WHY THE LEDGER ROW OUTLIVES THE BYTES. D-BD9: "a record of who pulled a medical card out of the
-- system costs one row and is exactly what you want to have six months later". So the sweep clears
-- `storage_path` and stamps `purged_at`; it never deletes the row. That is also why this table has no
-- UPDATE and no DELETE policy and why 0152's companion change adds it to RETENTION_FORBIDDEN — an
-- export ledger a manager can quietly edit is not a ledger.
--
-- WHY driver_ids IS AN ARRAY AND NOT A CHILD TABLE WITH A FOREIGN KEY. This records a historical FACT:
-- on this date, this person exported these drivers' files. A foreign key would make that fact mutable
-- by someone else's delete — `on delete cascade` erases the evidence and `set null` corrupts it. The
-- array is deliberately unreferential. Tenancy is still enforced: org_id is on the row, and the
-- handler resolves the ids inside the org before it reads anything.

create table if not exists public.dq_exports (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  -- 'binder'   — one or many drivers, assembled to a stored PDF by the dq_binder job.
  -- 'document' — one requirement for one driver, stamped and streamed; nothing is stored.
  kind           text not null check (kind in ('binder','document')),
  -- Capped at 25. An auditor's sample is typically 5–15; 25 drivers is roughly 450 scans and a file
  -- large enough that the cap is a kindness rather than a limit. Enforced here so the ceiling cannot
  -- be forgotten in a caller.
  driver_ids     uuid[] not null,
  -- Single-document exports only: which of the 18 §391.51 requirements this page proves, and the
  -- document it came from.
  requirement_key text,
  document_id    uuid references public.documents(id) on delete set null,
  -- D-BD7 — the file AS IT STOOD on a date. buildDqFile already takes the evaluation date, so
  -- reproducing the file the auditor was shown costs nothing now and cannot be retrofitted cheaply.
  as_at          date not null,
  status         text not null default 'queued' check (status in ('queued','running','done','failed')),
  -- The queue run that assembled it, for diagnosis. DELIBERATELY NOT A FOREIGN KEY: `jobs` is pruned
  -- at 90 days by RETENTION_RULES, and a real reference would either block that delete (no action) or
  -- quietly blank this column (set null) — the second being the same corruption-by-somebody-else's-
  -- delete that keeps `driver_ids` unreferential above. The ledger records what happened; it does not
  -- hold other tables hostage.
  job_id         uuid,
  storage_path   text,                       -- bucket 'compliance-exports', key org_id/{export_id}.pdf
  bytes          bigint check (bytes is null or bytes > 0),
  pages          int    check (pages is null or pages > 0),
  -- Completeness travels with the ledger row so "what did we hand over" is answerable without
  -- re-reading the PDF (D-BD5 prints the same numbers on the cover).
  drivers_count  int    check (drivers_count is null or drivers_count >= 0),
  documents_count int   check (documents_count is null or documents_count >= 0),
  gaps_count     int    check (gaps_count is null or gaps_count >= 0),
  error          text,
  requested_by   uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  -- When the BYTES expire (D-BD4). Null for 'document' — nothing was stored.
  expires_at     timestamptz,
  purged_at      timestamptz,

  constraint dq_exports_sample_size check (
    cardinality(driver_ids) between 1 and 25
  ),
  -- A binder names no single requirement; a single-document export names exactly one driver and one
  -- requirement. Getting this wrong would produce a stamped page that cannot say what it proves.
  constraint dq_exports_shape check (
    case when kind = 'document'
      then cardinality(driver_ids) = 1 and requirement_key is not null
      else requirement_key is null and document_id is null
    end
  )
);

-- The history list on the qualification page: this org's exports, newest first.
create index if not exists idx_dq_exports_org_created
  on public.dq_exports (org_id, created_at desc);
-- The seven-day sweep's working set — only rows that still have bytes to remove.
create index if not exists idx_dq_exports_sweep
  on public.dq_exports (expires_at)
  where storage_path is not null and purged_at is null;

alter table public.dq_exports enable row level security;

-- Office roles read their org's export history. A driver must not see it: the ledger names every
-- other driver whose file has left the building, which is precisely the aggregate D-BD4 is careful
-- about. Writes are service-role only — the job and the API own this table, no client does.
drop policy if exists dq_exports_select on public.dq_exports;
create policy dq_exports_select on public.dq_exports for select using (
  org_id = public.auth_org_id()
  and public.auth_role() = any (array['admin','fleet_manager','safety_manager','auditor'])
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Storage — bucket 'compliance-exports', keyed org_id/{export_id}.pdf (folder[1] = org).
--
-- DELIBERATELY POLICY-FREE. `compliance-docs` (0146) at least grants INSERT to the safety roles
-- because a manager uploads a scan from the browser. Nothing about an export is client-authored: the
-- worker writes it and the API issues a signed URL to read it. Every policy that does not exist here
-- is a way this aggregate cannot be reached, and RLS denies by default, so the absence IS the rule.
-- 200 MB ceiling: 25 drivers × ~18 documents at a few MB a scan, with room for a heavy sample.
-- ═══════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit)
values ('compliance-exports', 'compliance-exports', false, 200 * 1024 * 1024)
on conflict (id) do nothing;

comment on table public.dq_exports is
  'Ledger of every driver-qualification export (DQ-BINDER-PLAN D-BD9): who exported which drivers,
   as at what date, and what came out. Service-role writes only; no UPDATE/DELETE policy. The row
   outlives the bytes — the seven-day sweep clears storage_path and stamps purged_at.';

-- ── the carrier's USDOT number ────────────────────────────────────────────────────────
-- The binder's cover has to identify the carrier the way the auditor's own paperwork does, and the
-- product has never stored a USDOT number — `organizations` carries a name, allowed domains and
-- operating hours. Printing a driver qualification file under a trading name alone leaves the reader
-- matching it to their file by hand. Nullable, because an existing org has no value to backfill and a
-- cover that says "USDOT — not recorded" is honest; the settings page asks for it.
alter table public.organizations add column if not exists dot_number text;
comment on column public.organizations.dot_number is
  'USDOT number, as issued by FMCSA. Printed on the driver-qualification binder cover (D-BD5).';
