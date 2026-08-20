-- 0216 — psp_requests: one row per PSP transaction, written BEFORE the call that bills.
--
-- ── WHY A LEDGER FOR A READ ─────────────────────────────────────────────────────────────────────
-- PSP is a read: MCMIS is unchanged by it. But §8 says "Accounts are charged the transaction fee for
-- 'Success,' 'Partial' and 'Failure' response statuses", so it leaves our control, costs money, can
-- partially fail, and a retry is a second invoice. That is the class efs_card_mutations was built
-- for, and the row goes in before the request goes out for the same reason: a connection reset after
-- PSP processed the request is indistinguishable from one before, and the charge has already landed.
--
-- ── THE STATUS VOCABULARY, AND ONE DELIBERATE DEVIATION FROM THE PLAN ────────────────────────────
-- PSP-PLAN P5 said to use the card ledger's six values verbatim so an operator reading two
-- integration surfaces learns one vocabulary. Five of them carry over. Two do not:
--
--   `drift_detected` is DROPPED. It means "the vendor's state stopped matching what we asked for",
--   and PSP has no vendor state to drift — D-PSP3 is the whole reason this is not an EFS capability.
--   A status nothing can ever write is a status that sends the next reader looking for a reconciler
--   that does not exist.
--
--   `indeterminate` is ADDED, and it is the one PSP genuinely needs. A network failure after
--   dispatch leaves us not knowing whether we were charged. Recording that as `failed` claims we were
--   not; recording it as `succeeded` claims a report we do not have. It is the honest third answer,
--   and §4c's rule follows from it: this row is never automatically retried.
--
-- ── PII ─────────────────────────────────────────────────────────────────────────────────────────
-- `request_body` carries a licence number and a date of birth, and `response_raw` carries a person's
-- entire crash and violation history across every carrier they have driven for — the most sensitive
-- record this product has ever stored. The request body is REDACTED on the way in (the redactCardXml
-- rule, 9a7a125). The raw response is kept whole because it is the evidence P7's derived rows are
-- rebuilt from, and it sits behind the same restrictive read as everything else in the hiring file.
create table if not exists public.psp_requests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  driver_id       uuid not null references public.drivers(id) on delete cascade,
  -- Ours, echoed by PSP on the response and on the 45-day monitoring report (§6). `drivers.id` goes
  -- here, so every reply resolves back without a mapping table and without name-matching.
  internal_ref_id text not null,
  idempotency_key text not null,
  request_body    jsonb not null,
  status          text not null default 'pending' check (status in (
                    'pending', 'sent', 'succeeded', 'partial', 'failed', 'indeterminate')),
  -- What PSP said, kept as PSP said it. `psp_status` 3 is undocumented (PSP-PLAN §2.6) and is
  -- therefore storable: a CHECK naming only the four documented values would refuse the one response
  -- we most need to keep a record of.
  psp_status        smallint,
  psp_status_detail smallint,
  psp_status_description text,
  -- §7: the handle for the PDF, and it dies after 5 days / 120 hours (Error 28).
  auth_code       text,
  monitor         boolean not null default false,
  -- STORED, not derived from psp_status. §8's rule may change, and an invoice reconciliation has to
  -- read what was true on the day rather than what today's code believes.
  billed          boolean not null default false,
  response_raw    jsonb,
  -- The filed PDF (P7). Null until it is fetched, and it must be fetched in the same job.
  document_id     uuid,
  error           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz
);

-- One request in flight per driver, the shape uq_efs_card_mutations_one_pending uses. Without it two
-- operators clicking at once buy the same report twice.
create unique index if not exists uq_psp_requests_one_in_flight
  on public.psp_requests (org_id, driver_id)
  where status in ('pending', 'sent');

-- A replayed key returns the first outcome instead of issuing a second BILLED call.
create unique index if not exists uq_psp_requests_idempotency
  on public.psp_requests (org_id, idempotency_key);

create index if not exists idx_psp_requests_driver
  on public.psp_requests (org_id, driver_id, created_at desc);
-- The 45-day monitoring poll (P8) resolves its report rows by this.
create index if not exists idx_psp_requests_internal_ref
  on public.psp_requests (org_id, internal_ref_id);

alter table public.psp_requests enable row level security;

drop policy if exists psp_requests_select on public.psp_requests;
create policy psp_requests_select on public.psp_requests
  for select using (org_id = public.auth_org_id());

-- A driver may read that a report was pulled about them, and nobody else's. The record itself is
-- theirs to see under the same reasoning as driver_authorizations: half of what a consent record is
-- for is the person who gave it being able to check what it bought.
drop policy if exists psp_requests_driver_scope on public.psp_requests;
create policy psp_requests_driver_scope on public.psp_requests
  as restrictive for select using (
    public.auth_role() <> 'driver' or driver_id = public.auth_driver_id()
  );

-- Hiring paperwork, behind the hiring section — the boundary 0209/0212/0215 already drew.
drop policy if exists psp_requests_section_read on public.psp_requests;
create policy psp_requests_section_read on public.psp_requests
  as restrictive for select using (
    public.auth_role() = 'driver'
    or public.auth_role() in ('admin', 'fleet_manager', 'safety_manager', 'auditor', 'recruiter')
  );

-- NO client write policy at all. Every row is written by the service role from the order path, which
-- is where the budget, the step-up and the authorization gate live (P6). A row a browser could insert
-- is a billed vendor call with no gate in front of it.

comment on table public.psp_requests is
  'One row per FMCSA PSP transaction, written before the call that bills (§8 charges Success, Partial
   AND Failure). `billed` is stored rather than derived; `response_raw` is the evidence P7''s derived
   rows are rebuilt from. Service-role writes only.';
