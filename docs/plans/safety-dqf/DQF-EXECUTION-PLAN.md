# DQF execution plan — documents, previews, alerts, SambaSafety, storage economics

**Date:** 2026-08-18 · **Precision revision 2026-08-19** (G30–G36, D-DQ12–15, A6, C2/C3 horizon fix,
C6, D7/D8, Phase G, the deferrals table) — every remaining owner decision is now taken and recorded;
the regulatory encoding is verified against eCFR current through 2026-08-07. · **Supersedes nothing** —
`DQF-PLAN.md` stays the architecture record; this is the build order. Every claim below was read out of
the codebase on the date above and carries its `file:line`. Where a fact could not be established from
the repo or from a public source, the plan does not guess: acquiring the fact is itself a numbered step
in Phase A.

---

## 0. Ground truth — verified, not assumed

| # | Fact | Evidence | Consequence for this plan |
|---|---|---|---|
| G1 | `documents.variant` already constrains to `('original','normalized','thumb')` | `0146_compliance_documents.sql:63` | **Thumbnails and compressed derivatives need no migration.** The column was designed for this. |
| G2 | Bucket `compliance-docs`, private, `file_size_limit` = 25 MB | `0146:118-120` | A 25 MB original × N drivers × 18 items is the cost problem. Derivatives are the fix, not a smaller cap. |
| G3 | `documents` has an INSERT policy and **no UPDATE, no DELETE** policy | `0146:92-112` | A derivative is a **new row**, never an edit. Deleting a superseded original is a service-role act. |
| G4 | `sha256` is `not null`; browser computes it before upload | `0146:61`, `useCompliance.ts` | Derivatives get their own hash. Never reuse the original's. |
| G5 | `content_type` check admits `image/heic` | `0146:56-59` | **Unverified:** whether the deployed `sharp` build decodes HEIC. → Step A3. |
| G6 | `sharp@^0.35.3` is already an `apps/api` dependency | `apps/api/package.json:33` | No new dependency for image work. |
| G7 | A conservative, versioned image normalizer already exists — WebP q80, long edge 1568 px, EXIF auto-orient, `IMAGE_NORMALIZER_VERSION = "2.0.0"` | `services/hazmatExtraction/image.ts:21-60` | Copy the **shape** (versioned, deterministic, verified output format); do **not** reuse the ruleset — its `.normalise()`/`.median()` exist to help a vision model, not a human reading a medical card. |
| G8 | Signed **upload** URL at `services/compliance.ts:110`; batch signed **read** at `:149` | verified | Preview reuses the existing read path. No new storage plumbing. |
| G9 | The binder downloads originals one by one | `services/dqBinder/index.ts:63` | Binder must keep using `original`. A binder built from thumbs is not evidence. |
| G10 | Orphan reconcile is wired for the **`hazmat` bucket only** | `hazmatStorageReconcileScheduler.ts:27` — `["hazmat", reconcileHazmatStorageOrphans]` | **`compliance-docs` has no orphan sweep today.** Failed uploads accumulate as billed bytes forever. This is a live cost leak, not a hypothetical. |
| G11 | `storageBackup.ts` is provider-agnostic and has **no wired target** | `services/storageBackup.ts:1-35` | Supabase DB backups exclude Storage. Today a restore yields `documents` rows pointing at nothing. |
| G12 | `planStorageReconcile` is pure and bucket-agnostic; `listAllObjects(admin, bucket)` takes the bucket | `storageReconcile.ts:27-41` | The sweep for `compliance-docs` is a scheduler entry, not new logic. |
| G13 | `NOTIFICATION_CATEGORIES` has 15 entries, **none DQ-related** | `packages/shared/src/notificationsContract.ts:15-31` | Alerts need new categories, added in one place. |
| G14 | `notify()` routes through the `emit_notification` SQL function, which applies module entitlement, per-user mutes, quiet hours and a dedupe key | `services/notify.ts:1-40` | Never INSERT a notification row by hand. A retried scheduler must not buzz twice. |
| G15 | Email exists: `lib/mailer.ts` + `lib/graphMail.ts` (Microsoft 365 Graph); org recipients live on `organizations.notification_emails` + `notifications_enabled` | `services/notifications.ts:18-28` | Reuse. No new mail provider. |
| G16 | The scheduler pattern is: env flag → interval → per-org `last_*_at` dedupe → registered in `schedulers.ts` | `digestScheduler.ts:37-58`, `schedulers.ts:29-47` | The DQ alert sweeper copies this exactly. |
| G17 | `org_integrations (org_id, provider, enabled, ingest_token, config, last_synced_at)` exists, service-role only, **no client RLS policies** | `0068_tms_integration.sql:10-22` | SambaSafety credentials go here as `provider='sambasafety'`. **No new table.** |
| G18 | `qualification_records.kind` already includes `mvr`, `annual_mvr_review`, `clearinghouse_full`, `clearinghouse_limited`; `documents.kind` includes the same | `0129`, `0146:44-56` | A SambaSafety MVR lands in existing tables. **No schema change for ingest.** |
| G19 | `dqAttention()` / `dqGroups()` are consumed by the API overview and both UIs | `complianceOverview.ts:149-150`, `DriverQualificationPage.vue:118-119`, `QualificationFleetTable.vue:75` | The due-date ranking already exists server-side. The alert sweeper must call **the same function**, never a second implementation. |
| G20 | `QualificationFleetTable` already default-sorts by severity then soonest, and has "Needs attention" / "Due in 7/30 days" filters | `QualificationFleetTable.vue:83-101, 164-167` | The fleet list is **not** the weak link. Do not rewrite it. |
| G21 | `RETENTION_FORBIDDEN` pins `certifications`, `qualification_records`, `documents`, `dq_exports` | `dataRetention.ts:148+` | Any purge feature must go **around** this list deliberately, with its own audited path. |
| G22 | Gates: file ≤ **500** lines (warn 450), function ≤ **200** lines, `lint:tokens`, and `pnpm test` discovers every `supabase/tests/*.test.mjs` and fails a matrix that prints no `RESULT` line | `check-file-size.mjs:55`, `check-function-size.mjs:24`, `run-tests.mjs:1-30` | Every step below states which file it will grow and whether that file has headroom. |
| G23 | Migration numbers are NOT assigned in this plan. An earlier revision pinned "0204 = B2", which went stale the moment 0203 landed out of band. The rule is: **take the next free number at landing time**; `lint:migrations` enforces global uniqueness. | `check-migration-versions.mjs` | A plan that hard-codes future migration numbers is asserting a fact about a moment it cannot see. |
| G24 | `DESIGN-SYSTEM-CONTRACT.md §8` cites `DqFilePanel.vue` (deleted) and `CompliancePage.vue (332 ln)` (now 177) | contract `:577-606` vs. repo | The contract's anti-pattern section is stale. → Step D5. |
| G25 | `developer.sambasafety.com` is **public** and is a **published Postman collection**, not an OpenAPI site. 108 requests; hosts `api-demo.sambasafety.io` / `api.sambasafety.io`; OAuth2 client-credentials + `X-Api-Key`; webhooks signed with `X-SambaSafety-Signature`; reports negotiable as `+pdf` / `+json` | collection committed at `docs/vendor/sambasafety-postman-collection.json`, analysed in `SAMBA-RECON.md` | Phase E can be written against a real definition. **Open:** the signature algorithm and signing secret — E5 is blocked on it. |
| G26 | Every one of the 13 webhook event docs specifies `Authorization: Basic [encoded Client ID & Client Secret] (Optional)` on the callback | collection, Webhooks/Events (13/13) | **The callback is authenticable with credentials we already hold**, independent of the undocumented signature. E5 is not blocked. |
| G27 | `POST /organization/v1/groups/:groupId/people` accepts **`customPersonId`** | collection, Create a Person | Our `drivers.id` goes there. Identity mapping needs **no join table** — Samba stores our key. |
| G28 | The `qorta.motorvehiclereport` event carries `result`, `reason` (e.g. `ON DEMAND`), `mvrId`, `personId` and links to report/order/license | collection, webhook example | Continuous monitoring **pushes** us MVRs. We never poll, and we learn *why* an MVR was produced. |
| G29 | Collection completeness, measured: 108 requests, **107** with typed parameter descriptions, **108** with response examples (avg 7 KB), 54 with request bodies | script over the committed collection | Sufficient to write the client against. Gaps are commercial, not technical — see A5. |

