-- 0495 — what the court decided on each roadside ticket, and the DataQs request that carries it to FMCSA
-- (INSPECTION-CHALLENGE-PLAN IC4 second merge, R-ADJ2/R-ADJ3; owner 2026-10-19: "proceed as proposed").
--
-- ── WHY A DISPOSITION IS A VIOLATION'S, NOT A DOCUMENT'S ──────────────────────────────────────────
-- The court's paper is filed on the INSPECTION (`documents`, kind `court_disposition`, IC2), and until now a
-- filed paper closed every ticket on it. Five inspections hold two tickets (measured 2026-10-19), and one paper
-- can answer one of them, or both with two different outcomes. So a person reads the paper and records, per
-- ticket, what it says: FMCSA's outcome code (job aid AdjudicatedCitations2025.pdf) —
--
--   3  not guilty / dismissed           the violation leaves SMS and PSP
--   2  convicted of a different charge  the violation stays at severity 1
--   1  convicted of the charge          nothing changes; a paid fine is this
--
-- (0, "not applicable", is FMCSA's for a citation with no court — a warning, which is not a ticket here.)
-- `document_id` is the paper it was read from; the service checks it is a court result filed on this
-- inspection. It carries no FK: `documents` is the evidence module's (the 0480/0485 pattern).
--
-- ── WHY THE DATAQS REQUEST IS RECORDED AND NEVER SENT ────────────────────────────────────────────
-- R-ADJ2: an outcome of 3 or 2 that FMCSA's feed does not show is a request to file ("Inspection—Citation with
-- Associated Violation", RDRTypeDefinitions.pdf). DataQs has no API and the filer certifies under 18 USC 1001,
-- so a PERSON confirms the driver (D-IC7: `attribution_id` is the decision the attestation was made over),
-- reads the 1001 text, attests, files it in DataQs themselves and comes back with the RDR number.
--
--   approved  attested; the narrative is the person's, as attested — the hand-off shows it to copy.
--   filed     DataQs gave it an RDR number on `filed_on`; the row carries the approval forward.
--
-- A draft is not a row: it is drafted from the disposition each time it is shown, and becomes a record only when
-- someone attests to it. FMCSA's answer (granted, denied) arrives on the feed as the violation's result, read
-- where every result is read; the states that wait on it are the plan's §5, a later migration's to add.
--
-- ── APPEND-ONLY, LIKE EVERY RECORD IN THIS MODULE ───────────────────────────────────────────────
-- A disposition misread is answered by a new row; the newest per violation is the state, and a request
-- approved over an older disposition is no longer the ticket's (the service drafts it again). Both tables
-- are in RETENTION_FORBIDDEN. Service role only; no client policy.

create table if not exists public.inspection_citation_dispositions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null,
  violation_id uuid not null,
  document_id uuid not null,
  outcome_code smallint not null check (outcome_code in (1, 2, 3)),
  -- The charge the driver was convicted of instead: the paper names it, and the request says it.
  amended_charge text check (amended_charge is null or length(amended_charge) between 1 and 200),
  court_name text not null check (length(court_name) between 1 and 200),
  decided_on date not null,
  note text check (note is null or length(note) <= 1000),
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  constraint inspection_citation_dispositions_inspection_fk foreign key (inspection_id, org_id)
    references public.roadside_inspections (id, org_id),
  constraint inspection_citation_dispositions_violation_fk foreign key (violation_id, org_id)
    references public.roadside_violations (id, org_id),
  constraint inspection_citation_dispositions_amended check ((outcome_code = 2) = (amended_charge is not null)),
  -- The request's FK names the disposition AND the ticket it is about, so the two can never disagree.
  constraint inspection_citation_dispositions_ticket_key unique (id, org_id, inspection_id, violation_id)
);

create index if not exists inspection_citation_dispositions_violation_idx
  on public.inspection_citation_dispositions (org_id, violation_id, created_at desc);
create index if not exists inspection_citation_dispositions_inspection_idx
  on public.inspection_citation_dispositions (org_id, inspection_id);

drop trigger if exists trg_inspection_citation_dispositions_append_only on public.inspection_citation_dispositions;
create trigger trg_inspection_citation_dispositions_append_only
  before update or delete on public.inspection_citation_dispositions
  for each row execute function public.inspection_evidence_append_only();

alter table public.inspection_citation_dispositions enable row level security;

comment on table public.inspection_citation_dispositions is
  'IC4 (0495): what the court decided on one roadside ticket, read by a person from the filed court paper — FMCSA''s outcome code 3 dismissed, 2 different charge, 1 convicted. Append-only, newest row is the state, service role only.';

create table if not exists public.dataqs_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null,
  violation_id uuid not null,
  disposition_id uuid not null,
  rdr_type text not null check (rdr_type in ('inspection_citation_with_associated_violation')),
  state text not null check (state in ('approved', 'filed')),
  narrative text not null check (length(narrative) between 1 and 4000),
  -- The driver decision (person's or the officer's report's) the attestation was made over (D-IC7).
  attribution_id uuid not null,
  attested_by uuid not null,
  attested_at timestamptz not null,
  rdr_number text check (rdr_number is null or length(rdr_number) between 1 and 40),
  filed_on date,
  acted_by uuid not null,
  created_at timestamptz not null default now(),
  constraint dataqs_cases_disposition_fk foreign key (disposition_id, org_id, inspection_id, violation_id)
    references public.inspection_citation_dispositions (id, org_id, inspection_id, violation_id),
  -- Filed is the one state with an RDR number, and a number never comes without its day.
  constraint dataqs_cases_filed check ((state = 'filed') = (rdr_number is not null)),
  constraint dataqs_cases_filed_on check ((rdr_number is null) = (filed_on is null))
);

create index if not exists dataqs_cases_violation_idx
  on public.dataqs_cases (org_id, violation_id, created_at desc);
create index if not exists dataqs_cases_inspection_idx
  on public.dataqs_cases (org_id, inspection_id);

drop trigger if exists trg_dataqs_cases_append_only on public.dataqs_cases;
create trigger trg_dataqs_cases_append_only
  before update or delete on public.dataqs_cases
  for each row execute function public.inspection_evidence_append_only();

alter table public.dataqs_cases enable row level security;

comment on table public.dataqs_cases is
  'IC4 (0495): a DataQs request a person attested to (18 USC 1001) and filed in DataQs themselves — approved, then filed with its RDR number. Never sent by us. Append-only, newest row is the state, service role only.';
