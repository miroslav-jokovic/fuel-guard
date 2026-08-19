-- 0211 — split 0205's restricted-record policies along the two regulations they were conflating.
--
-- 0205 put six qualification-record kinds behind ONE predicate (admin + safety_manager). That was
-- correct while the two rules behind those six happened to name the same roles. They do not any more:
--
--   §382.401(a)  — drug & alcohol testing records live in "a secure location with controlled
--                  access". A custody rule; it says nothing about hiring.
--   §391.53(a)(1) — the investigation history (previous-employer inquiries and their responses) goes
--                  to "those who are involved in the hiring decision". That IS the recruiter.
--
-- A recruiter who cannot read a previous-employer response cannot do the job §391.23(a)(2) assigns
-- them: they can chase the inquiry and never see the answer. So one restrictive policy per table
-- becomes two, and the role lists differ by exactly the recruiter.
--
-- The kind lists and both role lists mirror TESTING_RECORD_KINDS / INVESTIGATION_HISTORY_KINDS and
-- canReadTestingRecords() / canReadInvestigationHistory() in packages/shared/src/auth.ts — the single
-- source of truth its own comment declares it to be; if the two ever disagree, shared wins and these
-- policies are the ones to fix.
--
-- RESTRICTIVE, so they AND onto the permissive org policies and can only narrow. Nothing here widens
-- what any EXISTING role could read: admin and safety_manager keep both halves, and every other
-- pre-existing role keeps neither.
--
-- What this does NOT protect, unchanged from 0205: the API reads with the service role, which
-- bypasses RLS. That path is enforced in routes/compliance.ts via filterRestrictedRows() and
-- canReadRestrictedKind().

drop policy if exists qualification_records_restricted_kinds on public.qualification_records;
drop policy if exists documents_restricted_kinds on public.documents;

-- ── §382.401(a): testing records. Unchanged membership — admin + safety_manager. ────────────────
create policy qualification_records_restricted_testing on public.qualification_records
  as restrictive for select
  using (
    kind not in ('drug_test','alcohol_test','clearinghouse_full','clearinghouse_limited')
    or public.auth_role() in ('admin','safety_manager')
  );

create policy documents_restricted_testing on public.documents
  as restrictive for select
  using (
    kind not in ('drug_test','alcohol_test','clearinghouse_full','clearinghouse_limited')
    or public.auth_role() in ('admin','safety_manager')
  );

-- ── §391.53(a)(1): investigation history. Adds the recruiter, and only the recruiter. ───────────
create policy qualification_records_restricted_investigation on public.qualification_records
  as restrictive for select
  using (
    kind not in ('previous_employer_inquiry','previous_employer_response')
    or public.auth_role() in ('admin','safety_manager','recruiter')
  );

create policy documents_restricted_investigation on public.documents
  as restrictive for select
  using (
    kind not in ('previous_employer_inquiry','previous_employer_response')
    or public.auth_role() in ('admin','safety_manager','recruiter')
  );
