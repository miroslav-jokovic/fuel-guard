-- 0205: restricted qualification records (DQF-EXECUTION-PLAN Phase G, decision D-DQ15)
--
-- The gap: §382.401(a) requires drug & alcohol testing records kept in "a secure location with
-- controlled access", and §391.53(a)(1) limits the investigation-history file (previous-employer
-- inquiries/responses) to those involved in the hiring decision — but qualification_records and
-- documents were readable by EVERY role the fleet section admits, dispatcher and auditor included.
-- Measured before the first real restricted row exists (the A2 baseline found zero), which is the
-- moment this is a code change rather than an incident report.
--
-- Why RESTRICTIVE policies: they AND onto the existing permissive org policies, so this can only
-- narrow. The kind list and the privileged-role pair mirror RESTRICTED_QUALIFICATION_KINDS and
-- canReadRestricted() in packages/shared/src/auth.ts — the single source of truth; if the two ever
-- disagree, shared wins and this policy is the one to fix.
--
-- What this does NOT protect: the API reads these tables with the service role, which bypasses RLS
-- entirely. Enforcement for that path lives in routes/compliance.ts via filterRestrictedRows();
-- this policy is defence in depth for the PostgREST path and any future direct read.

create policy qualification_records_restricted_kinds on public.qualification_records
  as restrictive for select
  using (
    kind not in ('drug_test','alcohol_test','clearinghouse_full','clearinghouse_limited',
                 'previous_employer_inquiry','previous_employer_response')
    or public.auth_role() in ('admin','safety_manager')
  );

create policy documents_restricted_kinds on public.documents
  as restrictive for select
  using (
    kind not in ('drug_test','alcohol_test','clearinghouse_full','clearinghouse_limited',
                 'previous_employer_inquiry','previous_employer_response')
    or public.auth_role() in ('admin','safety_manager')
  );

-- The binder may include restricted kinds only when a privileged role explicitly asks, and the ask
-- is a fact worth keeping: the export ledger records it, so "who put a drug-test page into a PDF
-- that left the building" is a query, not a reconstruction.
alter table public.dq_exports
  add column if not exists include_restricted boolean not null default false;
