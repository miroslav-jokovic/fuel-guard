# Safety — electronic Driver Qualification File: audit and plan (2026-08-07)

The proposal: turn the Compliance page into a Safety surface holding every driver document as an
electronic DQ file, serving both the hazmat qualification gate and a TMS integration.

**The answer is yes, and the schema is roughly three-quarters of the way there.** What is missing is
smaller than it looks, and one piece of it is load-bearing.

## 1. The blocker

**There is no way to upload a driver document today, and no place to put one.**

- No `documents` table exists. `grep "create table .*documents"` across all 139 migrations returns
  exactly two hits: `hazmat_documents` (`0092:68`) and `master_documents` (`0101:63`).
- `certifications.document_id` (`0127:35`) and `qualification_records.document_id` (`0129:20`) are
  unconstrained uuids pointing at nothing. `0127:35` says so in a comment: *"FK added with the
  documents table (M1 roster); column reserved now."*
- `master_documents` has `storage_path text not null` and **the bucket it refers to was never
  created**. Three buckets exist in the whole product: `receipts` (0005), `load-photos` (0085),
  `hazmat` (0092).
- `master_documents` has **zero application code** — its only reference outside the migration is a
  schema probe at `schemaCheck.ts:46`. Same for `compliance_items` (`0101`), whose nightly
  `compliance_scan` job does not exist, and for `driver_endorsements` (`0098`), despite `0098:86-87`
  claiming the hazmat gate reads it (the gate reads `certifications` instead).
- `DOCUMENT_SUBJECT_TYPES` and `DOCUMENT_VARIANTS` are exported from `complianceContract.ts:53-56` and
  referenced nowhere.

So the "compliance system" is currently `certifications` plus one read-only roster page. Everything
else is schema with nothing behind it.

## 2. What already works, and is the pattern to copy

The hazmat document path is complete and proven, end to end:

1. **Register** — `hazmatLoads.ts:139-174`: verify the parent, enforce a page cap, compute
   `${orgId}/${loadId}/${docId}.${ext}`, `createSignedUploadUrl`, upsert the metadata row
   `onConflict:"id", ignoreDuplicates:true`, return `{documentId, storagePath, uploadUrl, token}`.
2. **Upload** — the driver app uploads directly under an RLS INSERT policy on `storage.objects`
   scoped by `foldername[1] = auth_org_id()` (`0092:252-267`), swallowing a 409 as success so a retry
   is safe. There is deliberately **no client SELECT and no client DELETE** on that bucket.
3. **Read** — `listDocuments` (`hazmatLoads.ts:177-198`) batches `createSignedUrls(paths, 300)`: one
   round trip, five-minute URLs, originals never publicly reachable.
4. **Hygiene** — `storageReconcile.ts` sweeps orphans after a 24-hour grace; `storageBackup.ts` copies
   evidence buckets to a second provider.

A DQF document path is this, with `driver_id` where `load_id` is. Nothing needs inventing.

## 3. What the schema already gets right

`qualification_records` (`0129`) is close to a direct encoding of the DQF, and it was written before
anyone framed it that way. Its fifteen kinds — `employment_application, mvr, annual_mvr_review,
road_test, cdl_equivalency, previous_employer_inquiry, previous_employer_response, clearinghouse_full,
clearinghouse_limited, eldt, spe_certificate, medical_registry_verification, drug_test, alcohol_test,
accident` — map almost one-to-one onto §391.51(b) and its companions. It is append-only by policy (no
UPDATE, no DELETE), which is exactly right for an audit artifact.

`certifications` (`0127`) holds the credential side with a real supersede chain, so "what did this
driver's medical card say on 3 March" is answerable — something the `drivers.*_expires_at` columns
can never answer, since they are overwritten.

The gap is that `qualification_records` **has an API and no UI at all** (`routes/compliance.ts:62-84`),
so the entire DQF event history is writable only by curl.

## 4. What the regulation actually requires

From 49 CFR §391.51 and its companions. Two clocks, and the schema must express both.

