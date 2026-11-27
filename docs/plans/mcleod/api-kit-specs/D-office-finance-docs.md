# Spec D — MK4 documents, MK5 office writes, MK2 finance reads, MK6 ETA + home time

**Status:** build spec, 2026-11-19, written read-only against `FG-mcleod-api` at `6a70d36a2`
(`claude/mcleod-api-kit-build-plan` = main + `MCLEOD-API-SURFACE-2026-11-19.md`). Phases are the ones in
`docs/plans/mcleod/MCLEOD-API-KIT-PLAN.md` §5. Operations are the ones in
`docs/plans/mcleod/MCLEOD-API-SURFACE-2026-11-19.md` (read from a hosted McLeod customer's `/ws/docs`, not
ours). Every operation is re-read on OUR `https://<our-mcleod-host>/ws/docs/` at MK0; where ours could
differ, the MK0 check and the build for each outcome are written next to the step. No step below waits
on an unwritten decision: each fork is closed by an MK0 observation with both branches built.

## 0. What this spec depends on, and the names it uses

### 0.1 The write-request pipeline (ruled; specified in the pipeline spec)

This spec ADDS kinds to it and does not redefine it. The interface relied on, and nothing more:

| Element | Used as |
|---|---|
| Table `mcleod_write_requests` (the pipeline spec's name wins if it differs; every reference below is to that one table) | one row per intent; `id uuid` = the client action id (or a deterministic UUIDv5 when the server originates the intent, §0.3) |
| `kind text` | one of the kinds this spec registers: `image_upload`, `driver_create`, `driver_update`, `tractor_update`, `trailer_update`, `stop_eta_update` and `home_time_update` (MK6, conditional) |
| `state` | `queued → sent → confirmed \| refused \| conflict` |
| `target jsonb` | the McLeod row addressed: `{company_id, row_type, row_id}` |
| `payload jsonb` | the body to send (never SSN, §MK5.1) |
| `expect jsonb` | the read-before-write precondition: the field values the agent must read on the McLeod row immediately before the write; any difference ⇒ `conflict`, never a write |
| `response jsonb`, `refusal text`, `confirmed_at` | what McLeod answered; the reason in plain words |
| per-kind enable flag | `mcleod_write_kinds_enabled(org_id, kind, enabled_at, enabled_by)` or the pipeline spec's equivalent; every kind here ships **disabled**, and is enabled only after its MK0/test-company proof (D-MK3) |
| On-prem agent | pulls `queued` rows over its outbound HTTPS, reads the target row, compares `expect`, calls `/ws`, posts the result back |

A kind's **domain row** (what 360 meant, why, who) is always written first and never depends on McLeod
(Q-MK6). The write request points at it.

### 0.2 Migration numbering and the deploy window

`ls supabase/migrations | tail -1` was `0636_toll_plazas_and_observations.sql` on 2026-11-19. Migrations
below are named **M-D1 … M-D9** in order; each takes the next free number at build time
(`lint:migrations`, `check-migration-ordering.mjs`: above main's newest, never a gap). Per
`docs/MIGRATION-DISCIPLINE.md` §the-deploy-window and `lint:migration-ordering`: **a column and its first
reader ship in two merges**; new tables are exempt; a function body that reads a column it adds in the
same migration is safe (both are database-side). Every new table: `enable row level security`, zero
client policies (service-role only) unless stated, seedable by `rls.test.mjs`.

### 0.3 Deterministic ids for server-originated intents

When an intent is born on the server (a stop completed, a hire step finished) there is no phone outbox
id. The request id is `uuidv5(MCLEOD_WRITE_NS, "<kind>/<domain-row-id>/<content-key>")`, with
`MCLEOD_WRITE_NS` one constant in `packages/shared/src/mcleodWriteContract.ts` (the pipeline spec's
contract file; added there if absent). A replayed trigger therefore inserts `on conflict (id) do
nothing` and can never queue the same write twice. (`uuid` is already an api dependency — confirm with
`grep '"uuid"' apps/api/package.json` at build; if absent, use `node:crypto` SHA-1 per RFC 4122 §4.3 in a
12-line helper with its own unit test against the RFC's published vector.)

---

## MK4 — Documents into McLeod Imaging (DocumentPower)

### MK4.0 What exists today (measured in the code)

- **Driver stop photos**: `load_stop_photos` (`supabase/migrations/0085_driver_loads.sql:213-224`) — `id`
  is the phone's UUID, `slot`, `storage_path`, `captured_at`, `uploaded_at`. **No sha256, no mime, no
  size, no review state.** Bucket `load-photos`, 15 MB (`0611`). The phone uploads straight to Storage
  (`apps/driver/src/data/handlers.ts:76-86`, `upsert:false`, "already exists" ignored) and the rows are
  inserted inside `driver_complete_stop` (`0141_driver_load_rpc_contract.sql:349-361`, `on conflict (id)
  do nothing`) — so **every photo of a stop is known, in one transaction, the moment the stop completes**.
  Slots: `PHOTO_SLOTS` (`packages/shared/src/loadsContract.ts:42-52`). McLeod stops get
  `required_photos` `['trailer','bol']` at pickup, `['bol']` at dropoff (`apps/api/src/modules/loads/mirrorLoads.ts:120`).
- **Office load detail** signs and displays them only (`apps/api/src/modules/loads/dispatchLoads/detail.ts:31-79`).
- **Revised RC**: `lumper_case_files` (`0601:19-40`), `kind in ('revised_rc')`, sha256 + mime + size,
  append-only guard, bucket `lumper-files` 25 MB, PDF/JPEG/PNG.
- **`documents`** (`0146`) already allows `subject_type = 'load'` but no kind for a load paper
  (`0631`'s list has no `bol`/`pod`/`rate_confirmation`/`lumper_receipt`).
- **Document reader** (`0448`): `document_sources` sha256-unique per org; not keyed to loads.
- **Hazmat**: `hazmat_documents` (`0092:68-81`) has sha256; hazmat papers are not billing papers and
  are **not** sent (D-MK4-2).
- **The McLeod key**: a McLeod load is one movement with exactly one order (0 exceptions measured
  2026-09-24, `0364:81-85`). `loads.external_id = "<company_id>:<movement_id>"`, `loads.ref = orders.id`
  (`packages/shared/src/mcleodLoadProjection.ts:240-241`). There is no separate order-id column; `ref` is
  it for `source='tms'` loads. McLeod stop ids live in `mcleod_dispatch_stops.stop_id`
  (`0364`), joinable to `load_stops` by (company, movement, `movement_sequence` = `load_stops.seq`).
- **Imaging index** (Q-LRC10, `LUMPER-REVISED-RC-PLAN.md:287-405`): `dta.dbo.bolimgh/bolimgd/imapcats/media`;
  LME billing reads `bolimgd where bimd_load_no = ? and bimd_imgcat = 1`. Route (b) grant = Part 6 of
  `tools/mcleod-agent/review/SILVICOM-GRANTS.sql:194-214`, **not yet run**.

### MK4.1 Decisions

**D-MK4-1 — Documents attach to the ORDER.** rowType = the order row type, rowId = `loads.ref`
(`orders.id`). Reasons: (1) billing finds images by order — LME's own billing statement keys
`bolimgd.bimd_load_no` and invoices are per order; (2) movement:order is 1:1 here (measured), so
nothing is lost by choosing the order; (3) the revised RC already lives on the order (D-LRC16); (4) a
stop-level image would be invisible to the billing query. The stop is carried in OUR row (which stop,
which slot), not in McLeod's.

*MK0 check (exact):* for one delivered order `O` that has a BOL in imaging,
`GET /images/{rt}/{O}/documentTypes` for `rt ∈ {O, orders, order}` (row-type spelling is not on the
public page) and `GET /images/{rt}/{O}`. Record which spelling answers 200 with a non-empty category
list. Outcomes:
- (i) an order spelling answers and the list holds the categories billing uses → build as written,
  `MCLEOD_IMAGE_ROW_TYPE` = that spelling, stored in `mcleod_image_categories.row_type` (never a code
  constant — it is read from the stored rows).
- (ii) only a movement spelling answers (`M`/`movement`) → rowId = the movement id from
  `loads.external_id`; everything else unchanged (one function, `imageTargetFor(load)`, owns the choice and
  reads the stored row type; its test covers both).
- (iii) neither answers for an order that visibly has images → `image_upload` stays disabled; record
  B-MK11 "DocumentPower not exposed on our `/ws`" with McLeod's answer; the clerk packet (BOL plan Layer
  2 (b)) remains the delivery. No other build changes.

*And with route (b) once Part 6 runs:* confirm `bimd_load_no = orders.id` (Q-LRC10 measurement (2),
share of 2026's LUM orders that join). If it is the movement id instead, outcome (ii) applies even if
an order spelling answered — billing's key wins.

**D-MK4-2 — What is sent, as which of our kinds.** One shared constant,
`MCLEOD_IMAGE_KINDS = ['bol','pod','lumper_receipt','revised_rc'] as const` in
`packages/shared/src/mcleodImagesContract.ts`:

| Our kind | Produced by | Sent when |
|---|---|---|
| `bol` | `load_stop_photos.slot='bol'` on a `pickup` stop of a `source='tms'` load | the stop completes (D-MK4-4) |
| `pod` | `load_stop_photos.slot='bol'` on a `dropoff` stop (the signed delivery copy, D-EXR10) | the stop completes |
| `lumper_receipt` | `lumper_case_files.kind='lumper_receipt'` (widened by M-D3) | the office files it on the case |
| `revised_rc` | `lumper_case_files.kind='revised_rc'` with `source='upload'` | the office files it, **and** read-before-write finds no RC already in McLeod (D-MK4-6) |

Not sent, by decision: `trailer`, `seal`, `damage`, `load_secured`, `other` slots (proof-of-work photos,
not billing papers — D-EXR10 keeps them as photos); hazmat papers (`hazmat_documents`: shipping papers
stay in 360's §172 evidence, billing never asked for them); any file whose source is McLeod itself
(`lumper_case_files.source='mcleod'`, added by the LRC build) — **never echoed back**; `documents` rows
(driver/equipment compliance files are not billing papers).

**D-MK4-3 — The McLeod category is chosen from McLeod's own list, stored, not hard-coded.**
Two tables (M-D1):

```sql
-- McLeod's categories as /ws reports them, per company and row type. Written by the agent only.
create table public.mcleod_image_categories (
  org_id            uuid not null references public.organizations(id) on delete cascade,
  company_id        text not null,                    -- AnywhereCompanyID (TMS..TMS4)
  row_type          text not null,                    -- the spelling MK0 found (D-MK4-1)
  document_type_id  text not null,                    -- McLeod's id, verbatim (imapcats.icat_catid when equal)
  description       text not null,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  gone_at           timestamptz,                      -- set when a refresh no longer lists it
  primary key (org_id, company_id, row_type, document_type_id)
);
alter table public.mcleod_image_categories enable row level security;

-- Which McLeod category each of our kinds goes to. Set by a person, from the list above.
create table public.mcleod_image_kind_map (
  org_id            uuid not null references public.organizations(id) on delete cascade,
  company_id        text not null,
  kind              text not null check (kind in ('bol','pod','lumper_receipt','revised_rc')),
  row_type          text not null,
  document_type_id  text not null,
  set_by            uuid not null,
  set_at            timestamptz not null default now(),
  primary key (org_id, company_id, kind),
  foreign key (org_id, company_id, row_type, document_type_id)
    references public.mcleod_image_categories (org_id, company_id, row_type, document_type_id)
);
alter table public.mcleod_image_kind_map enable row level security;
-- History of the mapping: an audit row per change (§MK4.6), not a second table.
```

- The kind list is a CHECK mirrored by `MCLEOD_IMAGE_KINDS`; `mcleod-image-kinds.test.mjs` (new PGlite
  matrix) holds them equal, the `unit-file-kinds.test.mjs` pattern.
- Refresh: the agent calls `GET /images/{row_type}/{rowId}/documentTypes` once a day per company, for one
  recent order of that company (the categories are "allowed for that row"; one order per company is
  enough unless MK0 shows the list varies by order — MK0 check: compare the list for 5 orders of
  different customers per company; if they differ, refresh per order at send time and store per
  (company, document_type_id) the union, and `image_upload` validates the mapped id against the
  per-order list in read-before-write, §MK4.3 agent step 1). It POSTs the list to
  `POST /api/tms/mcleod/image-categories` (connector-token route, same auth as `tmsIngest.ts`).
- **The map is required before anything is sent**: a send whose (company, kind) has no map row is not
  queued; the candidate sweep counts it as `unmapped` on the McLeod settings card (§MK4.7) — the gap is
  visible, never silently dropped.
- **Cross-check with imaging's own names**: when Part 6 runs, `imapcats` (`icat_catid`, `icat_catdesc`)
  is read once and compared to `/ws`'s list. Equal ids ⇒ nothing to do. Different ids ⇒ `/ws`'s id is the
  one sent (it is the API's contract); imapcats is shown beside it on the card so the admin maps by the
  name billing knows. Either way the admin maps `bol`, `pod`, `lumper_receipt`, `revised_rc` once per
  company. The revised RC maps to the ordinary "Rate Confirmation" category — Imaging has no revised
  category (owner, 2026-11-18).

**D-MK4-4 — Trigger: the stop's completion, not office review.** Reasons: (1) it is what McLeod's
own capture does today (images go straight to billing, BOL plan §0.2) — waiting on a person adds a step
to a filing that has none, and late paper delays the invoice; (2) the stop's photo set is closed by
`driver_complete_stop` in one transaction, so completion is the one moment the set is known; (3)
D-EXR12 (verification, never truth) is about **fields read from** the paper — the BOL reader's
readiness state stays 360's and is not sent; the image itself is the evidence billing already looks at;
(4) a wrong photo in the `bol` slot reaches billing exactly as a wrong McLeod-capture scan does today,
and the office can see it and send again (§MK4.7), so review-first buys nothing that
billing's existing check does not already give. Office-filed papers (`lumper_receipt`, `revised_rc`) are
already reviewed by the filer — their trigger is the filing.

**D-MK4-5 — One PDF per (stop, kind), pages in capture order.** A BOL photographed as three pages is
one document to billing. The API worker assembles the JPEGs (`load-photos`) into one PDF with `pdf-lib`
(already `apps/api/package.json:54`), one page per photo, image embedded unscaled, `captured_at` order
then `id` as tie-break. Office files go as uploaded (PDF/JPEG/PNG). *MK0 check:* POST a 2-page PDF to the
test company; `GET /images/{id}` returns it with 2 pages ⇒ as written. If PDF is refused (415/400 naming
the type): send TIFF instead — one single-page TIFF per photo via `sharp(...).tiff()` (`sharp` is a dependency,
`apps/api/package.json:59`; no multi-page TIFF is assembled, so no library is added) ⇒ then
**one request per page**, pages ordered by a `page` field in `mcleod_image_sends.page_no`; the unique key
includes `page_no`. Both branches are built behind `IMAGE_UPLOAD_FORMAT` read from `mcleod_api_capabilities`
(the MK0 table, pipeline spec) so the choice is data, not a deploy.

**D-MK4-6 — Dedupe.**
- **Our own repeats** (replays, retries, two clicks): `mcleod_image_sends` unique on
  `(org_id, company_id, row_type, row_id, document_type_id, sha256)` where `sha256` is of **the exact bytes
  sent**. A second identical send cannot be queued. The request id is `uuidv5("image_upload/<source
  key>/<sha256>")` (§0.3), so the trigger's replay is also a no-op.
- **sha256 added where missing**: `load_stop_photos.sha256` (M-D2, nullable for old rows,
  `check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$')`). The phone computes it before upload
  (`expo-crypto` `digest` over the file bytes — check `apps/driver/package.json` for `expo-crypto`; add it
  if absent, it is in the Expo SDK, no native fingerprint change beyond the module, which the OTA
  fingerprint gate will catch) and sends it in `p_photos[].sha256`; `driver_complete_stop` stores it when
  well-formed (M-D2 replaces the function; an old app sends no key and stores null). The API worker
  **recomputes** the hash of each photo it downloads; a mismatch with a stored hash refuses the send with
  `refusal = 'photo bytes changed since capture'` and an office exception — integrity, the §390.32
  reason `documents.sha256` carries.
- **McLeod already has it** (revised RC only — the one case with a precise rule): read-before-write lists
  `GET /images/{rt}/{order}`; an image of the mapped RC category scanned on/after the case's lumper date
  (D-LRC16) ⇒ the request ends `confirmed` with `response.already_present = <that image id>` and no
  POST. For `bol`/`pod`, a McLeod-capture image beside ours cannot be told apart from a second page or a
  second stop's paper, so **no skip heuristic**: a duplicate image is visible and harmless to billing; a
  missing one costs an invoice. The double-capture rate is measured, not guessed: the daily check
  (§MK4.9) counts orders where both a 360 send and a non-integration-user image of the same category exist.

### MK4.2 Schema (migrations)

- **M-D1** `mcleod_image_categories`, `mcleod_image_kind_map` (above), and `mcleod_image_sends`:

```sql
create table public.mcleod_image_sends (
  id                uuid primary key,                 -- = mcleod_write_requests.id (same uuidv5)
  org_id            uuid not null references public.organizations(id) on delete cascade,
  kind              text not null check (kind in ('bol','pod','lumper_receipt','revised_rc')),
  -- No FK to loads' tables: a migration above 0260 may touch ONE module's tables (lint:table-modules),
  -- and these are loads-owned. Plain ids, the documents table's polymorphic shape (0146).
  load_id           uuid,                             -- bol/pod
  stop_id           uuid,
  lumper_case_id    uuid references public.lumper_cases(id) on delete set null,   -- mcleod-owned, same module
  source_table      text not null check (source_table in ('load_stop_photos','lumper_case_files')),
  source_ids        uuid[] not null check (cardinality(source_ids) between 1 and 40),
  company_id        text not null,
  row_type          text not null,
  row_id            text not null,
  document_type_id  text not null,
  page_no           int  not null default 1 check (page_no >= 1),            -- >1 only on the TIFF branch
  file_bucket       text not null default 'mcleod-outbound',
  file_path         text not null unique,
  mime              text not null check (mime in ('application/pdf','image/tiff','image/jpeg','image/png')),
  byte_size         bigint not null check (byte_size between 1 and 25 * 1024 * 1024),
  sha256            text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mcleod_image_id   text,                             -- from the POST response or the read-back
  created_at        timestamptz not null default now(),
  constraint uq_mcleod_image_sends_bytes
    unique (org_id, company_id, row_type, row_id, document_type_id, sha256, page_no)
);
alter table public.mcleod_image_sends enable row level security;
-- Append-only: a guard trigger (0601's shape) refuses UPDATE of anything but mcleod_image_id
-- (null → value, once) and refuses DELETE unless the organisation is going.
```

  Bucket `mcleod-outbound` (private, 25 MB, no client policy; the API signs a 10-minute URL for the
  agent). Storage path `org/<org>/<kind>/<send id>.<ext>`. Added to `storageReconcile.ts` and to the
  retention policy in `apps/api/src/modules/org/dataRetentionPolicy.ts` with the SAME 1,095 days as
  `load_stop_photos` (a derived copy; the source photos are the evidence). `mcleod_image_sends` goes in
  `RETENTION_FORBIDDEN` (`apps/api/src/modules/org/dataRetentionForbidden.ts`)
  (it is the record that a paper was delivered to billing — an evidence table).
- **M-D2** `load_stop_photos.sha256` + `driver_complete_stop` stores `elem->>'sha256'` when it matches the
  format (otherwise null — a malformed hash is not a reason to fail a driver's stop). Same migration is
  safe: the function is its own reader.
- **M-D3** `lumper_case_files.kind` check widens to `('revised_rc','lumper_receipt')`; `source`
  (`upload|mcleod`) and `mcleod_image_id` come from the LRC build (LUMPER-REVISED-RC-PLAN "What changes in
  360"); if that build has not merged when MK4 starts, M-D3 adds `source text not null default 'upload'
  check (source in ('upload','mcleod'))` itself and the LRC build drops that line from its own migration
  (one owner of each column; whichever merges first owns it, the other is reduced in review).
  Widened one merge **before** the upload UI that writes `lumper_receipt` (deploy window).

### MK4.3 Code — files and shapes

`packages/shared/src/mcleodImagesContract.ts` (new): `MCLEOD_IMAGE_KINDS`, `imageKindForStopPhoto(stopKind,
slot): McleodImageKind | null` (`pickup`+`bol` → `bol`, `dropoff`+`bol` → `pod`, else null — the ONE
place the slot→kind rule lives), zod schemas for the category-list POST and for the agent's result.

`apps/api/src/modules/mcleod/images/` (new, ≤ 450 lines per file):
- `candidates.ts` — `findImageCandidates(admin, orgId)`. The stop half is asked of the `loads` module,
  never read here (D-ARC3; `lint:table-access`/`lint:boundaries`): `loads` exports
  `completedStopPapers(admin, orgId, sinceIso)` from `apps/api/src/modules/loads/index.ts` (new file
  `loads/stopPapers.ts`) returning `{load_id, load_ref, load_external_id, stop_id, stop_kind, photos:[{id,
  storage_path, sha256, captured_at}]}` for completed stops (`completed_at` within 14 days) of
  `source='tms'` loads that have `bol`-slot photos — two org-filtered queries (stops, then photos
  `in(stop_id)` in chunks of 200, the `.in()` header limit). `candidates.ts` subtracts the
  `(stop_id, kind)` pairs already in `mcleod_image_sends` and adds lumper files without a send (same
  module). Both reads are asserted org-scoped (`expectOrgScoped`).
- `assemble.ts` — download photos (`load-photos`), recompute sha256 per photo, compare with stored,
  build PDF (pdf-lib), upload to `mcleod-outbound`, hash the result. Pure assembly function
  `assemblePdf(pages: Buffer[]): Promise<Buffer>` unit-tested on fixture JPEGs.
- `enqueue.ts` — inserts `mcleod_image_sends` + `mcleod_write_requests` (`kind='image_upload'`,
  `target={company_id,row_type,row_id}`, `payload={document_type_id, send_id, file_url_route:
  "/api/tms/mcleod/image-sends/<id>/file", mime, sha256, byte_size}`, `expect={category_listed: true}`)
  in ONE database call: an RPC `mcleod_enqueue_image_send(...)` in M-D1, because supabase-js cannot span a
  transaction (the `driverLoads.ts:18` lesson) and a send row without its request is a stuck send.
  `on conflict do nothing` on both.
- `scheduler` — `mcleodImageSend` in `apps/api/src/schedulers.ts`, every 2 minutes, lane = the one
  `api` (scheduler owner, `docs/WORKER-DEPLOYMENT.md`); runs only when the kind is enabled for the org.
  A sweep, not a hook in the completion route: a crash between the RPC and the enqueue cannot lose a
  paper, and the completion path (`driverLoads.ts:280-300`) stays McLeod-free (D-ARC3: `loads` does not
  call `mcleod`).
- `routes` (in `apps/api/src/modules/mcleod/routes/tmsImages.ts`, connector token; the office "Send
  again" and the mapping card are in `officeWrites.ts` — MK5's D-MK5-0g):
  `POST /api/tms/mcleod/image-categories` (category refresh), `GET /api/tms/mcleod/image-sends/:id/file`
  (302 to a 10-minute signed URL; 404 unless the send's request is `sent` or `queued` and belongs to the
  connector's org).

`tools/mcleod-agent/images.mjs` (new) — the agent half, run inside the pipeline's request loop for
`kind='image_upload'`:
1. `GET /images/{rt}/{row}/documentTypes` — the mapped `document_type_id` must be listed; else `refused`
   (`"McLeod no longer offers category X on this order"`).
2. `GET /images/{rt}/{row}` — snapshot of image ids (read-before-write); for `revised_rc`, the D-LRC16
   check (§MK4.1 D-MK4-6) may end it here as `confirmed/already_present`.
3. Fetch the file from the API route, verify sha256 and size against the payload (mismatch ⇒ `refused`,
   never sent).
4. `POST /images/{rt}/{row}/{document_type_id}` with the bytes. The request body shape (raw body with
   `Content-Type` vs. `multipart/form-data`) is read on our `/ws/docs` at MK0; `POST /images/multipart/...`
   exists for the latter. MK0 check: one upload each way on the test company; the first that yields a
   retrievable image is recorded as `IMAGE_UPLOAD_ENCODING` in `mcleod_api_capabilities`; the agent
   implements both (one function each, 30 lines, tested with a stub server).
5. Result → state `sent` with `response` (status, body). **Not `confirmed` yet** — "some providers may
   stage the uploaded image and later pick it up with a batch process".
6. Confirmation poll (pipeline's `sent` re-check, every 10 minutes up to 24 hours): `GET /images/{rt}/{row}`
   shows an id not in the step-2 snapshot, of the mapped category ⇒ `confirmed`,
   `mcleod_image_sends.mcleod_image_id` set. If the POST response itself returned an image id and
   `GET /images/{id}` returns bytes, that is confirmation at once. After 24 hours unseen ⇒ `conflict`
   with `refusal = "McLeod accepted the file but it is not on the order after 24 hours"` — an office
   exception, **never re-sent automatically** (a re-send would double-file once the batch runs).
   *MK0 check:* time from POST to visible on the test company, 5 uploads; if the median is > 2 hours, the
   window becomes 72 hours and the poll interval 30 minutes (stored in `mcleod_api_capabilities`).
   With Part 6 granted, a second confirmation reads `bolimgd` for `bimd_load_no = row and bimd_scandt >=
   sent_at and bimd_user = <integration user>` — used only to explain a `conflict`, never to confirm
   (the API is the contract).

### MK4.4 Read side — revised RC (route (b) stays ruled; the switch rule)

Route (b) (Part 6 grant + imaging volume read) **stays the ruled route** and is built as
`LUMPER-REVISED-RC-PLAN.md` "What changes in 360" says. The API (`GET /images/{rt}/{order}`, `GET
/images/{id}`) is route (a). The switch is a rule, not a judgement:

**Switch rule.** `lumper.mjs` reads revised RCs through the API instead of `dta` when **all** hold:
1. MK0 shows `GET /images/{rt}/{order}` returns, per image, an id, the category id and a scan/create
   date (field names recorded in `mcleod_api_capabilities.IMAGE_LIST_FIELDS`);
2. `GET /images/{id}` returns the original file (or a PDF rendering of every page) for an RC known in
   imaging — checked page count equal to the volume file's;
3. a **14-day parallel run** on every open case's order: the set {category, scan date to the minute} from
   the API equals the set from `bolimgd` on every order, every day — a single difference resets the 14
   days and is written in the LRC progress log with the order;
4. the owner is told the result in one line (the release notes carry it — no separate approval step:
   the rule is the approval).

Then: the API is primary; the `dta` read is kept **only** as the daily silent-weeks check ("revised RC in
McLeod but not on the case" must be 0, computed from both and both must be 0), and **the imaging-volume
share access is never requested** if it has not been granted yet (the API serves the file).
If Part 6 has still **not** been run when conditions 1–2 pass: there is nothing to compare, so the API is
built as the only route with the D-LRC16/D-LRC17 rules unchanged, and Part 6 is withdrawn from the IT
request (one line in the LRC log). If conditions 1 or 2 fail: route (b) stays primary permanently
and the API is not used for reads.
Code shape: one interface in `tools/mcleod-agent/lumper.mjs`,
`readOrderImages(orderIds) → [{order_id, image_id, category_id, scanned_at, user}]`, with `fromDta` and
`fromApi` implementations; `LUMPER_IMAGE_SOURCE=dta|api|both` (both = parallel run, comparison printed
and posted as `lumper_image_source_diffs` in the `POST /api/tms/lumper` payload). Test:
`lumper.test.mjs` gains the comparison function's cases (equal; missing on one side; date skew 59 s
equal / 61 s different).

### MK4.5 BOL plan Q6 and Q9 — closed

Appended to `docs/plans/drivers-app/BOL-READING-RELIABILITY-PLAN.md` §9 progress log, and the two
questions' headings get "— CLOSED <date>, see log" (append at the end; never rewrite the rows above —
`plan-progress-log-not-table-rows`):
- **Q6 — closed: YES.** 360 writes the BOL (pickup) and the signed delivery copy (dropoff) onto the
  McLeod order through DocumentPower's licensed `/ws` upload (D-MK4-1..6). The premise of "default no"
  was the per-call price; the owners bought a fixed-price API Kit (~$750/month, 2026-11-19), so the
  marginal write is free and Layer 2's choice is (c), the licensed write, one per (stop, kind). D-EXR12
  stands unchanged: what is sent is the image; no field 360 read is written to McLeod.
- **Q9 — closed.** (i) Imaging stores its index in `dta.dbo.bolimgh/bolimgd` (+`imapcats`, `media`) and
  the files on the volume `media` names (Q-LRC10, measured 2026-11-18); readable by Part 6 or by the API
  (§MK4.4). (ii) A watched-folder/email import is no longer needed and is not pursued. (iii) The price is
  a fixed licence, not per call. Layer 1 (read what McLeod capture writes) reads through §MK4.4's route.

### MK4.6 Permissions and audit

- Mapping card: `requireSection("settings","manage")` (admin + fleet_manager per `SECTION_ACCESS`,
  `packages/shared/src/auth.ts:74-160`, org overrides respected by the same middleware). Route
  `PUT /api/mcleod/image-map/:company/:kind`. Audit: one `audit_logs` row (the existing table
  the settings routes write; same helper) `action='mcleod.image_map.set'`, before/after document type.
- Sends: no person acts — the audit is `mcleod_image_sends` + the request's state history (pipeline).
- Office "send again" on a `refused`/`conflict` send (§MK4.7): `requireSection("dispatch","manage")`;
  creates a NEW request (new uuidv5 with a `/retry-<n>` suffix in the content key) — the refused row is
  never edited; audit `action='mcleod.image_send.retry'`.
- Lumper receipt upload: the existing lumper case file route and its gate (`lumperCases.ts` uses the
  dispatch/billing gate it already has) — kind parameter added, nothing else.

### MK4.7 UI

- **Settings › Data & sync › McLeod › Document categories** (one card, `apps/web/src/features/settings/…`
  beside the existing McLeod card): per company, four rows (BOL, Delivery copy, Lumper receipt, Rate
  confirmation) each a select of the stored categories (description + imapcats name when known); a
  count "N papers waiting for a category" per row; read-only for `settings: view`.
- **Office load detail** (`detail.ts` + the load drawer): under each stop's photos, one status line per
  sent kind: "In McLeod (BOL) · 14:02" / "Sent, waiting for McLeod to file it" / "Not filed: <reason>"
  with **Send again** for `refused`/`conflict`. Read: `mcleod_image_sends` joined to the request state,
  org-filtered, in `detail.ts` (one query, `in(stop_id)`), fields added to the shared load-detail
  contract (`loadsContract.ts`) — contract first, reader second merge.
- **Lumper case**: the file row shows "In McLeod" / "Already in McLeod (filed by <user> <date>)" for
  `already_present`.
- Driver app: nothing new to see (the stop already shows its photos); `imageKindForStopPhoto` is not
  used on the phone.

### MK4.8 Tests and gates

- `packages/shared/src/mcleodImagesContract.test.ts` — slot→kind table, every `PHOTO_SLOTS` member
  answered.
- `supabase/tests/mcleod-images.test.mjs` (new matrix, RESULT line, `await db.close()`): (1) M-D2
  stores a well-formed sha and nulls a bad one, old payload with no key still completes the stop;
  (2) (moved to the API test of `completedStopPapers`: only completed tms stops with bol photos, never another org's); (3) `uq_mcleod_image_sends_bytes` refuses a second identical send;
  (4) the guard refuses UPDATE of anything but `mcleod_image_id` null→value; (5) kind check equals
  `MCLEOD_IMAGE_KINDS` (read from the built contract file, as `unit-file-kinds.test.mjs` does);
  (6) `mcleod_enqueue_image_send` writes both rows or neither.
- `apps/api/src/modules/mcleod/images/*.test.ts` — assemble (page order, sha recompute mismatch ⇒
  refusal), enqueue idempotence (two calls ⇒ one row), routes org-scoped via `supabaseRecorder`
  `expectOrgScoped`; the file route 404s for another org's send.
- `tools/mcleod-agent/images.test.mjs` — stub `/ws` server: category missing ⇒ refused; RC already
  present ⇒ confirmed/already_present, no POST; POST 200 without id then visible on poll ⇒ confirmed;
  never visible in window ⇒ conflict, no second POST; sha mismatch on fetch ⇒ refused, no POST.
- Mutation proof (memory `prove-tests-fail-by-mutating`): remove the `already_present` branch ⇒ the
  agent test must fail; drop `page_no` from the unique key ⇒ matrix (3) on the TIFF branch must fail.
- Gates: `lint:migrations`, `lint:migration-ordering` (M-D3 before the receipt UI; contract fields
  before `detail.ts` reads them), `check-rls.mjs`, `lint:upserts` (no partial upsert — the RPC inserts),
  `lint:filesize`/`lint:funcsize`, `lint:boundaries` (web feature imports), `lint:comment-claims` (any
  "proves" comment quotes a test title above), `definer-rpc-grants.test.mjs` (the two RPCs are
  service-role only). Retention: `RETENTION_FORBIDDEN` gains `mcleod_image_sends` — its test
  (`dataRetention.test.ts`) asserts it. **Table manifests** for every new table (M-D1's three): an entry in
  `scripts/table-modules.json` (module `mcleod`; `mcleod_image_categories` layer `raw`, growth `fleet`;
  `mcleod_image_kind_map` `core`, `fleet`; `mcleod_image_sends` `core`, growth `time`, budget 600 rows/day =
  2× (~210 stops/day measured for `mcleod_dispatch_stops`), retention null — RETENTION_FORBIDDEN), the
  writer pairs in `scripts/table-writers.json`, and the regenerated `supabase/schema.generated.sql` —
  `lint:table-modules`, `lint:table-writers`, `lint:table-producers` (each table has its writer in the same
  PR or a pinned waiver naming this spec), `lint:table-lifecycle`, `lint:table-access`.

### MK4.9 Rollout

1. MK0 checks above on the test company (D-MK3); `mcleod_api_capabilities` filled.
2. Admin maps the four kinds per company.
3. Enable `image_upload` for the org with only `revised_rc` + `lumper_receipt` first (office papers,
   low volume, precise dedupe) for 7 days: every send confirmed or explained.
4. Enable `bol`/`pod` (a per-kind sub-flag inside `image_upload`'s enable row: `kinds text[]`) for the
   fleet whose drivers use the 360 app (the app's release gate, KIT-PLAN §6, decides who that is).
5. Daily check, posted to the McLeod health line: sends `sent` > window (must be 0 unexplained),
   `unmapped` candidates (must be 0 after step 2), double-captured orders (measured, reported, not
   acted on — the number that tells the owner when to retire McLeod's capture app for that fleet).

---

## MK5 — Office writes: new hire, termination/reactivation, truck/trailer status, driver fields, medical/CDL

### MK5.0 Rules common to every MK5 write

**D-MK5-0a — The agent owns McLeod's spellings; the API sends neutral facts.** `tools/mcleod-agent/roster.mjs`
`MAP` is the one place McLeod column names become our names ("FuelGuard never learns a McLeod column
name", its header). The write side is its inverse in the same directory: `tools/mcleod-agent/writes/rowMap.mjs`
exports `toRowDriver(fact)`, `toRowTractor(fact)`, `toRowTrailer(fact)`. `payload` in
`mcleod_write_requests` carries **our** field names only. A test (`writes/rowMap.test.mjs`) round-trips
every writable field: `MAP.drivers(fromRow(toRowDriver(x)))` equals `x` for each field, where `fromRow`
renames RowDriver keys to the SQL aliases `queries.mjs` reads (`license_no→cdl_number`, …). So a column
mapped on one side and not the other fails a test, not a sweep.

Driver mapping (from `tools/mcleod-agent/queries.mjs:25-67` — the columns the agent already reads, so
each one is measured to exist and hold data):

| Our field (`drivers`) | McLeod `RowDriver` / `dbo.driver` column | Note |
|---|---|---|
| `first_name` | `first_name` | |
| `middle_name` | `name_mid_initial` | first letter only; McLeod's column is an initial |
| `last_name` | `name` | `name` is the SURNAME (measured, `roster.mjs:96`) |
| `cdl_number` / `cdl_state` | `license_no` / `license_state` | |
| `cdl_expires_at` | `license_date` | this carrier keeps the CDL **expiry** in `license_date` (`queries.mjs:53`); MK0 confirms `RowDriver` exposes `license_date` (not on the public page's list) — if it does not, CDL expiry is not writable and is dropped from every MK5 field list by one constant |
| `medical_card_expires_at` | `medical_cert_expire` | |
| `date_of_birth` | `birth_date` | |
| `address_line1`, `city`, `state`, `postal_code` | `address`, `city`, `state`, `zip` | |
| `email` | `name_of_spouse` | the carrier's own convention: email lives there on 164/164 active rows, `email` is empty on 1,463/1,463 (`queries.mjs:60-67`). Written where the carrier reads it. |
| `hire_date` | `hire_date` | |
| — (lifecycle) | `is_active`, `termination_date`, `reason_for_leaving`, `can_rehire` | MK5.2 only |
| `phone` | **not written** | McLeod holds no phone on any of 1,463 rows; Samsara is its writer (`rosterFields.ts:79-82`) |
| SSN | **never written** | D-MK5-1c |

**D-MK5-0b — Row update mode is measured, not assumed.** `PUT /driver/update` (TableRowService),
`PUT /tractors/update`, `PUT /trailers/update`. *MK0 check (test company):* GET the row, PUT a body of
`{id, company_id, <one field>}`, GET again and diff every field. Unchanged others ⇒
`ROW_UPDATE_MODE=partial` (send only the changed fields). Others nulled/defaulted ⇒ `full`: the agent
PUTs the row it just read with only the requested fields replaced (read-modify-write, inside one request
handling, seconds apart). Stored in `mcleod_api_capabilities`; both modes implemented
(`writes/rowUpdate.mjs`, ≤ 80 lines, stub-server tests for each).

**D-MK5-0c — Read-before-write, always.** Every MK5 request carries `expect` = the McLeod values 360
last saw for exactly the fields it changes (from the last sweep — `drivers`/`vehicles`/`trailers` columns,
or `credential_source_dates` for medical). The agent GETs the row; any expected field differing ⇒
`conflict` ("McLeod changed <field> from A to B since you looked"), no write. The office re-opens the row
(fresh sweep value) and decides again. No blind retry anywhere.

**D-MK5-0d — One writer per 360 column; reconciliation is the sweep.** An MK5 write never updates
360's copy of a McLeod-owned field directly. After `confirmed`, the agent re-reads that ONE row with the
normal roster statement (`rosterQueries('identity')` filtered by id) and posts it through the normal
ingest (`POST /api/tms/roster/drivers?mode=identity`, `/roster/vehicles`, `/roster/trailers`,
`/roster/drivers/retire` — `apps/api/src/modules/mcleod/routes/tmsIngest.ts:135+`), and drops that row's
hash from its diff state so the regular sweep cannot skip it. So 360 shows McLeod's value within a
minute of confirmation, written by the same code path as every night, and `fleetParity`/held lists see no
special case. While a request is `queued|sent`, the field shows "Asked McLeod: <value> · waiting".

**D-MK5-0e — Audit.** Every request: one `audit_logs` row via `writeAudit` (`apps/api/src/lib/audit.ts:43`)
at request time with the actor, `action = 'mcleod.<kind>.requested'`, `entity`/`entityId` = our row,
`meta = {request_id, fields, from, to}`; the pipeline's state changes are the rest of the trail (system
actor, `actorId: null`, `action = 'mcleod.write.<state>'`, written by the pipeline's result route — one
place, not per kind).

**D-MK5-0g — Every MK5 route lives in the `mcleod` module.** `scripts/check-feature-boundaries.mjs`
allows `mcleod -> roster`, `mcleod -> recruiting`, `mcleod -> evidence`, `mcleod -> loads`, `mcleod -> org`
(lines 104-151); the reverse edges would close module cycles. So the office routes are
`apps/api/src/modules/mcleod/routes/officeWrites.ts` (mounted at `/api/mcleod`), and they call the owning
module's exported service for any 360-side write — never the reverse. A 360-side act that must also reach
McLeod (the close, the termination) is therefore one browser click that makes the 360 call and then the
McLeod call, plus a **backstop list** (§MK5.1, §MK5.2) so a dropped second call is visible within 10 minutes.

**D-MK5-0f — Enable flags.** `driver_create`, `driver_update` (sub-flags `fields`, `lifecycle`,
`medical`), `tractor_update`, `trailer_update`; all shipped off; each turned on after its test-company
proof. While off, every UI below behaves exactly as today.

### MK5.1 New hire → `PUT /drivers/create`

**Re-rules D-RL5 (KIT-PLAN Q-MK11).** Recorded as **D-RL5a** in `ROSTER-LIFECYCLE-PLAN.md` §5 and its log:
when `driver_create` is on, **Close application** in 360 creates the McLeod driver; a driver hired in
McLeod first (or before the flag) is still handled by `rosterApplicantHire.ts` exactly as today. Both
paths end in the same state (360 row active + linked), so neither needs to know about the other.

**Trigger and UI.** `POST /api/recruitment/hire` (`apps/api/src/modules/recruiting/routes/hire.ts:59-104`)
is unchanged in gate (`recruitment:view` + named permission `recruitment.close_application`,
`packages/shared/src/rolePermissions.ts:49`) and in refusal (Q-HM5). The close drawer
(`apps/web/src/features/recruitment/useHire.ts`, `HireDrawer`) gains one field, **McLeod driver code**,
pre-filled by `proposeMcleodDriverCode(first, last, taken)` (shared, pure): the carrier's convention
measured at MK0 from the 1,463 existing ids (e.g. `AMABLER`, `KSATTERW`, `WCHRISTO` = first initial +
surname, 8 characters). *MK0 measurement:* share of active ids equal to
`upper(left(first,1) + left(name,7))` after stripping non-letters; ≥ 90% ⇒ that rule, collisions
suffixed `2`,`3`… replacing the last character; < 90% ⇒ the field starts empty and is required (no
guessed rule). Free-check: `GET /api/roster/mcleod/driver-code/:code` asks the agent through the
pipeline's synchronous read lane if the pipeline spec has one; otherwise the check is the create's own
read-before-write (taken ⇒ `conflict` "code taken", office picks another, one click re-sends).

**Flow (API).** `POST /api/recruitment/hire` is untouched. In the same click, after its 200, the drawer
calls `POST /api/mcleod/drivers/:id/create {code}` (`officeWrites.ts`; gate: the same named permission,
`requireNamedPermission(CLOSE_APPLICATION_PERMISSION)` from `org`'s index, plus `requireSection('recruitment',
'view')`), which reads the hired row through roster's interface (refuses `409 not_hired` unless
`status='active'` with a `compliance.applicant_hired` audit and no `mcleod_driver_id`) and calls
`requestMcleodDriverCreate(admin, orgId, driverId, code, actorId)` (`apps/api/src/modules/mcleod/writes/driverCreate.ts`, new). It inserts the
request: `id = uuidv5("driver_create/<driver_id>/<hire_date>")`, `target = {company_id, row_type:
'driver', row_id: code}`, `payload` = the mapped fields from the hired row (`drivers` columns above,
`hire_date` = the close's hire date, `is_active: true`), `expect = {absent_by_id: code,
absent_by_licence: cdl_number}`. Same response to the browser plus `mcleod: {requestId, state:'queued'}`.
A failure of this second call does not undo the hire (the hire is a 360 fact and is complete); the drawer
shows "Not sent to McLeod — Send now", which repeats the idempotent call. **Backstop:** the McLeod card on
Settings › Data & sync lists "Hired in 360, not in McLeod" — drivers hired through 360 in the last 30 days
(`compliance.applicant_hired`) with no `mcleod_driver_id` and no open `driver_create` request — each with
**Send** (opens the code field). It must read 0 after a normal day; the daily health line counts it.

**Agent (`writes/driverCreate.mjs`).**
1. `GET /drivers/{code}` must be 404; else `conflict` ("code taken").
2. `GET /drivers/search?license_no=<cdl>` (exact parameter name from our `/ws/docs` at MK0):
   - an **active** driver with this licence ⇒ `conflict` reason `exists_in_mcleod` — the hire already
     happened in McLeod; no create. 360 then links him through the normal matcher on the next sweep
     (`rosterApplicantHire`/`rosterMatch` already link an active row by licence + name).
   - an **inactive** driver with this licence ⇒ this is a **return**: the request is converted in place to
     a reactivation (§MK5.2 "reactivate"), unless `can_rehire = 'N'` ⇒ `refused` "McLeod marks
     <code> not eligible for rehire" (shown in the close drawer and on the driver page; the 360 hire stands,
     the carrier decides).
3. `GET /drivers/new` ⇒ defaults; overlay `toRowDriver(payload)`; `id = code`; `company_id`.
4. `PUT /drivers/create`. 2xx ⇒ `sent`, then `GET /drivers/{code}` shows the row ⇒ `confirmed` with
   `response.mcleod_driver_id = code`.
5. Reconciliation (D-MK5-0d): posts the row through `POST /api/tms/roster/drivers?mode=identity`; the
   matcher links it to the 360 row (licence + name, the D-RL5 rule) — and, to remove any doubt about a
   licence typo, the result route ALSO calls `handApplicationToTms` (`apps/api/src/modules/roster/index.ts`)
   with `{driverId, externalId: code, companyId}` BEFORE that post, so the link never depends on the
   matcher's fuzziness. `handApplicationToTms` is already idempotent on McLeod's id (23505 = claimed
   elsewhere ⇒ the request flips to `conflict` "McLeod id already linked to <other driver>").

**Required fields (MK0).** On the test company, `PUT /drivers/create` with only `GET /drivers/new` +
the mapped fields. Each refusal naming a missing field: if it is one we hold, it is added to the mapping
(table above, one row); if it is one only the office knows (e.g. `type_of`, `fleet_manager`, `payee_id`,
pay rate), it becomes a **required select on the close drawer** whose options are read from McLeod
(`GET /drivers/new` default + the distinct values on active drivers, read once a day by the agent into
`mcleod_driver_create_options(org_id, company_id, field, value, label, seen_at)`, a new table in M-D4a, module `mcleod`) — never typed free.
If the refused field is `social_security_no`: see D-MK5-1c.

**D-MK5-1c — SSN is never sent.** `payload` has no SSN key; `toRowDriver` has no SSN mapping;
`writes/rowMap.test.mjs` asserts no output key matches `/social|ssn/i`. **If McLeod requires it**
(create refused naming it, on the test company): `driver_create` is **not enabled** for the org; the
close drawer shows "Enter this driver in McLeod — McLeod requires the SSN, which 360 does not send"; the
hire in McLeod is done by hand as today and D-RL5's sweep links it. Nothing else changes. Sending the
SSN would be a new owner ruling with its own spec (who may cause it — `recruitment.full_ssn` holders
only —, transport, McLeod audit); this spec builds no path for it.

**Permission.** The close's own gate. The "Send now" retry route: same named permission.
**Audit.** `mcleod.driver_create.requested` (actor = the closer), then pipeline states.
**Tests.** `writes/driverCreate.test.mjs` (stub `/ws`): code taken ⇒ conflict; active licence ⇒
`exists_in_mcleod`; inactive + `can_rehire=Y` ⇒ reactivation body; `can_rehire=N` ⇒ refused; success ⇒
create body has no SSN, has `name_of_spouse = email`, `name = last_name`. API:
`writes/driverCreate.test.ts` — enqueue after a successful hire only; a refused hire enqueues nothing;
replay ⇒ one request (uuidv5); `expectOrgScoped`. Shared: `proposeMcleodDriverCode.test.ts` (collision
suffixing, non-letters, 8-char cut). Matrix: `mcleod-driver-create-options` in `rls.test.mjs` seeding
(new table). Mutation: remove step 2 ⇒ the active-licence test must fail.

### MK5.2 Termination and reactivation

**Today.** Office termination = `PATCH /api/roster/drivers/:id` with `status`/`termination_date`
(`apps/api/src/modules/roster/routes/drivers.ts:163-246`), gated by `callerCanManage(role,'roster')`
(lifecycle fields, `DRIVER_LIFECYCLE_FIELDS`, `packages/shared/src/rosterContract.ts:349`). McLeod's
termination reaches 360 through `rosterRetire` (D-MR7: the sync sets, never clears); rehire is D-MR7a
(McLeod hire date after termination), D-RL6 (McLeod takes back its own termination, nobody here ended it),
D-RL9 (archive day stands in), D-RL10 (active with a last day = ending, held `ended_in_mcleod`).

**End employment (McLeod-linked driver, `lifecycle` sub-flag on).** The PATCH's lifecycle branch is
extracted, unchanged in behaviour, into roster's exported `applyDriverUpdate(admin, orgId, id, body, actor)`
(`apps/api/src/modules/roster/driverUpdate.ts`; the PATCH route calls it — its existing tests stay green as
the refactor's proof). For a row with `mcleod_driver_id` and `identity_source in ('mcleod','samsara')` the
web sends the termination to `POST /api/mcleod/drivers/:id/end-employment` (`officeWrites.ts`, gate
`requireSection('roster','manage')` — the same `callerCanManage(...,'roster',sections)` answer the PATCH
asks), which calls `applyDriverUpdate` first (360's §391.51(c) clock starts now; `driver.updated` audit
unchanged; the office's legal act, written first per Q-MK6) and then enqueues `driver_update` with `payload = {is_active: false,
termination_date, reason_for_leaving, can_rehire}` and `expect = {is_active: true, termination_date: null}`.
The PATCH body schema (`driverUpdateSchema`) gains optional `reason_for_leaving` (≤ 60 chars — McLeod's
column width read at MK0 from `/ws/docs` `RowDriver`; the zod max is set to it) and `can_rehire`
(boolean); both are required by the UI when terminating a McLeod-linked driver and stored on our row
(M-D4b, module `roster`, adds `drivers.reason_for_leaving text`, `drivers.can_rehire boolean` — **reader in the next merge**).
Backstop: the health card lists "Ended in 360, active in McLeod" — linked drivers terminated here with no
open or confirmed `driver_update` lifecycle request (D-RL10's held list already shows the McLeod side).
- Interplay, checked against each ruling: D-RL6 will NOT restore him (a `driver.updated` audit touching
  status exists — this act is exactly the "somebody HERE ended the employment" it looks for). D-RL10's
  `ended_in_mcleod` hold cannot arise from our write (we set `is_active` false with the date, not active
  with a date). D-MR7's "sync sets, never clears" is untouched: after confirm the retire sweep reads
  McLeod inactive with the same date — a no-op.
- `conflict` (McLeod already inactive with another date, or already active with a date): shown on the
  driver page; the 360 termination stands; the office reconciles in McLeod — D-RL10's held list already
  carries that case.
- `refused`: same display; McLeod still lists him active ⇒ the existing held list (D-RL10 wording) shows
  him, so nothing is silent.

**Reactivation (a return).** Not a button on the roster: a returning driver re-applies and is closed
through Hiring (the §391 file is rebuilt), which is MK5.1's step 2 "inactive driver with this licence".
Body: `{is_active: true, termination_date: null, hire_date: <close's hire date>, reason_for_leaving:
null}`, `expect = {is_active: false, license_no}`. After confirm, D-MR7a's rule restores/links the 360
side on the reconciliation post (McLeod hire date strictly after the former termination — true by
construction, since the close's hire date is today or later and the termination is in the past;
`hireApplicant` refuses a hire date before the former termination: new check in
`validateHireRequest`, shared, with its test). This removes D-RL6/D-RL9 review items for every return
done through 360; returns done in McLeod keep today's rules.

**Permission.** `roster: manage` for end-employment (unchanged gate). Reactivation: the close permission.
**Tests.** `drivers.routes` test: PATCH terminate on a linked row enqueues one `driver_update` with the
expect; on an unlinked or `manual` row enqueues none; recruiter refused before any write (existing test
stays green). Agent: expect mismatch ⇒ conflict, no PUT. Shared: `validateHireRequest` refuses a hire date
≤ the former termination. Gate: `lint:migration-ordering` (M-D4b columns before the reader).

### MK5.3 Truck and trailer status (re-rules Q-7 → Q-MK12)

**Today.** `isStatusFromTms` (`packages/shared/src/tms.ts:382`) makes the status read-only on
McLeod-linked rows in `VehicleForm.vue:63`, `TrailerForm.vue:26`, `VehiclesPage.vue:394`,
`TrailersPage.vue:219`. The sweep derives `vehicles.status` with `deriveVehicleStatus` from `in_shop`
(`tractor_status='S'`), purchase/model-year (`ordered`), and retires on `service_status <> 'A'`
(`rosterRetire.ts`, `queries.mjs` `retirementQueries`). Trailers: `is_active` only — `trailer_status='S'`
is NOT a shop (E5, measured: 39 of 223, all moving), so no trailer shop state exists.

**Re-ruling recorded as Q-7b** in `FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md` (appended): with `tractor_update`
/ `trailer_update` on, the status of a McLeod-linked unit is editable again and **asks McLeod**; 360's
column keeps one writer (the sweep). `isStatusFromTms` keeps its meaning ("the sweep writes it") and a new
`statusEditRoute(row, enabledKinds): 'mcleod' | 'local' | 'readonly'` (shared) decides the form:
`'mcleod'` when `isStatusFromTms(row)` and the kind is on; `'readonly'` when `isStatusFromTms` and off
(today); `'local'` otherwise (today's PostgREST edit).

**What the office can ask, and what McLeod is asked to set** (one shared table,
`MCLEOD_UNIT_STATUS_REQUESTS` in `packages/shared/src/tms.ts`, beside `deriveVehicleStatus`):

| Office picks (truck) | Sent (neutral fact) | Agent writes | Sweep brings back (`deriveVehicleStatus`) |
|---|---|---|---|
| Running | `{in_shop:false, winding_down:false}` | `tractor_status='A'` | `active` |
| In the shop | `{in_shop:true}` | `tractor_status='S'` | `maintenance` |
| Winding down / sold, awaiting pickup | `{winding_down:true}` | `tractor_status='I'` (service stays `A`) | `active` + `winding_down` (D-DB11) |
| Out of service (retire) | `{in_service:false, out_of_service_at}` | `service_status='I'`, `outservice_date` | retired by `rosterRetire` (its caps and guards apply unchanged) |
| Back in service | `{in_service:true}` | `service_status='A'` | re-created/linked by the active sweep (P4) |

| Office picks (trailer) | Agent writes | Sweep |
|---|---|---|
| In service | `is_active='A'` | active |
| Out of service | `is_active='I'`, `outservice_date` | retired |

A test asserts `deriveVehicleStatus(applyRequest(row, req)) === expected` for every row of the table —
the inverse is derived from the forward rule, not restated (no-workarounds: "deriving beats restating").
*MK0 check:* `GET /tractors/{id}` for one S truck and one I truck: which `RowTractor` key holds the
sub-status (`tractor_status` or `status`). The agent's `toRowTractor` uses the key found, stored in
`mcleod_api_capabilities.TRACTOR_SUBSTATUS_KEY`. Trailers: `RowTrailer`'s `is_active` vs `status` the same
way (`TRAILER_ACTIVE_KEY`). V (available) is never written: it is McLeod's own planning state; "Running"
writes A, and a truck McLeod later marks V is still `active` here (same derivation).

**UI.** `VehicleForm.vue` / `TrailerForm.vue`: when `statusEditRoute === 'mcleod'`, the status select shows
the office choices above (labels from the shared table), a line "Saved in McLeod; 360 shows it after
McLeod confirms", and on save calls `POST /api/roster/vehicles/:id/mcleod-status` (or `/trailers/:id/`)
instead of writing `status` through PostgREST. The rest of the form still saves through PostgREST as today
(the claim trigger does not list `status`, so nothing is claimed — 0241's header). `VehiclesPage.vue:394`'s
action shows for `'mcleod'` rows with the McLeod wording. Pending request ⇒ chip "Asked McLeod: In the
shop".
**API.** `POST /api/mcleod/vehicles/:id/status` and `/api/mcleod/trailers/:id/status` in `officeWrites.ts`
(rows read through roster's interface): `requireSection('equipment',
'manage')` (admin, fleet_manager — `auth.ts` matrix; org overrides respected by the middleware), validates
the choice against the shared table, reads the row (org-filtered), refuses `409 not_linked` for an
unlinked/`manual`/`efs` row, enqueues `tractor_update`/`trailer_update` with `expect` = the last swept facts
(`in_shop`, `winding_down`, status). `lint:vehicle-status`: the route never spells a status — it uses
the shared table and `IN_SERVICE_VEHICLE_STATUSES`; the gate's AST walker covers the new file.
**Retire path.** "Out of service" is the ONLY retire for a linked unit; the local retire stays for
unlinked units. Memory rule kept: a vehicle is never deleted.
**Tests.** shared table inverse test (above); route tests (equipment:manage only, dispatcher/safety 403,
org-scoped, unlinked 409); form tests (`VehicleForm.test.ts`, `TrailerForm.test.ts`: `'mcleod'` route
calls the API and not PostgREST for status; `'readonly'` unchanged); agent stub tests (key from
capabilities; full vs partial mode). Mutation: map "In the shop" to `V` ⇒ the inverse test must fail.

### MK5.4 Driver field edits without claiming the row (re-rules D-MR6 → Q-MK13)

**Today.** For `identity_source='mcleod'` rows, CDL/medical/hire/DOB/address/email are refreshed every
sweep (D-MR6) and an office edit of them **reverts**; a name or phone edit **claims the whole row** to
`manual` (0241 trigger `claim_identity_for_office`, argument list `full_name, first_name, middle_name,
last_name, phone`; `resolveDriverUpdate`) and McLeod stops refreshing it for good.

**New, with `driver_update.fields` on.** The writable list is **derived**:
`DRIVER_MCLEOD_WRITABLE_FIELDS` (shared) = the keys `driverPatch` (`apps/api/src/modules/mcleod/rosterFields.ts:36-83`)
returns for a fully-populated input, minus `full_name` (composed). A unit test computes `driverPatch`'s
key set and asserts equality — a field added to the sweep becomes writable or the test fails.
- `DriverForm.vue` (and the driver detail edit) for a McLeod-linked `mcleod`/`samsara`-sourced row: those
  fields save through `POST /api/mcleod/drivers/:id/fields {field: value…}` (`officeWrites.ts`,
  `requireSection('roster','manage')`, name edits allowed
  to the recruiter only on an applicant row as today — an applicant has no McLeod link, so the route
  refuses `409 not_linked` and the form uses today's path); the route enqueues `driver_update` with
  `expect` = current 360 values (= McLeod's last swept values, D-MR6) and changes **nothing** on our row.
  The UI says "Saved in McLeod" and shows the pending chip.
- Fields McLeod does not hold (`phone`, notes, assignments, every 360-only column) save as today.
- **The claim trigger stops claiming McLeod rows on phone** — a defect today (McLeod never writes
  phone, so claiming a McLeod row because the phone changed stops its licence refresh for nothing). M-D5
  replaces `claim_identity_for_office()`: an argument written `col@source` claims only when
  `old.identity_source = source`; the drivers trigger becomes
  `('full_name','first_name','middle_name','last_name','phone@samsara')`. `rosterFields.claimParity.test.ts`
  gains the case; the existing trigger matrix (the one testing 0241/0286) gains: McLeod row + phone edit
  by JWT ⇒ still `mcleod`; Samsara row + phone edit ⇒ `manual`.
- A name edit made through PostgREST on a McLeod row (an old client, or the kind off) still claims as
  today — the escape hatch D-MR14 built stays for orgs without the kind. With the kind on, the web never
  takes that path for those fields (form test asserts it).
- Un-claim: a row already claimed `manual` before this ships can be handed back to McLeod by the existing
  explicit `identity_source` change (0241's UN-CLAIM path); the driver page shows "Office-owned — hand back
  to McLeod" for `manual` rows that have a `mcleod_driver_id`, `roster: manage`, audited
  `driver.identity_returned`.

**Tests.** Derived-list equality; route (org-scoped, refuses unlinked, never writes `drivers`);
trigger matrix cases above; agent: `conflict` on expect mismatch. Gates: `lint:filesize` on
`drivers.ts` (if it crosses 450 lines the new route goes in `routes/driverMcleodEdit.ts`, mounted beside).

### MK5.5 Medical card / CDL one-click "Update McLeod" (extends D-MSUX7 → Q-MK14)

**Today.** `resolveMedicalExpiry` (`packages/shared/src/credentialSources.ts:51`): a documented (scanned)
card wins; else the earliest source date; `disagree` flags it. Sources per driver in
`credential_source_dates` (0467). `MedicalTab.vue` (`apps/web/src/features/drugAlcohol/MedicalTab.vue`)
lists "Sources disagree" with one column per `MEDICAL_SOURCES` entry.

**New, `driver_update.medical` on.** In the disagree list, a row whose rule is `documented` and whose
McLeod column differs from the scanned date gets one button **Update McLeod to MM/DD/YYYY**
(dates through the one formatter, memory `dates-are-mmddyyyy-from-one-definition`). Never automatic
(Q-MK14). `POST /api/mcleod/drivers/:id/medical` (`officeWrites.ts`; the medical state is read through
evidence's interface — `mcleod -> evidence` exists): `requireSection('safety','manage')`; recomputes
`resolveMedicalExpiry` server-side (the button's date is not trusted), refuses unless rule = `documented`
and McLeod's latest claim ≠ that date; enqueues `driver_update {medical_card_expires_at}` with
`expect = {medical_card_expires_at: <McLeod's latest claim from credential_source_dates>}`.
Confirmation ⇒ the reconciliation post records McLeod's new claim through `recordSyncedCredentials`
(the existing door) ⇒ `disagree` clears on its own. Rule D-MSUX7 is unchanged (the scan still wins
either way); the write only removes the disagreement at its source.

**CDL.** Same shape on the driver's CDL certification row (DQ file), when a `certifications` row of kind
`cdl` with a `document_id` has an expiry different from `drivers.cdl_expires_at` (McLeod's, D-MR6):
button "Update McLeod", `requireSection('safety','manage')`, `driver_update {cdl_expires_at}` (only if
MK0 confirmed `license_date` is writable, MK5.0 table), expect = current `drivers.cdl_expires_at`. No CDL
resolver is invented: D-MR6 already makes McLeod's value the roster value and the scan the evidence.

**Tests.** Route: refuses when not `documented`, when equal, for another org; enqueues with McLeod's claim
as expect. Web: button only on the qualifying rows (MedicalTab test). Mutation: drop the server-side
recompute ⇒ the "button date forged" test must fail.

### MK5.6 Migrations, gates, rollout for MK5

- **M-D4a** (module `mcleod`): `mcleod_driver_create_options` (new table, RLS, service-role; manifest entry
  layer `raw`, growth `fleet`). **M-D4b** (module `roster`): `drivers.reason_for_leaving`, `drivers.can_rehire`
  (nullable; readers in the following merge — `lint:migration-ordering`). Two files because one migration
  may touch one module's tables (`lint:table-modules`).
- **M-D5**: `claim_identity_for_office()` with `col@source`; drivers trigger re-created with
  `phone@samsara`. Applies cleanly to production's shape (`schema-drift-production-shape.test.mjs` runs it).
- Gates: `lint:boundaries` (no new module edge — every route is in `mcleod`), `lint:table-modules` /
  `lint:table-writers` / `lint:table-producers` / `lint:table-lifecycle` (M-D4a's table),
  `lint:migrations`, `lint:migration-ordering`, `check-rls.mjs`, `definer-rpc-grants.test.mjs`
  (the trigger function stays `security definer` with `set search_path = ''`, no client grant),
  `lint:vehicle-status`, `lint:boundaries` (web features import `@silvicom/shared` only),
  `lint:filesize`/`lint:funcsize`, `lint:comment-claims`, `lint:upserts`.
- Rollout order (each after its test-company pass, D-MK3): `tractor_update`/`trailer_update` (lowest
  stakes, measurable by `fleetParity`) → `driver_update.medical` → `driver_update.fields` →
  `driver_update.lifecycle` → `driver_create`. Daily: count of MK5 requests by state; any `sent` older
  than 1 hour (row updates are synchronous on `/ws`, unlike images) is an alert on the McLeod health line.

---

## MK2 — Finance reads: end the frozen `lme_analytics` restore

### MK2.0 The finding that decides MK2

The public `/ws` surface has **no GL, ledger, AP voucher or fuel service**; `SettlementService`,
`DeductionService` and `BillingService` are read-only (`MCLEOD-API-SURFACE-2026-11-19.md` §Money). Every
finance figure 360 shows ties a sub-ledger to the general ledger **to the cent, per posting key**
(P0c; `GL_KEY_LINES` in `tools/mcleod-agent/queries.mjs:805-820`). So the restore ends by **SQL GRANTs on
live `lme`**, not by the API. KIT-PLAN §5's MK2 row ("Finance through the API") is corrected to this;
the correction is appended to `MCLEOD-API-KIT-PLAN.md` §8 as **D-MK2-1**.

**D-MK2-1 — Finance reads stay on SQL; the API's Settlement/Deduction/Billing reads replace nothing.**
Reasons, each sufficient: (1) the ledger has no API, and a tie-out compares two reads taken from **one
database at one moment** — settlements from `/ws` (live, now) against the ledger from SQL (another
moment) would disagree by whatever posted in between, and the harness refuses when Σ ≠ GL (PNL P3);
(2) the tie-outs join on `post_key`, `void_date`, payee and posting module, none of which the public
`RowSettlement`/deduction shapes are documented to carry; (3) `/ws` returns ≤ 1,000 rows per call
(`-Dloadmaster.api.maxresultsize`), against 25,572 settlements and 12,451 deductions in one 322-day read
(FINANCE-REPORTS-V2 §1.2) — 38+ paged calls for what one indexed statement does; (4) the restore is a
**permission** problem (D-PREC12): the login cannot read the tables on `lme`, and an API user does not
change that for the GL. No MK2 step calls a money endpoint. (A driver-facing "my settlement" screen
would be a different use, with its own plan; it is not part of ending the restore and nothing here waits
on it.)

### MK2.1 Every table the financial sweep reads — login, database, grant, status

The sweep is `agent.mjs --financial` → `runFinancial()` (`tools/mcleod-agent/agent.mjs:718-832`):
settlements (`settlements.mjs`), deductions, vouchers + fuel (`expenses.mjs`), movement facts
(`movements.mjs`), billing (`billing.mjs`), GL accounts / control / totals / key lines / office lines
(`ledger.mjs`), tractor periods (`tractorPeriods.mjs`), fuel-tax receipts (`fuelTaxReceipts.mjs`). It posts
to `apps/api/src/modules/mcleod/routes/tmsFinancial.ts` (`/settlements`, `/vouchers`, `/deductions`,
`/movement-facts`, `/ledger-totals`, `/ledger-key-lines`, `/gl-control`, `/tractor-periods`, `/gl-accounts`,
`/office-lines`, `/fuel-tax-receipts`, `/billing`), ingested by `financialIngest.ts`,
`ledgerControlIngest.ts`, `movementFactIngest.ts`, `glControl.ts`, `ledgerKeyLines.ts`,
`fuelTaxReceipts.ts` into `mcleod_settlements`, `mcleod_deductions`, `mcleod_ap_vouchers`,
`mcleod_movements`, `mcleod_billing`, `mcleod_gl_accounts`, `mcleod_gl_control`, `mcleod_gl_totals`/
`mcleod_gl_days`, `mcleod_gl_key_lines`, `mcleod_office_lines`, `mcleod_tractor_periods`,
`mcleod_fuel_tax_receipts`.

Tables per statement (extracted from the statement text, `queries.mjs`, 2026-11-19):

| Statement | Tables |
|---|---|
| `SETTLEMENTS` | `drs_settle_hist` |
| `SETTLEMENT_DEDUCTIONS` | `drs_deduct_hist` |
| `SETTLEMENT_LEDGER_LINES` | `gl_ledger`, `drs_settle_hist` |
| `AP_VOUCHERS` | `voucher`, `voucher_hist` |
| `FUEL_PURCHASES` | `fuel_detail`, `fuel_detail_hist` |
| `FUEL_LEDGER_LINES` | `gl_ledger`, `fuel_detail_hist` |
| `MOVEMENT_FACTS`, `MOVEMENT_FACT_COUNTS` | `movement`, `movement_order`, `equipment_item` |
| `BILLING_HISTORY` | `billing_history`, `orders`, `users` |
| `GL_ACCOUNTS` | `gl_account` |
| `GL_CONTROL` | `gl_control`, `fiscal_year_dtl` |
| `GL_CONTROL_TOTALS`, `OFFICE_SETTLEMENT_LINES` | `gl_ledger`, `gl_ledger_hist` |
| `GL_KEY_LINES` | `gl_ledger` |
| `TRACTOR_PERIODS` | `tractor` |
| `FUEL_TAX_RECEIPTS` | `fuel_tax_history` |
| (lumper, hourly, not `--financial`) `LUMPER_*` | `orders`, `customer`, `users`, `stop`, `other_charge`, `other_charge_hist`, `billing_history`, `drs_deduct_hist`, `drs_pending_deduct` |
| (new, MK2.3) F3 key lines all modules, F7 | `gl_ledger`, `voucher_hist`, `drs_check`, `gl_summary` |

**Logins and databases.** Today the financial sweep runs from the owner's Mac with `.env.sandbox`
(`<analytics SQL login>` on `lme_analytics`, the restore of 2026-10-09; memory `finance-reports-v2-position`);
the VM connector runs `<read-only SQL login>` on `lme` with `FINANCE_FEED=off`
(`tools/mcleod-agent/connector.example.env:39-42`). **Target: the VM connector, `<read-only SQL login>` on
`lme`, `FINANCE_FEED=on`, 02:00 Central** (`schedule.mjs`). `.env.sandbox` stops being a feed and stays a
probe credential.

**The exact grants on `lme`** (`tools/mcleod-agent/review/SILVICOM-GRANTS.sql`):

| Table | Grant on `lme` | Status 2026-11-19 |
|---|---|---|
| `movement`, `movement_order`, `orders`, `stop`, `users`, `tractor`, `trailer`, `continuity`, `driver` (18 cols) | already granted (file header :6-8) | **run** |
| `customer (id,name,city,state_id,company_id)`, `reference_number` | Part 1 :77-83 | **run** 2026-09-29 |
| `gl_ledger`, `gl_ledger_hist`, `gl_account`, `billing_history`, `drs_settle_hist`, `drs_deduct_hist`, `voucher`, `voucher_hist`, `fuel_detail`, `fuel_detail_hist`, `equipment_item` | Part 4 :160-170 | **NOT RUN** (13 of 15 refused, measured 11-18) |
| `fuel_tax_history`, `voucher_dist`, `gl_control`, `fiscal_year_dtl` | Part 3 :139-148 = Part 4 :171-174 | **NOT RUN** |
| `other_charge`, `other_charge_hist`, `drs_pending_deduct` | Part 5 :188-190 | **NOT RUN** |
| **`drs_check`** | **new line in Part 4** (F3/F4: the payee of every DRS key — 684/684 keys join, measured on the copy) | to add |
| **`gl_summary`** | **new line in Part 4** (Q-FR2-4 → yes; F7) | to add |

The file change (a docs/SQL edit, no migration): append to Part 4, after `:174`,
```sql
-- Added <date>, NOT YET RUN: settlement checks (payee per DRS posting key, F3/F4) and McLeod's own
-- period balances (F7, FINANCE-REPORTS-V2 Q-FR2-4). No personal data beyond a payee id.
GRANT SELECT ON dbo.drs_check        TO <read-only SQL login>;
GRANT SELECT ON dbo.gl_summary       TO <read-only SQL login>;
```
add both names to the CHECK block's `IN (...)` list (`:225-230`), and a dated header paragraph
(`:57-67` style). The same two lines go to Part 2 (`lme_analytics`) **only** for the comparison run in
MK2.2 step 3. `voucher_dist` stays in Part 4 but nothing reads it (FINANCE-REPORTS-V2 found it holds open
vouchers only; F3 takes AP accounts from key lines) — it is kept because removing a line from a request
already with IT costs more than a harmless SELECT; the header says no statement reads it.

**The request** is ONE message from the owner to Alex (memory `it-requests-are-one-complete-list`): Part 3
+ Part 4 (with the two new lines) + Part 5, run on `lme`, then the CHECK block's output pasted back.
Part 6 (imaging) was already sent alone (2026-11-18) and is not repeated. This message is the whole of
**Q-FR2-3** (no copy refresh is asked: the copy stops mattering), **Q-TP10** (`gl_control` is in Part 4),
**Q-IP3** (`fuel_tax_history`, Part 3/4), and **PNL P1**.

### MK2.2 Cut-over and the comparison check

1. **F0 now, unchanged** (owner, from a `main` checkout, FINANCE-REPORTS-V2 §5): re-read 2026 from the
   copy so October's fixes fill `bill_type`, `void_date`, `gl_control`, key lines, tractor periods.
   It does not wait for the grants: it unblocks F1–F2 measurement today. (Use
   `FUELGUARD_INGEST_URL=https://api.360.silvicominc.com` and the live token from the VM's `connector.env`,
   as the memory records — never a placeholder in the command given to the owner.)
2. **Grant check** on `lme` under the connector login: the CHECK block shows 1 for every Part 3/4/5
   table and 0 for `can_update_movement`. Then `agent.mjs --financial --dry-run` on the VM (reads all,
   posts nothing, prints counts and timings). Halt on any refusal.
3. **Comparison run** — new flag `--financial --compare=lme_analytics` (agent, `tools/mcleod-agent/financeCompare.mjs`,
   ≤ 300 lines): runs every financial statement against `lme` and against the copy for the same window
   (Jan 1 → the copy's restore date, 2026-10-09), posts nothing, and prints per statement × month ×
   (module, account) the two sums and the row counts. **Acceptance:** for every month the copy's
   `gl_control` shows closed, every line equal to the cent; any difference in a closed month is printed
   with its posting keys and is, by definition, a restatement after the restore — it is recorded in the
   FINANCE-REPORTS-V2 log with month, account and amount and is exactly what D-TP6's restatement line
   (F6) shows; for the open months (copy's open period onward) differences are expected and not
   judged. The run's output file is attached to the cut-over PR.
   Test: `financeCompare.test.mjs` — equal sets ⇒ "equal"; one-cent difference in a closed month ⇒ listed
   with its key; difference in an open month ⇒ not a failure.
4. **Switch:** on the VM, `FINANCE_FEED=on` in `connector.env`, restart the service. The first night runs
   with `FINANCIAL_WINDOW_DAYS=322` (one-time line in `connector.env`, removed the next day — the
   service logs the window, so its removal is checked in the log), so all of 2026 is re-read from live.
5. **Freshness proof:** `mcleod_gl_control` shows `lme`'s open period (not the copy's period 8); the
   financial freshness stamp (`apps/api/src/modules/financial/financialFreshness.ts`, stamped by the mcleod ingest — `financialFreshnessStamp.test.ts`) carries the sweep's source database — the
   ingest payloads gain `source_db` (`lme` | `lme_analytics`) in their `extra` (schema change in
   `packages/shared` contracts first; ingest stores it in the existing freshness row — if the row has no
   column for it, **M-D6** adds `source_db text` to that table, reader in the next merge); the Finance page
   footer says "From McLeod, live, as of <time>" or "From the McLeod copy restored <date>" — so a fall-back
   to the copy is visible, never silent.
6. **Retire the copy path:** `.env.sandbox` `--financial` runs refuse unless `--allow-copy` is passed
   (`agent.mjs` guard, test in `agent` flag tests), so a stale restore can never again be posted over live
   figures by habit.

### MK2.3 The finance steps this unblocks — each closed or sequenced

- **FINANCE-REPORTS-V2 F0** — stays the owner's one command now (step 1); superseded nightly by step 4.
- **Q-FR2-3** — answered by MK2.1's request; no copy refresh is asked.
- **Q-FR2-4** — **yes**: `gl_summary` added to Part 4 (and Part 2 for the comparison). F7's column probe
  runs with the connector login after the grant (`INFORMATION_SCHEMA.COLUMNS`, recorded in the F7 PR);
  the memory already lists its columns from the copy (company_id, glid, transaction_date, transaction_no,
  amount(+_c/_d/_n/_r), is_history) and the probe confirms them on `lme`.
- **F3** — needs `drs_check` (now in Part 4) and `GL_KEY_LINES`'s module list widened from
  `('BILL','SET','SETV','FUEL')` to every module (AP, DRS, OFF, DED, GJ, RJ, CASH, WIRE added) — one SQL
  edit, reviewed by IT under Q-LRC6's rule (new SQL goes to IT before the VM runs it); ingest unchanged
  (`mcleod_gl_key_lines` is per module already).
- **TRUCK-DRIVER-PNL P1** = step 4. **Q-TP10** = the MK2.1 request.
- **IFTA Q-IP3** — `fuel_tax_history` on `lme` (Part 3/4). After step 4, IP6 reads live; the
  two-year receipt window (`agent.mjs:820-829`) is unchanged.
- **F12b / GO-LIVE C1** — built now, independent of the grant (reads the copy until step 4, live after):
  **M-D7** `mcleod_fuel_purchases` (new table, RLS, service-role) with exactly `FUEL_PURCHASES`'s 27 columns
  (`queries.mjs:450-505`) plus `org_id`, `swept_at`; primary key `(org_id, company_id, external_id)`;
  `POST /api/tms/fuel-purchases` in `tmsFinancial.ts` (zod schema in shared, batched 2,000, write by
  set-based RPC, not a partial upsert — `lint:upserts`); `agent.mjs` posts `ex.purchases` after vouchers.
  Posting date = `mcleod_gl_key_lines.txn_date` joined on `post_key` (FUEL is already in the module list).
  Non-canonical (D-FS2: EFS stays canonical for fuel dollars). `ledgerCoverage.ts:134`'s "posting-lag
  term until fuel_detail is staged" becomes a computed term. Done when July's FUEL residual decomposes
  into a named posting-lag term and the unexplained remainder is under $1.00 (C1's own criterion).
  Tests: ingest (org-scoped, idempotent re-send, `source_db`), shared schema, `ledgerCoverage` lag term on a
  fixture month.

### MK2.4 Gates

`lint:migrations`/`lint:migration-ordering` (M-D6 column before its reader; M-D7 new table), the table
manifests for `mcleod_fuel_purchases` (`scripts/table-modules.json`: module `mcleod`, layer `raw`, growth
`time`, budget 250 rows/day = 3× June 2026's 2,259 purchases/30 days, retention null — it is books, add to
`RETENTION_FORBIDDEN` beside `mcleod_settlements`; writer pair in `table-writers.json`; regenerated
`schema.generated.sql`), `lint:table-producers` (the ingest ships in the same PR), `check-rls.mjs`,
`lint:upserts`, `lint:filesize` (`agent.mjs` is 63 KB and grandfathered — the compare mode lives in its own
file, only a flag branch is added), agent tests (`node --test tools/mcleod-agent/*.test.mjs`, already in
`pnpm test`), `lint:comment-claims`.

---

## MK6 — ETA write and home time

### MK6.1 ETA into McLeod

**What is true.** D-DB4 (`docs/plans/dispatch-loads/DISPATCH-BOARD-PLAN.md:184-190`): the board's ETA is
ours (remaining distance ÷ planning speed + HOS rest); McLeod's `stop.eta` is hand-typed (36 stale in the
past when measured) and is a reference in the drawer. Predictions are recorded hourly in
`load_stop_eta_predictions` (0453, owned by `loads`, 60-day retention; recorder `livemap/boardEtaRecorder.ts`).
**Measurement status:** every insert failed 10-10 → 10-15 (fractional seconds into an integer column),
fixed by #1578, live in release v2026.10.19; ~8,250 predictions by 10-19 (memory
`dispatch-board-v2-position`). **DB7 — the 14-day comparison (SQL in the plan, :530-545) — has not been
recorded as run**: the data for it exists (well over 14 days by 2026-11-19), the analysis does not.
McLeod's actual times are filled on 762/762 delivered loads, so the comparison has its ground truth.

**Step 1 — run DB7 (read-only, production), record it in DISPATCH-BOARD-PLAN's log.** It decides whether
anything is written:

| DB7 result, bucket "≤ 6 h out", predictions with GPS age ≤ 15 min and HOS known | Decision |
|---|---|
| median \|error\| ≤ 30 min **and** p90 \|error\| ≤ 90 min, n ≥ 300 | **D-MK6-1a: write** (steps 2–4), for predictions meeting the same basis filter only |
| either threshold missed | **D-MK6-1b: no ETA write.** Q-DB4's next step (HERE matrix distance, `BOARD_ROAD_FACTOR` retune) is taken first; DB7 is re-run 14 days after it ships; this table is applied again. The board keeps showing our ETA as today. |
| n < 300 in the bucket | wait 14 more days of recording; re-run (the recorder is already running — nothing to build) |

Why those numbers: an ETA written into McLeod is what McLeod's own screens and any customer track-and-trace
show; a written value worse than a dispatcher's typed one makes McLeod worse. 30/90 minutes is the band a
dispatcher's appointment-window decision tolerates (an appointment window is ≥ 1 hour on the board's own
`appointment_start/end`), and the basis filter keeps stale-GPS guesses out.

**Step 2 — MK0: find the write path (test company), in this order:**
1. **Call-in.** `CallinService` (`PUT /callins/create`): read `RowCallin` on our `/ws/docs`. If it carries a
   next-stop ETA field, create one call-in for a test movement and `GET /stops/{id}`: if `stop.eta` moved
   to the call-in's value ⇒ **path = callin** (McLeod's native check-call: dispatchers see it in the call-in
   history with our user, and McLeod's own logic updates the stop).
2. **Stop row.** Else `GET /stop/{id}` via TableRowService: if the row has `eta`, `PUT /stop/update`
   (`ROW_UPDATE_MODE` from MK5.0b) with only `eta`; then `GET /stops/{id}` and diff: only `eta` changed —
   status, actuals, and no service-failure row created (`clearStop` is the call that creates those; we never
   call it) ⇒ **path = stop_update**.
3. 403 on either ⇒ the integration user lacks the role: ask McLeod for it (added to the pipeline spec's
   B-MK4 role list for the one request); nothing is built until granted.
4. Neither exposes an ETA ⇒ **D-MK6-1c: no ETA write path on our /ws**; recorded in KIT-PLAN §8; the board
   keeps its own ETA. Nothing else changes.
Stored as `mcleod_api_capabilities.ETA_WRITE_PATH = callin | stop_update | none`.

**Step 3 — build (only under D-MK6-1a and a path).**
- **What is written:** for each dispatched, in-transit `source='tms'` load, the NEXT not-yet-arrived stop's
  latest prediction meeting the basis filter, when it differs from McLeod's current `eta` (last sweep,
  `load_stops.eta_at`) by ≥ 30 minutes, at most once per stop per hour.
- **Job:** `mcleodEtaWrite` in `apps/api/src/schedulers.ts`, every 15 minutes, lane `general`, owner `api`
  (`docs/WORKER-DEPLOYMENT.md`), env `MCLEOD_ETA_WRITE_MINUTES` (default 15, 0 = off), and the kind flag.
  Code `apps/api/src/modules/mcleod/writes/etaWrite.ts`: asks `loads` for the latest predictions
  (new export `latestStopPredictions(admin, orgId)` in `loads/index.ts` — `mcleod -> loads` exists), joins
  its own `mcleod_dispatch_stops` by `(company_id, movement_id, movement_sequence = seq)` for McLeod's
  `stop_id`, and enqueues `stop_eta_update`: `id = uuidv5("stop_eta_update/<stop_id>/<hour>")`,
  `payload = {eta, basis}`, `expect = {arrived: false, eta: <McLeod eta as last swept>}`.
- **The human wins:** the agent reads the stop; if it has an actual arrival ⇒ `refused` "arrived"; if its
  `eta` differs from `expect.eta` and is not the last value we wrote ⇒ a person typed it ⇒ `conflict`, and
  the job writes nothing to that stop for 6 hours (`mcleod_eta_holds(org_id, stop_id, until)`, new table in
  **M-D8**, module `mcleod`, growth `time`, retention 7 days).
- **Board:** the drawer's McLeod reference line reads "McLeod ETA (sent by 360 at 14:05)" when McLeod's value
  equals our last confirmed write, else "McLeod ETA (typed in McLeod)". One shared function decides.
- **Tests:** writer (threshold 29/30 min, once per hour, basis filter, no write after arrival, hold after a
  human edit), agent (callin and stop_update bodies, refusal on arrival), `expectOrgScoped`.
- **Re-rules:** DISPATCH-BOARD §8 "No … status writes to McLeod" gains "except the ETA under D-MK6-1a";
  D-DB4 unchanged (the board's ETA is ours; now McLeod also carries it).

### MK6.2 Home time

**What is true.** HOME-TIME-PLAN: periods live in `driver_time_off` (`provider='silvicom'`, `kind='home_time'`,
`expected_return_at`, ended/canceled columns — 0597), marked by `roster.home_time` holders through
`/api/roster/home-time`; D-HT5 "Nothing is written to McLeod"; McLeod `driver` has `next_home_date`,
`last_home_date`, `home_duration`, `return_home_flag`, `home_location_id`, `pta_date`, **unreadable by our SQL
login** (:20-24); **Q-HT1 (where dispatch keeps home time today) is open as a fact**. `SymphonyMobileComm
driverAvailable` is HOS available hours, not home time — not a candidate. `EquipStatusService PUT
/equipStatus/create` creates a `RowDriverStatus` (driver status event). `driver_time_off.provider` defaults
to `mcleod` and has `external_id`/`raw` (0068) — the table was designed to hold McLeod's periods too.

**Step 1 — answer Q-HT1 with the API's reads (MK0, read-only, live company is fine: reads only).**
The agent's API user can read what the SQL login cannot. `tools/mcleod-agent/oneoff/homeTimeProbe.mjs`:
- `GET /drivers/{id}` for every active driver (~186): count non-null `next_home_date`, `pta_date`,
  `last_home_date`, `home_duration`, `return_home_flag`; repeat daily for 14 days (the probe stores
  nothing in 360; it writes a dated CSV in the scratch folder the owner reads) and count changes.
- The `RowDriverStatus` records for the same drivers over 90 days (`GET` on the TableRowService table that
  `/ws/docs` names for RowDriverStatus, or the EquipStatusService read if one exists): count by status code,
  and list the codes' descriptions.
- Compare with 360's own periods marked since HT3 (2026-11-13): for each 360 period, does McLeod hold
  `next_home_date` within ±1 day of `start_at`, `pta_date` within ±1 day of `expected_return_at`, or a status
  event spanning it?

**Step 2 — decide per outcome (each fully built; none waits on another ruling):**

| Outcome of step 1 | Decision |
|---|---|
| **H1** status events with a home/vacation code exist for ≥ 10% of active drivers in 90 days | **D-HT5a(H1):** each 360 mark writes a driver status event — `PUT /equipStatus/create` with the home code (the code chosen once by an admin from the codes found, stored in `mcleod_home_time_map(org_id, kind, mcleod_code)`, M-D9, module `mcleod`), `from = start_at`, `to = expected_return_at` (field names from `RowDriverStatus` on `/ws/docs`); change ⇒ update of that event (TableRowService `PUT /<table>/update`); end/cancel ⇒ the event's `to` set to `end_at` / event deleted only if McLeod allows (`DELETE /<table>/{id}`; if refused, `to = start_at` and a note) |
| **H2** `next_home_date`/`pta_date` filled on ≥ 50% of active drivers, changing within the 14 days, and ±1-day agreement with 360 periods on ≥ 80% of the periods compared | **D-HT5a(H2):** mark/change ⇒ `driver_update {next_home_date: start_at, pta_date: expected_return_at, home_duration: whole days}`; end ⇒ `{last_home_date: start_at::date, next_home_date: null, pta_date: end_at}` — the semantics are the ones step 1 measured (pta = when the driver is available again); if step 1's agreement shows a different reading, the mapping row in `toRowDriver` follows the measurement and the test pins it |
| **H1 and H2** both | both writes, one request each (they feed different McLeod screens and dispatch keeps both today) |
| **H3** neither in use | **D-HT5 stands, now as a measured fact:** dispatch keeps home time outside McLeod; 360's period is the only record; nothing is written. Q-HT1 closed as (b). |
| H2's fields filled but disagreeing with 360 periods on > 20% | dispatch keeps a *different* fact there (e.g., a planned rotation); **no write** — writing would overwrite it; Q-HT1 closed as "(a), a different fact"; the fields are imported read-only as a board hint (below) |

**Reads, in every outcome except H3:** the agent sends McLeod's home facts on the roster sweep (neutral
names `home_next_at`, `available_again_at`, `home_status_periods[]`) — `tmsDriverInputSchema` gains them
(shared contract first, ingest second merge); the ingest writes McLeod-originated periods to
`driver_time_off` with `provider='mcleod'`, `external_id` = McLeod's event id (or `driver:<id>:next` for H2),
through roster's interface. `homeTime.ts`'s live read already excludes McLeod rows from the one-live-period
rule ("McLeod rows in the live read" is one of HT2's killed mutants), so a McLeod period never blocks a 360
mark; the board shows it as "McLeod: home until …" when no 360 period exists — this is Q-HT1 (a)'s
"prefill so nobody types a date twice": the mark form pre-fills from it. Our own writes come back on this
read; they are recognised by `external_id` = the id our write created and are not shown twice.

**Write mechanics (H1/H2).** No change to the roster module's home-time service (`roster -> mcleod` would be a
cycle): `apps/api/src/modules/mcleod/writes/homeTimeWrite.ts` is a sweep every 2 minutes (scheduler
`mcleodHomeTimeWrite`, lane `general`) over periods changed since its cursor, read through a new roster
export `homeTimeChangesSince(admin, orgId, sinceIso)` (`mcleod -> roster` exists); it enqueues
`home_time_update` with `id = uuidv5("home_time_update/<period_id>/<updated_at>")` — one request per state
of the period, so a change after a change queues the latest and the older one is superseded by
`expect` (the agent reads McLeod's current values; a newer request for the same period exists ⇒ the older
ends `refused` "superseded", never sent). The pipeline gains kind `home_time_update` (sub-shape `event` |
`driver_fields`). Permission: none at the write — the mark itself was gated by `roster.home_time`; the
audit is the mark's (`home_time.marked|changed|ended|canceled|reopened`) plus the pipeline states.
D-HT6 (the system ends a period on a pickup) writes the end the same way, so McLeod is told when the
driver is working again.

**Tests:** probe has no test (one-off, writes no state); writer (cursor, supersede, org-scoped, H1 and H2
bodies, cancel path); ingest of McLeod periods (no duplicate of our own write, never blocks a 360 mark —
the existing HT2 mutant test extended); shared contract fields.

### MK6.3 Migrations

- **M-D8** (`mcleod`): `mcleod_eta_holds` — only under D-MK6-1a with a path.
- **M-D9** (`mcleod`): `mcleod_home_time_map` — only under H1.
Each with its `table-modules.json`/`table-writers.json` entries and regenerated `schema.generated.sql`; both
`growth: fleet` (holds) / `fleet` (map); RLS, service-role.

---

## Appendix A — Migrations in order (numbers taken at build time)

| Name | Module | What | Deploy-window rule |
|---|---|---|---|
| M-D1 | mcleod | `mcleod_image_categories`, `mcleod_image_kind_map`, `mcleod_image_sends` + guard, bucket `mcleod-outbound`, RPC `mcleod_enqueue_image_send` | new tables: exempt |
| M-D2 | loads | `load_stop_photos.sha256`; `driver_complete_stop` stores it | column + its in-DB reader together; the app sends it after |
| M-D3 | mcleod | `lumper_case_files.kind` widens to `lumper_receipt` (+ `source` if the LRC build has not added it) | one merge before the receipt upload UI |
| M-D4a | mcleod | `mcleod_driver_create_options` | new table |
| M-D4b | roster | `drivers.reason_for_leaving`, `drivers.can_rehire` | readers in the next merge |
| M-D5 | roster | `claim_identity_for_office()` `col@source`; drivers trigger `phone@samsara` | function only; production-shape test |
| M-D6 | financial | `source_db` on the freshness row (only if it lacks a place for it) | reader in the next merge |
| M-D7 | mcleod | `mcleod_fuel_purchases` | new table |
| M-D8 | mcleod | `mcleod_eta_holds` (conditional, MK6.1) | new table |
| M-D9 | mcleod | `mcleod_home_time_map` (conditional, MK6.2 H1) | new table |

## Appendix B — Plan documents updated by this work (append-only, in each one's progress log)

- `MCLEOD-API-KIT-PLAN.md` §8: D-MK2-1 (finance on SQL), D-MK4-1..6, D-MK5-0a..g, D-MK6-1a/b/c, D-HT5a.
- `BOL-READING-RELIABILITY-PLAN.md` §9: Q6 closed YES, Q9 closed (§MK4.5).
- `LUMPER-REVISED-RC-PLAN.md`: the route (a)/(b) switch rule (§MK4.4); `lumper_receipt` kind.
- `ROSTER-LIFECYCLE-PLAN.md`: D-RL5a (360 creates the McLeod driver when `driver_create` is on).
- `MCLEOD-ROSTER-SYNC-PLAN.md`: D-MR6a (McLeod-held fields edit through McLeod, no claim; `phone@samsara`).
- `FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md`: Q-7b (status asks McLeod for linked units).
- `MEDSTOP-PLAN.md`: D-MSUX7a (one-click "Update McLeod", never automatic).
- `FINANCE-REPORTS-V2-PLAN.md`, `TRUCK-DRIVER-PNL-PLAN.md`, `IFTA-PRECISION-PLAN.md`, `FINANCE-GO-LIVE-PLAN.md`:
  Q-FR2-3/4, P1/Q-TP10, Q-IP3, C1/F12b as in §MK2.3.
- `DISPATCH-BOARD-PLAN.md`: DB7 result and D-MK6-1 outcome. `HOME-TIME-PLAN.md`: Q-HT1 answer and D-HT5a.
- `tools/mcleod-agent/review/SILVICOM-GRANTS.sql`: `drs_check`, `gl_summary` in Part 4 (+ Part 2 for the
  comparison), CHECK list, header paragraph.

## Appendix C — Every MK0 check this spec defines (one list for the MK0 session)

1. Images row type spelling for an order (`O`/`orders`/`order`) and documentTypes list; per-order variation (5 orders). (MK4.1)
2. Upload accepts PDF 2-page; else TIFF per page. Raw body vs multipart. (MK4.1 D-MK4-5, MK4.3 step 4)
3. POST→visible latency (5 uploads) → confirmation window. (MK4.3 step 6)
4. Image list fields (id, category, date) and `GET /images/{id}` returns full file → read switch conditions 1–2. (MK4.4)
5. `RowDriver` has `license_date`; `reason_for_leaving` width; `drivers/search` licence parameter name. (MK5)
6. `ROW_UPDATE_MODE` partial vs full, for driver, tractor, trailer. (MK5.0b)
7. `drivers/create` required fields with only defaults + our fields; SSN required or not. (MK5.1)
8. Driver code convention share (≥ 90%). (MK5.1)
9. `RowTractor` sub-status key; `RowTrailer` active key. (MK5.3)
10. ETA path: callin carries stop ETA → else `stop/update eta` → 403 → none. (MK6.1)
11. Home time probe H1/H2/H3 (14 days of reads). (MK6.2)
12. After Part 6 runs: `bimd_load_no = orders.id`; `imapcats` vs `/ws` category ids. (MK4.1, MK4.1 D-MK4-3)
