-- 0215 — driver_authorizations: the legal basis for every screening pull, and its evidence.
--
-- THE GAP. Nothing in this product records that a driver was told what we were about to check and
-- agreed to it. `grep -ri consent` found only Microsoft Graph admin consent. Meanwhile:
--
--   • PSP refuses the request without it — guide v3.9 §5.4.1 `driverConsent`, Errors 17 and 31:
--     "Your company must disclose to the driver that their PSP record is being accessed and must
--     obtain their authorization prior to receiving the driver record."
--   • A SambaSafety MVR is a consumer report; §391.23(a)(2)/§40.25(g) needs the driver's release to
--     reach a former employer's drug & alcohol history, and §40.25(g) requires SPECIFIC written
--     consent for it — a general release does not carry that far.
--   • §382.701(a) requires driver-specific consent for a Clearinghouse full query.
--
-- Four obligations, four instruments, one table. This is the critical path: we cannot lawfully call
-- POST /Records for anybody until a row here exists, and PSP would refuse us anyway.
--
-- ── WHY ONE ROW PER PURPOSE AND NOT ONE CONSENT CHECKBOX (HIRING-PLAN.md D-HIRE3) ───────────────
-- FCRA §604(b)(2) requires the disclosure "in a document that consists SOLELY of the disclosure".
-- Courts read `solely` literally; it is the most litigated line in employment screening. A consent
-- buried in a multi-page application fails, and the authorization may be combined with the
-- disclosure and with nothing else. So the schema makes the compliant shape the easy one: a row IS
-- one document, carrying its own disclosure text and its own version. There is no column in which a
-- combined omnibus consent could be stored.
--
-- ── WHY THE ESIGN COLUMNS EXIST BEFORE THE SIGNING UI DOES (D-HIRE4) ────────────────────────────
-- Under ESIGN/UETA what makes a signature enforceable is consent to transact electronically, intent
-- to sign, attribution, retention and accuracy — plus an audit trail. None of that can be
-- reconstructed after the fact, so the columns land now even though H5 builds the surface. Sealing a
-- PDF later is a library problem and the smaller half.
--
-- ── APPEND-ONLY, and revocation is a ROW ────────────────────────────────────────────────────────
-- Evidence, so the CLAUDE.md rule applies: no UPDATE or DELETE policy, corrections are new rows. A
-- revocation is a row whose `revokes` names the grant it withdraws, which keeps "what did we hold at
-- the moment we made the request" answerable — a `revoked_at` column would overwrite exactly that.
create table if not exists public.driver_authorizations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  purpose       text not null check (purpose in (
                  'fcra_disclosure',      -- §604(b)(2) consumer report, standalone
                  'psp',                  -- FMCSA PSP §5.4.1 / Errors 17, 31
                  'previous_employer',    -- §391.23(a)(2); §40.25(g) for D&A history
                  'clearinghouse',        -- §382.701(a) full query
                  'drug_alcohol')),       -- §382 testing programme
  -- The instrument, exactly as it was shown. `disclosure_text` is the SERVER's copy of a versioned
  -- constant in packages/shared, never anything the client sent — the pattern hazmat_reviews.attestation
  -- established in 0092 (D8): "never paraphrase in the UI".
  disclosure_version text not null,
  disclosure_text    text not null,
  -- ── ESIGN / UETA evidence ─────────────────────────────────────────────────────────────────────
  method        text not null check (method in ('esign', 'wet_signature', 'verbal_documented')),
  signed_name   text not null,                 -- what the signer typed or wrote, verbatim
  intent_statement text not null,              -- the sentence they affirmed, versioned with the disclosure
  esign_consent_at timestamptz,                -- agreed to transact electronically (method='esign')
  accepted_at   timestamptz not null default now(),
  accepted_ip   inet,
  accepted_user_agent text,
  -- A scan, when the signature was on paper. Null for e-sign until H5 seals a PDF.
  evidence_document_id uuid,
  -- Who RECORDED it, which is not who signed it: for a wet signature an office user keys it in.
  recorded_by   uuid references auth.users(id) on delete set null,
  -- Revocation: this row withdraws that grant. Null on a grant.
  revokes       uuid references public.driver_authorizations(id) on delete restrict,
  revoke_reason text,
  created_at    timestamptz not null default now(),
  -- A revocation names what it revokes and carries no disclosure of its own to sign; a grant is the
  -- other way round. One CHECK rather than two nullable halves nobody reads together.
  constraint driver_authorizations_revocation_shape check (
    (revokes is null) or (revoke_reason is not null)
  )
);

-- The read this table exists for: "may we pull X for this driver, right now".
create index if not exists idx_driver_authorizations_live
  on public.driver_authorizations (org_id, driver_id, purpose, accepted_at desc);
create index if not exists idx_driver_authorizations_revokes
  on public.driver_authorizations (revokes) where revokes is not null;

alter table public.driver_authorizations enable row level security;

drop policy if exists driver_authorizations_select on public.driver_authorizations;
create policy driver_authorizations_select on public.driver_authorizations
  for select using (org_id = public.auth_org_id());

-- A driver reads their OWN authorizations and nobody else's — 0129's shape. Somebody is entitled to
-- see what they agreed to; that is half of what a consent record is for.
drop policy if exists driver_authorizations_driver_scope on public.driver_authorizations;
create policy driver_authorizations_driver_scope on public.driver_authorizations
  as restrictive for select using (
    public.auth_role() <> 'driver' or driver_id = public.auth_driver_id()
  );

-- Same section boundary as driver_employment_history (0209/0212): hiring paperwork belongs to the
-- people making the hiring decision, not to a dispatcher reading Fleet to see who is on which truck.
drop policy if exists driver_authorizations_section_read on public.driver_authorizations;
create policy driver_authorizations_section_read on public.driver_authorizations
  as restrictive for select using (
    public.auth_role() = 'driver'
    or public.auth_role() in ('admin', 'fleet_manager', 'safety_manager', 'auditor', 'recruiter')
  );

-- INSERT only. No UPDATE, no DELETE: append-only by the absence of a policy, which is the same way
-- 0129 says it.
drop policy if exists driver_authorizations_insert on public.driver_authorizations;
create policy driver_authorizations_insert on public.driver_authorizations
  for insert with check (
    org_id = public.auth_org_id()
    and public.auth_role() = any (array['admin','fleet_manager','safety_manager','recruiter'])
  );

comment on table public.driver_authorizations is
  'The driver''s written disclosure + authorization for each screening purpose (HIRING-PLAN.md H1).
   One row IS one document, because FCRA §604(b)(2) requires the disclosure to stand alone. Append-only;
   a revocation is a row whose `revokes` names the grant. Blocks every screening call.';
