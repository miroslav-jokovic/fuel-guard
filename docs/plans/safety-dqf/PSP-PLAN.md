# FMCSA PSP — recon and implementation plan

**Date:** 2026-08-19 · **Source of every vendor fact below:** `docs/psp-docs/FMCSA
PSP-REST-WS_ProtocolImplementationGuide.pdf`, **v3.9, issued 2026-07-09** by NIC Federal / Tyler
Technologies — 80 pages, read in full, not summarised from marketing. Section numbers cite that
document. Where the guide is silent, this plan says so rather than filling the gap with a guess; that
is the lesson `SAMBA-RECON.md` §1 paid for once already.

This plan is the PSP sibling of `DQF-EXECUTION-PLAN.md` Phase E. It is written as a decision log, and
the decisions carry IDs `D-PSP*` so later work can cite them.

---

## 0. Ground truth — measured 2026-08-19, not assumed

| Fact | How it was established | Value |
|---|---|---|
| A PSP API token exists | Owner (MJ), 2026-08-19 | Yes — **environment not yet stated** (see Q1) |
| PSP appears nowhere in this codebase | `grep -ri "psp\|pre-employment"` over `apps/ packages/ supabase/` | Zero hits outside `dqCatalogue.ts`'s §391.23 citations |
| `organizations.dot_number` | column added `0152_dq_exports.sql:124` | exists, **NULL for Silvicom Inc** |
| `drivers.cdl_number` / `cdl_state` | columns added `0098_drivers_master.sql:56-57`, populated by D6's Samsara sync | **166 of 266** drivers carry both |
| `drivers.date_of_birth` | column exists on the roster read (`routes/roster/drivers.ts:59`) | **0 of 266 drivers carry one** |
| Drivers eligible for a PSP request today | `count(*) where status='active' and cdl_number is not null and cdl_state is not null and date_of_birth is not null` | **0** |
| `qualification_records` | production count | **0 rows** — the DQF tables are still green field |

**The headline finding is the last three rows, and it is not about PSP.** §5.4.1 makes `driverDOB` a
mandatory request field, and §8.1 makes date of birth one of the **four data points that must match
exactly** for a record to be returned. We hold a date of birth for nobody. Neither the API token, nor
the SambaSafety credentials, nor the PAI key unblocks a single PSP request — **the roster does**. The
same gap blocks a SambaSafety MVR order (DOB + SSN) and a Clearinghouse query. Capturing DOB is
therefore not PSP work that can wait for PSP; it is roster work that gates three integrations at once,
it is blocked by nothing, and it should start first.

`organizations.dot_number` is the same shape of problem one level up: §5.4.1 requires
`dotNumber` **or** `motorCarrierId`, and Error 10 refuses the request without one. One row, one value,
zero engineering — but nobody has typed it in.

---

## 1. What PSP is, and — importantly — what it is not

PSP sells a motor carrier one thing: a driver's **crash record (5 years)** and **roadside inspection
record (3 years)** out of FMCSA's MCMIS, with the driver's written consent (§Introduction).

**D-PSP1 — PSP is advisory in the qualification file, never a `missing` item.** 49 CFR §391.23
enumerates what a carrier must investigate before hiring: the driving record from every state of
licensure (§391.23(a)(1)) and the safety-performance history from previous employers
(§391.23(a)(2),(d)). **PSP is not in that list.** FMCSA's own program is voluntary; a carrier that
never buys a PSP report has a lawful §391.51 file. So the catalogue entry gets `advisory: true` —
the same treatment `eldt` already has, and for the same reason spelled out in `dqCatalogue.ts:
"§391.51(b) has no ELDT item"`. An advisory item never reports `missing`, never enters the attention
feed, and never counts against `complete`.

Getting this backwards would be the most damaging thing this feature could do: it would paint every
lawful driver file red and teach operators that our compliance verdict is noise.

**What PSP is genuinely worth**, and where the product value sits:
- **Hiring evidence.** A carrier that *did* run PSP wants the artifact in the binder. FMCSA's own
  research is the selling point, and it belongs in the file as proof of a diligent hire.
- **A risk signal we cannot get anywhere else.** `driverInfoSummary` returns
  `driverInspCount / driverOOSCount / driverOOSRate` and the vehicle equivalents (§5.4.3). That is a
  driver's real roadside history across *every* carrier they have driven for — something neither
  Samsara nor our own inspection data can see. It is a legitimate input to `services/entityRisk.ts`
  and `driverScore.ts`.
- **45-day monitoring** (§5.4.1, §6) — a post-hire change feed FMCSA added in July 2026. See §4g.

---

## 2. The vendor surface, verified

### 2.1 Hosts and auth

| | |
|---|---|
| Test (UAT) | `https://rest-api.uat.psp.tylerapp.com` |
| Production | `https://www.psp.fmcsa.dot.gov/PspRestService` |
| Auth | `api-key: <token>` header on every call (§5.2) |
| Token lifetime | **60 days** (§4.2) |
| Token origin | The **first** token must be minted by a human in the PSP web UI behind Login.gov + MFA (§4.2). Every subsequent one can be requested by `GET /Token` (§4.3). |
| OpenAPI | **Published, and fetched 2026-08-19** — `<base>/swagger/v1/swagger.json`, OpenAPI 3.0.4, committed at [`docs/vendor/psp-openapi.json`](../../vendor/psp-openapi.json) (§10.6) |

Tokens are **per environment**; a UAT token does not work in production and vice versa (§4).

**The Swagger JSON is the one thing SambaSafety did not give us** (`SAMBA-RECON.md` §1). It has been
pulled and committed to `docs/vendor/psp-openapi.json`, so the shapes below are checkable by a test
rather than by re-reading a PDF — and §2.6 records what it says that the guide does not.

### 2.2 The three endpoints that matter

| Verb | Path | Purpose |
|---|---|---|
| `POST` | `/Records` | Request one or more driver records. **This is the call that bills.** (§5.3) |
| `POST` | `/Record` | Fetch the PDF for a record already requested, by `authCode`. (§7) |
| `POST` | `/v2/Record` | **Undocumented.** Present in the OpenAPI, absent from the guide — see §2.6. |
| `GET` | `/Token` | Rotate the API token. (§4.3) |
| `GET` | `/DayMonitored45` | The 45-day monitoring report. (§6) |

### 2.3 `POST /Records` — the request (§5.4.1)

The body is an **array** of driver-record requests; each carries an array of `licenseQueries`:

```jsonc
[{
  "authCode": "",                 // empty on request; PSP returns one
  "dotNumber": "43586",           // or motorCarrierId — Error 10 without at least one
  "driverConsent": true,          // Error 17 if absent/false. See D-PSP3.
  "driverFirstName": "SUSAN",
  "driverLastName": "GODFREY",
  "driverDOB": "12/11/1949",
  "motorCarrierId": "10708",
  "internalRefId": "…",           // ≤256 chars, ours, echoed back — our idempotency handle
  "licenseQueries": [{ "dlFirstName": "…", "dlLastName": "…", "dlNum": "…", "dlState": "PA" }],
  "userIPAddress": "24.111.116.63",
  "monitor": false                // 45-day monitoring enrolment; default false
}]
```

`internalRefId` is PSP's equivalent of SambaSafety's `customPersonId` (`SAMBA-RECON.md` §9): a field
the vendor stores for us and echoes on every response and on the monitoring report. **`drivers.id`
goes there.** No mapping table, no name-matching — the same reasoning that avoided repeating the
`0203` duplicate-driver damage.

### 2.4 The response (§5.4.3)

`driverInformationResponse` carries `status / statusDetail / statusDescription`, the driver identity
echo, `authCode`, `requestDate`, `mcmisUploadDate`, `monitor`, and:

- `driverRecord.crashRecords[]` — ~70 fields per crash, including `notPreventable` /
  `notPreventableDesc` (§10.5).
- `driverRecord.inspectionRecords[]` — ~80 fields per inspection, each with
  `inspectionViolations[]` carrying `partNoSection`, `sectionDesc`, `outOfServiceIndicator`,
  `citationResult` / `citationResultDesc` (adjudication, §10.4).
