-- 0479 — the officer's report is read, and what it says can confirm the driver
-- (INSPECTION-CHALLENGE-PLAN.md IC10; D-IC13; Q-IC11 ruled (a) by the owner 2026-10-15).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- Measured on production 2026-10-15: none of FMCSA's six open datasets names the driver — no name, no
-- licence, no date of birth. Every driver on an inspection today is Samsara's reading (IC5, 0473) until a
-- safety manager confirms it by hand. The one paper that names the driver is the officer's report, and
-- IC2 (0476) already lets a safety manager file it on the inspection. This migration lets the document
-- reader read it, and lets what it reads stand as a confirmation.
--
-- ── WHAT THIS ADDS ───────────────────────────────────────────────────────────────────────────────
-- (The reader's side — `document_reads.profile` taking `roadside_inspection_report` — is 0478, the
-- document-reading module's own migration; one module per migration, `check-table-modules.mjs`.)
-- 1. `inspection_attributions.source` takes `report`: the row written when the report's licence number,
--    read alike by both readers, belongs to the roster driver Samsara already put on the truck (Q-IC11 (a)).
--    It restates the engine reading it agrees with, names our driver in `driver_id`, and carries no
--    `decided_by` — no person decided; `inspection_attributions_person_named` already says exactly that
--    (`source = 'person'` ⇔ a decider). A person can still correct it with a later row, as any reading.
-- 2. `inspection_report_reads` — which filed report was handed to the reader, by its bytes. One row per
--    document, written once, append-only: "this document's bytes, sha256 X, went to intake at T". The
--    read itself is found through `document_sources.sha256` → `document_reads`, never through a stored
--    read id, because two intakes of the same bytes fold into ONE source (D-DR12) and a stored id could
--    name the one that was folded away.
--
-- ── NO FOREIGN KEY TO documents ──────────────────────────────────────────────────────────────────
-- `documents` is evidence (RETENTION_FORBIDDEN) and a retraction is an audited service-role delete
-- (`retractFiledEvidence`); an FK here would make this link refuse it. The pass that writes the link
-- reads the document first, and a link to a retracted document is a read nobody looks for.
--
-- ── DEPLOY ORDER ─────────────────────────────────────────────────────────────────────────────────
-- A CHECK widening (old code never writes the new word) and a new table. Their writer, the report
-- pass on the FMCSA hourly tick, ships in this same merge: on staging, a tick that runs before
-- `migrate-staging` fails its insert, logs it, and the next tick does it — a feature no one is using yet
-- waits an hour (`check-migration-ordering.mjs`'s new-table rule, by the same reasoning). In a release the
-- migration runs first. The `report` attribution has no writer until the next merge.

alter table public.inspection_attributions drop constraint if exists inspection_attributions_source_check;
alter table public.inspection_attributions
  add constraint inspection_attributions_source_check check (source in ('engine', 'person', 'report'));

create table if not exists public.inspection_report_reads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null,
  -- The filed `documents` row (kind `roadside_inspection_report`, subject this inspection). No FK, above.
  document_id uuid not null,
  -- The bytes handed to the reader — the same value as the source's `sha256` once intake has run.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint inspection_report_reads_inspection_fk
    foreign key (inspection_id, org_id) references public.roadside_inspections (id, org_id),
  constraint inspection_report_reads_once unique (org_id, document_id)
);

create index if not exists inspection_report_reads_inspection_idx
  on public.inspection_report_reads (org_id, inspection_id);

drop trigger if exists trg_inspection_report_reads_append_only on public.inspection_report_reads;
create trigger trg_inspection_report_reads_append_only
  before update or delete on public.inspection_report_reads
  for each row execute function public.inspection_evidence_append_only();

alter table public.inspection_report_reads enable row level security;

comment on table public.inspection_report_reads is
  'IC10 (0479): an officer''s report handed to the document reader — the filed document and the sha256 of its bytes; the read is found by that sha256. Append-only, service role only.';
