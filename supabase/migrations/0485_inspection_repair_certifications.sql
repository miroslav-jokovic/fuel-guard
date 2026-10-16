-- 0485 — safety's certification of a roadside inspection's repairs (INSPECTION-CHALLENGE-PLAN IC11 B2,
-- D-IC14; Q-IC12 (a), Q-IC13 ruled 2026-10-15).
--
-- ── WHAT 396.9(d)(3)(i) ASKS ─────────────────────────────────────────────────────────────────────
-- A carrier official certifies that every violation on the report was corrected, by completing the
-- report's "Signature of Carrier Official, Title, and Date Signed". Q-IC13: maintenance names the repair
-- of each unit (`inspection_repairs`' person rows, 0482), safety certifies the whole REPORT — so this is
-- one row per act over an inspection, not per unit, beside 0482 rather than inside it (its outcome CHECK
-- is per-unit vocabulary, and widening it would put a new column's reader a merge behind its writer).
--
-- ── WHO, AND WHEN, ARE NOT TYPED ─────────────────────────────────────────────────────────────────
-- The signer is the signed-in person (`certified_by`), their name frozen as the product showed it at the
-- moment (`signer_name`: a later rename must not rewrite a signature). The date is the carrier's calendar
-- day the server saw (`signed_on`), never one the page sends: a backdated certification is the thing an
-- auditor looks for. Only the TITLE is the person's to give — the regulation asks for it and the product
-- does not know it.
--
-- ── WHAT WAS CERTIFIED IS FROZEN WITH IT ─────────────────────────────────────────────────────────
-- `repairs` holds the `inspection_repairs` row each unit stood on when the person certified (the newest per
-- unit — the same `basedOn` the Repair card shows). A later row on any unit (a re-read, a corrected
-- decision) makes the certification no longer current, which the card shows; the old one stays, because
-- it was true of what it named. `document_id` is the rendered repair record (`documents`, kind
-- `roadside_repair_record`, 0484), filed BEFORE this row is written, so no certification exists without
-- its record. No FK to `documents` or `auth.users` (another module's tables), for 0473's reasons.
--
-- Returning the signed form to the state is a separate, rarer act ((d)(3)(ii): "if requested by the
-- issuing State agency") — recorded later, not here.
--
-- New table: its writer (`inspections/repair/certify.ts`) ships in the same merge.

create table if not exists public.inspection_repair_certifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null,
  certified_by uuid not null,
  signer_name text not null check (length(btrim(signer_name)) > 0),
  signer_title text not null check (length(btrim(signer_title)) between 1 and 120),
  signed_on date not null,
  -- [{ "unitId": uuid, "repairId": uuid }], one per violated unit, as certified.
  repairs jsonb not null check (jsonb_typeof(repairs) = 'array' and jsonb_array_length(repairs) > 0),
  document_id uuid not null,
  created_at timestamptz not null default now(),
  constraint inspection_repair_certifications_inspection_fk
    foreign key (inspection_id, org_id) references public.roadside_inspections (id, org_id)
);

create index if not exists inspection_repair_certifications_inspection_idx
  on public.inspection_repair_certifications (org_id, inspection_id, created_at desc);

drop trigger if exists trg_inspection_repair_certifications_append_only on public.inspection_repair_certifications;
create trigger trg_inspection_repair_certifications_append_only
  before update or delete on public.inspection_repair_certifications
  for each row execute function public.inspection_evidence_append_only();

alter table public.inspection_repair_certifications enable row level security;

comment on table public.inspection_repair_certifications is
  'IC11 B2 (0485): a carrier official''s 396.9(d)(3)(i) certification that a roadside inspection''s vehicle violations were corrected — signer, title, date, the repair rows certified and the rendered record. Append-only, service role only.';