| DQF item | Cite | Retention |
| --- | --- | --- |
| Employment application | §391.21 / §391.51(b)(1) | Employment + 3 years |
| Pre-employment MVR | §391.23(a)(1) / (b)(2) | Employment + 3 years |
| Road test certificate, equivalency, or §391.44(d) statement | §391.31(e), §391.33 / (b)(3) | Employment + 3 years |
| Annual MVR | §391.25(a) / (b)(4) | **3 years from the document date** — purgeable, §391.51(d)(1) |
| Annual review note | §391.25(c)(2) / (b)(5) | **3 years from date**, (d)(2) |
| Medical examiner's certificate, or CDLIS MVR carrying med-cert status | §391.43(g) / (b)(6) | **3 years from date**, (d)(3) |
| FMCSA medical variance, SPE certificate, part-381 exemption | §391.49 / (b)(7) | **3 years from date**, (d)(4) |
| National Registry verification note | §391.23(m)(1) / (b)(8) | **3 years from date**, (d)(5) |
| Clearinghouse pre-employment (full) and annual (limited) queries | §382.701(a),(b),(e) | 3 years from the query |
| Drug and alcohol testing records | §382.401 | 5 / 2 / 1 years by record class |
| Hazmat training record (§172.704(d): name, completion date, materials, trainer name **and address**, certification) | §172.704 | **Employment as a hazmat employee + 90 days** |

Three things worth stating plainly because they change the design:

- **§172.704's "three years" is the recurrent training *interval*, not the retention period.** Retention
  is employment + 90 days. Encoding it as a flat three-year purge would be wrong.
- **The §391.53 driver investigation history file — previous-employer safety performance responses — is
  a legally *separate*, access-restricted file, not a DQF section.** §391.53(a) and (d) restrict who may
  see it. That is an access-control requirement in our model, not a folder name.
- **An electronic DQF is expressly permitted.** §390.32 (from the 2018 electronic documents rule,
  83 FR 16226): electronic methods satisfy any retention requirement in parts 300–399 provided the
  document accurately reflects the information, "remains accessible and capable of being accurately
  reproduced for later reference" by anyone entitled to it, and includes proof of consent under
  15 U.S.C. 7001(c). Legibility is separately required by §391.51(b)(6)(i).

Flagged as not fully verified and worth confirming before encoding: the post-June-2025 §391.51(b)(6)
text, where for CDL holders the CDLIS MVR replaces the paper medical certificate as the DQF artifact
(non-CDL drivers still need the MEC and the §391.23(m)(1) note).

## 5. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D-DQ1 | Build the `documents` table and a private `driver-docs` bucket, copying the hazmat register → signed-upload → batch-signed-read pattern exactly. | It is proven, and a second way of storing evidence bytes is a second thing to get wrong. |
| D-DQ2 | `master_documents`, `compliance_items` and `driver_endorsements` are deleted, not extended. | Zero application code, a bucket that does not exist, and a scan job that was never written. Schema that implies protection and provides none is the same failure as `requireStepUp` in the platform plane. Endorsements move to `certifications` with `kind='endorsement'`, which is already what the gate reads. |
| D-DQ3 | Retention is a **property of the document class**, stored, not hard-coded: `{employment_plus_years: 3}` or `{years_from_date: 3}` or `{employment_plus_days: 90}`. | Three clocks appear in the table above. A single hard-coded rule would be wrong for two of them. |
| D-DQ4 | The §391.53 investigation history is a separate collection with its own RLS, not a section of the DQF. | The regulation restricts access to it specifically. Modelling it as "just another DQF kind" would leak it to everyone who can read a DQ file. |
| D-DQ5 | Nothing is auto-purged. Retention drives a **"purgeable" state and a report**; deletion is an explicit human act, audited. | A background job that deletes compliance evidence on a date arithmetic bug is not a risk worth taking for a product this young. |
| D-DQ6 | `certifications` stays the single source of truth for qualification; the `0098` current-value columns become display fields fed from it, not a second truth. | It is the only table any enforcement path reads (`qualification.ts:64-72`). Two sources of truth for a legal gate is the defect. |
| D-DQ7 | The page becomes **Safety**, with a per-driver DQ file view, and stays gated on the fleet capability rather than the hazmat module. | A DQ file is every carrier's obligation. Hazmat adds rows to it; it does not own it. This also fixes the current bug where non-hazmat fleets are graded as cargo-tank carriers. |
| D-DQ8 | DQF completeness is computed and exposed as a status the hazmat gate and a TMS can both consume. | One evaluation, two consumers. The hazmat §5 gate already does this shape; it just reads a narrower slice. |

## 6. Plan

### DQ0 — Documents (the blocker) — **DONE 2026-08-08**

Shipped as `0146_compliance_documents.sql` (additive) and `0147_retire_dead_compliance_tables.sql`
(destructive), split so a later reader can tell which is which without reading the diff.

- Migration: `documents` (`org_id`, `subject_type`, `subject_id`, `kind`, `storage_path`,
  `content_type`, `bytes`, `sha256`, `page`, `variant`, `captured_at`, `uploaded_by`, `created_at`),
  the two FKs `certifications.document_id` and `qualification_records.document_id` reserved their
  columns for, a private bucket with a 25MB limit and an INSERT policy scoped by
  `foldername[1] = auth_org_id()`, and RLS mirroring `certifications`' driver scope.