- `driverInfoSummary` — the six inspection/OOS counters and rates.
- `driverReportSummaryResponse` — 17 fleet-level rollups (crashes, fatalities, injuries, towaways,
  hazmat releases, OOS rates, `numCrashesNotPreventable`).
- `inspectionViolationSummary[]` — per-violation counts with `isAdjudicated`.

**D-PSP2 — store the response verbatim, parse a thin projection.** ~150 vendor fields per record, all
typed `"string"` in the guide, is not a schema to model in Postgres. The raw JSON is the evidence; the
PDF is the artifact an auditor reads; what we *index* is the dozen summary numbers the product
actually uses. Same posture as `efsSoap`'s "persist the body before parsing".

### 2.5 Status codes (§8.5) — the whole table, because it is the client's contract

| status | meaning | statusDetail | Notes |
|---|---|---|---|
| `0` | Success | `0` | Exact match on all four data points, for every licence submitted |
| `4` | Partial | `4` | Multi-licence request, some matched |
| `1` | Failure | `1` | No licence matched |
| `2` | Error | 1,2,3,4,5,7,8,10,11,17,18,21,22,23,24,25,26,27,28,30,31,32,33,34,35,78 | See §4a |

A `Success` with zero crashes and zero inspections **is a valid, clean record** (§8.3, last line) —
not an empty result, and the UI must say "clean" rather than "no data found".

### 2.6 What the OpenAPI says that the guide does not — fetched and diffed 2026-08-19

Re-fetch with:

```bash
curl -sS "https://www.psp.fmcsa.dot.gov/PspRestService/swagger/v1/swagger.json" -o docs/vendor/psp-openapi.json
```

Five endpoints (`POST /Records`, `POST /Record`, `POST /v2/Record`, `GET /Token`,
`GET /DayMonitored45`), one security scheme (`api-key` header), seventeen schemas. The envelope the
guide draws in §5.4.3 is confirmed: `POST /Records` takes `RecordRequest[]` and returns
`DriverReportResponse[]`, each wrapping a `driverInformationResponse` plus
`driverReportSummaryResponse`, `authCodeURL`, `inspectionViolationSummary`, `driverQueries` and
`monitor`.

**Five discrepancies, each of which would bite a client written from one source alone:**

1. **`POST /v2/Record` exists and the guide never mentions it** — not in §7, not in the version
   history through v3.9. Same `AuthCodeRequest` body. Ask what it changes (Q8) before choosing a
   version; do not adopt it because the number is higher.
2. **No schema declares a single `required` field.** Every property in `RecordRequest` is
   `nullable: true`, including `driverDOB` and `licenseQueries`. **The spec is therefore useless as a
   validation contract, and a codegen'd client would be actively dangerous** — it would happily send
   a request with no date of birth and let PSP bill us for the `Failure`. Requiredness lives only in
   the §8.5 error table, which is why P2's validator is hand-written from that table and not
   generated. This is the `SAMBA-RECON.md` §1 lesson in a second costume: the machine-readable
   artifact exists here, and it still is not the specification.
3. **`status` is an enum of `[0, 1, 2, 3, 4]`. The guide documents 0, 1, 2 and 4.** **Status 3 is
   undocumented** — unknown meaning, unknown billing. P2's status table must treat an unrecognised
   status as an explicit `unknown` that settles the ledger row for a human, never as a default-to-
   success or a default-to-failure.
4. **`status` is an integer on `/Records` and a string on `/Record`.** `DriverInformationResponse.
   status` is `int32`; `AuthCodeResponse.status` is `string` ("Failure", per §7.3's example). Two
   types for one concept across two endpoints of one API — parse them as two types, and never share
   a helper between them.
5. **Field-name typos, and the two sources disagree about one of them.** `DriverReportSummary
   Response.numFatailities` (sic) is spelled that way in **both** the guide and the spec — mirror it
   exactly. But the token response is `canRequestRecoreds` in the guide's §4.3 example and
   `canRequestRecords` in the spec's `TokenResponse`. **One of them is wrong and we cannot tell
   which from documentation.** Parse defensively — accept either — and pin the spelling actually
   observed on the wire with a test the first time we see a live response.

One more shape trap: `driverInfoSummary.driverOOSRate` and its siblings are typed **`int32`, not a
decimal**. An out-of-service *rate* delivered as an integer is either a truncated percent or a scaled
value, and P10 must not multiply it by 100 on an assumption. Confirm against a live UAT record before
it reaches a driver's score.

---

## 3. Architecture — is PSP an EFS-style capability?

`DQF-EXECUTION-PLAN.md`'s Architecture section drew the boundary for SambaSafety and it is the right
place to start, because the instinct ("build PSP the same way") deserves the same scrutiny it gave
that one.

The EFS architecture — `Capability = Contract × Behaviour × View`, `Behaviour = Target × Mutation ×
Verification × Governance` — exists for **outbound writes that leave our control, can partially fail,
can be replayed, and cost money**. Its thesis is *"generalising dispatch is easy; generalising
verification is the job."*

Score PSP against that, honestly:

| The axis | PSP |
|---|---|
| Leaves our control | Yes |
| Costs money | **Yes — and it bills on failure too** (§8) |
| Can be replayed | Yes, and a replay is a second charge |
| Can partially fail | Yes — `Partial`, status 4 |
| **Mutates vendor state** | **No.** MCMIS is unchanged. `POST /Records` is a read with a price tag. |
| **Has state to re-read and re-judge** | **No.** There is no `snapshot`, no `judge`, no `reconcile` — nothing at FMCSA to look at afterwards to ask "did it land". The response *is* the landing. |

**D-PSP3 — PSP is not a capability, and building it as one would be cargo-culting.** Two of the four
`Behaviour` legs — `Verification` and most of `Mutation` — have no referent here. A `verify` block
whose `judge` always returns `landed` and whose `reconcile` can only re-read our own row is ceremony
that makes the next reader hunt for vendor state that does not exist. The plan's own standing rule
applies: *an abstraction may only accommodate cases that exist in code today.*

**What PSP does need is the other half of the EFS design, and it needs all of it:**

- **A ledger row written before dispatch**, carrying an idempotency key and the redacted request body
  — because this is the exact failure class the card ledger was built for. A retried POST is a second
  invoice.
- **The governance stack** — step-up re-auth, a per-org monthly budget on the
  `0130_hazmat_run_counter.sql` shape, a kill switch, and a consent gate that is stricter than any of
  them.

So: **PSP is an ingest-with-a-price**, not a mutation. It gets a ledger and governance, and it does
not get a capability registry.

### 3.1 The reusable module the request is really asking for

The ask was "PSP as a reusable module so we can use it with multiple features". The reusable thing is
**not** the PSP client — a client that speaks one vendor's protocol is reusable by exactly nobody. A
premature `ScreeningProvider` interface with PSP as its only implementation would be the
`LedgerAdapter` seam the Samba plan explicitly refused to build.

Three seams carry the reuse instead, and two of them are new:

**(a) `driver_authorizations` — the genuinely reusable new module, and it is blocked by nothing.**
PSP refuses a request without the driver's written disclosure and authorization (§5.4.1
`driverConsent`; Errors 17 and 31). So does a SambaSafety MVR (FCRA). So does a Clearinghouse query
(§382.701 requires driver-specific consent). So does drug and alcohol testing. **Four features, one
obligation, and we have no surface for it anywhere in the product** — `grep -r "consent"` finds only
Microsoft Graph admin consent.

`hazmat_reviews.attestation` (`0092_hazmat_core.sql:119`, D8) is the proven pattern and should be
copied outright: the **server composes the exact attestation string** and stores it verbatim, the
client never authors it (`hazmatReview.ts:8` — *"never paraphrase in the UI"*). A
`driver_authorizations` row records purpose, the exact disclosure text shown, when and by whom it was
accepted, and its scope. `driverConsent: true` on a PSP request then means something we can produce in
an audit, rather than a boolean a developer hardcoded.

This is the piece to build first among the new work. It is the reusable module; PSP is its first
consumer.

**(b) `packages/shared/src/psp/` — pure, zero I/O, and it saves money.** Request validation, response
parsing, and the summary projection. §4a explains why validation-before-dispatch is a cost control and
not a nicety. Pure and unit-tested per the house rule; usable from the API, the worker, and a
scratch script alike.

