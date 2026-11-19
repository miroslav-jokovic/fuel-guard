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
| `kind text` | one of the kinds this spec registers: `image_upload`, `driver_create`, `driver_update`, `tractor_update`, `trailer_update`, `stop_eta_update` (MK6, conditional) |
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
  are **not** sent (§MK4.2).
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
  per-order list in read-before-write, step 2 of §MK4.5). It POSTs the list to
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
and the office can see and correct it (§MK4.8 "send again / note"), so review-first buys nothing that
billing's existing check does not already give. Office-filed papers (`lumper_receipt`, `revised_rc`) are
already reviewed by the filer — their trigger is the filing.

**D-MK4-5 — One PDF per (stop, kind), pages in capture order.** A BOL photographed as three pages is
one document to billing. The API worker assembles the JPEGs (`load-photos`) into one PDF with `pdf-lib`
(already `apps/api/package.json:54`), one page per photo, image embedded unscaled, `captured_at` order
then `id` as tie-break. Office files go as uploaded (PDF/JPEG/PNG). *MK0 check:* POST a 2-page PDF to the
test company; `GET /images/{id}` returns it with 2 pages ⇒ as written. If PDF is refused (415/400 naming
the type): send multi-page TIFF (`sharp` is a dependency, `apps/api/package.json:59`; `sharp(...).tiff()`
per page joined with `tiff` multipage via `sharp` `join` is NOT supported — use one TIFF per page) ⇒ then
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
  load_id           uuid references public.loads(id) on delete set null,   -- bol/pod
  stop_id           uuid references public.load_stops(id) on delete set null,
  lumper_case_id    uuid references public.lumper_cases(id) on delete set null,
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
  retention policy in `dataRetentionPolicy.ts` with the SAME retention as `load-photos` (it is a derived
  copy; the source photos are the evidence). `mcleod_image_sends` goes in `RETENTION_FORBIDDEN`
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
- `candidates.ts` — `findImageCandidates(admin, orgId)`: completed stops (`status='completed'`,
  `completed_at > now() - 14 days`) of `source='tms'` loads with `bol`-slot photos and no
  `mcleod_image_sends` row for (stop, kind); lumper files with no send. **Set-based**: one SQL function
  `mcleod_image_candidates(p_org uuid)` in M-D1 (service-role only; `revoke all … from public, anon,
  authenticated`), not N queries — and org-filtered (`expectOrgScoped` in the test).
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
- `routes` (in `apps/api/src/modules/mcleod/routes/tmsImages.ts`, connector token):
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
  `PUT /api/settings/mcleod/image-map/:company/:kind`. Audit: one `audit_logs` row (the existing table
  the settings routes write; same helper) `action='mcleod.image_map.set'`, before/after document type.
- Sends: no person acts — the audit is `mcleod_image_sends` + the request's state history (pipeline).
- Office "send again" on a `refused`/`conflict` send (§MK4.8): `requireSection("dispatch","manage")`;
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
  (2) `mcleod_image_candidates` returns exactly the completed tms stops with bol photos and no send,
  never another org's; (3) `uq_mcleod_image_sends_bytes` refuses a second identical send;
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
  (`dataRetentionPolicy` suite) asserts it.

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