- API: `POST /api/compliance/documents` (register → signed upload URL) and
  `GET /api/compliance/documents?subjectType&subjectId[&kind]` (one batch signed-read), modelled on
  `hazmatLoads.ts:139-198`. Registration is audited as `compliance.document_registered`.
- `master_documents`, `compliance_items` and `driver_endorsements` dropped with their `schemaCheck`
  entries, after a grep proved the only references in the entire repo were those three probes and
  four prose comments.

**Three departures from this plan, each deliberate:**

1. **The bucket is `compliance-docs`, not `driver-docs`.** The subject vocabulary was always wider
   than drivers — tractors, trailers, dispatch loads and the carrier itself — and a trailer's annual
   inspection certificate filed in a bucket called "driver-docs" is a trap. A bucket cannot be
   renamed later without moving every object in it, so the name had to be right the first time.
2. **`subject_type` includes `organization`.** `certifications.subject_type` already accepts an
   organization subject and the hazmat gate blocks on org-level certifications, so a PHMSA
   registration certificate needed somewhere to live. `DOCUMENT_SUBJECT_TYPES` in
   `complianceContract.ts` was extended to match.
3. **No aggregate per-subject cap.** `hazmat_documents` caps at `MAX_BOL_PAGES` because each page
   costs two vision-model calls; nothing is extracted here, and a cap on a qualification file would
   fail the §391.51 retention it exists to serve. The bound is per request (page ≤ 50).

**Append-only, and it is RLS that enforces it.** There is no UPDATE and no DELETE policy on
`documents` — a safety file a manager can quietly rewrite is not evidence under §390.32(d). Removal
is a service-role retention operation. Sixteen assertions in `supabase/tests/rls.test.mjs` pin this,
including that one driver cannot read another driver's medical card and that no client can read the
bucket directly at all. That file's expected count moved **159 → 175**.

### DQ1 — Make driver master data editable — **DONE 2026-08-08**

`roster/drivers.ts` promised detail, update, endorsements and deactivate "on this same router" and had
none of them, so every column `0098` added was write-once: a driver created with a mistyped
`cdl_expires_at` stayed that way forever.

- `GET /:id` — the full profile, tenant-scoped on the query so a cross-org id is indistinguishable
  from one that does not exist.
- `PATCH /:id` — strict. An unknown key is a 400, not a silent no-op, because the columns absent from
  the schema are absent for a reason: `identity_source` is derived, `user_id` and `app_access_enabled`
  belong to the invite flow, `app_username` to the credentials router, the `samsara_*` and
  `current_hos_*` columns to the syncs.
- Dates are validated as `YYYY-MM-DD`, and a cleared `<input type="date">` (which posts `""`) now
  reads as null instead of reaching Postgres as `''::date` and returning a 500.

**Deactivation is a status edit, not its own endpoint.** `auth_driver_id()` (0083) resolves only
'active' drivers, so `PATCH { status: 'terminated' }` ends driver-app access through the policies
themselves — no session to revoke, no second code path that can disagree with the first. Four matrix
assertions prove it: a terminated driver resolves to no identity, reads none of their own fuel history
and none of their own safety documents, and the office still sees the record, because §391.51(c)
retains it for three years past the end of employment.

**Three rules live in a pure `resolveDriverUpdate`**, testable without a database because they are the
rules and not incidental route code: editing an identity field claims the row from telematics; editing
the name parts recomputes `full_name` (never the reverse, per 0098, and never to empty since the column
is NOT NULL); terminating without a date stamps today, and never overwrites a date that already exists.

**A live defect found on the way, fixed in the same change.** 0098 documents "enrich, never clobber"
and the sync's deactivation pass honoured it — but the UPDATE-on-match path did not. It wrote
`full_name`, `phone` and `samsara_username` over *every* matched row, including
`identity_source = 'manual'`. An admin correcting a misspelled name through this new PATCH would have
watched it revert on the next Samsara run, silently, with nothing logged; nothing asserted the
behaviour either way. A manual row now gets only its `samsara_driver_id` refreshed — the link, not the
identity. Shipping the edit surface without this would have been shipping something that does not work.

Matrix count moved **175 → 179**.

### DQ2 — The qualification page — **DONE 2026-08-08**

**Named "Driver Qualification", not "Safety".** The sidebar already had a **Safety** section with
Compliance inside it, so the rename this plan drafted would have produced Safety → Safety. "Driver
Qualification" is what the page is, and it is what McLeod and Samsara call the same surface. The route
stays `/compliance` so no bookmark breaks. Owner decision, taken 2026-08-08.