**(c) The tables every consumer already reads.** The DQF binder, the driver page, the scorer and the
retention sweeper must read `documents` and `qualification_records` — never a `psp_*` table. That is
what makes a PSP report interchangeable with a hand-uploaded one and keeps a second consumer from
growing a second vocabulary. `D-DQ6` already says this for certifications; it holds here.

---

## 4. The hazards — what the guide states and a naive client would get wrong

### a. It bills on Failure, so validation is a cost control
> §8: *"Accounts are charged the transaction fee for 'Success,' 'Partial' and 'Failure' response
> statuses."*

A mistyped licence number returns `Failure` and costs the same as a hit. Status `2` (Error) is *not*
in that list — so a request PSP rejects as malformed is free.

**Every one of these is checkable before dispatch**, straight off the §8.5 error table: DOB present
and parseable and the driver ≥18 (Errors 1, 27); first name ≤20 chars, letters/hyphen/apostrophe only
(Error 2); last name ≤20 (Errors 5, 25, 26); `dlNum` ≤25 chars (Errors 4, 24); `dlState` exactly 2
chars and a valid US state, Canadian province, US territory or `MX` (Error 8); `internalRefId` ≤256
(Error 3); a `dotNumber` or `motorCarrierId` present (Error 10). That is `packages/shared/src/psp/
validate.ts`, pure, and it is the difference between a bad roster row costing a transaction fee and
costing nothing.

### b. One driver per request
> §5: *"If there are any validation issues with any of the driver record requests, the entire request
> is cancelled."*

The endpoint takes an array, and a single bad row voids the batch. Batching a nightly sweep of 200
drivers into one call means one bad DOB kills 199 good requests. **Send one driver per request.**

### c. Never blind-retry `POST /Records`
There is no idempotency header. `internalRefId` is echoed but nothing in the guide says PSP
de-duplicates on it. A connection reset after the server processed the request is indistinguishable
from one before — and the charge has already landed. So: ledger row first, single attempt, and a
network-layer failure settles `indeterminate` for a human, never an automatic retry. This is precisely
the discipline `efs_card_mutations` encodes; PSP needs the same one for the same reason.

### d. The token is a 60-day fuse with a manual reset
`GET /Token` (§4.3) renews, but the *initial* token is only obtainable by a human at Login.gov with
MFA (§4.2). Let one lapse and the integration is down until a person with the PSP account logs in.

Three consequences: the token is sealed at rest via `secretBox` with its expiry stored alongside;
renewal runs on a scheduler well before day 60 (and per `CLAUDE.md`, schedulers run in exactly one
process fleet-wide — check `docs/WORKER-DEPLOYMENT.md` before adding one); and a failed renewal
raises an operator alert rather than a log line, because nothing automated can fix it.

**The guide does not say whether `GET /Token` invalidates the previous token.** It says *"A new token
was created and returned"*. Assume rotation: renewal must be single-flight and the swap transactional,
or two workers renewing concurrently will orphan each other's credential.

*(Field-name trap: the guide's §4.3 example spells the field `"canRequestRecoreds"` and the OpenAPI
spells it `"canRequestRecords"`. Accept both — see §2.6(5) — and pin the observed spelling once a live
response settles it.)*

### e. The PDF has a 120-hour fuse
> §7: *"the report must not be past the 5 days/120-hour expiration window."*

`authCode` is the handle for `POST /Record`, and it dies after five days (Error 28). **Fetch the PDF
in the same job that made the request** and file it into `documents` immediately. Do not design a
"download it later" affordance; there is no later.

Ask for `returnType: "PDF"` for the raw bytes. Note §7.1's trap: *in the PDF return type an error
comes back as a string beginning `"ERROR"`* — a client that pipes the response straight to storage
will file a text file with a `.pdf` name and a valid sha256. Check the leading bytes for `%PDF`.

### f. `userIPAddress` is required, and it is not ours
§5.4.1 makes it mandatory. For a system-to-system call the honest value is the IP of the operator who
authorised the request, which makes it an audit fact rather than a filler field — but the guide never
defines it. **Confirm with PSP support before production** (Q4): sending a wrong value on a request
governed by an account-holder agreement is a compliance question, not a formatting one.

### g. 45-day monitoring is a poll, and "changed" costs money to read
`monitor: true` enrols a transaction (§5.4.1). `GET /DayMonitored45` (§6) then returns, per enrolled
record: `authCode`, `lastName`, `internalRefId`, `timeStamp`, `changeDetected`.

**That is all it returns.** To learn *what* changed you must request the record again — which bills
again (§8). So a scheduler that auto-re-pulls on `changeDetected` is an unbounded spend triggered by
FMCSA's data, not by us. **D-PSP4:** `changeDetected` raises a notification and nothing else; the
re-pull is an operator decision, under the same budget and step-up as any other order.

There is no webhook. This is a poll, on the `efsIngestScheduler` model, keyed on `internalRefId` →
`drivers.id`. The guide does not say whether enrolment costs extra, or how enrolment ends (Q5).

### h. PSP data is restricted, and more so than most of the file
The record is a person's crash and violation history across every carrier they have driven for,
obtained under a consent regime with an FMCSA account-holder agreement behind it. It goes in
`RESTRICTED_QUALIFICATION_KINDS` (`packages/shared/src/auth.ts:132`) alongside the drug/alcohol and
§391.53 kinds, and therefore behind `canReadRestricted` (admin + safety_manager) and the `0205`
RESTRICTIVE policies, and into the binder only when `dq_exports.include_restricted` is explicitly set.

**Whether PSP is a consumer report under FCRA — and so whether adverse-action notice obligations
attach when a report contributes to a hiring decision — is a question for the PSP account-holder
agreement and counsel, not for this document** (Q6). The conservative handling above is correct
either way, which is why it is not held up waiting for the answer.

---

## 5. Phase P — the steps

Numbered to run after the DQF plan's Phase D. Migrations are additive and start at **0208** (0205 is
taken by restricted kinds, 0206 by `derived_from`, 0207 by the notification categories — the Samba
plan's "migration 0205" numbering is stale). Every write is audited with a `compliance.*` action
through `writeAudit`, per the DQF plan's conventions.

### P0 · Capture date of birth — **code DONE 2026-08-19; the data entry is not**
0 of 266 drivers have one, and PSP, a Samba MVR and a Clearinghouse query all require it.

**Why there was nothing to fix in the API.** `date_of_birth` was already a column, already on
`driverCreateSchema` / `driverUpdateSchema` / `driverDetailSchema`, and already in the roster
router's `DRIVER_DETAIL_COLS`. The whole gap was that **no surface in the web app rendered the
field** — every roster edit path in the browser goes through `DriverForm.vue`, which speaks the older
five-field `driverInputSchema` and writes to PostgREST directly. The field existed end to end and had
no door.

**What shipped:**

- `packages/shared/src/rosterContract.ts` — `dateOfBirthIssue(value, today)` and `dateOfBirthSchema`,
  now used by both the create and the update contract. Three rules `isoDateSchema` does not have: a
  **real calendar date** (its regex accepts `2026-02-31`, which reaches Postgres as a 500), **not in
  the future and at least 18** (PSP Error 27 — 18 and not §391.11(b)(1)'s 21, because this schema
  judges whether a value can be a date of birth, not whether the driver may drive interstate), and
  **not over 120 years ago**, which is the transposed-century typo. `today` is an argument so the
  rule is testable without freezing a clock.
- `packages/shared/src/rosterContract.test.ts` — 8 assertions, including the leap-day case that a
  milliseconds-divided age gets wrong.
- `apps/web/src/composables/useDrivers.ts` — `useUpdateDriverProfile`, which goes through
  `PATCH /api/roster/drivers/:id` rather than PostgREST, so a personal-data edit is contract-validated
  and **audited**. Deliberately a second hook beside `useUpdateDriver`, not a replacement for it.
