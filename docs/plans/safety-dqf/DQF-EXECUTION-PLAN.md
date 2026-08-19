# DQF execution plan — documents, previews, alerts, SambaSafety, storage economics

**Date:** 2026-08-18 · **Supersedes nothing** — `DQF-PLAN.md` stays the architecture record; this is the
build order. Every claim below was read out of the codebase on the date above and carries its
`file:line`. Where a fact could not be established from the repo or from a public source, the plan does
not guess: acquiring the fact is itself a numbered step in Phase A.

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
| G23 | Next free migration number is **0204** | `ls supabase/migrations \| tail -1` → `0203` | Numbers assigned per step, in order. |
| G24 | `DESIGN-SYSTEM-CONTRACT.md §8` cites `DqFilePanel.vue` (deleted) and `CompliancePage.vue (332 ln)` (now 177) | contract `:577-606` vs. repo | The contract's anti-pattern section is stale. → Step D5. |
| G25 | `developer.sambasafety.com` is **public** and is a **published Postman collection**, not an OpenAPI site. 108 requests; hosts `api-demo.sambasafety.io` / `api.sambasafety.io`; OAuth2 client-credentials + `X-Api-Key`; webhooks signed with `X-SambaSafety-Signature`; reports negotiable as `+pdf` / `+json` | collection committed at `docs/vendor/sambasafety-postman-collection.json`, analysed in `SAMBA-RECON.md` | Phase E can be written against a real definition. **Open:** the signature algorithm and signing secret — E5 is blocked on it. |
| G26 | Every one of the 13 webhook event docs specifies `Authorization: Basic [encoded Client ID & Client Secret] (Optional)` on the callback | collection, Webhooks/Events (13/13) | **The callback is authenticable with credentials we already hold**, independent of the undocumented signature. E5 is not blocked. |
| G27 | `POST /organization/v1/groups/:groupId/people` accepts **`customPersonId`** | collection, Create a Person | Our `drivers.id` goes there. Identity mapping needs **no join table** — Samba stores our key. |
| G28 | The `qorta.motorvehiclereport` event carries `result`, `reason` (e.g. `ON DEMAND`), `mvrId`, `personId` and links to report/order/license | collection, webhook example | Continuous monitoring **pushes** us MVRs. We never poll, and we learn *why* an MVR was produced. |
| G29 | Collection completeness, measured: 108 requests, **107** with typed parameter descriptions, **108** with response examples (avg 7 KB), 54 with request bodies | script over the committed collection | Sufficient to write the client against. Gaps are commercial, not technical — see A5. |

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

### A2 · Baseline the storage bill
Run against production (read-only, per the established `supabase db query --linked` path):
count and `sum(bytes)` of `documents` grouped by `content_type` and `variant`; and `listAllObjects(admin, 'compliance-docs')`
count via a scratch script. Record both numbers plus the delta (objects with no row = the G10 leak).
**Done when:** `SAMBA-RECON.md`-style note `docs/plans/safety-dqf/STORAGE-BASELINE.md` states: rows, bytes,
objects, orphan count, and the projected 12-month bytes at current upload rate.

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

---

## Phase B — Documents: previews and storage economics *(the priority)*

### B1 · `packages/shared/src/documentDerivatives.ts` — the pure spec
Export `DERIVATIVE_SPECS` and `DERIVATIVE_VERSION`:
- `thumb`: long edge **320 px**, WebP **q65**, stripped metadata — the file-table cell.
- `normalized`: long edge **2000 px**, WebP **q82**, EXIF auto-orient only — the on-screen viewer.
No `.normalise()`, no `.median()`: G7's ruleset is tuned for a vision model, and altering the luminance of
a scanned medical card before a human reads it is a legibility change to evidence.
Plus `shouldDerive(contentType)` → true only for `image/*`; PDFs are handled by A4's decision.
**Files:** new file (~60 ln) + `documentDerivatives.test.ts`; barrel export in `packages/shared/src/index.ts`.
**Done when:** `pnpm --filter @fuelguard/shared test` passes with ≥ 8 new assertions, including that the
version string changes if any spec value changes.

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