| G30 | The 30-day "expiring" horizon is duplicated in FOUR places: `buildDqFile`'s default (`dqFile.ts:191`, applied by the overview at `complianceOverview.ts:136`, the driver page at `DriverQualificationPage.vue:97`, the binder at `dqBinder/gather.ts:210`) and a hand-rolled copy in `CertManager.vue:71-73`. The `expiringWithinDays` parameter exists and **no caller passes it.** | verified 2026-08-19 | **C2's 90/60-day thresholds cannot be fed from today's attention feed** — an item 60 days out is `current` and absent from `dqAttention`. The alert path must compute at a wider horizon (C3); the three UI/binder surfaces stay at 30 so the queue and the file keep agreeing. |
| G31 | `notify()` delivery reaches the **driver app only**: `notification_events` are rendered by `apps/driver/app/notifications.tsx` via `/api/me/notifications`, push targets `device_push_tokens` (drivers' phones). The web app has **no notification inbox** — its NotificationsPage edits `organizations.notification_emails`. Office users have no push tokens. | verified 2026-08-19 | An office-facing alert emitted only through `notify()` lands nowhere an office user looks. Office delivery is email (G15) until C6 builds a web inbox. |
| G32 | `qualification_records` kinds `drug_test`/`alcohol_test`/`previous_employer_*` are readable today by **every** role passing `canView` — dispatcher and auditor included — because the three read paths (`GET /qualification-records`, the overview, the binder gather) use the service-role client, which bypasses RLS. RLS restricts only the `driver` role to own rows (`0129:29-32`). | verified 2026-08-19 | §382.401 and §391.53 require controlled access. Phase G partitions these kinds; RLS alone cannot do it. |
| G33 | Regulatory verification against eCFR (Title 49 current through 2026-08-07): **(1)** §391.51(b) was renumbered in 2022 — medical certification is (b)(6), SPE (b)(7), registry note (b)(8); the §391.27 violations list is gone. **(2)** For CDL holders the DQF medical document **is the CDLIS MVR** (§391.51(b)(6)(ii)); the paper-MEC window sunset 2025-06-22 and survives only via an FMCSA NRII waiver (60-day paper bridge, currently through **2026-10-11**, extended four times — track quarterly). **(3)** The registry-verification note (b)(8) is required for **non-CDL drivers only** post-2025-06-22. **(4)** **ELDT is not a DQF document** — §391.51(b) has no ELDT item; the retention obligation is the training provider's (§380.725). **(5)** §382.401 retention is four tiers: 5yr (positives/refusals/violations), 2yr (collection process), 1yr (negatives), indefinite-plus-2 (training). **(6)** Clearinghouse obligations unchanged since 2021; query records 3yr, satisfied by maintaining registration. | eCFR versioner API 2026-08-07 snapshot; FR API sweep of all FMCSA final rules 2025-01→2026-08 | Step D8 encodes (2)–(4); Phase G honours (5); F1's rules encode §391.51(d) + the §172.704 employment+90-days clock. **E7 gains a duty:** an ingested MVR carrying medical-certification status is the (b)(6)(ii) document of record for a CDL holder. |
| G34 | Notification category `training_due` exists in the contract with a label and a driver-app icon and has **zero emitters** anywhere in the repo. | grep 2026-08-19 | C1 leaves it alone (driver-facing vocabulary, dormant per D-DQ13) and adds the `dq_*` categories beside it. |
| G35 | The two §172.704(d)-mandated fields — `trainingProviderAddress`, `trainingMaterials` — are accepted by the contract (`complianceContract.ts:114-115`), the table and the RPC (`0127:30-31, :96-97`), and are capturable in **no UI**: `RequirementDrawer.vue` captures neither; `CertManager.vue` (org-only mount) captures neither. `notes` likewise. | verified 2026-08-19 | Step D7 closes it. |
| G36 | Equipment certifications: contract and table accept `tractor`/`trailer` subjects; **no UI mounts a cert editor for either**; `VehicleDetailPage.vue` exists at `/vehicles/:id` (summary + fills only); **trailers have no detail page or route at all**; the hazmat gate reads only organization + driver certs (`services/qualification.ts:73-80`). | verified 2026-08-19 | Explicitly **deferred** — see "Deferred, with reasons" after Phase G. |

**Two corrections to earlier verbal analysis, recorded so they are not re-inherited:** the fleet table
does *not* sort by name (G20), and `dqAttention` is *not* unrendered (G19). Both were checked and were
wrong.

---

## Conventions every step obeys

- **Migrations** are additive unless the step says otherwise, numbered in the order below, and carry the
  same header-comment discipline as `0146` (what gap, why this shape, what was rejected).
- **Every write is audited** through `writeAudit` with a `compliance.*` action, as `routes/compliance.ts:79-113` does.
- **Pure logic lives in `packages/shared`** with unit tests; the service layer only does I/O. This is why
  `dqFile.ts` is testable at 30 assertions with no database.
- **Design**: `PageHeader` carries no title (it comes from `route.meta.title`); `DataTable` inside
  `BaseCard padding="none"`; **omit `align`** on columns; badges only from `lib/badges.ts`; drawers are
  `SlideOver` with actions in `#footer`; mutation feedback is a toast, never an inline banner.
  (`DESIGN-SYSTEM-CONTRACT.md` §1, §5.2, §5.8, §6.2.)
- **Done-when** for every step is a command that exits zero, not a description.

---

## Architecture — what Phase E copies from the EFS module, and what it deliberately does not

**The question this answers.** The EFS card-control module (`docs/27-EFS-CAPABILITY-ARCHITECTURE.md`)
is the most carefully-built surface in this product, and the reasonable instinct is "build DQF the same
way". That instinct is right for exactly one part of this plan and wrong for the rest, so the boundary
is drawn here rather than left to taste.

### What the EFS architecture actually is

```
Capability  =  Contract  ×  Behaviour  ×  View
Behaviour   =  Target  ×  Mutation  ×  Verification  ×  Governance
```

Three type-linked artifacts in three packages — browser-safe contract in `packages/shared`, behaviour
in `apps/api`, view in `apps/web` — held together by a cross-registry fitness test
(`apps/api/src/efs/registry.test.ts`) because nothing else can hold declarations that live in three
places. Underneath: a five-phase orchestrator (prepare → plan → dispatch → verify → settle), a ledger
row per mutation carrying an idempotency key and the request body, and a background reconciler that
re-judges rows after the fact.

It exists because of a specific failure: adding one write touched nine files with nothing enforcing
that you touched all nine, and the orchestrator conflated targeting, mutating and verifying into one
hardcoded path. Its thesis is one sentence — **"generalising dispatch is easy; generalising
verification is the job."**

### Where it applies here, and where copying it would be cargo-culting

| Part of this plan | Direction | Architecture |
|---|---|---|
| **B — documents, derivatives, previews** | inbound / local | House conventions. We write to our own bucket; there is no vendor to disagree with us. |
| **C — alerts** | outbound, but ours | House conventions plus `notify()`'s existing dedupe/mute/quiet-hours governance. |
| **D — pages, IA, the Samsara licence field map** | local | House conventions. |
| **E — SambaSafety** | **outbound mutation against a vendor** | **The EFS capability architecture.** |
| **E's webhook receiver** | **inbound** | NOT a capability. Ingest, with signature/Basic verification and a queue. |

A thumbnail generator has no landing to judge and no ledger to keep. Applying `Target × Mutation ×
Verification × Governance` to it would be ceremony that makes the next reader look for a vendor that
is not there. Phase E is the only place in this plan where a write leaves our control, can partially
fail, can be replayed, and **costs money** — which is precisely the class the EFS architecture was
built for.

### The four adaptations, each stated rather than silently taken

**1. `View` is optional, and its absence is CHECKED.** Every EFS capability is triggered by a human at
a card drawer, so three artifacts are unconditional. Three of the four Samba capabilities are
triggered by a sync, not a person. So the contract carries `userTriggered: boolean`, and the fitness
test asserts **both directions**: `userTriggered: true` must have a view, `false` must not have one. A
merely-permitted absence would let a real UI go missing and the test still pass.

**2. There is no `echo` mutation kind.** EFS's echo exists because its SOAP API requires resubmitting
the entire card document, so `assertEchoFidelity` guards against clobbering fields you never meant to
touch. SambaSafety is JSON REST with per-resource endpoints; there is no document to echo. Samba
capabilities are `direct` only — plus `sequence`, which is genuinely needed and is not a simplification
(see 4).

**3. `indeterminate` is the normal outcome for an MVR order, not an error.** The EFS `Landing` type is
`landed | not_landed | indeterminate`, and `apps/api/src/efs/types.ts:94` already anticipates exactly
this case in a comment — *"an ordering op whose fulfilment horizon is days, can say so"*. An MVR order
is accepted immediately and the report arrives later by webhook. So `judge` returns `indeterminate` on
a well-formed acceptance, the row settles `sent`, and the **webhook or the reconciler** is what moves
it to `succeeded`. This is the one place where DQF exercises a branch of the EFS design that EFS itself
never needed, and it works because the shape was drawn honestly the first time.

**4. `sequence` is load-bearing from day one.** Enrolling a driver is person → licence → enrolment,
three vendor writes that must not half-apply. EFS added `sequence` for one two-step operation and made
`partial` a terminal-but-actionable state with a `step_index`; Samba needs it immediately. Recovery is
re-running from `step_index`, which is safe because each step is idempotent on `customPersonId`.

### The one thing NOT to copy

**Do not build a `LedgerAdapter` seam.** EFS deliberately kept one ledger implementation and wrote the
second down without building it, under the rule that an abstraction may only accommodate cases that
exist in code today. Here four vendor operations exist on day one, so `samba_mutations` is a real
table — but it is one table for one vendor, not a generic "integration mutations" abstraction serving
a McLeod integration nobody has written yet.

---

## Phase A — Facts to acquire (blocks only Phase E; start it first anyway)

### A1 · Acquire the SambaSafety API definition — **DONE 2026-08-18**
The portal is **public** (no login) and is a **published Postman collection**, not an OpenAPI site — which
is why it reads as an empty page to any fetcher that does not run JavaScript. The full collection (108
requests) is committed at `docs/vendor/sambasafety-postman-collection.json` and analysed in
[`SAMBA-RECON.md`](./SAMBA-RECON.md). Verified there: both hosts, the OAuth2 client-credentials flow with
its three secrets, the webhook subscription endpoints, the `X-SambaSafety-Signature` header, the HATEOAS
event payload, the `+pdf` / `+json` report media types, and the full endpoint inventory.

**Open, but no longer blocking:** the algorithm behind `X-SambaSafety-Signature` is undocumented. It does
not gate E5, because every event doc also specifies HTTP **Basic** auth on the callback using our own
client id and secret (G26) — verifiable today. Ask the rep for the signature spec as hardening.
**Done when:** both open items are recorded in `SAMBA-RECON.md` §3.

### A2 · Baseline the storage bill — **DONE 2026-08-19**
`scripts/storage-baseline.mjs` — read-only, prints no PII, writes
[`STORAGE-BASELINE.md`](./STORAGE-BASELINE.md). Re-runnable; also takes `--bucket`/`--table` so the
other two evidence buckets can be measured the same way.

**The measurement, and it is not what this plan assumed.**

| | |
|---|---|
| Rows in `documents` | **0** |
| Objects in `compliance-docs` | **0** |
| Orphan objects | 0 |
| `certifications` / `qualification_records` / `dq_exports` | **0 / 0 / 0** |
| `drivers` | **266** |

Verified twice, by two independent paths — the service-role client in the script, and
`supabase db query --linked` — against project `nsjszqnfppczbnligxll`, which is the ref
`apps/api/.env` points at and the ref `supabase/.temp/project-ref` records. This is production.

**What it means, stated plainly rather than worked around:**

1. **The orphan leak (G10) is real as a mechanism and has cost nothing.** There is no garbage to
   sweep because there is nothing in the bucket. B7 still ships — it is the guard that makes the leak
   impossible rather than merely absent — but it should not be described as recovering money.
2. **B8 (backfill derivatives) is a no-op today.** It stays in the plan for the day it is not.
3. **The far bigger finding: the DQF has never been used in production.** 266 drivers, zero
   certifications, zero qualification records, zero documents, zero exports. Everything built since
   2026-08-08 — the checklist, the drawer, the fleet table, the binder, the seeding path — has never
   had a row put through it by a real user.

**This reorders the plan's own premise, and step A2b establishes why.**

### A2b · Why the seeding path was never run — **ANSWERED 2026-08-19**

Investigated end to end. **Nothing is broken. The feature asks for data the product already receives
and throws away.**

Ruled out, each by checking rather than reasoning:

| Suspected blocker | Finding |
|---|---|
| Role gating | Silvicom's 4 users are all `admin`; `SECTION_ACCESS.admin.fleet = "manage"` (`auth.ts:70`). Full access. |
| Nav visibility | `nav.ts:122` shows Driver Qualification on `canViewSection(role,"fleet")` — no module gate, unlike HazmatGuard next to it. |
| Route/module gate | `router/index.ts:202-206` requires auth only. |
| The seed banner not rendering | Renders on `session.canManage && notStartedCount > 0` (`CompliancePage.vue:118`). Both true. |
| API broken or slow at fleet scale | **Ran `getComplianceOverview` against production.** Silvicom: 248 rows in 213 ms, `truncated=false`, every driver `not_started` with 18 missing items and 5 groups. It works. |
| Anyone ever tried and failed | `audit_logs` holds **1,706,947** rows and **zero** `compliance.*` actions, ever. The app is heavily used; this surface never has been. |

**The actual cause.** All 248 active drivers have `identity_source='samsara'`, and of those 248:

```
cdl_number 0   cdl_expires_at 0   cdl_state 0   medical_card_expires_at 0   hire_date 0
```

Every credential column `0098` added is **empty for every driver**. The seeding panel's job is to
turn paper into rows — but there is no paper in the system to turn, so seeding 248 drivers × 18
items means hand-typing several thousand values sourced from a filing cabinet. Nobody was ever going
to do that, and the UI politely asking them to is the whole story.

**The unlock, found by probing Samsara read-only.** `GET /fleet/drivers` returns, for **100 of 100**
drivers sampled:

```
licenseNumber   100/100
licenseState    100/100
```

`samsaraDriverSync.ts:76-80` fetches those objects and maps **name, phone, username, samsara_driver_id
only**. Nothing in the repo references `licenseNumber` or `licenseState` — verified by grep. The two
fields that would start every qualification file are arriving on every sync and being discarded.

**And licence number + state is exactly SambaSafety's input.** `POST /organization/v1/people/:personId/licenses`
takes them; enrollment and MVR ordering follow; and an MVR returns CDL class, expiry, endorsements and
medical-certification status — most of the §391.51 checklist, per driver, without anyone typing.

So the chain that makes this feature real is:

```
Samsara licenseNumber + licenseState  (already arriving, discarded today)
        → drivers.cdl_number / cdl_state          [new step D6]
        → SambaSafety person + licence + enrolment [E4]
        → MVR                                      [E5 order → E6 webhook → E7 ingest]
        → certifications + qualification_records populated automatically
```

**D6 is the highest-value step in this plan**, and it is small: extend one sync's field map. It
must honour `0098`'s "enrich, never clobber" rule and DQ1's manual-row protection — a licence someone
corrected by hand is not overwritten by telematics — and must never log the licence number, which is PII.

**What this does NOT change.** Previews (B1–B6) and alerts (C1–C5) stay valuable, but they improve a
surface that will only have content once D6 and Phase E put content in it. Sequence accordingly.

### A2c · The roster is 33% fuel-card stubs — **FOUND 2026-08-19**

Owner: *"Samsara has only 167 active drivers, where are the extra coming from?"* Correct, and the
answer is a provenance bug that silently inflates every roster-shaped number in the product.

**The reconcile**, run read-only against both systems:

| | |
|---|---|
| Samsara `/fleet/drivers` | **167 active**, 955 deactivated |
| Our `drivers`, Silvicom | 263 total, **248 active** |
| …linked to a Samsara-ACTIVE driver | **167** — exact match, the sync is correct |
| …linked to a Samsara-DEACTIVATED driver | 0 — the deactivation pass works |
| …linked to an id Samsara no longer returns | 0 |
| **…with no `samsara_driver_id` at all** | **81** |
| `identity_source` on all 248 | **`samsara`** |

So 81 rows claim Samsara provenance and have no Samsara link. Every one was created by a **system
actor** (`audit_logs.actor_id is null`, action `driver.insert`), first on 2026-07-10 and most recently
**2026-08-19 02:56** — this is live and ongoing, not historical debris. Their column profile is a
name and nothing else: 0 phones, 0 usernames, 0 logins, 0 driver types.

**The source is `driverAttribution.ts:44`:**

```ts
.insert(toCreate.map((full_name) => ({ org_id: orgId, full_name, status: "active" })))
```

`attributeDrivers` provisions a driver row for every EFS driver NAME that has no record, so a fuel
fill has somebody to point at. That is legitimate and should not be removed — an unattributed fill is
worse than a stub. **What is wrong is that the stub is indistinguishable from an employee**, and it is
wrong for two reasons that compound:

1. **`identity_source` has no value for this provenance.** The CHECK constraint admits only
   `'samsara'` and `'manual'` — so the column falls to its DB default, `'samsara'`, and every stub
   claims to have come from telematics. The vocabulary has two values for three origins.
2. **`status` is set to `'active'`**, which is the exact predicate `complianceOverview.ts:95` uses to
   decide who owes a §391.51 file.

**Classified against Samsara's full history** (name-normalised, counts only):

| The 81 stubs | |
|---|---|
| Name matches a Samsara **deactivated** driver → **former employee** | **46** |
| Name matches a Samsara **active** driver → duplicate of a real row | **0** — `driversToProvision`'s matching is sound |
| No Samsara record at all — owner-operator, another carrier's driver on a shared card, or a card-side name variant | 35 |

**What this breaks.** Commit `3876960` set out to make the qualification queue "employed drivers
only" and filtered on `status`; these rows assert `active` with no employment behind them, so a third
of the queue is people the carrier owes no file for — including 46 who provably left. It also means
the A2 baseline's "266 drivers" overstates the real roster by about half, and any per-driver cost
estimate (SambaSafety monitoring is priced per enrolled driver) would be inflated the same way.

**The fix, proposed not built** — this is the owner's call because option (b) has a blast radius:

- **(a) Name the provenance.** A migration extends the `identity_source` CHECK with `'efs'`, backfills
  the rows that are system-inserted with no `samsara_driver_id`, and `driverAttribution` sets it
  explicitly. The qualification queue then filters `identity_source <> 'efs'` and D6/Phase E enrol 167
  drivers rather than 248. Small, targeted, and it makes the column honest.
- **(b) Give stubs their own status** rather than `'active'`. Cleaner conceptually, but every
  `status='active'` query in the product changes meaning at once. Not worth it for this.
- **(c) Separately**, the 46 stubs matching deactivated Samsara drivers are ex-employees and should
  probably be `terminated`, which is a data decision, not a code one.

Recommendation: **(a) plus (c)**, and (a) lands before D6 so nothing enrols a stub into a paid
monitoring subscription.

### A3 · Probe HEIC decode
`documents.content_type` admits `image/heic` (G5). Write a throwaway script that runs `sharp(heicBuffer).metadata()`
in the API's own container image.
**Done when:** the answer is recorded. If HEIC does not decode, B1 must either add `heic-convert` or the
0146 constraint must be narrowed in a later migration — the plan branches here rather than guessing.

### A4 · Owner decisions — **TAKEN 2026-08-18 (MJ)**

**D-DQ9 — PDF preview is the browser's own viewer in an `<iframe>` on the signed URL.** No server-side
rasteriser. A PDF row shows a document glyph rather than a page thumbnail. Server rasterisation stays a
bounded follow-up if the glyph proves insufficient. *Consequence recorded in B5: we cannot drive `print()`
into a cross-origin iframe, so a PDF is printed from the browser's own PDF toolbar, and our Print button
is hidden for PDFs rather than present-and-broken.*

**D-DQ10 — originals are never purged when a derivative exists.** §390.32(d) requires accurate
reproduction; a lossy WebP of a medical card is not the record. Derivatives are additive storage, paid for
by never shipping 25 MB to a browser that wanted 40 KB.

**Four further decisions, taken 2026-08-19 (MJ):**

**D-DQ12 — the A2c fix is (a) plus (c), approved.** `identity_source` gains `'efs'`; the 81 stubs are
backfilled; the qualification surfaces filter them out; the 46 stubs matching Samsara-deactivated
drivers become `terminated`. Formalised as step A6 below. Lands before E4 — nothing enrols a stub into
a billed subscription.

**D-DQ13 — the DQ file is company-only. Drivers do not see it.** The owner's words: "drivers do not
need to see this files, this is for company only." DQF-PLAN's DQ5 (driver self-service) is **retired,
not deferred**: no driver credentials screen, no driver-facing alerts, no driver upload path. C3
therefore notifies office roles only. The dormant driver-scope RLS policies from 0127/0129/0146 stay
in place — they are restrictive (they only narrow what the `driver` role could read) and dropping them
would be a migration for no behaviour change; a comment in the next touching migration should note they
are intentionally inert.

**D-DQ14 — office alerting is email now, web inbox as a follow-up.** "Both": Phase C ships the email
path (immediate email on newly-crossed thresholds + the weekly digest section) against the existing
org-email channel (G15), AND C3 writes every alert through `notify()` anyway — the rows land in
`notification_events` where the dedupe ledger lives (G14) and where C6's web inbox will find history
waiting for it when it ships.

**D-DQ15 — drug & alcohol and investigation-history records are restricted to `admin` +
`safety_manager`.** No new role. Phase G implements it at three layers (RLS, API, UI) because the read
paths are service-role (G32). Non-privileged roles keep seeing the checklist *state* of restricted
items — a dispatcher may know a file is incomplete — but not the records, documents, or details behind
them, and the binder excludes restricted kinds unless a privileged role asks for them.

**D-DQ11 (added during A4, from research) — derivatives are generated by our own `sharp` pipeline, not by
Supabase Image Transformations.** Supabase can resize on the fly through `createSignedUrl({transform})`,
which is less code. Rejected for four reasons, in order of weight: it is **Pro-plan-gated and billed at
$5/1,000 origin images per month**, where the `sharp` path is one-off compute plus ~40 KB of storage per
document; a URL-side transform is **invisible to the data model**, whereas `variant='thumb'` is a row the
binder, retention and reconcile logic can already reason about (G1); **HEIC cannot be transformed to
another format** by that service at all, and `documents.content_type` admits HEIC; and it is a
**single-provider dependency** in a codebase that already carries `storageBackup.ts` specifically to avoid
one. Recorded so the cheaper-looking option is not re-proposed.

### A5 · `scripts/samba-recon.mjs` — discover the account, read-only
Owner input 2026-08-18 resolved three of the six open items and turned the rest into a script rather than
an email thread. **Every call in this step is a GET or a search POST — nothing is ordered, nothing is
billed, nothing is written.**

| Question | Owner's answer | How the script settles it |
|---|---|---|
| Which MVR product? | *"Whatever MVR we have is sufficient for DOT"* — the account is already live and the product in use is the right one | Probe each product's list endpoint over a wide date range — `/transactional/v1/mvrorders`, `/orders/v1/mvrreports/activity`, `/orders/v1/mvrreports/intelligent`, `/orders/v1/reports/cdlis`. **The one returning rows is the product we buy.** Pin it in `SAMBA-RECON.md`; the client hard-codes that path and no other. |
| Which group? | The **Silvicom** group holds the active drivers; other groups exist and are not ours | `GET /organization/v1/groups?page=1&size=50`, match the name, record the `groupId`. Resolve by name **once**, store the id — never match by name at runtime. |
| State access codes (UT/CA/PA)? | *"We don't have drivers from those states"* | **Build the guard, not the config.** `orderMvr()` refuses a licence issued in UT, CA or PA with a named error telling the operator an access code must be configured first. The day a driver from one of those states is hired, we get a clear message instead of a vendor-side order failure. |
| Rate limits | — | Still the rep's, or observed. Non-blocking: the client already backs off on 429. |
| Per-driver monitoring price | — | Still the rep's. Only affects how hard E3's unenrolment is sold, not whether it is built. |
| Fixtures | — | Capture from the **live** account read-only, not from a sandbox. |

**PII is the hard constraint on this step.** An MVR is the most sensitive record in the product — SSN,
date of birth, licence number, full violation history. Fixtures captured for E2's tests **must be scrubbed
before they touch the repo**, following the precedent already set by `redactCardXml` (commit `9a7a125`,
"masks driver PII — the transcript scrub, automated"). The script writes redacted fixtures only, and
`gitleaks` runs over them.

**Done when:** `SAMBA-RECON.md` §8 names the MVR product path, the Silvicom `groupId`, and the count of
enrolled licences; and `scripts/samba-recon.mjs` re-runs idempotently with no write of any kind.

### A6 · The stub fix — D-DQ12, approved, now a step
One migration (next free number, G23) + one data pass + two code changes:
1. **Migration:** extend the `drivers.identity_source` CHECK (`0098:26-27`) to admit `'efs'`, and
   backfill `identity_source='efs'` for rows that are system-inserted (`audit_logs` actor null) with
   `samsara_driver_id is null` — the 81 measured in A2c. The backfill predicate is written in the
   migration with the count it expects to touch, so an unexpected match count fails loudly.
2. **Data pass (production, owner-run per the SQL-editor pattern):** the 46 stubs whose names match
   Samsara-deactivated drivers → `status='terminated'`, audited as `driver.updated`.
3. **Provisioning honesty:** `efsIngest.ts:93` and `driverAttribution.ts:44` set
   `identity_source: 'efs'` explicitly on every future stub.
4. **Filter:** `complianceOverview.ts` adds `.neq("identity_source", "efs")`; E4's eligibility
   predicate excludes `'efs'` rows; `QualificationSeedPanel`'s driver list follows automatically
   (it reads the overview).
**Not** a rename of the Samsara ambiguity insert (`samsaraDriverSync.ts:98-103`) — that path creates
telemetry-linked rows and is out of scope here; if ambiguous-name duplicates recur, the reconcile
panel already handles them post-hoc.
**Done when:** a PGlite matrix proves the CHECK admits the three values and rejects a fourth; the
overview test proves an `'efs'` row is absent from the response; and the production driver census
(`status in ('active','on_leave') and identity_source <> 'efs'`) reads ~167, matching Samsara's
active roster.

---

## Phase B — Documents: previews and storage economics *(the priority)*

### B1 · `packages/shared/src/documentDerivatives.ts` — the pure spec — **DONE 2026-08-19**
Export `DERIVATIVE_SPECS` and `DERIVATIVE_VERSION`:
- `thumb`: long edge **320 px**, WebP **q65**, stripped metadata — the file-table cell.
- `normalized`: long edge **2000 px**, WebP **q82**, EXIF auto-orient only — the on-screen viewer.
No `.normalise()`, no `.median()`: G7's ruleset is tuned for a vision model, and altering the luminance of
a scanned medical card before a human reads it is a legibility change to evidence.
Plus `shouldDerive(contentType)` → true only for `image/*`; PDFs are handled by A4's decision.
**Files:** new file (~60 ln) + `documentDerivatives.test.ts`; barrel export in `packages/shared/src/index.ts`.
**Shipped with 19 assertions.** The version guard is a *fingerprint* derived from the specs and pinned
by a test, rather than a hand-written constant nobody remembers to bump — editing a bound or a quality
fails the suite until the change is acknowledged.

**Found while building it, and it amends this plan:** G1 was right that `variant` needs no migration, but
nothing links a derivative back to its original — `documents` has no parent column. Encoding the link in
the storage path would make an object name a foreign key, which is how the next person ends up regex-
matching bucket listings. **Migration 0204 adds `documents.derived_from uuid references documents(id)`**,
at step B2 where the writer lives.

### B2 · `apps/api/src/services/documentDerivatives.ts` — generate and register
Given a `documents` row id: download the original, run `sharp` per B1, compute a fresh SHA-256 (G4), upload
to `${orgId}/${subjectType}/${subjectId}/${docId}.thumb.webp`, insert a **new** `documents` row with
`variant='thumb'` and the same `kind`/`subject_*` (G3 — never an UPDATE). Idempotent on
`(subject, kind, variant, sha256-of-original)` so a retry is free.
**Files:** new service (~150 ln), guard it under the 200-line function budget by splitting `derive()` from `store()`.
**Done when:** unit test with a stubbed Supabase client proves: derivative row inserted, original untouched,
second call is a no-op, and a `sharp` failure returns an error rather than throwing.

### B3 · Wire derivation into the queue, not the request
Add job kind `document_derive` to `services/queue/handlers/` (sibling of `dqBinder.ts`), enqueued from
`POST /api/compliance/documents` **after** the row is registered. The upload path must not wait on `sharp`;
the register call already returns before bytes exist.
**Files:** `queue/handlers/document_derive.ts`, `queue/handlers/index.ts`, `services/compliance.ts`, `services/jobs.ts`.
**Done when:** enqueue is asserted in the route test, and the handler is registered in the index (a handler
that is not registered cannot exist — the `run-tests` philosophy applied to the queue).

### B4 · `listDocuments` returns variants grouped
Change `services/compliance.ts:149` to sign every variant in the same batch call and return
`{ id, kind, original: {url,bytes}, thumb?: {url}, normalized?: {url} }`. One round trip, unchanged
five-minute TTL.
**Watch:** `compliance.ts` is currently under budget but this is the file most likely to cross 450 — check
`pnpm lint:filesize` after.
**Done when:** the contract type in `packages/shared/src/complianceContract.ts` is updated, `vue-tsc` passes,
and the existing document tests still pass unmodified where behaviour did not change.

### B5 · `BaseModal.vue` — a second dialog primitive, added deliberately

**Verified gap:** the app has **exactly one** Headless UI `Dialog` — `components/SlideOver.vue`. There is
no centred modal, no lightbox, and `features/roster/DriverAccessModal.vue` is a `SlideOver` despite its
name. Deps: `@headlessui/vue@1.7.23`.

**The push-back, and why the answer is still yes.** The instinct that fits this design system is "reuse
`SlideOver`, do not invent a surface." But `SlideOver` is `max-w-md | max-w-lg` — 28–32 rem. A scanned
medical card rendered 28 rem wide is not legible, and widening `SlideOver` would change every existing
drawer. A document viewer wants width and centring; a form wants a side panel that keeps the list visible.
Those are two surfaces, and the honest move is **one sanctioned primitive added to
`components/ui/BaseModal.vue` and written into the design contract**, not a bespoke overlay in a feature
folder. Same `Dialog`, same scrim (`bg-neutral-900/60`), same 300 ms transitions, same header/body/footer
anatomy as `SlideOver` §6.1 — only the panel geometry differs: centred, `max-w-4xl`, `max-h-[90vh]`.

**Props:** `open`, `title`, `description?`, `size?: "md"|"lg"|"xl"` (`xl` = `max-w-4xl`, the document case).
**Done when:** the contract §1.1 lists it, and a test asserts Escape and scrim-click both emit `close`.

### B6 · `DocumentPreview.vue` — the viewer, with download and print that actually work
New `apps/web/src/features/compliance/DocumentPreview.vue`, mounted in `BaseModal size="xl"`.

- **Trigger:** the thumbnail already rendering in the requirement drawer's file table (commit `9ea8040`).
  Thumb is the `thumb` variant; the modal shows `normalized`; nothing loads the 25 MB original until asked.
- **Body:** image at `max-h-[75vh] object-contain`, or — for PDFs — an `<iframe>` on the signed original (D-DQ9).
- **Footer:** `Print` · `Download original` · `Close`.
- **Metadata line:** kind label, `captured_at`, `bytes`, and the first 12 chars of `sha256` in `font-mono`
  (the contract sanctions mono for machine identifiers; the hash is §390.32(c) made visible).

**Download — the trap, and the fix.** `<a href="{signedUrl}" download>` **does not work here.** Storage is
a different origin from the app, and the `download` attribute is ignored cross-origin: Firefox drops it
entirely and navigates, Safari honours it only for same-origin, `blob:` and `data:` URLs, and Chrome
strips the filename hint. The correct fix is server-side, not client-side: sign the URL with Supabase's
**`download` option**, which sets `Content-Disposition: attachment` with the filename we choose, so a plain
link downloads in every browser with no fetch and no memory cost. `signDocumentDownload(docId)` returns
that URL, named `{driverLastName}-{kind}-{capturedAt}.{ext}`, and the request is **audited** — the binder
download already sets this precedent (`routes/compliance.ts:456-485`, `compliance.binder_downloaded`).
Reading someone's medical card out of the system is worth a ledger line.

**Print — no iframe.** The common recipe (hidden iframe → `contentWindow.print()`) **cannot work** on a
cross-origin signed URL; the browser blocks the call. The reliable approach is a **print stylesheet in the
app's own document**: the image is already loaded and displayed in the modal, so `window.print()` prints
it, provided CSS hides everything else. The app currently has **zero `@media print` rules anywhere** —
verified. Add to `apps/web/src/style.css`:

```css
@media print {
  body * { visibility: hidden; }
  .print-target, .print-target * { visibility: visible; }
  .print-target { position: absolute; inset: 0; margin: 0; }
  .print-target img { max-width: 100%; page-break-inside: avoid; }
  @page { margin: 12mm; }
}
```
`BaseModal` exposes a `printable` prop that puts `.print-target` on its panel; `DocumentPreview` sets it.
**The Print button is hidden for PDFs** — the browser's own PDF viewer owns that toolbar, and a button
that silently does nothing is worse than no button (D-DQ9).

**Rejected alternatives, recorded:** fetch → `blob:` → print/download works and is same-origin, but it
pulls the whole file into memory (25 MB cap) and duplicates what one signed-URL parameter does server-side;
a print-specific popup window is blocked by popup blockers and loses the app's fonts.

**Done when:** `pnpm --filter @fuelguard/web typecheck`, `pnpm --filter web lint:tokens` and
`pnpm lint:filesize` pass; a component test asserts the PDF branch renders an iframe **and hides Print**,
the image branch renders `<img>` **and shows Print**; and an API test asserts the download URL carries a
`Content-Disposition` filename and writes a `compliance.document_downloaded` audit row.

### B7 · Close the orphan leak (G10) — **DONE 2026-08-19**; scheduler only, no migration
`reconcileComplianceDocOrphans` binds `compliance-docs` → `documents` on the already-generalised
`reconcileBucketOrphans`, and the scheduler's bucket list becomes three entries. Same 24-hour grace.
Orphan **rows** stay flagged, never deleted (`storageReconcile.ts:20-24`) — that asymmetry is what makes
this safe to aim at a compliance bucket: it can keep bytes it could have deleted, never delete evidence.

**Correction to G10:** the sweep already covered **two** buckets (`hazmat` and `load-photos`), not one.
`compliance-docs` was the omission. The file is renamed `storageReconcileScheduler.ts` — it stopped being
hazmat-specific at LD3, and a name saying "hazmat" on the code that decides the fate of every driver's
medical-card scan misleads whoever reads it next.

**Shipped with 4 assertions** pinning each bucket↔table binding (point `documents` at the wrong bucket and
every object in it looks like an orphan) plus one proving a `documents` row whose object is missing is
flagged and never deleted.

### B8 · Backfill derivatives for existing documents
One-shot script `scripts/backfill-document-derivatives.mjs`: page `documents where variant='original' and content_type like 'image/%'`,
enqueue `document_derive` for each. Rate-limited; resumable; prints a count.
**Done when:** the script is idempotent on a second run (0 enqueued) and A2's baseline note is amended with
the post-backfill byte total.

### B9 · Wire an off-provider backup target (G11)
`storageBackup.ts` needs a `BackupTarget` implementation and credentials. Cheapest correct choice for
append-only evidence: **Cloudflare R2** (zero egress). Implement `lib/r2BackupTarget.ts` against the S3 API,
add env vars, register a weekly scheduler entry for buckets `compliance-docs` + `hazmat`.
**Done when:** a dry-run against a test bucket copies one object and `has()` skips it on the second pass.

> **Storage economics, stated plainly.** The saving is not compression of the record — it is never
> *serving* the record. A 25 MB original fetched into a fleet table of 200 drivers is 5 GB of egress per
> page view; the same table on 40 KB thumbs is 8 MB. B1–B6 are an egress fix first and a storage fix
> second. B7 is the only step that reduces stored bytes, and it does it by deleting bytes nothing points at.

---

## Phase C — Alerts *(the second priority)*

> **Two facts shape this phase** (G30, G31): the attention feed the UIs render sees only 30 days out,
> so the 90/60-day thresholds need the overview computed at a wider horizon — for the scheduler only;
> and `notify()` alone reaches nobody at a desk, so the office path is email (D-DQ14), with the
> `notify()` rows doubling as the dedupe ledger and the pre-populated history for C6's inbox.
> Per D-DQ13 there are **no driver-facing alerts** in this phase or any other.

### C1 · Categories
Add to `NOTIFICATION_CATEGORIES` (G13): `dq_expiring`, `dq_expired`, `dq_missing`, plus the two
externally-sourced ones Phase E emits — `dq_license_status` (a licence was suspended, downgraded or
reinstated) and `dq_mvr_received` (monitoring produced a new MVR, with its `reason`). Add labels in
`NOTIFICATION_CATEGORY_LABELS`. Leave them **mutable** (not in `NON_MUTABLE_CATEGORIES`) — an office
user who triages by email may silence the in-app copy once C6 gives them one. `training_due` (G34)
stays untouched: it is driver-facing vocabulary, dormant under D-DQ13.
**Done when:** `notificationsContract.test.ts` (which iterates every category, `:127`) passes unchanged.

### C2 · Widen the overview's horizon — for the scheduler, without forking the UI's
`getComplianceOverview(admin, orgId, today)` gains an options argument `{ expiringWithinDays?: number }`
threaded straight into `buildDqFile` (the parameter exists and is dead today — G30). **No UI caller
changes**: the route handler, the driver page and the binder keep the 30-day default, so the queue and
the file keep agreeing (`complianceOverview.ts:20-23` stays true). Only C3 passes `91`.
**Done when:** an overview test proves an item 60 days out is absent at the default horizon and present
in `attention` at 91 — the assertion that would have caught this plan's own original defect.

### C3 · `packages/shared/src/dqAlerts.ts` + `apps/api/src/services/dqAlertScheduler.ts`
The pure schedule: `planDqAlerts(rows: DriverOverviewRow[], today, alreadySentKeys: Set<string>): DqAlert[]`.
Thresholds **90 / 60 / 30 / 14 / 0 / overdue-weekly**. Each alert carries a `dedupeKey` of
`dq:${driverId}:${itemKey}:${threshold}` so crossing 60 days emits once, ever, and a restart emits nothing.
Consumes `DqAttentionItem` from `dqFile.ts` — the same ranking the UI shows (G19) — computed at C2's
91-day horizon.

The scheduler copies `digestScheduler.ts` exactly (G16): `DQ_ALERTS_ENABLED` env flag, 6-hour interval,
per-org guard. For each org:
1. `getComplianceOverview(…, { expiringWithinDays: 91 })` → `planDqAlerts` with `alreadySentKeys`
   read from `notification_events` dedupe keys.
2. Each alert → `notify()` to every membership in `rolesThatManage("fleet")` — this is the **ledger and
   the future inbox**, not the delivery (G31); `emit_notification`'s dedupe key is what makes a retried
   scheduler silent.
3. If any alert was **newly** emitted this run, ONE email to `organizations.notification_emails`
   (respecting `notifications_enabled`, G15) listing the new items, worst first — not one email per
   alert; a fleet crossing a renewal season must not send forty emails in an afternoon.
Register in `schedulers.ts`.
**Done when:** ≥ 20 assertions on the pure planner (an item at exactly 60 days emits; at 59 it does not
re-emit the 60 key; an overdue item emits weekly not daily; a `terminated` or `identity_source='efs'`
driver emits nothing); and a scheduler test with a stubbed admin client proves two consecutive runs
produce one `notify()` per alert and at most one email, and `DQ_ALERTS_ENABLED=false` produces none.

### C4 · The weekly email section
`digest.ts` already assembles and sends a weekly org email (G15). Add a **DQ section**: count expiring in 30
days, count expired, count files not started, and the five most urgent driver+item pairs.
**Watch:** `digest.ts` is 360 lines — adding a section risks the 450 warn band. Put the section builder in
`packages/shared/src/digestDq.ts` and call it.
**Done when:** `renderDigestEmail`'s snapshot test covers the new block, and `pnpm lint:filesize` shows
`digest.ts` still under 450.

### C5 · The fleet-level attention strip
`CompliancePage.vue` (177 ln — ample headroom) gains, above the table, a single row of at most five
`BaseCard padding="sm"` tiles: *Expired · Due in 14 days · Due in 30 · Not started · Files complete*. Each is
a click-to-filter that sets the existing `stateFilter` on `QualificationFleetTable` — it does **not** introduce
a second filter model.
**Done when:** clicking a tile changes the table's rows and the FilterBar chip appears, asserted in a
component test.

### C6 · The web notification inbox — the "both" half of D-DQ14, sequenced after C5
The office half of the notification system the driver app already has: a bell in `AppShell.vue`'s top
bar with an unread count, a panel listing `notification_events` for the signed-in user, mark-as-read
writing `notification_reads`. The API surface exists for drivers at `/api/me/notifications`; this adds
the office equivalent (same tables, `requireOrg` + office roles rather than `requireRole("driver")`).
Scope discipline: **list, unread count, mark read, deep link** — no preferences UI (mutes/quiet hours
already have a home in `notification_preferences` and can get an office UI later), no new categories.
By the time this ships, C3 has been writing DQ alert rows for weeks — the inbox opens with history in
it rather than empty.
**Done when:** an office user sees a `dq_expired` event emitted by C3, the unread count decrements on
read, and a `driver`-role session receives 403 from the office route.

---

## Phase D — Information architecture

### D1 · One driver, one page
`DriverQualificationPage.vue` (459 ln) becomes `features/compliance/QualificationSection.vue`, mounted inside
`DriverDetailPage.vue` (160 ln, currently fuel-history only) under a section switcher:
**Profile · Qualification · Fuel · Performance**.
**Constraint:** the extracted section must land under 500 lines on its own (G22). It will not — 459 lines of
page includes header, filters and the export menu that belong to the page, not the section. Split as:
`QualificationSection.vue` (the checklist + drawer wiring) and keep the export actions on the host page's
`PageHeader #actions`.
**Done when:** `/drivers/:id` renders the qualification checklist, `pnpm lint:filesize` is clean, and
`vue-tsc` passes.

### D2 · Redirect, do not break
`/compliance/:id` → `redirect: to => ({ name: 'driver-detail', params: to.params, query: { section: 'qualification' } })`
in `router/index.ts:210-213`. Bookmarks and the binder's deep links keep working.
**Done when:** a router test asserts the redirect resolves with the section query preserved.

### D3 · Qualification on the roster
Add one column to `DriversPage.vue`: a `lib/badges.ts` badge reading `14/18` or `Due 12d`, sourced from the
same `useComplianceOverviewQuery`. Row click already routes to `/drivers/:id`.
**Watch:** `DriversPage.vue` is 414 lines — over the 450 warn band after this. Move the two hand-rolled badge
maps (`:31-38`, `:74-77`) into `lib/badges.ts`, which the design contract §8.4 already flags as a violation.
The column pays for itself in lines.
**Done when:** `pnpm lint:filesize` shows `DriversPage.vue` under 450 and `lint:tokens` is clean.

### D4 · Three states, not five
`DqItemState` is internal and stays. The **UI vocabulary** collapses to **OK / Expiring / Blocked**, mapped in
one place (`lib/badges.ts`), with `missing` and `not_started` both rendering as *Blocked* and the distinction
surviving in the drawer where it is actionable.
**Done when:** no `.vue` file contains a status string literal not sourced from `badges.ts`.

### D6 · Stop discarding the two fields that start every file — **the highest-value step here**
`samsaraDriverSync.ts` maps name, phone, username and `samsara_driver_id` from a driver object that
also carries `licenseNumber` and `licenseState`, populated for 100 of 100 drivers sampled (A2b). Map
them onto `drivers.cdl_number` and `drivers.cdl_state`.

**Three rules it must obey, all pre-existing:**
1. **Enrich, never clobber** (`0098`) — a licence corrected by hand is not reverted by the next sync.
   DQ1 already fixed exactly this bug for `full_name`/`phone`; this must not reintroduce it.
2. **Manual rows keep their identity** — an `identity_source='manual'` row gets only its
   `samsara_driver_id` refreshed, per DQ1.
3. **Never log a licence number.** It is PII, and this repo already automated that lesson in
   `redactCardXml` (`9a7a125`).

**Not a `certifications` write.** A licence number is master data on the driver; a CDL *certification*
with an issue and expiry date is evidence, and Samsara supplies no dates. D-DQ6 keeps `certifications`
the single source of truth for qualification — this step fills the field that lets Phase E go and get
the evidence, and stops there.
**Done when:** a unit test proves a manual row's hand-entered `cdl_number` survives a sync that carries
a different one, and that a telematics row with no licence gets one; and a production sync run leaves
`count(cdl_number) > 0` where it is 0 today.

### D5 · Refresh the design contract
`DESIGN-SYSTEM-CONTRACT.md §8.1` documents a deleted file and §8.2 a file that has since halved (G24).
Rewrite both entries against the current tree, and add `DocumentPreview.vue` to §1.2 as the sanctioned
document viewer so the next person does not build a second one.
**Done when:** every path in §8 resolves.

### D7 · Close the §172.704(d) capture gap (G35) — carried over from DQF-PLAN DQ3, dropped by an earlier revision
Add `trainingProviderAddress`, `trainingMaterials` and `notes` to the training branch of
`RequirementDrawer.vue` (it already captures `issuingAuthority` and the scan), and the same three to
`CertManager.vue` for parity. No contract, table or API change — all three already accept the fields
(G35); this is UI only.
**Done when:** recording a hazmat training through the drawer with all §172.704(d) fields produces a
`certifications` row carrying them, asserted end-to-end in the drawer's component test against the
recorded request body.

### D8 · Encode the verified regulatory state (G33) — three catalogue corrections
1. **ELDT becomes advisory.** It is not a §391.51(b) document; the carrier holds no retention
   obligation. The spec gains `advisory: true`: an advisory item never reports `missing`, never enters
   `dqAttention`, and never counts against `complete` — it renders only when evidence exists, labelled
   "tracked, not required". The catalogue comment already conceded this; the state machine now agrees.
2. **The registry-verification note applies to non-CDL drivers only.** `DqFileInput` gains
   `hasCdl: boolean` (the caller derives it from `drivers.cdl_number`, which D6 populates);
   `medical_registry_verification`'s spec carries `appliesWhen: "no_cdl"`. A CDL holder's file no
   longer reports a missing registry note that §391.51(b)(8) stopped requiring in June 2025.
3. **The CDLIS MVR satisfies the medical item for CDL holders.** `medical_card`'s evidence for a
   CDL holder is the CDLIS MVR (§391.51(b)(6)(ii)); E7 therefore writes, from an ingested MVR carrying
   medical-certification status, a `medical_card` certification row whose `expires_at` is the MVR's
   medical expiry and whose `document_id` cites the MVR PDF — the paper-card path stays for non-CDL
   drivers and for the waiver bridge (through 2026-10-11; re-check quarterly, G33).
All three are `packages/shared` changes with exhaustive tests; the API and both UIs consume them
without modification because they render the computed file rather than re-deriving it (G19).
**Done when:** a CDL driver's file with an ingested MVR reports medical `current` and no registry-note
gap; a non-CDL driver's file still demands both; an ELDT-less file reports `complete`; and the
18-item count assertions in `dqFile.test.ts` are updated deliberately rather than loosened.

---

## Phase E — SambaSafety, as a capability module

Built on the EFS architecture per the Architecture section above. Every write to SambaSafety is a
capability; the webhook receiver is not.

**The four capabilities**, and why exactly these:

| key | What it mutates | `userTriggered` | Mutation | Landing |
|---|---|---|---|---|
| `samba_person_create` | a person in the Silvicom group | false — the sync creates it | direct | `landed` on a `personId` that reads back |
| `samba_license_create` | a licence on that person | false | direct | `landed` on a licence that reads back |
| `samba_enrollment_set` | monitoring on/off for a licence | false | direct | `landed` when the enrolment reads `enrolled`/`unenrolled` as asked |
| `samba_mvr_order` | **an MVR order — this one bills** | **true** | direct | **`indeterminate`** on acceptance; the webhook settles it |
| `samba_driver_onboard` | the three above, in order | false | **sequence** | per-step; `partial` with `step_index` on a half-apply |

### E0 · The vocabulary — **do this first, it is what makes the rest compile-checked**
`packages/shared/src/samba/types.ts` + `apps/api/src/samba/types.ts`, modelled on
`packages/shared/src/efs/types.ts` and `apps/api/src/efs/types.ts`, with the four adaptations named in
the Architecture section. Include `defineContract`/`defineBehaviour` identity helpers — they look like
no-ops and are the inference anchor that makes a contract change a compile error in the behaviour and
the view rather than a runtime surprise on a real driver.
**Done when:** the types compile with no capability written against them yet, exactly as EFS's did.

### E1 · Credentials — no new table (G17)
`org_integrations` with `provider='sambasafety'`: three secrets per environment (client id, client
secret, api key — `SAMBA-RECON.md` §2), non-secret settings in `config` (`groupId` from A5, demo vs
production, the MVR product path A5 pinned). Service-role only; it already has no client policies.
**Done when:** a scratch script reads and writes the row through the admin client only, and `gitleaks`
is clean.

### E2 · `apps/api/src/samba/client.ts` — the vendor edge, and nothing else
OAuth2 client-credentials with `X-Api-Key` on every call, token cached for `expires_in` minus a margin,
429/5xx retry with jitter, every response body persisted verbatim before parsing.

**The guard that must be structural, not remembered:** SambaSafety returns **application errors with
HTTP 200** (`SAMBA-RECON.md` §6). The client checks the response envelope for an error `code` on every
200 and converts it to a typed failure. A capability's `judge` must never be the first thing to notice.

**Opts arrive built.** Following `ReadCtx`/`DispatchCtx`: the capability receives its retry policy and
deadline and never constructs them, so pacing cannot become per-capability discretion.
**Done when:** a fixture test round-trips one MVR response, and a second proves a `200` carrying
`{"code":"B02"}` surfaces as an error.

### E3 · `samba_mutations` — the ledger
Migration **0205** (0204 is B2's `derived_from`). Mirrors `efs_card_mutations` minus the card-specific
columns:

```sql
id, org_id, capability_key, driver_id, target_kind, target_ref,
idempotency_key, request_body jsonb (redacted), status, step_index,
attempts, vendor_ref, error, created_at, settled_at
```

`status` uses the **same six values** as the card ledger — `pending, sent, succeeded, failed,
drift_detected, partial` — because an operator reading two integration surfaces should not learn two
vocabularies. A partial unique index gives one in-flight mutation per `(capability_key, target_ref)`,
as `uq_efs_card_mutations_one_pending` does.

**`request_body` is not optional.** Without it the reconciler cannot re-judge a row it did not write,
which is the exact defect EFS hit with its `direct` mutations before Step 3.9.
**PII:** the body carries licence numbers. It is redacted on the way in, per `redactCardXml`.
**Done when:** a migration matrix proves the one-in-flight index holds and that a replayed
idempotency key returns the first outcome rather than issuing a second vendor call.

### E4 · The three sync capabilities + the onboarding sequence
`samba_person_create`, `samba_license_create`, `samba_enrollment_set`, composed by
`samba_driver_onboard`.

- **Target** — the driver, joined by `customPersonId = drivers.id` (G27). No mapping table, no
  name-matching; name-matching a roster is what produced the `0203` damage and the A2c stubs.
- **Who is eligible** — drivers with a `cdl_number` and `cdl_state` (which D6 supplies) that are
  **not** EFS-provisioned stubs (A2c). **A2c's fix lands before this step**, or the sequence enrols
  fuel-card names into a billed subscription.
- **Verification** — `snapshot` reads the person/licence/enrolment back; `judge` asks whether it moved;
  `reconcile` is the after-only predicate the background pass uses.
- **Unenrolment on termination is the cost control** and is its own invocation of
  `samba_enrollment_set`, not a special case inside the sync.
**Done when:** a behaviour test proves a terminated driver is unenrolled exactly once and never
re-enrolled, and a half-applied sequence settles `partial` with the failing `step_index`.

### E5 · `samba_mvr_order` — the one that bills, and the only `userTriggered` capability
**Governance is the point of this capability**, and it is the axis the pre-rewrite plan had nothing on:

- **Step-up re-authentication** on order. It spends money and pulls a person's driving record.
- **A per-org monthly MVR budget**, using the shape hazmat extraction already proved —
  `withinBudget` + the `org_usage_month` counter incremented atomically with the write
  (`0130_hazmat_run_counter.sql`). A runaway sync must hit a ceiling, not an invoice.
- **A kill switch**, as `extractionEnabled` is for vision.
- **The UT/CA/PA guard** (A5): a licence issued in a state whose access code is unconfigured is
  refused by name, not attempted.

**Landing is `indeterminate` by design.** Acceptance means accepted, not delivered — the row settles
`sent` and E6's webhook moves it to `succeeded`. A `judge` that claimed `landed` here would be lying
about a report that does not exist yet.
**Done when:** an over-budget order is refused with no vendor call, an order without step-up is
refused, and an accepted order settles `sent` rather than `succeeded`.

### E6 · The webhook receiver — ingest, deliberately NOT a capability
`POST /api/integrations/samba/webhook`. A capability is a write WE initiate; this is the vendor
talking back, and modelling it as one would put an inbound handler in a registry whose fitness test is
about outbound artifacts.

- **Authentication (G26):** `Authorization: Basic base64(clientId:clientSecret)` — credentials we
  already hold — verified with a **constant-time compare**, rejected before parsing. A missing header
  is a rejection; the vendor calls it optional, we do not. `X-SambaSafety-Signature` is verified *in
  addition* once the algorithm is documented (A1's open item) — strictly stronger, added later.
- **Replay-protected by `eventId`.**
- **The payload is HATEOAS, not data** — `{eventId, data:{orderId, links:[{rel,href}]}}`. The handler
  follows `links[].href` to fetch the report and never treats the event body as the record.
- **It settles the ledger row** for the matching `samba_mvr_order` — which is what makes E5's
  `indeterminate` honest rather than an unanswered question.
**Done when:** a wrong-signature body has no side effect, a replayed `eventId` is a no-op, and a
`motorvehiclereport.received` event moves its ledger row `sent → succeeded`.

### E7 · MVR ingest → the tables we already have (G18)
Order the report in **two media types** (`SAMBA-RECON.md` §4): `application/vnd.sambasafety.platform.mvr+pdf`
for the artifact an auditor expects, `+json` for the fields. The PDF files into `documents` as
`content_type='application/pdf'`; the parsed fields insert a `qualification_records` row citing that
document id. Both writes audited. **No schema change** — the kinds already exist.
**Done when:** ingesting a fixture produces exactly one document row and one record row, and
re-ingesting the same report id produces neither.

### E8 · The cross-registry fitness test
`apps/api/src/samba/registry.test.ts`, modelled on `apps/api/src/efs/registry.test.ts` — including its
**non-empty-discovery guard**, which is not ceremony: a discovery that finds nothing makes every loop
body vacuous and every assertion pass, which is exactly how `routeAuth.test.ts` once asserted 401s
about routers it had never seen. Count first, then assert.

Asserts: every contract has a behaviour; `userTriggered: true` has a view **and `false` does not**;
every `capability_key` is unique and matches the ledger CHECK; every capability declares a `verify`
with both `judge` and `reconcile`; every billing capability declares a budget and a step-up gate.
**Done when:** deleting any one artifact of any capability turns the suite red.

### E9 · Surface it
An Integrations card on `OrgSettingsPage.vue` (connection state, `last_synced_at`, enrolled count vs
eligible), and on the driver's Qualification section an MVR row marked **Source: SambaSafety** from
data, never inferred from a record's shape — so a hand-entered MVR and a pulled one are never confused.
The only capability View is `samba_mvr_order`'s confirmation, which must state the cost and the
remaining monthly budget before the operator confirms.

## Phase F — Retention, closing D-DQ3 and D-DQ5

### F1 · Retention as data
`DqItemSpec.retention` is TEXT today, explicitly *"Shown, never acted on"* (`dqCatalogue.ts:107`). Add a
structured sibling `retentionRule: {kind:'employment_plus_years'|'years_from_date'|'employment_plus_days', n:number}`.
Keep the prose — it is what the UI shows and what an auditor reads.
**Done when:** every one of the 18 specs has a rule, asserted exhaustively so a new spec cannot omit one.

### F2 · The purgeable report
`computePurgeable(file, employmentEndDate, today)` in shared; a read-only API endpoint; a section on
`OrgSettingsPage`. **Nothing deletes** — D-DQ5 stands, and `RETENTION_FORBIDDEN` (G21) stays untouched.
**Done when:** a driver terminated 4 years ago with a 3-year-retained item reports purgeable; the same driver
still employed reports not purgeable.

---

## Phase G — Restricted records (D-DQ15; closes DQF-PLAN's open question 2)

**The restricted set**, with its citation per kind: `drug_test`, `alcohol_test` (§382.401(a): "secure
location with controlled access"); `clearinghouse_full`, `clearinghouse_limited` (D&A program records —
included as prudent practice; the §382.401 enumeration was not verified to name query records, and the
plan says so rather than citing it); `previous_employer_inquiry`, `previous_employer_response`
(§391.53(a)(1): access limited to those involved in the hiring decision). Privileged roles: `admin`,
`safety_manager` (D-DQ15). The single source of truth is one exported constant —
`RESTRICTED_QUALIFICATION_KINDS` in `packages/shared` — consumed by every layer below; a kind listed
in two places is how one layer forgets.

### G-1 · The shared vocabulary
`RESTRICTED_QUALIFICATION_KINDS` + `canReadRestricted(role)` in `packages/shared/src/auth.ts` (beside
the section matrix, which is where role questions are answered today).
**Done when:** an exhaustive test pins the set, so adding a fifteenth record kind forces a decision
about whether it is restricted.

### G-2 · RLS — defence in depth, not the enforcement
One migration (next free number): a **restrictive** policy on `qualification_records` and on
`documents` denying the restricted kinds to non-privileged roles. This protects the PostgREST path
(the web app reads some tables directly) and any future direct read; it does NOT protect the three
service-role paths (G32), which is why G-3 exists.
**Done when:** the RLS matrix proves a dispatcher's direct read returns zero restricted rows and an
admin's returns them.

### G-3 · The API layer — where enforcement actually lives
The three service-role read paths filter by `canReadRestricted(req.auth.role)`:
- `GET /api/compliance/qualification-records` drops restricted rows for non-privileged callers;
- `getComplianceOverview` keeps counting restricted items' **state** (a dispatcher may know the file
  is incomplete — D-DQ15) but nulls `evidenceDate`/`goodUntil` detail? **No** — simpler and honest:
  the overview already carries no record payloads, only computed states; it needs no change, and a
  test pins that it never grows one.
- the binder gather **excludes restricted kinds by default**; a privileged role may pass
  `includeRestricted: true`, which is recorded on the `dq_exports` ledger row.
Writes: `POST /qualification-records` for a restricted kind requires a privileged role.
**Done when:** route tests prove a dispatcher listing records sees none of the restricted kinds, a
binder built by a fleet_manager contains no drug-test page, and the `includeRestricted` flag appears
on the export ledger row when used.

### G-4 · The UI
`RequirementDrawer` and the qualification section render restricted items' state for everyone, and the
record/renew affordance plus history/scan links only for privileged roles; others see the state badge
with "Restricted — safety manager access" in place of the evidence. One gate:
`session.canReadRestricted`, derived from the same shared predicate.
**Done when:** a component test renders the drawer as dispatcher and asserts no restricted evidence or
capture control is present.

---

## Deferred, with reasons — so absence reads as a decision, not an oversight

| Deferred | Why | Re-opened by |
|---|---|---|
| **Driver self-service (old DQ5)** | **Retired**, not deferred — D-DQ13: the file is company-only. | An explicit owner reversal. |
| **Equipment (tractor/trailer) certifications UI** (G36) | No consumer: the hazmat gate reads only org + driver certs; a capture UI for data nothing reads is inventory without a customer. Trailers also lack a detail page to host it. | The first gate or report that consumes an equipment cert — build the consumer and the capture together. |
| **Web notification preferences UI** | `notification_preferences` exists and works; C6 ships list/read only. | Office users asking to mute categories. |
| **Server-side PDF rasterisation** | D-DQ9 chose the browser's viewer; revisit only if the glyph-not-thumbnail experience for PDFs proves insufficient. | User feedback after B6. |
| **ELP (English Language Proficiency) file item** | Guidance + NPRM only as of 2026-08; no documentation obligation exists (G33). | The ELP final rule, if it adds one. |

---

## Sequencing

```
A1 ✓  A2 ✓  A2b ✓  A2c ✓  A4 ✓  D-DQ12..15 ✓      A3, A5 open
      │
      ├─ B7 ✓                          (shipped — the sweep that was missing)
      ├─ B1 ✓ → B2 → B3 → B4 → B5 → B6 (previews; B5 adds BaseModal to the design system)
      ├─ B8 → B9                        (after B2 exists; B8 is a no-op until documents exist)
      │
      ├─ C1 → C2 → C3 → C4 → C5 → C6    (independent of B; C2 gates C3; C6 after C5)
      │
      ├─ D1 → D2 → D3 → D4 → D5         (after C5, which touches CompliancePage)
      ├─ D6, D7, D8                     (D6 gates E4; D8 gates E7's medical write)
      │
      ├─ G-1 → G-2 → G-3 → G-4          (before real drug-test rows exist — today there are zero)
      │
      └─ A6 → D6 → A5 → E0 → E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8 → E9
                                        F1 → F2  (last; nothing depends on it)
```

**Three hard orderings, all about money, law or safety:**

1. **A6 lands before E4.** 81 of 248 "active" drivers are EFS fuel-card name stubs. Enrolling
   them is a per-driver monthly charge for people who do not work here, 46 of whom provably left.
2. **E0 before everything else in E.** The vocabulary is what makes contract/behaviour/view a
   compile-checked triple instead of three files that agree by luck. EFS added its types before any
   capability consumed them, for the same reason.
3. **Phase G before the first real drug-test row.** Production holds zero restricted records today
   (A2); restricting access before content exists is a code change, after it is an incident report.

**Ship order, revised by A2b/A2c and the 2026-08-19 decisions:** **D6 first** — a one-sync field map,
and the only thing between an empty product and Phase E filling it. Then A6 (the stub fix), then G-1..4
(cheap now, expensive later), then E0–E7 with D8's catalogue corrections landing alongside E7. Then
B2–B6 (previews) and C1–C6 (alerts), which make a populated surface good and have nothing to act on
until the files have content. B7 and B1 have shipped.

## Definition of done, per phase

| Phase | Gate |
|---|---|
| A | ✓ vendor collection committed and analysed; baseline measured; A2b/A2c answered; D-DQ9..15 recorded. Open: A3 (HEIC probe), A5 (recon script), A6 (stub fix — approved, unbuilt) |
| B | `pnpm test` green; `pnpm lint:filesize && pnpm lint:funcsize && pnpm --filter web lint:tokens` green; orphan count from A2 → 0 |
| C | Two consecutive scheduler runs emit each alert once and at most one email; digest email renders the DQ block; a 60-day item is present at the 91-day horizon and absent at 30 (C2's assertion); office inbox shows C3's rows (C6) |
| D | `/compliance/:id` redirects; every §8 path in the design contract resolves; no status literal outside `badges.ts`; §172.704(d) fields captured end-to-end (D7); a CDL driver's file demands no registry note and accepts an MVR as the medical document, a non-CDL driver's still demands both (D8) |
| E | Deleting any one artifact of any capability turns E8 red; an over-budget or step-up-less MVR order is refused with no vendor call; an accepted order settles `sent`, not `succeeded`; a replayed idempotency key issues no second vendor call; a half-applied sequence settles `partial` with its `step_index`; a 200-with-error-code surfaces as an error; a wrong-signature webhook has no side effect; no `identity_source='efs'` driver is ever enrolled (A6) |
| F | Purgeable report returns for a terminated driver; `RETENTION_FORBIDDEN` unchanged |
| G | A dispatcher sees restricted items' state and no evidence, in RLS (direct read), API (route test) and UI (component test); the default binder carries no restricted page; `includeRestricted` is ledgered |