- `apps/web/src/features/compliance/ScreeningIdentityCard.vue`, mounted at the top of
  `QualificationSection.vue` — above the group tiles, because a driver with no date of birth cannot be
  screened at all, which is upstream of every requirement the tiles count. It is diagnostic first and
  a form second: it names the missing values by name ("missing a date of birth, licence state")
  before it offers the input. Licence number and state render read-only — the Samsara sync owns them
  under D6's enrich-never-clobber rule, and a wrong licence is a roster edit, not a screening edit.

**`date_of_birth` is deliberately NOT added to the roster router's `AUDITED_VALUE_FIELDS`.** That
list exists so a DOT auditor can see what a medical-card expiry changed to; copying a date of birth
into it would put a personal-file value in a log every admin can read, which is the exact thing that
list's own comment refuses. The audit row records that the field was edited. `sentryScrub.ts` already
redacts `date_of_birth` by key, so no change was needed there either.

**Still open, and it is data entry rather than engineering:** the 266 dates of birth themselves, and
`organizations.dot_number` for Silvicom Inc — one value, and PSP Error 10 refuses every request
without it.

**Verified by:** `pnpm typecheck`, `pnpm lint` and `pnpm test` (unit + all 8 matrices) all green.
Not verified in a browser — the vite dev server crashes in this environment for unrelated reasons, so
`vue-tsc` and the unit suites are the check, per the standing note.

### P0b · Screening readiness — **DONE 2026-08-20**

**Measured, not guessed.** With P9 shipped, the carrier number configured and the unit price set, a
production count on 2026-08-20 read: **201 active drivers, a licence for 166, a date of birth for
ZERO.** Every gate was built and not one PSP request could have been made — `validatePspRequest`
refuses without a date of birth (§8.5 details 1, 27). The integration was complete and unusable, and
nothing in the product said so; the failure would have surfaced one driver at a time, at the moment
somebody tried to spend money.

`/recruitment/screening` is the fleet-wide answer: how many drivers can be screened, what is blocking
the rest ranked by how many each field blocks, and the missing date of birth editable in the row
where it is missing. P0's identity card stays — it is the right surface when you are already looking
at one driver's file — but it made fixing 201 drivers a 201-visit job.

**The verdict is the validator's.** Every row is judged by `validatePspRequest` over a draft built by
`buildPspDraft` — the same two functions the order path runs, now shared (`psp/identity.ts`). A page
with its own checklist would eventually call somebody ready whom PSP refuses, and **PSP bills on
Failure**, so the disagreement would cost a transaction fee to discover rather than merely being
wrong. A test pins that the report's gaps equal the order path's own issues for the same driver.

Consent is deliberately NOT part of the verdict. The signed release is the order path's gate
(`missingAuthorizations`); folding it in here would report every driver as unready for a reason that
has nothing to do with their identity data, which is the one thing this report is about.

#### P0b(ii) · The bulk path — migration 0221

201 drivers is a lot of typing, and the value usually already exists in the carrier's payroll export.
`/recruitment/screening` takes a CSV: a `date_of_birth` column plus anything to match on — driver id,
employee number, licence number, or name. Drop it to preview, press again to write. The preview is
not decoration: it is the only way somebody can see what the matching rules decided about THEIR file
before anything lands.

**Only `date_of_birth` is importable.** Licence number and state are the other screening identity
fields, and the Samsara sync owns them under enrich-never-clobber (D6). A spreadsheet fighting a
telematics sync over a driver's licence number is a worse problem than the 35 drivers it would fix.

**Three refusals, each because the failure is silent and expensive:**

- **An ambiguous name is rejected, never resolved by picking the first match.** A date of birth on
  the wrong driver is a screening request about the wrong person, billed (§8), possibly filed against
  somebody whose job depends on it. Two rows claiming one driver is the same failure and is refused
  the same way.
- **`03/04/1980` is refused rather than interpreted.** It is two real dates depending on where the
  sheet came from, both pass validation, and the wrong one is invisible until PSP charges for a
  `Failure`. ISO only, and the error names the fix.
- **A date already on file is never overwritten**, and that rule lives in the WHERE clause
  (`date_of_birth is null`), not only in the planner. The planner decides from a roster it read
  moments earlier; the predicate closes the window between that read and the write. The behavioural
  matrix pins exactly this — "a stale plan cannot clobber a value written since it was made".

`applied` is reported separately from `matched` for the same reason: the difference is real, and
telling somebody 40 dates landed when 39 did is how a bulk tool loses trust.

### P3 · Credentials — the carrier is the ORGANISATION (partly done 2026-08-20)

The order path read `PSP_DOT_NUMBER` from the environment, which is correct for exactly one shape of
deployment: one carrier per install. **This is not that** — there are two organisations in the
database, so an environment-level carrier number files every request under one of them. A request
about the second org's driver would go out under the first org's identity, against the first org's
account-holder agreement.

That is a misattribution rather than an untidiness: a PSP record is obtained by a named carrier with
that driver's written consent, and the name on the request is part of what makes it lawful.
`resolveCarrierIdentity` now prefers `organizations.dot_number` and falls back to the environment,
the preflight reports which answered, and the readiness page shows a `No carrier DOT number` badge
when neither does. The API TOKEN is still per-deployment — one account holder's key — and that is the
remaining half of P3.

### P1 · `driver_authorizations` — the reusable consent module (migration 0208)
The §3.1(a) table. Columns: `org_id, driver_id, purpose ('psp'|'mvr'|'clearinghouse'|'drug_alcohol'),
disclosure_text, accepted_at, accepted_via, accepted_by, evidence_document_id, revoked_at`. RLS
enabled per the hard rule; restricted read like `0205`. Append-only — a revocation is a new row, per
the evidence-table discipline in `CLAUDE.md`.

Server composes `disclosure_text` from a versioned constant in `packages/shared`; the client never
sends it (`hazmatReview.ts:8`).

**Done when:** a PGlite matrix proves an authorization cannot be inserted for another org's driver,
that the text stored is the server's and not the caller's, and that a revoked authorization stops
satisfying the gate.

### P2 · `packages/shared/src/psp/` — the pure module
`validate.ts` (§4a's pre-flight, one rule per §8.5 error code, each citing it), `parse.ts` (the
response projection of D-PSP2), `status.ts` (the §8.5 table as data, including which statuses bill).
Zero I/O. Unit-tested.
**Done when:** `pnpm test` covers every §8.5 error code that is checkable pre-flight, and a fixture
round-trips a full `driverInformationResponse` into the projection.