The two hard-coded values at `CompliancePage.vue` were already fixed under F-H2; the roster column now
also distinguishes **Not started** from **Action required** (F-H1) and has its own filter for it.

**`packages/shared/src/dqFile.ts` — the checklist as pure logic.** Eighteen items: §391.51(b) and its
companions, plus the §383.93 endorsement and the four §172.704(a) training types when the carrier runs
HazmatGuard. Each carries its citation and its retention rule as text. The builder takes `today` as a
parameter rather than reading the clock, so the same file can be rendered *as at* an audit date —
which is the question an auditor actually asks, and one a function that looks at the wall clock cannot
answer. 30 assertions.

Three scoping decisions worth keeping:

1. **This is not the hazmat gate.** `qualificationGate.ts` decides whether a driver may haul a
   placardable load right now; `dqFile.ts` decides whether their file is complete for an audit. They
   overlap on the CDL and the medical certificate and diverge everywhere else. Merging them would mean
   one silently answering the other's question. They can even disagree usefully: training on its third
   anniversary is `expiring` in the file and still a pass at the gate.
2. **The tank endorsement is not in the file.** It is a fact about the equipment on a given trip, not
   about the driver's paperwork. The gate keeps it.
3. **§391.27 is not in the file.** It was removed in 2020 and superseded by the Clearinghouse query.
   Listing it would teach a carrier a requirement that no longer exists.

**`DqFilePanel.vue` — a section in the existing drawer, not a page.** Clicking a driver opens the
checklist first (the question the drawer was opened to answer) with the certification editor below it.
Each row shows status, the date it is good until, and the scan; rows without a scan get an **Attach**
button that registers the document and PUTs the bytes straight to Storage through DQ0's signed-upload
path, with the SHA-256 computed in the browser before the upload so the register records the hash of
exactly what was sent.

**A dangling document id reports as no document.** A failed upload leaves the metadata row behind, and
a checklist that trusted the id would promise an auditor a scan that cannot be opened. The builder
cross-checks every id against the documents actually registered.

### DQ3 — Close the capture gaps

- `qualification_records` gets its UI — the fifteen DQF events, with document upload.
- `CertManager` gains the fields the API already accepts and the form omits: `issuingAuthority`,
  `trainingProviderAddress`, `trainingMaterials`, `notes`, `documentId`. Two of those are
  §172.704(d)-required data we currently cannot capture at all.
- History view — the API supports `includeHistory` and the UI never requests it, so the supersede chain
  is invisible.
- Equipment and organization certifications are already expressible (`subject_type` allows tractor,
  trailer, organization) and unreachable in the UI. Wire the organization one at least: the hazmat gate
  reads org-level certs and blocks on them.

### DQ4 — Retention and audit production

Per-class retention (D-DQ3), a purgeable report (D-DQ5), and a DQ file export — a single PDF or zip per
driver, which is what §390.32(d)'s "accurately reproduced for later reference" means in practice during
an audit. Add compliance tables to `dataRetention.ts`'s **forbidden** list so a future retention rule
cannot quietly start pruning them.

### DQ5 — Driver self-service

The RLS is already written and unused: `certifications_driver_scope` (`0127:67-70`),
`qualification_records_driver_scope` (`0129:30-32`), `master_documents_driver_scope` (`0101:97-102`) —
all for an "M6 My profile screen" that was never built. A driver seeing their own expiring medical card
is the cheapest compliance win available, and the driver app has no credentials screen at all today.

## 7. On the TMS question

A TMS wants two things from this: whether a driver is qualified to be dispatched, and the documents
behind that answer when an auditor asks. D-DQ8 gives the first as a computed status; DQ4's export gives
the second. Worth noting that the ingest direction is the harder one — `POST /api/tms/loads` already
exists and has no producer, and `tools/mcleod-agent` sends only movements and driver time.

## 8. Open questions

1. Do we want driver e-signature on the application and the annual violation list? §390.32(c) permits
   it, and it removes the last paper step — but it is a real build.
2. Should the §391.53 investigation history be visible to `safety_manager` only, or also to
   `fleet_manager`? The regulation restricts it; our role model does not yet distinguish.
3. Medical certification post-June-2025: do we ingest CDLIS MVRs, or keep filing the paper MEC for CDL
   holders until forced? This changes which artifact the checklist demands.
4. Does the DQ file cover owner-operators the same way? `drivers.driver_type` exists; the obligation
   differs and nothing in the model reflects that.
