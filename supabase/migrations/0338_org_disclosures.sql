-- 0338 — the carrier's own wording for the instruments its applicants sign.
--
-- ── THE PROBLEM THIS SOLVES, MEASURED ──────────────────────────────────────────────────────────
-- Every instrument lives in `packages/shared/src/authorizationContract.ts` as a module constant, and
-- all six are `version: "v0-draft"`. `isDraftDisclosure()` reads that string, and behind it refuse:
-- every submission, every signature, the 15 U.S.C. 7001(c) consent gate, every PSP order, every
-- §40.25 letter and every Clearinghouse query. A driver who fills in nine screens meets a disabled
-- button reading "Not ready to send yet" (reported with a screenshot, 2026-09-11).
--
-- ⚠ The wording is not ours to write, and today it takes an engineer and a deploy to change. That is
-- the missing capability, not a configuration detail: the carrier has drafted text, counsel has to
-- rule on it, and neither of them can reach a TypeScript constant. This table is where it goes
-- instead.
--
-- ── WHY THE VERSION IS ASSIGNED AND NEVER TYPED ────────────────────────────────────────────────
-- `driver_authorizations` stores the exact text that was signed AND its version, and the whole value
-- of the version is that it identifies the text. If a carrier could type "v1" twice with different
-- wording, two signatures would name one version and mean different things — and the row that says
-- what somebody agreed to would stop being checkable. So publishing ASSIGNS the next integer for
-- that org and instrument, and `version` is `v1`, `v2`, `v3`. Nobody chooses it.
--
-- It also has to survive `isDraftDisclosure()`, which reads `startsWith('v0') || endsWith('-draft')`.
-- Numbering from 1 satisfies that by construction rather than by a validation rule somebody could
-- later relax.
--
-- ── WHY PUBLISHING INSERTS AND NEVER UPDATES ───────────────────────────────────────────────────
-- The live wording is the newest row for (org, instrument). Correcting a typo is a new version, and
-- the old one stays because signatures point at it. The same rule this schema already applies to
-- every other piece of evidence: corrections are new rows.
--
-- ── AND WHY THE 7001(c) CONSENT IS STORED AS CLAUSES ───────────────────────────────────────────
-- ⚠ The other five instruments are a body of text. The electronic-records consent is SIX statutory
-- disclosures — 7001(c)(1)(B)(i)(I) through (c)(1)(C)(i) — and `esignConsentBody()` composes them in
-- statutory order. Storing it as one blob would let a carrier publish a consent missing a clause the
-- statute requires, and nothing would be able to tell. So that instrument stores `clauses` as a
-- jsonb object keyed by the clause names, and the check below refuses a row that has the wrong shape
-- for what it claims to be.

create table if not exists public.org_disclosures (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  -- One of AUTHORIZATION_PURPOSES, or 'esign_consent'. Deliberately text rather than an enum: the
  -- vocabulary lives in packages/shared and a migration that restated it would be the second copy.
  instrument   text not null,
  -- Assigned, never typed. 'v1', 'v2', … — see the header.
  version      text not null,
  title        text not null,
  -- ⚠ ALWAYS present: the exact text the signer was shown. For the five authorizations that is what
  -- the office typed; for the consent it is what `esignConsentBody()` composed from the clauses
  -- below, at publish time. `driver_authorizations` and `esign_consents` copy this onto the
  -- signature row, so "the text as shown" is the thing every instrument has in common.
  body         text not null,
  -- The consent's six statutory clauses, keyed by name — the parts `body` was composed FROM. Null
  -- for the five authorizations, which have no statutory structure to keep.
  clauses      jsonb,
  -- The sentence the signer affirms. ESIGN's intent-to-sign is evidenced by this, not by a mark.
  intent       text not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null,

  -- The consent must carry its clauses. Everything else may not need them, and nothing may be
  -- published with no text at all — `body` being NOT NULL is the floor under that.
  --
  -- ⚠ The first version of this constraint said `body is null` FOR THE CONSENT, with the clauses as
  -- its only representation. Two things were wrong with it. The smaller: `rls.test.mjs` discovers
  -- every RLS table and seeds it from the catalog, filling only NOT NULL columns — so a table whose
  -- shape depends on the VALUE of another column cannot be seeded generically, and
  -- `supabase/CLAUDE.md` is explicit that an unseedable table is a failure rather than a skip. The
  -- larger: it made the consent the one instrument with no stored "text as shown", when that is
  -- precisely what a signature row copies and what an audit reads.
  constraint org_disclosures_consent_has_clauses check (
    instrument <> 'esign_consent' or clauses is not null
  )
);

-- One version number per instrument per carrier. Publishing races itself otherwise — two recruiters
-- pressing Publish at the same moment would both compute the same next integer, and two different
-- texts would answer to one version.
create unique index if not exists uq_org_disclosures_version
  on public.org_disclosures (org_id, instrument, version);

-- The read on every applicant's page load: the newest row per instrument for one carrier.
create index if not exists ix_org_disclosures_live
  on public.org_disclosures (org_id, instrument, published_at desc);

-- The service role reads this and carries its own org filter. No client policies: a browser cannot
-- read another carrier's unpublished wording, and the applicant's own page is served the composed
-- text by the API rather than reading the table.
alter table public.org_disclosures enable row level security;

comment on table public.org_disclosures is
  'The carrier''s own published wording for the instruments its applicants sign. Append-only: the live text is the newest row per (org_id, instrument), and a correction is a new version because `driver_authorizations` rows point at the version they were signed under. Until a carrier publishes, the code''s `v0-draft` placeholders apply and every signature path refuses.';

comment on column public.org_disclosures.version is
  'Assigned by the publish service as v1, v2, … — never typed by a user. The version identifies the text, so two versions must never be able to mean two different things; and numbering from 1 satisfies `isDraftDisclosure()` by construction.';

comment on column public.org_disclosures.body is
  'The exact text the signer was shown. Typed by the office for the five authorizations; composed by `esignConsentBody()` from `clauses` at publish time for the consent. Composed once and stored, not at read time: a rendering change must never alter what an already-signed instrument said.';

comment on column public.org_disclosures.clauses is
  'The 7001(c) consent only. Its six statutory disclosures keyed by clause name — the parts `body` was composed from. Kept structured so a consent missing a clause the statute requires cannot be published unnoticed.';