### B7 · Close the orphan leak (G10) — migration **0204** not required; scheduler only
Register `compliance-docs` in the reconcile scheduler alongside `hazmat`
(`hazmatStorageReconcileScheduler.ts:27` becomes a two-entry list; rename the file to
`storageReconcileScheduler.ts` since it is no longer hazmat-specific). Same 24-hour grace. Orphan **rows**
stay flagged, never deleted (`storageReconcile.ts:20-24`).
**Done when:** the scheduler test asserts both buckets are swept, and A2's orphan count drops on the next run.

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

### C1 · Categories
Add to `NOTIFICATION_CATEGORIES` (G13): `dq_expiring`, `dq_expired`, `dq_missing`, plus the two
externally-sourced ones Phase E emits — `dq_license_status` (a licence was suspended, downgraded or
reinstated) and `dq_mvr_received` (monitoring produced a new MVR, with its `reason`). Add labels in
`NOTIFICATION_CATEGORY_LABELS`. Leave them **mutable** (not in `NON_MUTABLE_CATEGORIES`) — a driver who has
already been told twice may silence it; the office copy is a separate emission.
**Done when:** `notificationsContract.test.ts` (which iterates every category, `:127`) passes unchanged.

### C2 · `packages/shared/src/dqAlerts.ts` — the pure schedule
`planDqAlerts(rows: DriverOverviewRow[], today, alreadySentKeys: Set<string>): DqAlert[]`.
Thresholds **90 / 60 / 30 / 14 / 0 / overdue-weekly**. Each alert carries a `dedupeKey` of
`dq:${driverId}:${itemKey}:${threshold}` so crossing 60 days emits once, ever, and a restart emits nothing.
Consumes `DqAttentionItem` from `dqFile.ts` — **the same ranking the UI shows** (G19).
**Done when:** ≥ 20 assertions, including: an item at exactly 60 days emits, at 59 does not re-emit the 60
key, an overdue item emits weekly not daily, and a driver with `status='terminated'` emits nothing.

### C3 · `apps/api/src/services/dqAlertScheduler.ts`
Copy `digestScheduler.ts` exactly (G16): `DQ_ALERTS_ENABLED` env flag, 6-hour interval, per-org guard.
For each org: `getComplianceOverview` → `planDqAlerts` → for each alert, `notify()` to every membership in
`rolesThatManage("fleet")` (G14 handles mutes/quiet-hours/dedupe), and — where the driver has a login —
`notify()` the driver for their own items only.
Register in `schedulers.ts`.
**Done when:** a test with a stubbed admin client proves two consecutive runs produce one `notify()` call per
alert, and that `DQ_ALERTS_ENABLED=false` produces none.

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

### D5 · Refresh the design contract
`DESIGN-SYSTEM-CONTRACT.md §8.1` documents a deleted file and §8.2 a file that has since halved (G24).
Rewrite both entries against the current tree, and add `DocumentPreview.vue` to §1.2 as the sanctioned
document viewer so the next person does not build a second one.
**Done when:** every path in §8 resolves.

---

## Phase E — SambaSafety *(gated on A1; nothing here is written before the spec is in the repo)*

### E1 · Credentials, in the table that already exists
`org_integrations` with `provider='sambasafety'` (G17): secrets in the row, non-secret settings in `config`
(account id, demo/production, monitored-driver quota). Service-role only — it already has no client policies.
**Migration:** none. **Done when:** a scratch script reads and writes the row through the admin client only.

### E2 · `apps/api/src/services/samba/client.ts`
Written against `docs/vendor/sambasafety-postman-collection.json`, never against prose. Concretely:
`POST /oauth2/v1/token` with Basic(clientId:clientSecret) + `X-Api-Key`, `grant_type=client_credentials`,
`scope=API`; cache the token for `expires_in` minus a margin; send `Authorization: Bearer` **and**
`X-Api-Key` on every call; 429/5xx retry with jitter; persist every response body verbatim before parsing.
**The non-obvious guard:** SambaSafety returns **application errors with HTTP 200** (`SAMBA-RECON.md` §6).
A client that branches on status alone will file a failed MVR order as a success — so the response
envelope is checked for an error `code` on every 200.
**Done when:** a fixture test round-trips one MVR response, and a second fixture proves a `200` carrying
`{"code":"B02"}` is surfaced as an error, not a success.