### P3 · Credentials — no new table
`org_integrations` with `provider='psp'`: the token **sealed** via `secretBox` (it is a bearer
credential with a 60-day life, and `secretBox` exists for exactly this), plus non-secret config —
environment (`uat`|`production`), `dotNumber`, `motorCarrierId`, `tokenExpiresAt`. Service-role only;
the table already has no client policies (G17's reasoning, unchanged).
**Done when:** a scratch script reads and writes the row through the admin client only, and
`gitleaks` is clean.

### P4 · `apps/api/src/psp/client.ts` — the vendor edge and nothing else
`POST /Records`, `POST /Record`, `GET /Token`, `GET /DayMonitored45`. Response body persisted verbatim
before parsing. **No retry on `/Records`** (§4c) — that is a structural property of this client, not a
policy a caller passes in. Opts arrive built, following `ReadCtx`/`DispatchCtx`.

The guard that must be structural: **status `2` is an error carried inside a 200**, the same trap
SambaSafety sets (`SAMBA-RECON.md` §6). The client converts it to a typed failure; no caller may be
the first to notice.
**Done when:** a fixture test round-trips a success response; a second proves `status: 2,
statusDetail: 17` surfaces as a typed `consent_missing` failure and not as data; a third proves a
`/Record` response beginning `"ERROR"` is never written to storage; and a fourth proves an
unrecognised `status` (3, or anything the §8.5 table does not name) settles the row for a human
rather than defaulting in either direction — §2.6(3).

### P5 · `psp_requests` — the ledger (migration 0209)
```
id, org_id, driver_id, idempotency_key, internal_ref_id, request_body jsonb (redacted),
status, psp_status, psp_status_detail, auth_code, monitor, billed boolean,
response_raw jsonb, document_id, error, created_at, settled_at
```
`status` uses the **same vocabulary as `efs_card_mutations`** — `pending, sent, succeeded, failed,
drift_detected, partial` — so an operator reading two integration surfaces learns one set of words.
`partial` carries PSP status 4 honestly. A partial unique index gives one in-flight request per
`(org_id, driver_id)`.

`billed` is a stored column, not a derivation, because §8's rule may change and an invoice
reconciliation must read what was true on the day. Licence numbers and DOB are redacted on the way in,
per `redactCardXml`.
**Done when:** a migration matrix proves the one-in-flight index holds, and that a replayed
idempotency key returns the first outcome rather than issuing a second **billed** vendor call.

### P6 · The order path — governance is the feature
A queue job (`services/queue/handlers/psp.ts`), enqueued by an operator action, never by a sweep.
Gates, in order, each refusing **before** any vendor call:
1. **A live `driver_authorizations` row** for `purpose='psp'`. Without it the request is not made —
   we do not send `driverConsent: true` on a developer's say-so.
2. **Step-up re-authentication** (`requireFreshAuth`) — it spends money and pulls a person's record.
3. **Per-org monthly budget**, `withinBudget` + an atomic `org_usage_month` counter, on the
   `0130_hazmat_run_counter.sql` shape.
4. **Kill switch**, as `extractionEnabled` is for vision.
5. **P2's validation** — the cost control of §4a.

Then: ledger row → `POST /Records` → `POST /Record` for the PDF in the **same job** (§4e) → settle.
**Done when:** an order without consent, without step-up, over budget, or failing validation is
refused with **zero** vendor calls and a named error each; and a `Failure` response still settles the
row `failed` with `billed = true`.

### P7 · Ingest → the tables we already have (migration 0208 extends the CHECKs)
Add `psp_report` to `qualification_records.kind` (0129), to `documents.kind` (0146), to
`RESTRICTED_QUALIFICATION_KINDS` and to `0205`'s two RESTRICTIVE policies — the four lists that must
move together, with `packages/shared/src/auth.ts` as the source of truth its own comment declares it
to be.

The PDF files into `documents` (`content_type='application/pdf'`); one `qualification_records` row
cites that document, `occurred_on = requestDate`, `detail` carrying P2's summary projection. Both
writes audited. Then the catalogue entry, `advisory: true`, per **D-PSP1**.
**Done when:** ingesting a fixture produces exactly one document row and one record row; re-ingesting
the same `authCode` produces neither; and a `dispatcher` role reading the driver's file sees no PSP
row at all.

### P8 · 45-day monitoring — poll, notify, and stop there
A scheduler polling `GET /DayMonitored45`, joining `internalRefId → drivers.id`, raising a
`dq_psp_change` notification through `notify()` on a `changeDetected` transition. Extend `0207`'s
category CHECK.

**It does not re-pull the record** — D-PSP4, §4g. The notification deep-links to the driver's
qualification page where an operator can order a fresh report under P6's gates.
**Done when:** a `changeDetected` transition raises exactly one notification per record per change,
a repeated poll with the same `timeStamp` raises none, and no code path orders a record from the
scheduler.

### P9 · Surface it — **DONE 2026-08-20**
The PSP row on the driver's Qualification section, marked **Source: PSP** from data and never inferred
from a record's shape. The order confirmation states the cost and the remaining monthly budget before
the operator confirms — the same bar E5 sets for a Samba MVR. Design contract as ever: `PageHeader`
carries no title, `DataTable` inside `BaseCard padding="none"`, badges only from `lib/badges.ts`,
`SlideOver` with actions in `#footer`, toasts not banners.

**Source is a written field, not a heuristic** (`psp/provenance.ts`). The ordered path now writes
`detail.source = 'psp_api'`; the import writes `portal_import`; anything else reads `unknown` and
says so. The shortcut this refuses — *"it has an inspection count, so it was ordered"* — is wrong in
the one case that matters: an ordered record for a driver with no inspections has no counts either,
and would be mislabelled an unread PDF. A clean record and an unexamined one look identical from the
outside (D-PSP5), which is the whole reason the writer states the source. `hasStructuredPspData`
asks the separate question a UI actually has — may I render counts — and answers **no** for an
`unknown` record, because rendering a number nothing produced is the worse error.

**The confirmation states the charge, and refuses to state a price it does not know.** The billing
outcomes come from `PSP_STATUS` via the preflight (`billsOn`), never retyped in the client, so the
sentence is *"PSP charges for success, partial, failure responses — including a search that matches
nothing"*. `PSP_UNIT_PRICE_USD` has **no default** (Q2 is unanswered): unset, the drawer says the
price is not configured and shows the monthly budget instead. A plausible invented figure is worse
than an honest absence to somebody approving a spend.

**The password comes last.** `pspOrderPreflight` runs the same `checkPspGates` the order runs, but
with `stepUp: true`, so it never returns `step_up_required` — an operator learns the driver never
signed the PSP disclosure *before* being asked to re-type anything. For the same reason the route
does not use `requireFreshAuth()` as middleware: that would refuse first, ahead of the legality check
the service deliberately orders first.

**`monitor` is not exposed.** §5.4.1 allows enrolling a request in 45-day monitoring and the draft
carries the flag, but P8 — the poll that would read what monitoring reports — does not exist. A
switch whose consequence nothing listens to is not a feature.

**Ordering remains OFF.** `PSP_ORDERS_ENABLED` defaults to false, and a route test pins that a
deployment with a key configured still refuses with 503 and writes no ledger row.

#### P9a · The hardening, before the first order (migration 0219)

Three gaps in the above, closed while `psp_requests` is empty and there are **zero** `psp_report`
records in production — each one cheap now and expensive after the first purchase.

**The rate goes on the row.** `PSP_UNIT_PRICE_USD` is deployment configuration: one value, correct
only right now. A vendor price change silently re-prices every past row. `billed` records WHETHER PSP
charged; `psp_requests.unit_price_usd` now records WHAT the rate was, stamped at INSERT — before the
vendor call, so it survives a settle that never completes — and null when nobody has told us (Q2),
which reads as "we were not told", never as "free". **This is the half of invoice reconciliation the
boolean cannot carry.** A per-org rate table with effective dates is the enterprise shape and is
deliberately NOT built: the price is still unknown, and a second source for it would be the drift
this column exists to prevent. The snapshot means adding one later needs no rework.

**`{ authority: false }` replaces `stepUp: true`.** The preflight used to skip the password gate by
asserting a step-up that had not happened. `checkPspGates` now takes an explicit gate selection, and
the input type it needs (`PspGateInput`) no longer includes the `userId` the preflight had to invent.
The order path never passes the flag, so nothing can skip the password on a request that spends.

**Provenance became a closed set.** A CHECK on `qualification_records` requires
`detail.source in ('psp_api','portal_import')` for `kind = 'psp_report'`. `pspRecordSource` stays
defensive about `unknown` for rows written before it, but nothing new may omit it. **Written the
wrong way first:** `detail ->> 'source' in (...)` is NULL when the key is absent, a CHECK passes on
NULL, and the constraint would have caught a typo while waving through the omission — the likelier
mistake. `coalesce(..., '')` is the fix and the behavioural matrix is what caught it.

The consequence, handled rather than discovered in production: the generic
`POST /api/compliance/qualification-records` can no longer file a PSP record — it has no field for
the source and no way to know it. The contract refuses it with a message naming the two paths that
can, and the requirement drawer points there instead of offering a form that cannot succeed.

### P10 · Second consumer — the risk signal, only once P7 is real
`driverInfoSummary.driverOOSRate` into `services/entityRisk.ts` / `driverScore.ts`, read from
`qualification_records.detail` and not from any PSP table (§3.1(c)). Listed last on purpose: it is the
step that proves the seam, and building it before there is a report to read would be designing against
an imagined shape.

---

## 5b. Extracting from PSP — the employment cross-check and the violation history

Two asks, 2026-08-19 (MJ): cross-check the previous employers a driver lists on their application
against what PSP knows, and keep every PSP violation in its own table as an accurate driver history.
Both are worth building. One of them only works in one direction, and that direction is the opposite
of the intuitive one.

### 5b.1 What PSP actually tells us about where a driver has worked

Verified against `docs/vendor/psp-openapi.json`, not inferred:

| Record | Carrier identity it carries | When |
|---|---|---|
| `inspectionRecords[]` | **`usdotNumber`** (strong key) + `carrierName` (free text) | `inspectionDate` |
| `crashRecords[]` | **`censusNumber`**, `uploadDOTNumber` + `carrierName` | `reportDate` |

So a PSP report is, among other things, **a list of (carrier DOT number, date) pairs for one driver**
— every carrier whose truck that driver was sitting in when a roadside inspection or a recordable
crash happened. That is a real employment signal, and it is the only independent one we can get.

### 5b.2 D-PSP5 — the cross-check corroborates and discovers; it can never refute

**A driver can work two years for a carrier and never be inspected once.** Inspections are not
attendance records. So for any employer the driver *did* list:

- PSP shows an inspection under that DOT number in that window → **corroborated.**
- PSP shows nothing → **says nothing at all.** Not "unverified" in a suspicious sense, not a flag,
  not a lower confidence score. Nothing.

Building this as a "did the driver lie about working here" detector would manufacture accusations
against exactly the drivers who happen to drive cleanly, which is both wrong and backwards. The
absence of a violation is the good outcome; a design that treats it as doubt is inverted.

**The valuable direction is the inverse, and it is a genuine compliance finding.** §391.21(b)(10)
requires the application to list the applicant's employers — three years of them for the safety
history, ten for CDL employment. §391.23(a)(2) then requires us to investigate the safety performance
history of **every DOT-regulated employer in the preceding three years**. If PSP shows this driver was
inspected under a DOT number that appears nowhere on their application, then:

1. the application has a gap under §391.21(b)(10), and
2. **we have a §391.23(a)(2) inquiry we did not know we owed** — an employer we never wrote to,
   because we never knew they existed.

That second one is the feature. It is not a gotcha; it is the DQF plan's own subject matter, and it
is the one thing in this whole integration that finds a compliance defect an auditor would find
later. PSP's inspection window is three years — the same three years §391.23(a)(2) asks about. The
alignment is not a coincidence.

**So the UI vocabulary is `corroborated` / `not listed on the application` / `no PSP activity`, and
never `verified` / `unverified`.** "Unverified" reads as an accusation about the driver; "no PSP
activity" is a statement about the data, which is all we have.

### 5b.3 D-PSP6 — match on the DOT number, and treat a name match as a question

`carrierName` is free text as a roadside inspector or a census record entered it. `usdotNumber` is
exact. An employment application, meanwhile, captures a name, an address and a phone — drivers do not
know their former employer's DOT number, and asking them to supply one they will guess at is worse
than not asking.

The resolution path, in order:

1. **DOT number on the employment-history row when we have it** — exact match, no ambiguity.
2. **FMCSA's own public carrier lookup** to resolve a name to a DOT number. `GET https://mobile.
   fmcsa.dot.gov/qc/services/carriers/name/:name` and `.../carriers/:dotNumber` exist and are live
   (probed 2026-08-19; they answer without auth by naming both endpoints and refusing on `webKey`,
   which is a free registration). A name search returns candidates, not an answer.
3. **Normalised name similarity as a HINT that a human confirms**, never as an automatic link.
   "SWIFT TRANSPORTATION CO" against "Swift Transportation" is obvious to a person and a coin-flip to
   a string comparison, and a wrong link here writes a false employment fact into a §391.51 file.

**Our own DOT number is excluded from the discovery pass by name.** Inspections accumulated while
driving for us are not an unlisted employer, and a feature whose first finding is "this driver
appears to have worked for you" is a feature nobody trusts again.

### 5b.4 The half of the cross-check we do not have yet

`grep` finds no structured previous-employer data anywhere: `employment_application` and
`previous_employer_inquiry` / `previous_employer_response` are **document kinds and dated record
kinds only**. The application is a scanned PDF. There is no row anywhere that says "this driver says
they drove for Carrier X from 2022-03 to 2024-01", so there is nothing for PSP to be cross-checked
*against*.

**This is the DOB situation again**, and it has the same shape: the cross-check is blocked on our own
data model, not on the vendor. `driver_employment_history` — driver, employer name, DOT number
(nullable), address, phone, from/to dates, whether DOT-regulated, plus the §391.23(a)(2) inquiry
state — is buildable today, is required reading for the §391.53(a)(1) investigation file regardless
of PSP, and would make the previous-employer requirements in `dqCatalogue` answerable from data
rather than from a human reading a scan.

### 5b.5 D-PSP7 — the violation tables are a derived index, and the raw response stays the evidence

D-PSP2 said "store the response verbatim, parse a thin projection", and it sized that projection for
one question: is this driver's record clean. A violations table answers different questions — which
FMCSR sections, which BASIC, out-of-service rate over time, whether a violation was adjudicated away
— and those need rows, not a summary blob. That is an extension of D-PSP2, not a reversal of it, and
the ordering it implies is the load-bearing part:

> **The raw `psp_requests.response_raw` is the evidence. The violation tables are a rebuildable
> index over it.** A parsing bug is then fixed by re-deriving from bytes we already own, never by
> buying the report a second time. At a per-transaction fee that is the difference between a patch
> and an invoice.

Three tables, after P7:

- **`psp_inspections`** — one row per roadside inspection: `psp_request_id`, `org_id`, `driver_id`,
  `inspection_id` (MCMIS), `report_state`, `report_number`, `inspection_date`, `inspection_level_id`,
  `usdot_number`, `carrier_name`, the `total_*Violations` / `total_*OOS` counters, `post_accident_indicator`.
- **`psp_violations`** — one row per `inspectionViolations[]` entry: `psp_inspection_id`,
  `insp_violation_id`, `seq_no`, `part_no_section` (the FMCSR cite), `section_desc`,
  `out_of_service_indicator`, `insp_viol_unit`, `citation_number`, `citation_result` +
  `citation_result_desc`.
- **`psp_crashes`** — one row per crash: `report_state`, `report_number`, `report_date`, `censusNumber`
  / `uploadDOTNumber`, `carrier_name`, `fatalities`, `injuries`, `tow_away`, `federally_recordable`,
  and **`not_preventable` + `not_preventable_desc`** (§10.5) — a crash FMCSA has deemed
  non-preventable must never be counted against a driver, and that flag is the only thing that says so.

**Adjudication is why `citationResult` is not optional to store** (§10.4): `1` is conviction of the
original charge, `2` conviction of a different one. A violation that was adjudicated away and one
that stuck look identical without it, and showing a driver a violation that a court threw out is the
kind of error that ends the feature's credibility in one conversation.

**Deduplication.** Two pulls six months apart return overlapping inspections. MCMIS supplies
`inspectionId` and `inspViolationId`, which is the obvious key — but the guide never promises they
are stable across pulls, so the unique constraint is on the **real-world identity**,
`(org_id, driver_id, report_state, report_number, inspection_date)`, with `inspection_id` stored
alongside. **Whether the two agree is an observable fact, not a design choice**: verify it against two
real pulls of the same driver before trusting either (Q9).

**A defensive check that belongs in the ingest, not in review:** each record carries
`driverLicenseNumber` / `driverLicenseState`. Assert they match the licence we requested for before
writing a single row. Filing one person's violation history onto another person's record is the worst
failure this feature has, and it is one comparison away.

### 5b.6 D-PSP8 — name it for what it is: PSP is not "driver history"

PSP is **three years of roadside inspections and five years of DOT-recordable crashes, from MCMIS**.
It is not:

- moving violations or convictions — that is an MVR, and it is SambaSafety's surface (Phase E);
- accidents that were not DOT-recordable;
- anything at all from before the window, or from a state that has not uploaded yet — `mcmisUploadDate`,
  `mcmisAddDate` and `censusSearchDate` exist on the records precisely because state upload lag is
  real and variable.

So the tables are `psp_*`, prefixed by their source, and the UI says "PSP / MCMIS roadside history".
A table called `driver_violations` invites the next reader to treat it as complete and to build a
score on it, and it is not complete. The fuller picture is PSP **plus** the Samba MVR, joined at the
driver — which is exactly why both feed `qualification_records` and neither owns the driver's story.

### 5b.7 The constraint that governs both features

PSP records are obtained under **the driver's written consent for a specific purpose**, against an
FMCSA account-holder agreement. Both of these features go beyond reading one report during one hire:
the cross-check derives an employment inference, and the violation tables build a retained,
queryable history intended to feed driver scoring later (P10).

**Whether the account-holder agreement permits retaining PSP-derived data past the hiring decision,
and permits re-using it for ongoing driver assessment, is a question for that agreement — it is not
answered anywhere in the protocol guide** (Q10, and Q7's FCRA question applies with more force here
than it did to a single report filed in a DQ file).

This is not a reason to stop; it is a reason the design already has the right shape and must keep it:

- every derived row carries `psp_request_id`, and that request carries the `driver_authorizations`
  row (P1) that permitted it, so **"what consent covers this data" is a join, not an argument**;
- the `psp_*` tables are restricted kinds behind `canReadRestricted`, like everything else in §4h;
- retention is declared in Phase F alongside the rest, and a purge deletes the derived index and the
  raw response together — an index that outlives its evidence is a copy that nobody authorised.

### 5b.8 Steps

**P11 · `driver_employment_history` — the missing half. DONE 2026-08-19.**

The structured §391.21(b)(10) list with the §391.23(a)(2) inquiry state per employer. What shipped:

- **Migration `0208`** — `driver_employment_history`, RLS on, org + driver-scope + manage policies,
  a partial index on `usdot_number` for the PSP join. **Mutable, not append-only**, and the header
  says why: the evidence is the application PDF in `documents` and the inquiry rows in
  `qualification_records`, both untouched and both still append-only; these rows are a
  *transcription* of that evidence, so a typo is a correction rather than a contradictory second copy.
  Not added to `RESTRICTED_QUALIFICATION_KINDS` either — §391.53(a)(1) restricts the INVESTIGATION
  file, which 0205 already covers; the list of where somebody says they have worked is part of the
  application (§391.51(b)(1)) and carries no such limit.
- **`packages/shared/src/employmentCoverage.ts`** — the pure arithmetic: the three-year window, gap
  detection with overlapping and adjacent employments merged, and the inquiry split. `GAP_TOLERANCE_DAYS`
  is 30 and is **named rather than inlined precisely because the FMCSA specifies no threshold** — it
  is carrier practice, and the UI copy says so, so nobody reads a flagged 31-day gap as a federal
  finding. A documented non-response counts as SATISFIED per §391.23(d), never as outstanding.
  12 unit tests, including the leap-day window clamp and the adjacent-employment phantom gap.
- **`packages/shared/src/recruitmentContract.ts`** — the wire contract, kept separate from the
  arithmetic on the `dqCatalogue`/`dqFile` precedent.
- **`apps/api/src/routes/recruitment.ts`** — `/api/recruitment/roster`, `/drivers/:id/employment`,
  and create/update/delete, every write audited under `compliance.employment.*`. 11 route tests
  covering the gate, `expectOrgScoped` on every read, and the refusal to hang an employer off another
  org's driver.
- **Web** — a **Recruitment** sidebar section (`/recruitment`) with the fleet queue, and an
  **Employment** tab on the driver page for the workspace, the same queue/workspace split D1 and D3
  drew for the qualification file.

**The window ends at the HIRE DATE, not at today**, in both the API and the page: §391.21(b)(10) asks
about the three years preceding the application, so measuring a five-year employee against today
would manufacture three years of gap nobody was ever required to declare. A route test pins it.

**Recruitment is its own `AppSection` — corrected 2026-08-19.** It shipped gated on `fleet`, on the
stated reasoning that a seventh section would have to be mirrored into "the SQL section helpers the
RLS migrations use". **There are no SQL section helpers.** The database has `auth_role()` and
`auth_org_id()` and nothing else; `0078_role_department_rls.sql` derived each policy from
`rolesThatManage(section)` **by hand, per table, at authoring time**. So the real cost of a section is
`APP_SECTIONS` + one column per role in `SECTION_ACCESS`, and its consumers — five TypeScript files.

And the boundary it expresses is real. Gated on `fleet`, a **dispatcher could read every driver's
former employers, their dates and their contact details**, because a dispatcher reads Fleet to see who
is on which truck. §391.53(a)(1) limits the investigation history to "those who are involved in the
hiring decision", which is the line `0205` already drew for the inquiry RECORDS. `recruitment` is
`manage` for admin / fleet_manager / safety_manager, `view` for auditor (a DOT audit is exactly the
reader who asks for this file), and **`none` for dispatcher** — a deliberate narrowing of what
shipped, pinned by `auth.test.ts` and by the route suite.

Migration `0209` adds the matching RESTRICTIVE read policy so the PostgREST path agrees with the API
guard. `driver` stays in that predicate even though the matrix says `recruitment: none` for drivers:
self-view is a separate axis and always has been — `safety` and `fleet` are also `none` for a driver,
yet `0129` lets a driver read their own `qualification_records`. `0208`'s driver-scope policy still
ANDs on top, so a driver sees their own row and no other.

**Verified by:** `pnpm typecheck`, `pnpm lint`, `pnpm lint:rls`, `pnpm lint:migrations`,
`lint:tokens`, `lint:ui-adoption`, `lint:upserts`, `lint:secrets` and `pnpm test` — the tenant
isolation matrix picked the new table up automatically and went from 82 to 83 tables covered, 0
leaking, 0 anon-readable.

**Still open:** nothing in the schema. The employers themselves are transcription work, and the
`psp_discovery` source value is deliberately unused until P13 exists to produce it.

**P12 · `psp_inspections` / `psp_violations` / `psp_crashes`** — the derived index of §5b.5, written
by P7's ingest inside the same transaction as the `qualification_records` row, and re-derivable from
`response_raw` alone.
**Done when:** ingesting a fixture twice produces one set of rows; a record whose
`driverLicenseNumber` does not match the requested licence writes **nothing** and raises; deleting
every derived row and re-running the deriver from `response_raw` reproduces them exactly; and a
`dispatcher` role sees none of it.

**P13 · The cross-check** — a pure function in `packages/shared/src/psp/employment.ts` over
(employment history, PSP carrier-date pairs, our own DOT number) returning per-employer
`corroborated | no_psp_activity` plus a list of **unlisted carriers with dates**, each of which
becomes a proposed §391.23(a)(2) inquiry. Pure, so the whole matching rule is unit-tested without a
vendor or a database.
**Done when:** a driver with a clean record and a truthful application produces **zero** flags; an
inspection under our own DOT number is never reported as an unlisted employer; a name-only match
returns a candidate a human must confirm and never an automatic link; and an inspection under a DOT
number absent from the application produces exactly one proposed inquiry.

**P14 · The records the carrier already owns — the import path. DONE 2026-08-19.**

The API cannot fetch a record we already bought. Five endpoints, none of which lists past
transactions, and `/Record` needs an `authCode` that expires 120 hours after the request that
produced it (§7). A carrier arriving with a drawer of PSP PDFs can therefore get them into the
qualification file only by filing them — and buying them again would be paying a second time for a
record we already hold lawfully, on a driver who already signed for the first one.

**D-PSP9 — an import attests, it does not re-consent.** The ordered path (P6) refuses without a live
signed `psp` authorization in `driver_authorizations`, because we are about to make the request. An
import is the opposite situation: the pull already happened, on the portal, under the account-holder
agreement, before this driver had a row in this system, and the consent that authorised it is on
paper and may predate FuelGuard by years. Requiring a digital authorization would refuse to file
lawfully obtained evidence, and the workaround would be back-dating a signature into the table that
exists precisely so signatures are never back-dated. So the instrument matches the fact: a named
person, at a recorded time, affirming that the written consent exists and is retained
(`PSP_IMPORT_CONSENT_ATTESTATION`, served by the API so nobody attests to client-authored words).

**The import claims nothing about the report.** `result` is `imported`, never `clean` — the ordered
path derives `clean` from `isCleanRecord(report)`, a computed fact about structured data, and nothing
computed anything here. `detail` carries `structured: false` and **no counts at all**: writing
`inspections: 0` would have been the easy shape and the dangerous one, because zero inspections is a
meaningful claim about a driver (D-PSP5) and the cross-check would then corroborate employment
history against numbers nobody produced. An absent field cannot be misread that way. The consequence
is worth stating plainly: **an imported record satisfies the file but does not feed the cross-check.**

**No `psp_requests` row.** That ledger records transactions WE made — it settles a status, stores
what PSP charged, and is what an invoice reconciles against. An import is not a transaction, and
inventing a row for it would put a purchase we never made into the reconciliation.

What shipped:

- **`packages/shared/src/psp/import.ts`** — the two schemas, the `PSP_PROGRAM_START` bound (May 2010,
  because the date is hand-typed off a PDF header and `1011-03-04` is a date Postgres stores
  happily), the attestation text and the `detail` builder. Pure; 10 tests.
- **`apps/api/src/services/pspImport.ts`** — register the PDF (signed upload URL, bytes never touch
  the API), then file it. Refuses a document belonging to another driver, a document not filed as
  `psp_report`, and a second filing of the same PDF. 11 tests, `expectOrgScoped` on both paths.
- **`apps/api/src/routes/recruitment/psp.ts`** — `GET /psp-imports/attestation`,
  `POST /psp-imports/document`, `POST /psp-imports`, audited as `compliance.psp_record_imported`.

**The guard is an intersection, and that is the part worth remembering.**
`rolesThatManage("recruitment")` includes `fleet_manager`, and `canReadInvestigationHistory` does
not. Filing a PSP report as a fleet_manager would mean attesting to the consent behind a document
they are not permitted to open — evidence filed into a class the filer cannot read, check or
correct. So the route gates on **both**, derived from the two predicates rather than listed by hand.
A route test fails if anyone simplifies it back.

**No migration.** `psp_report` was already a legal `documents.kind` and `qualification_records.kind`
(0217), and the read restriction already rides on the kind. The import needed code, not schema.

**The surface** — `features/recruitment/PspRecordsSection.vue` on the driver page's **Employment**
tab, beside the history the record corroborates, with `usePspImport.ts` doing register → PUT → file.
Not on the Qualification tab, and that is a consequence of the guard rather than a preference: that
section's write affordances gate on `canManageFleet`, which a recruiter does not hold, so the entry
point would have been invisible to exactly the role §391.53(a)(1) describes. The table renders an
imported record's findings as **"Not machine-read — read the PDF"**; the ordered path's counted
projection renders as counts. A component test fails if a zero ever appears there, and another fails
if the button is offered to a fleet_manager the API would 403.

**Still open:** an imported PDF is unread. If the violation index (P12) is ever wanted for historical
records, the only route is OCR or hand transcription, and either one is a NEW record kind, not a
quiet upgrade of this one. P9 still owes the Qualification tab its own PSP row and the order
confirmation that states the cost.

---

## 6. Open questions

**Blocking:**
- ~~**Q1 — Is the token we hold UAT or production?**~~ **ANSWERED 2026-08-19: a UAT token has been
  obtained**, so P3–P7 can be proven end-to-end against the guide's test drivers with nobody's
  privacy involved and nothing billed. The production key still exists and still bills on Success,
  Partial AND Failure — `PSP_ENVIRONMENT` is the switch that decides which one a request reaches, and
  it has exactly one source of truth (the env schema default) for that reason. The original question,
  kept because the reasoning still governs the environment split:
  They are different tokens on different hosts (§4).
  A production token means every test request is a real charge against a real account-holder
  agreement; a UAT token means we can build the whole path today against the guide's own test data
  (§9.1.1: SUSAN GODFREY / PA, GARY THOMAS / GA+PA, JOSE DAVIS / VA, `dotNumber` 43586). **If it is a
  production token, get a UAT one before anyone writes a client.**
- ~~**Q2 — What is the per-transaction price?**~~ **Answered 2026-08-20, from the carrier's own July
  invoice (`docs/psp-docs/Invoice-072026.pdf`, gitignored): $10.00 per record.** 93 searches, $930.00,
  billed to customer account 13737 and itemised **per user email** rather than per carrier — so the
  invoice attributes spend to the person who ordered. FMCSA's published schedule agrees and adds an
  annual subscription the invoice does not itemise: $100 for carriers with 100+ power units, $25
  below that. `PSP_UNIT_PRICE_USD=10` in production is therefore correct rather than assumed.
  **The monthly ceiling is still MJ's to set** — `PSP_MONTHLY_LIMIT` defaults to 50, and the invoice
  shows 93 searches in July, so the default would have stopped that month's real work at roughly half.
- ~~**Q2b — Does the UAT environment bill?**~~ **Answered 2026-08-20 (MJ, from the UAT portal): it
  does not.** The portal lists every test pull made that day and offers each for download, with no
  charge attached — the vendor saying directly what none of the documents below manage to say.
  It also settles that **the portal keeps a 120-hour window the REST API does not expose** — the
  same 5 days §8.5 detail 28 gives the `authCode` — and that a **PII Masking** switch exists there
  which, if enabled, masks CDL numbers to the last 4 digits in reports and would break the
  returned-licence assertion in `parse.ts`. The research is kept below because
  the reasoning is the reusable part. **Was unresolved, and researched rather than assumed.** The
  guide's §8 says accounts are charged for Success, Partial and Failure with **no environment
  qualifier anywhere in v3.9**; FMCSA's public pages describe only the production schedule; and the
  test environment is not publicly documented at all. What is known: UAT is a **separate account**
  (`Silvicom, Inc - UAT`, motorCarrierId 31496) from the invoiced production account 13737, the test
  drivers are synthetic, and support issued the account expressly to be exercised. That is strong
  circumstantial evidence and not a vendor statement. The billing contact is on the invoice —
  **PSPBilling@tylertech.com** — and it is a better address for this than PSPhelp.
- ~~**Q3 — What is "the PAI key" for?**~~ **Answered 2026-08-19 (MJ): the Pilot API, for fuel
  prices.** Unrelated to driver qualification — it belongs beside `pilotPriceIngest.ts` /
  `postedPriceIngest.ts`, not in this plan or in Phase E. Nothing here waits on it.

**Non-blocking — ask PSP support (PSPhelp@tylertech.com / 1-877-642-9499), build around them:**
- **Q4** — What value does PSP expect in `userIPAddress` for a system-to-system request (§4f)?
- **Q5** — Does `monitor: true` carry its own fee, and how does an enrolment end — 45 days fixed, or
  until we say stop? (§6 is silent; it governs P8's unenrolment story.)
- **Q6** — Does `GET /Token` invalidate the previous token (§4d)?
- **Q7** — Is a PSP report a consumer report under FCRA for adverse-action purposes (§4h)? For the
  account-holder agreement and counsel, not for support.
- **Q9** — Are MCMIS `inspectionId` / `inspViolationId` stable across two pulls of the same driver
  (§5b.5)? Observable from two real UAT pulls; decides whether they can be the dedupe key.
- **Q10** — Does the PSP account-holder agreement permit **retaining** PSP-derived data past the
  hiring decision and **re-using** it for ongoing driver assessment (§5b.7)? This one governs P12 and
  P10, and it is an agreement question, not a support question.
- **Q8** — What is `POST /v2/Record`, and what does status `3` mean? Both are in the published
  OpenAPI and in no version of the guide (§2.6).

---

## 7. What can start now, in order

1. ~~**P0** — DOB capture.~~ **Code done 2026-08-19.** What remains is entering the 266 dates and
   Silvicom's DOT number — no longer engineering, and still the critical path for all three
   integrations.
2. **P1** — `driver_authorizations`. The reusable module the ask was reaching for; four consumers,
   zero vendor dependencies.
3. **P2** — the pure `psp/` module. Fully testable with no credentials at all.
4. ~~**P11** — `driver_employment_history`.~~ **Done 2026-08-19**, along with the Recruitment
   section that surfaces it. The cross-check (P13) now has something to check against.
5. **Q1** — answer it, and if the token is UAT, **P3–P7 can be built and proven end-to-end against
   live FMCSA test data before SambaSafety arrives.** PSP is not blocked the way SambaSafety is; the
   guide ships working test drivers and a Swagger document, which is more than the Samba portal ever
   gave us. P12 and P13 follow P7, because deriving an index and a match rule before there is a real
   report to derive them from is designing against an imagined shape.