### E3 · Enrollment sync
`services/samba/enrollmentSync.ts`: our `drivers` (status `active`/`on_leave`, matching `complianceOverview.ts:95`)
↔ Samba monitored drivers, joined on **`customPersonId` = our `drivers.id`** (G27) — no mapping table.
Enrol on hire (`PUT /monitoring/v1/licenseenrollments/:licenseId` `{enrollmentType:'enrolled'}`), unenrol on termination. **Unenrolment is the cost control** — a
monitored driver bills monthly whether or not they still work here.
**Done when:** a matrix-style test proves a terminated driver is unenrolled exactly once and never re-enrolled.

### E4 · MVR ingest → the tables we already have (G18)
**Order the report twice, in two media types:** `Accept: application/vnd.sambasafety.platform.mvr+pdf`
for the artifact an auditor expects, and `+json` for the fields that populate `qualification_records`.
The PDF files into `documents` as `content_type='application/pdf'` — no rasteriser, no conversion.
An MVR arrives → store the report bytes as a `documents` row (`kind='mvr'`, the HTML/PDF the vendor returns
per G25) → insert a `qualification_records` row (`kind='mvr'` or `'annual_mvr_review'`) citing that document
id. Both writes audited. **Zero schema change.**
**Done when:** ingesting a fixture produces exactly one document row and one record row, and re-ingesting the
same report id produces neither.

### E5 · Webhooks — authenticated by Basic, hardened by signature later
`POST /api/integrations/samba/webhook`, unauthenticated by session but verified against
`X-SambaSafety-Signature`, replay-protected by `eventId`. Rejects before parsing. Enqueues a job; never
processes inline. The payload is **HATEOAS, not data** — `{eventId, data:{orderId, links:[{rel,href}]}}` —
so the handler follows `links[].href` to fetch the report and never treats the event body as the record.
**Authentication (G26):** all 13 event docs specify `Authorization: Basic base64(clientId:clientSecret)`
on the callback — credentials we already hold. Verify it with a **constant-time compare**, reject before
parsing, and treat a missing header as a rejection (the vendor marks it "optional"; we do not).
`X-SambaSafety-Signature` is verified **in addition** once the vendor states the algorithm — a strictly
stronger check added later, not a precondition. Subscriptions: `POST|GET|PUT|DELETE /reports/v1/subscriptions`.
**Done when:** a test proves a body with a wrong signature is rejected with no side effect, and a replayed
event id is a no-op.

### E6 · Surface it
An `Integrations` card on `OrgSettingsPage.vue` showing connection state and `last_synced_at`; on the driver's
Qualification section, MVR rows show a *Source: SambaSafety* marker so a human-entered MVR and a pulled one
are never confused.
**Done when:** the marker renders from data, not from a heuristic on the record's shape.

---

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

## Sequencing

```
A1 A2 A3 A4  ──────────────────────────────────────────►  (A1 gates E only)
      │
      ├─ B1 → B2 → B3 → B4 → B5 → B6   (previews; the visible win)
      ├─ B7                            (independent; ship it first — it stops a live leak)
      ├─ B8 → B9                       (after B2 exists)
      │
      ├─ C1 → C2 → C3 → C4 → C5        (independent of B; can run in parallel)
      │
      ├─ D1 → D2 → D3 → D4 → D5        (after C5, which touches CompliancePage)
      │
      └─ E1 → E2 → E3 → E4 → E5 → E6   (after A1)
                                        F1 → F2  (last; nothing depends on it)
```

**Ship order if only one thing ships:** B7 (stops paying for orphans), then B1–B6 (previews), then C1–C3
(alerts). Those three are the entire difference between the filing cabinet we have and what the market sells.

## Definition of done, per phase

| Phase | Gate |
|---|---|
| A | `docs/vendor/sambasafety-openapi.json` exists and parses; `STORAGE-BASELINE.md` has four numbers; A4 recorded as D-DQ9/D-DQ10 |
| B | `pnpm test` green; `pnpm lint:filesize && pnpm lint:funcsize && pnpm --filter web lint:tokens` green; orphan count from A2 → 0 |
| C | Two consecutive scheduler runs emit each alert once; digest email renders the DQ block |
| D | `/compliance/:id` redirects; every §8 path in the design contract resolves; no status literal outside `badges.ts` |
| E | Fixture MVR ingests idempotently; a 200-with-error-code is surfaced as an error; a wrong-signature webhook has no side effect |
| F | Purgeable report returns for a terminated driver; `RETENTION_FORBIDDEN` unchanged |
