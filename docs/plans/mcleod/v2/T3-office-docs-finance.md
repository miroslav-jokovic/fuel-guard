# T3 — office writes, documents and finance (McLeod API Kit v2, Track D)

**Status:** PLAN, 2026-11-27, against `origin/main` merged into this branch (migrations end at
`0655_sent_load_visible_at_any_mcleod_status.sql`, PR #2684 merged). Index: `../MCLEOD-API-KIT-PLAN-V2.md`. Decisions
are the register's (`../DECISION-REGISTER-2026-11-20-API-KIT.md`); every D-MK id below is its. T2's interfaces
(`v2/T2-transport.md` top) and T1's (`v2/T1-driver-and-data.md` §0, N-4, N-8, N-16) are used by name and never
restated. Every file:line below was re-read on 2026-11-27. Migration numbers: none is taken here; each is the next free
one at merge (D-MK18), and the ORDER below is fixed.

**What T3 carries from T2 and T1 (cited, not re-decided):**
- MK4's dedupe `mcleod_image_sends (stop_id, kind, sha256)` (D-MK8) reads **`load_stop_photos.sha256`**, which T1 N-8
  adds and which both `driver_complete_stop` and `driver_add_stop_photos` write. Spec D's M-D2 is in M-A; **T3 adds no
  photo column.**
- **D-DA1** (`docs/plans/drivers-app/DRIVER-APP-ENTERPRISE-PLAN.md:173-174`): no driver lumper or detention screen. A
  lumper *document* kind stays only if billing needs it (that plan's outside fact X6, `:645`). D-2 is written that way.
- **N-16** built Hire again's roster half (reopen → applicant; `hire_applicant` clears `termination_date` and
  `archived_at` at the close; the sweep hires a reopened row only on McLeod's own reactivation while
  `driver_reactivate` is not `live`; permission `recruitment.reopen_former_driver`). T3's D-7 is the `/ws` write and
  its switch. **N-4** built `linkHiredDriverToTms`.
- `subject_ref` for driver and unit operations is `<subject id>:md5(payload)` (T2 §T-4.3). Each T3 PR that builds an
  adapter adds its operations to `packages/shared/src/mcleodWriteOperations.ts` (T2 §T-4.1); images and
  `driver_create` are `resend: "office_decides"` (D-MK10).
- Alerts: category `mcleod_write` (T-4b); recipients by section capability (D-MK31).
- Every T3 operation other than `stop_clear` needs a **test company** before `canary` (D-MK12, MK015, R4-3). So every
  T3 write waits on register §6 "Write-capable test company"; if none is ever named, every T3 operation stays `off`
  and only the 360 halves below ship (each step says which half that is).

**Facts this track builds on (2026-11-27):**
- `lumper_case_files.kind` is still `check (kind in ('revised_rc'))` (`0601_lumper_case_files.sql:23`); there is no
  `source` column, so no RC has ever been imported from McLeod; the office upload inserts `kind: "revised_rc"`
  (`apps/api/src/modules/mcleod/lumper/lumperCases.ts:239`); the route chain is `requireModule("dispatch")` +
  `requireSurface("dispatch.lumper-cases")` (`mcleod/lumper/routes.ts:16-17`, applied in the same file).
- **DB7 was run** on 2026-11-24 (`docs/plans/dispatch-loads/DISPATCH-BOARD-PLAN.md:595-624`): within 4 hours of
  arrival the board's p90 absolute error is **689 min**, against spec D's write threshold of 90. Its tail was diagnosed
  on 2026-11-25 (`:626-672`): a full 10-hour reset added to a driver already resting, and 30 % of McLeod arrivals typed
  as the appointment time. So spec D's **D-MK6-1b holds today: no ETA is written** (D-12).
- `driver_time_off` was last written 2026-11-17 (index §3 facts). The connector posts `/api/tms/driver-time`
  (`routes/tmsIngest.ts:305`) only when `MCLEOD_DRIVER_TIMEOFF_PATH` is set (`tools/mcleod-agent/agent.mjs:397-405`,
  an HTTP route left disabled by default, `config.example.env:43`). Whether that line is set on the VM is asked in the
  Alex message (D-13).
- Finance grants (`tools/mcleod-agent/review/SILVICOM-GRANTS.sql`): Part 4 **not run** (`:153`) except
  `billing_history` and `drs_deduct_hist`, which came with Part 5 (run 2026-11-17, memory `finance-reports-v2-position`);
  Part 6 (imaging) not run (`:195`). The header (`:57-67`) still says Part 5 is waiting — D-10a corrects it.
- File sizes (`wc -l`): `packages/shared/src/tms.ts` 499, `rosterContract.ts` 452, `apps/web/src/pages/VehiclesPage.vue`
  455, `TrailersPage.vue` 441, `apps/api/src/modules/roster/routes/drivers.ts` 328, `MedicalTab.vue` 139,
  `McleodFleetsSettingsPage.vue` 146, `dispatchLoads/detail.ts` 222, `loadsContract.ts` 259, `mcleod/tmsIngest.ts` 419,
  `mcleod/routes/tmsIngest.ts` 397.
- Ruled facts the older specs get wrong and T3 does not repeat: email is **never** written to McLeod (`mail.md:89`);
  `reason_for_leaving` is a 3-character McLeod code (council OF-7); `handApplicationToTms` updates only
  `status='applicant'` rows (`roster/driverTmsHandover.ts:18-28`); McLeod driver field edits beyond medical-card and
  CDL expiry are **not** built (owner O-2, narrow fields; audit D-61); the TIFF branch is dropped (council OF-10);
  `/api/mcleod` is not a mount — office routes live under `/api/integrations/mcleod/…` as T2's do.

---

## 0. Order (the T3 rows of the index's §2 table, expanded)

| # | PR | Migration (order only) | Needs | Rel before the next dependent | Outside gate |
|---|---|---|---|---|---|
| D-1 | MK4 tables + the pipeline's image and non-stop extensions | mcleod — after T-4's (D-MK18) | T-4 applied | stg | — |
| D-2 | Lumper receipt as a billing document (no driver screen) | mcleod — after D-1's | D-1 applied | stg before its upload UI | **X6** (billing) |
| D-3 | MK4 API: sweep, assembly, agent routes, Send again | — | D-1 stg; T-5 prod | prod | — |
| D-4 | MK4 agent: `images.mjs`, lumper echo guard | — | D-3 prod | rides CU-1 or CU-2 (below) | McLeod: where an image lands (D-MK30) |
| D-5 | MK4 office UI: category map, stop paper lines | — | D-3 merged | prod | — |
| D-6 | MK5 base: row adapters, driver options, end employment | mcleod (options) · roster (two columns) — two files | T-5 prod | prod; agent half per CU rule | K25 or Alex (D-MK40) |
| D-7 | Hire → McLeod: create and reactivate | — | D-6, N-4, N-16 prod | prod; agent half per CU rule | **Q-1, Q-4** |
| D-8 | Truck and trailer status asks McLeod | — | D-6 prod | prod; agent half per CU rule | K-probes (below) |
| D-9a | The phone-claim defect (no McLeod write) | roster — any time | — | prod | — |
| D-9b | Medical card / CDL "Update McLeod" | — | D-6 prod, D-9a merged | prod; agent half per CU rule | K21 (`license_date` writable) |
| D-10a | Finance, repo half: fuel purchases, compare tool, copy guard, grants file | mcleod — any time | — | prod; statements ride CU-1 | — |
| D-10b | Finance cut-over (operation) | — | D-10a prod, CU-1 on the VM | — | **Alex: Part 4 grants** |
| D-11 | DB7 (analysis) | — | — | **done 2026-11-24/25** | — |
| D-12 | ETA write (conditional) | mcleod (holds) — only under D-MK6-1a | DB7 re-run passes; T1 N-15 | prod | Alex item 10, K22 |
| D-13 | Home time (probe, then conditional write) | mcleod (map) — only under H1 | T-6 (VM configured) | prod | Alex item on the driver-time line |

**The connector-update rule (closes "which visit carries T3's agent code").** D-MK38 makes CU-1 the one update with a
SQL review. T3's agent halves are of two sorts:
- **SQL statements** (D-10a's finance statements) ride **CU-1** and are inside its one SQL review. D-10a has no
  dependency, so it merges before CU-1 is cut. T2 §CU-1's list gains that line (edited in this PR).
- **`/ws` adapters** (D-4, D-6, D-7, D-8, D-9b, D-12, D-13) contain no SQL, so Alex's review condition (`mail.md`: new
  SQL reaches him before it runs) does not apply to them. Each adapter merged on main when CU-1's commit is cut rides
  CU-1; every later one rides **CU-2**, one later connector update (same `update-connector.ps1` path, every new line
  off, one VM visit), cut when the last T3 adapter whose outside gate is answered has merged. No third update exists
  for T3; an adapter whose gate is answered after CU-2 waits for the next connector update the agent needs anyway.

**Order rules that are not obvious from the table:**
- D-1 re-creates two T-4 functions (`mcleod_write_claim`, `mcleod_write_settle`) and one trigger function (MK015's):
  T-4 must be applied first; D-1 is in the same module (mcleod), so no waiver line.
- D-6's roster columns are their own merge; their first writer (D-6's end-employment route) is the next merge
  (`lint:migration-ordering`, audit D-35).
- D-9a is independent of everything McLeod and should ship early: it removes a defect that silently stops McLeod's
  refresh of a driver row.

---

## D-1 MK4 tables and the pipeline's image and non-stop extensions

**What changes for a user.** Nothing: every switch is `off`.

**Files.**
- New `supabase/migrations/<next>_mcleod_image_sends.sql` (module `mcleod`). Header in the house register: the gap
  (360's papers never reach McLeod; billing re-scans them); why one row per paper and the request separate (audit D-54:
  Send again is a new request on the same paper); why the files are kept as long as the row (audit D-52 (a): they are
  the exact bytes delivered to billing); why canary scope for images is by customer (register defect 4, `RE-RULINGS.md`
  preamble); deploy window (new tables; the re-created functions keep their signatures); rollback.
- `scripts/table-modules.json`, `table-writers.json`, `table-lifecycle.json` (three entries each),
  `apps/api/src/modules/org/dataRetentionForbidden.ts` (`mcleod_image_sends` beside `mcleod_settlements` at `:319`),
  `apps/api/src/modules/org/storageReconcile.ts` (one `{ bucket: "mcleod-outbound", table: "mcleod_image_sends" }`
  source, the `load-photos` shape at `:297`: orphans only, no retention rule), `supabase/schema.generated.sql`,
  `supabase/tests/rls.test.mjs` (seeds), `supabase/tests/definer-rpc-grants.test.mjs`.
- `packages/shared/src/mcleodWriteTunables.ts`: `imageNotVisibleRereadS: [900, 2700, 82800]` (cumulative 15 min, 1 h,
  24 h — D-MK30's staged schedule).
- New matrix `supabase/tests/mcleod-images.test.mjs`.

**Migration DDL.**
```sql
-- McLeod's image categories as /ws reports them (GET /images/{rowType}/{rowId}/documentTypes), per company and row
-- type. Append-only observations; newest seq per (org, company, row_type, document_type_id) wins.
create table public.mcleod_image_categories (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity unique,
  org_id           uuid not null references public.organizations(id) on delete cascade,
  company_id       text not null check (length(company_id) between 1 and 10),
  row_type         text not null check (row_type ~ '^[A-Za-z_]{1,20}$'),   -- the spelling MK0 measured (D-MK4-1)
  document_type_id text not null check (length(document_type_id) between 1 and 40),
  description      text not null check (length(btrim(description)) between 1 and 200),
  listed           boolean not null,                                       -- false = a refresh no longer lists it
  seen_at          timestamptz not null default now()
);
create index mcleod_image_categories_current
  on public.mcleod_image_categories (org_id, company_id, row_type, document_type_id, seq desc);

-- Which McLeod category each of our kinds is filed under (D-MK29: a distinct category, picked once per kind by a
-- person). Append-only; newest seq per (org, company, kind) wins. MK020 refuses a category not currently listed.
create table public.mcleod_image_kind_map (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity unique,
  org_id           uuid not null references public.organizations(id) on delete cascade,
  company_id       text not null check (length(company_id) between 1 and 10),
  kind             text not null check (kind in ('bol','pod','revised_rc')),
  row_type         text not null check (row_type ~ '^[A-Za-z_]{1,20}$'),
  document_type_id text not null check (length(document_type_id) between 1 and 40),
  set_by           uuid not null,                                          -- no FK (D-MK6 rule)
  set_at           timestamptz not null default now()
);
create index mcleod_image_kind_map_current on public.mcleod_image_kind_map (org_id, company_id, kind, seq desc);

-- One row per PAPER 360 files into McLeod. The request(s) that file it are mcleod_write_requests rows whose
-- image_send_id points here (the first by the sweep, each Send again an office_retry superseding the last).
create table public.mcleod_image_sends (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  kind                text not null check (kind in ('bol','pod','revised_rc')),
  prove               boolean not null default false,                      -- a T-11 proof on the test company
  load_id             uuid references public.loads(id) on delete restrict,
  stop_id             uuid references public.load_stops(id) on delete restrict,
  lumper_case_file_id uuid references public.lumper_case_files(id) on delete restrict,
  source_photo_ids    uuid[] not null default '{}' check (cardinality(source_photo_ids) <= 40),
  company_id          text not null check (length(company_id) between 1 and 10),
  row_type            text not null check (row_type ~ '^[A-Za-z_]{1,20}$'),
  row_id              text not null check (length(row_id) between 1 and 20),  -- the order id (loads.ref) or, under
                                                                              -- D-MK4-1 outcome (ii), the movement id
  document_type_id    text not null check (length(document_type_id) between 1 and 40),
  page_count          integer not null check (page_count between 1 and 40),
  file_path           text not null unique,                                -- bucket mcleod-outbound
  mime                text not null check (mime in ('application/pdf','image/jpeg','image/png')),
  byte_size           bigint not null check (byte_size between 1 and 26214400),
  sha256              text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by          uuid,                                                -- no FK; null = the sweep
  created_at          timestamptz not null default now(),
  constraint mcleod_image_sends_stop_paper check (prove or kind not in ('bol','pod') or
    (load_id is not null and stop_id is not null and lumper_case_file_id is null and cardinality(source_photo_ids) >= 1)),
  constraint mcleod_image_sends_case_paper check (prove or kind <> 'revised_rc' or
    (lumper_case_file_id is not null and stop_id is null and cardinality(source_photo_ids) = 0)),
  constraint mcleod_image_sends_prove check (not prove or (load_id is null and stop_id is null and lumper_case_file_id is null))
);
create unique index mcleod_image_sends_one_paper on public.mcleod_image_sends (stop_id, kind, sha256)
  where stop_id is not null;                                                -- D-MK8
create unique index mcleod_image_sends_one_case_file on public.mcleod_image_sends (lumper_case_file_id)
  where lumper_case_file_id is not null;
create index mcleod_image_sends_order on public.mcleod_image_sends (org_id, company_id, row_type, row_id, document_type_id);

alter table public.mcleod_write_requests
  add constraint mcleod_write_requests_image_send_fk foreign key (image_send_id)
  references public.mcleod_image_sends(id) on delete restrict;              -- T-4 left the FK to this migration

-- The revised-RC import (LUMPER-REVISED-RC-PLAN) will add the same column; whichever merges first owns it, the other
-- keeps `if not exists` (one owner per column, spec D M-D3's rule).
alter table public.lumper_case_files add column if not exists source text not null default 'upload'
  check (source in ('upload','mcleod'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('mcleod-outbound', 'mcleod-outbound', false, 26214400, array['application/pdf','image/jpeg','image/png'])
  on conflict (id) do nothing;                                              -- no client policy: service role only

alter table public.mcleod_image_categories enable row level security;
alter table public.mcleod_image_kind_map   enable row level security;
alter table public.mcleod_image_sends      enable row level security;
```

**Triggers and error codes** (continuing T2's MK0xx series):

| Code | Trigger | Rule |
|---|---|---|
| MK011 | before update or delete on the three tables | append-only (the T-4 function, attached here); DELETE only by the org cascade |
| MK020 | before insert on `mcleod_image_kind_map` | the (company, row_type, document_type_id) is `listed` in its newest categories row |
| MK021 | before insert on `mcleod_image_sends` | load, stop and case file belong to the row's org; the stop is on the load; every `source_photo_ids` element is a `load_stop_photos` row of that stop |
| MK022 | before insert on `mcleod_write_requests` where `subject_kind = 'image'` | the send belongs to the request's org and company |

**Functions** (all `volatile`, `security definer`, `set search_path = ''`, service role only):
- `mcleod_image_send_create(p_org, p_kind, p_load, p_stop, p_case_file, p_photo_ids, p_company, p_row_type, p_row_id,
  p_document_type_id, p_page_count, p_file_path, p_mime, p_size, p_sha256, p_customer_id, p_actor) returns jsonb` —
  one transaction: insert the send (`on conflict do nothing` on either partial index; then read the existing row), then
  `mcleod_write_enqueue(p_org, gen_random_uuid(), 'image_file', 'image', p_company, 'sweep', {image_send_id,
  customer_id}, {document_type_id, row_type, row_id, mime, sha256, byte_size, page_count, kind}, {}, null, p_actor)`.
  Returns `{send_id, request_id, created}`. A send without its request cannot exist (spec D's reason for an RPC: supabase-js
  cannot span a transaction).
- **`mcleod_write_claim` re-created** (body = T-4's, one branch added): for `subject_kind = 'image'` the canary test is
  `customer_id = any(scope.customer_ids)`, not `subject_id` — an image's subject id does not exist until the paper does,
  so a `subject_ids` scope could never be written in advance (register defect 4).
- **MK015 re-created**: an image operation's canary scope is `{"customer_ids": non-empty array of strings}`; a driver or
  unit operation's stays `{"subject_ids": non-empty}`.
- **`mcleod_write_settle` re-created** (body = T-4's, one change): an `applied_unverified` or a `transient` with
  reason `not_visible_yet` takes `p_backoff_s` when it is given and between 60 and 86400 (the agent sends the next value
  of `imageNotVisibleRereadS` from the claim's tunables, so the schedule has one source); otherwise T-4's value. The
  `notVisibleReads`-th read still ends `conflict accepted_not_visible` (3 reads = 15 min, 1 h, 24 h). The column check
  `backoff_s between 0 and 3600` is replaced by `between 0 and 86400`.
- **`mcleod_write_prove_subject(p_org, p_actor, p_operation, p_company, p_subject jsonb, p_payload, p_expected) returns uuid`**
  — the non-stop sibling of T-4's `mcleod_write_prove`: only when the newest switch for (org, operation, company) is
  `test` and `is_mcleod_test_company(p_org, p_company)`; `origin='prove'`; the subject is the test company's row
  (driver and unit ids are `uuidV5` of `org:company:<McLeod id>` — no FK exists to violate; an image subject is a
  `prove` send row).

**Tests** (`mcleod-images.test.mjs`, prints `RESULT`): "a second send of the same photos for the same stop and kind
inserts nothing and returns the first"; "a send and its request are created together or not at all"; "a send whose
photos belong to another stop is refused (MK021)"; "a kind map naming a category McLeod no longer lists is refused";
"every image table refuses UPDATE and DELETE"; "the kind check equals MCLEOD_IMAGE_KINDS" (reads both CHECKs against
the built shared constant, the `unit-file-kinds.test.mjs` pattern); "an image canary admits a listed customer and holds
another"; "an image canary scope of subject ids is refused"; "the image re-read schedule ends accepted_not_visible
after the third read"; "a non-stop prove request needs a test switch on a test company"; "org deletion removes the
sends, categories and map". `definer-rpc-grants.test.mjs`: the three new/re-created functions are service-role only.

**Gates.** `lint:migrations`, `lint:migration-ordering` (functions only; their TS callers are D-3), `lint:rls`,
`lint:table-modules`/`-writers`/`-producers`/`-lifecycle` (categories `fleet`; map `fleet`; sends `time` 600/day =
2× the ~210 stops a day measured for `mcleod_dispatch_stops`, retention null, in `RETENTION_FORBIDDEN`),
`lint:schema-snapshot`, `lint:comment-claims`, the matrix `RESULT` line.

**Staging check.** `select count(*) from mcleod_image_sends` = 0; `select id from storage.buckets where id =
'mcleod-outbound'` = one row; `select pg_get_function_identity_arguments(oid) from pg_proc where proname =
'mcleod_write_settle'` = T-4's signature unchanged.

**Rollback.** Code revert is safe (nothing calls the new functions until D-3). The schema stays (a rollback never
reverses a migration); the re-created functions behave as T-4's for every non-image request.

**Release dependency.** Staging before D-3.

---

## D-2 Lumper receipt as a billing document (no driver screen)

**Blocked on one answer: X6** of the enterprise plan (`DRIVER-APP-ENTERPRISE-PLAN.md:645`, "Does billing need … lumper
receipts?", answered by billing through the owner). D-DA1 removes every driver lumper screen, so this is only an
**office** upload on the lumper case. Builds per outcome:

| X6 | Build |
|---|---|
| Yes, billing wants lumper receipts in McLeod | Migration (mcleod) widens `lumper_case_files.kind` to `('revised_rc','lumper_receipt')`, and `mcleod_image_sends.kind` + `mcleod_image_kind_map.kind` to add `lumper_receipt` (same CHECK re-set on both). Next merge: `MCLEOD_IMAGE_KINDS` gains it; the lumper case upload (`lumperCases.ts:239`) takes a `kind` parameter instead of the literal; the case page's upload offers "Lumper receipt". Gate unchanged (`requireSurface("dispatch.lumper-cases")`). Test: "a lumper receipt filed on a case is sent once, as its own paper". |
| No | Nothing is built; `MCLEOD_IMAGE_KINDS` stays `bol, pod, revised_rc`. |
| Never answered | As "No"; the lumper case keeps revised RCs only. |

**Gates** (yes branch): `lint:migrations`, `lint:migration-ordering` (CHECK first, writer the next merge),
the D-1 matrix title "the kind check equals MCLEOD_IMAGE_KINDS". **Staging check:** upload a receipt on a staging
case; `select kind from lumper_case_files order by created_at desc limit 1` = `lumper_receipt`. **Rollback:** revert the
UI; the wider CHECK stays. **Release:** staging before the upload UI.

---

## D-3 MK4 API: the sweep, the assembly, the agent routes, Send again

**What changes for a user.** Nothing while `image_file_*` is `off`. With a switch on, a driver's completed stop files
its BOL (pickup) or signed delivery copy (dropoff) into McLeod beside the capture app; a revised RC filed on a lumper
case files into McLeod's Rate Confirmation category unless McLeod already has one.

**Operations** (added to `packages/shared/src/mcleodWriteOperations.ts` here; two operations so each has its own
proof and switch, audit D-20/D-21):
```ts
image_file_stop:   { subject: "image", resend: "office_decides", phase: "MK4", alertSection: "dispatch" },  // bol, pod
image_file_office: { subject: "image", resend: "office_decides", phase: "MK4", alertSection: "dispatch" },  // revised_rc
```
The registry entry gains `alertSection` here (T2's `stop_clear` gets `"dispatch"`), so T-4b's catalogue and the watch
read the section from one place. D-1's RPC enqueues `image_file_stop` for `bol`/`pod` and `image_file_office` for
`revised_rc` (one CASE, pinned by the matrix title "each kind enqueues its own operation").

**Files.**
- New `packages/shared/src/mcleodImagesContract.ts` (+ test): `MCLEOD_IMAGE_KINDS = ['bol','pod','revised_rc']`;
  `imageKindForStopPhoto(stopKind, slot)` (`pickup`+`bol` → `bol`, `dropoff`+`bol` → `pod`, else null — the one place
  the slot rule lives); `imageCategoryRefreshSchema`, `imageSendSettledObservedSchema` (`{image_id, listed_ids_count}`,
  the allowlisted `observed` keys, D-MK14), `ImageSendState` (office read).
- New `apps/api/src/modules/loads/stopPapers.ts`, exported from `loads/index.ts`: `completedStopPapers(admin, orgId,
  sinceIso)` → stops with `status in ('completed','skipped')` (audit D-55: a skipped stop's paper is still a paper),
  `completed_at` ≥ `sinceIso`, of `source='tms'` loads, with their `bol`-slot photos `{id, storage_path, sha256,
  captured_at}`; two org-filtered reads through `fetchAllPagedIn`. The `scripts/check-feature-boundaries.mjs`
  comment on `"mcleod -> loads"` gains `completedStopPapers` (audit D-65: the comment is the record of what the edge
  carries).
- New `apps/api/src/modules/mcleod/images/{candidates,assemble,sweep,reads}.ts` (+ tests), each under 450 lines:
  - `candidates.ts` — `findImageCandidates(admin, orgId, now)`: stop papers of the last 14 days (D-MK25's window)
    minus `(stop_id, kind)` pairs that already have a send, **except** that late photos (a `stop_photo_added` event
    after the stop's last send) make a new candidate holding **only the photos in no earlier send**; revised-RC case
    files with `source='upload'` and no send. A candidate whose (company, kind) has no map row is counted `unmapped`,
    never queued. **One in flight per order and category** (council OF-8 step 3): a candidate is skipped while another
    send for the same (company, row_type, row_id, document_type_id) has a request not ended.
  - `assemble.ts` — downloads the photos (`load-photos`), recomputes each sha256 and compares it with the stored one
    (a mismatch → no send, an office exception `photo_bytes_changed`), builds one PDF per (stop, kind) with
    `PDFDocument.create({ updateMetadata: false })`, pages in `captured_at` then `id` order, `embedJpg` unscaled (council
    OF-10: deterministic bytes; no date is written). When the capability `image_upload_format` is `jpeg` (MK0: PDF
    refused), each photo is its own send with its original bytes. Uploads to `mcleod-outbound` at
    `org/<org>/<kind>/<send id>.<ext>`, then calls `mcleod_image_send_create`.
  - `sweep.ts` — scheduler `mcleod-image-file` (`apps/api/src/schedulers.ts`, lane `general`, every 2 min, `inFlight`
    guard, each org in its own try — the T-5 watch shape); runs for an org only while `image_file_stop` or
    `image_file_office` has a newest switch row other than `off` (no row = off, so a dark org queues nothing and no
    `stale_intent` pile-up can form). `docs/WORKER-DEPLOYMENT.md` gains the row.
  - `reads.ts` — `readImageSendStates(admin, orgId, {stopIds, caseFileIds})` and `knownMcleodImageIds(admin, orgId,
    imageIds)` (image ids from `confirmed` events' `observed->>'image_id'`), exported from `mcleod/index.ts`.
- `apps/api/src/modules/mcleod/routes/tmsMcleodApi.ts` gains (ingest token + write token + write limiter, T-3's chain):
  `POST /api/tms/mcleod-api/image-categories` (the agent's daily refresh: inserts a `listed` row for each category and a
  `listed=false` row for one no longer returned) and `GET /api/tms/mcleod-api/image-sends/:id/file` (302 to a
  10-minute signed URL; 404 unless the send's newest request is leased by this token's org).
- `apps/api/src/modules/mcleod/routes/mcleodApiControl.ts` (T-5's office file) gains: `GET/PUT
  /api/integrations/mcleod/image-map` (`requireSection("settings","view")` / `("settings","manage")` + step-up on
  PUT; inserts a map row; `writeAudit("mcleod.image_map.set")` with before/after) and
  `POST /api/integrations/mcleod/image-sends/:id/send-again` — `image_file_stop`: `requireSection("dispatch","manage")`;
  `image_file_office`: `requireSurface("dispatch.lumper-cases")` (audit D-57: the accountant works the lumper list);
  enqueues `origin='office_retry'` superseding the head of the chain (T-4's rule); `writeAudit("mcleod.image_send.retry")`.
- `MCLEOD_WRITE_REASONS` (T-5's shared map) gains, in the non-native-reader register (council OF-20):
  `category_missing` "McLeod no longer offers this paper type on this order. Ask billing which type to use.";
  `photo_bytes_changed` "This photo changed after the driver took it, so 360 did not send it.";
  `filed_ambiguous` "In McLeod, but 360 could not tell which copy is ours.";
  `rc_already_in_mcleod` "McLeod already has a rate confirmation from after the lumper. Not sent again.";
  `accepted_not_visible` (images) "McLeod took the file, but it is not on the order after 24 hours. Ask billing to check.";
  `outcome_unknown` (images) "360 does not know if McLeod got this file. Check the order in McLeod, then Send again or leave it."

**Tests.** `stopPapers.test.ts`: "lists only completed or skipped McLeod stops with BOL photos, org-scoped"
(`expectOrgScoped`). `candidates.test.ts`: "a stop already sent is not a candidate"; "late photos make a candidate of
only the new photos"; "a kind without a category is counted unmapped and not queued"; "a second paper for the same
order and category waits while the first is open". `assemble.test.ts`: "assembles the same photos twice to the same
sha256"; "pages follow capture order"; "a photo whose bytes changed is not sent and opens an exception"; "jpeg format
sends each photo as its own paper". `sweep.test.ts`: "an org whose image switches are off queues nothing".
`tmsMcleodApi.images.test.ts`: "the file route answers 404 for another org's send"; "a category refresh marks a
missing category unlisted". `mcleodApiControl.images.test.ts`: "Send again on a BOL needs dispatch manage"; "Send
again on a revised RC is open to the lumper list's people"; "the category map needs settings manage and a step-up".
`mcleodImagesContract.test.ts`: "every photo slot answers a kind or none".

**Gates.** `lint:boundaries` (`mcleod -> loads` through the index), `lint:table-access`, `expectOrgScoped`
everywhere, route-gate ledger (gates inline, RT-16), WORKER-DEPLOYMENT row, `lint:filesize`/`funcsize`,
`lint:comment-claims`.

**Staging check.** With every switch `off`: `GET /api/integrations/mcleod/image-map` answers the empty map; the
scheduler logs `mcleod-image-file: 0 orgs on`; `select count(*) from mcleod_image_sends` stays 0 after a staging
driver completes a fixture stop.

**Rollback.** `off` rows (≤ one sweep) or revert; queued requests end `stale_intent` after 72 h (T-4).

**Release dependency.** Production before D-4 can claim.

---

## D-4 MK4 agent: `images.mjs`, the confirmation rule, the echo guard

**What changes for a user.** Nothing until a switch is on; then a filed paper shows "In McLeod" on the stop.

**Files.** `tools/mcleod-agent/images.mjs` (+ test), the write loop's adapter table (`writeAdapters.mjs`, T-8) gains
`image_file_stop` and `image_file_office`; `images.mjs` also runs the daily category refresh (one recent order per
company; when MK0 shows the list differs by order, per order at send time); `--api-prove --operation=image_file_*`.

**The adapter** (T-8's loop; claim size 1; D-MK10's fence):
1. `GET /images/{row_type}/{row_id}/documentTypes`: the mapped id must be listed, else settle `refused category_missing`.
2. `GET /images/{row_type}/{row_id}` → the snapshot of image ids. `image_file_office`: an image of the mapped RC
   category scanned on or after the case's lumper date (D-LRC16) → settle `already_in_mcleod rc_already_in_mcleod`,
   no POST.
3. Fetch the file (D-3's route); verify sha256 and size against the payload; a mismatch → `refused bytes_mismatch`.
4. `begin_send` → `go` only (`office_decides`: one send ever, D-MK10) → `POST /images/{row_type}/{row_id}/{document_type_id}`
   with the body encoding the capability `image_upload_encoding` names (raw body or multipart, MK0).
5. **Confirmation rule (D-MK29, council OF-8):** the returned id is listed → `confirmed`, `observed.image_id`;
   else exactly one new image (not in the snapshot) of the mapped category with our page count and a scan date ≥ the
   send − 5 min → `confirmed`; two or more → `conflict filed_ambiguous`, never re-sent; none →
   `applied_unverified` with the first `imageNotVisibleRereadS` back-off, then re-read at 1 h and 24 h (D-MK30
   "staged"); after the third → `conflict accepted_not_visible` (D-1's settle).
6. A lost answer after `go` → `conflict outcome_unknown` (T-4: an `office_decides` operation's transient after a send).

**The echo guard (D-MK29, council OF-9).** The revised-RC import (when LUMPER-REVISED-RC-PLAN's route (a) or (b)
lands) calls `knownMcleodImageIds` and never imports a 360 image as McLeod's; on route (b) it also skips rows whose
`bimd_user` is `<integration user>`. That PR carries the test "an RC 360 filed is not imported back as McLeod's".

**Per outcome of "where a `/ws` image lands" (D-MK30, asked in the McLeod message item 13):**

| McLeod's answer | Build |
|---|---|
| Stored on the order, listed by `GET /images/O/{id}` | as above |
| Staged for a batch | as above (step 5's schedule is that answer's build) |
| Needs a DocumentPower module we do not own | both image operations stay `off`; Q-10's cost rule applies before anyone buys it |
| Lands where billing cannot see it | both stay `off`; the office keeps filing by hand as today |
| No answer in 10 business days | both stay `off` (register §6) |

**Paper-quality gate (council OF-11, D-MK34's briefing):** `image_file_stop` goes `canary` only after either the scanner
capture is attached to stops (BOL plan Step 0.0) or a 14-day trial where a billing clerk the owner names marks each
360-filed BOL/POD readable, ≥ 98 %. Its briefing says drivers keep McLeod's capture app until then. Under D-DA12 no
driver has a build yet (1 of 195 has a login), so the trial waits for N-17 on the tablets; `image_file_office` does
not wait for it (office files, low volume, precise dedupe — spec D MK4.9 step 3).

**Tests** (`images.test.mjs`, stub `/ws`): "a category McLeod no longer lists is refused without a POST"; "an RC already
in McLeod after the lumper date is not sent"; "the returned id listed confirms at once"; "one new image of our
category confirms"; "two new images of our category end ambiguous and are never sent again"; "an image not visible
after 24 hours ends accepted_not_visible with one POST"; "a lost answer after the send ends outcome_unknown and is
never re-sent"; "bytes that do not match the payload are refused without a POST". Mutation (`scripts/mutation-check.mjs`):
remove step 2's RC branch → the "already in McLeod" title fails.

**Gates.** agent tests, `lint:agent-syntax`, `lint:mcleod-secrets`, manifest regenerated. **Staging check:** none (agent;
no VM on staging). **Rollback:** VM previous commit; `off` rows. **Release:** D-3 in production; reaches the VM in CU-1
or CU-2 (§0 rule). **Proof:** T-10/T-11 on the test company: P-image (one 2-page PDF to a test order, read back with 2
pages); records `image_upload_format`, `image_upload_encoding`, the POST→listed latency (5 uploads; a median over 2 h
moves the schedule to `[1800, 7200, 250200]` in the tunables file — 30 min, 2.5 h, 72 h).

---

## D-5 MK4 office UI: the category map and the stop paper lines

**What changes for a user.** Settings › McLeod fleets gains a **Document types** section: per company, three rows (BOL,
Delivery copy, Rate confirmation) each a list of McLeod's categories, and "N papers waiting for a type". The office load
page shows one line per sent paper under each stop's photos: "In McLeod (BOL) · 2:02 PM", "Sent to McLeod. Not on the
order yet.", or the reason sentence with **Send again**. The lumper case file row shows "In McLeod" or "McLeod already
has it".

**Files.** Merge 1: `packages/shared/src/loadsContract.ts` (259) — the stop detail gains `papers:
ImageSendState[]` with `.default([])`. Merge 2: `dispatchLoads/detail.ts` (222) reads `readImageSendStates` through
`mcleod`'s index — the `loads -> mcleod` edge T-5 adds for `readStopWriteStates`, whose boundary comment gains
`readImageSendStates`;
`McleodFleetsSettingsPage.vue` (146) gains `McleodDocumentTypes.vue` (new component, + test) — **a section on the
existing surface `admin.settings.mcleod-fleets`** (`surfaceCatalogue.ts:432`, gate `section("settings")`), so no new
surface and no tutorial stub (audit D-56); `StopPaperLines.vue` (+ test) on the load page; the lumper case file row.

**Tests.** `loadsContract.test.ts`: "a stop without papers from an older API still parses". `McleodDocumentTypes.test.ts`:
"a settings viewer sees the map and cannot change it"; "a type no longer listed by McLeod is shown as gone".
`StopPaperLines.test.ts`: "Send again shows only for refused, ambiguous, not-visible and unknown papers".

**Gates.** `lint:migration-ordering` (contract field before its reader — two merges), `lint:tokens`, `lint:design`,
`lint:filesize`. **Staging check:** Settings › McLeod fleets shows Document types with "No McLeod categories yet".
**Rollback:** revert. **Release:** prod with or after D-3.

---

## D-6 MK5 base: the row adapters, McLeod's driver codes, ending employment

**What changes for a user.** Ending a McLeod-linked driver's employment asks for McLeod's **Reason** (a list of McLeod's
codes) and **Can be hired again?**; with the switch on, McLeod gets the same termination. While `off`, the 360
termination works exactly as today and the driver page says "End this driver in McLeod too."

**Operations** (registry, here):
```ts
driver_end_employment: { subject: "driver", resend: "read_decides", phase: "MK5", alertSection: "roster" },
```
(T3 ruling 2: termination alerts go to the section whose gate the act used — `roster` manage — since D-MK31's table names
no row for it.)

**Files.**
- Migration 1 (mcleod) `<next>_mcleod_driver_options.sql`: append-only `mcleod_driver_options (id, seq, org_id,
  company_id, field text check (field in ('reason_for_leaving')), code text check (length(code) between 1 and 3),
  label text check (length(btrim(label)) between 1 and 80), listed boolean, source text check (source in
  ('ws','alex')), recorded_by uuid, seen_at)`; newest seq per (org, company, field, code) wins; RLS on; MK011.
  Manifests (`raw`, `fleet`).
- Migration 2 (roster) `<next>_driver_leaving_reason.sql` — **merged alone**: `drivers.reason_for_leaving text check
  (reason_for_leaving is null or length(reason_for_leaving) between 1 and 3)`, `drivers.can_rehire boolean`.
- Merge 3 (code):
  - `packages/shared/src/rosterContract.ts` (452 — the two lists only): `DRIVER_LIFECYCLE_FIELDS` (`:349`) gains
    `reason_for_leaving`, `can_rehire` (a recruiter cannot set them on an applicant, audit D-35); the PATCH audit's
    value list gains both. New `packages/shared/src/mcleodDriverWrites.ts`: `endEmploymentRequestSchema` (date, code,
    can_rehire).
  - `apps/api/src/modules/roster/driverUpdate.ts` (new): `applyDriverUpdate(admin, orgId, id, body, actor)` — the
    whole PATCH body (read → applicant guard → resolve → update → `driver.updated` audit) extracted unchanged from
    `routes/drivers.ts`; the route calls it (its tests are the refactor's proof, audit D-33/D-36). Exported from
    `roster/index.ts`; the `"mcleod -> roster"` boundary comment names it.
  - `apps/api/src/modules/mcleod/routes/officeWrites.ts` (new, registered from `routes/integrations.ts` beside T-5's
    control routes): `POST /api/integrations/mcleod/drivers/:id/end-employment` — gate `requireSection("roster",
    "manage")` inline (the PATCH's own answer); refuses 409 `not_linked` for a row without `mcleod_driver_id` or with
    `identity_source` not `mcleod`/`samsara`; the code must be a listed `mcleod_driver_options` row (else 422
    `unknown_reason_code`, nothing written); calls `applyDriverUpdate` first (the 360 termination is the legal act,
    written first, Q-MK6), then `mcleod_write_enqueue(… 'driver_end_employment', 'driver', company, 'office',
    {driver_id}, {is_active: 'N', termination_date, reason_for_leaving, can_rehire: 'Y'|'N'}, {is_active: 'Y',
    termination_date: null}, null, actor)`; `writeAudit("mcleod.driver_end_employment.requested")`.
  - `GET /api/integrations/mcleod/driver-options?field=reason_for_leaving` (`requireSection("roster","view")`).
  - `POST /api/tms/mcleod-api/driver-options` (agent, write token): the K25 read posts McLeod's codes (`source='ws'`).
  - Platform console `apps/admin-api/src/routes/mcleodWrites.ts` gains `POST /admin/mcleod-writes/orgs/:org/driver-options`
    (platform chain + step-up): Alex's written list (`source='alex'`, D-MK40 when K25 is unreadable), the audit row
    quoting his message's date.
  - Web: the termination drawer for a linked driver (`apps/web/src/features/roster/…`, the component the PATCH uses)
    shows Reason (select) + Can be hired again (Yes/No), required, and calls the McLeod route; an unlinked row keeps
    the PATCH. Strings once in `MCLEOD_WRITE_REASONS`.
  - Agent (`/ws` adapters, CU rule): `tools/mcleod-agent/writes/rowMap.mjs` — `toRowDriver(fact)` for the fields
    T3 writes (`is_active` Y/N, `termination_date`, `reason_for_leaving`, `can_rehire`, `hire_date`,
    `medical_cert_expire`, `license_date`; and, under Q-1 = yes only, `first_name`, `name`, `license_no`,
    `license_state`, `birth_date`) — **no email key, no SSN key** (mail.md:89; D-MK14);
    `toRowTractor`, `toRowTrailer` (D-8). `writes/rowUpdate.mjs` — partial or full PUT per the capability
    `row_update_mode.<table>` (MK0: GET, PUT one field, GET, diff); in full mode the agent PUTs the row it just read
    with only the requested fields replaced, then strips every key matching `/social|ssn|tax_id/i` from the final body
    (D-MK14, audit D-59). Precheck: the row's current values must equal `expected`, else `conflict changed_in_mcleod`.
    After `confirmed`, the agent re-reads the one row with the normal roster statement and posts it through the
    normal ingest, so 360 shows McLeod's value from the usual writer (spec D D-MK5-0d).
- **MK0 probes added to the T-6 list** (each a capability row): `row_update_mode.driver|tractor|trailer`; every key
  `toRowDriver` emits present on `RowDriver` (audit D-25); `reason_for_leaving` codes readable (K25); a driver who
  holds a tractor or is on a dispatched movement — is `is_active='N'` refused (council OF-22; test company only).

**Per outcome.** K25 readable → the agent posts the codes daily; unreadable → Alex's list (Alex message item) through the
console; neither → the end-employment route answers 409 `no_reason_codes` and the drawer says "End this driver in McLeod
too." (the 360 termination still saves). McLeod refuses ending a driver with a truck or a load → `refused
driver_has_work`, "McLeod will not end this driver while they have a truck or a load. Unassign them in McLeod first."

**Tests.** `officeWrites.endEmployment.test.ts`: "ending a linked driver saves the 360 termination first, then asks
McLeod once"; "a code not in McLeod's list is refused and nothing is written"; "an unlinked driver is refused with
not_linked"; "it needs roster manage"; "it is scoped to the caller's org" (`expectOrgScoped`). `drivers.test.ts`:
"the PATCH never asks McLeod" (the boundary, audit D-34). `driverUpdate.test.ts`: "the extracted update still writes
driver.updated". `rowMap.test.mjs`: "no McLeod body carries an email or SSN key"; "drivers use Y/N and trailers A/I";
`rowUpdate.test.mjs`: "full mode replaces only the requested fields"; "the final body has no SSN key even when
McLeod's row had one"; "a changed field ends changed_in_mcleod without a PUT". Matrix `rls.test.mjs` seeds for the
options table.

**Gates.** `lint:migrations`, `lint:migration-ordering` (roster columns alone; reader next merge), `lint:rls`,
`lint:table-*`, `lint:boundaries` (comments name `applyDriverUpdate`), route-gate ledger, `lint:filesize`
(`rosterContract.ts` must stay under 500: only list entries are added), `lint:comment-claims`.

**Staging check.** On a staging driver with a fixture McLeod link and no options: the drawer shows "End this driver in
McLeod too."; the 360 termination saves; `select count(*) from mcleod_write_requests` = 0.

**Rollback.** Revert merge 3 (the PATCH path is unchanged); the columns stay.

**Release dependency.** prod; agent half per §0's CU rule; the switch needs T-10's test company (else `off` forever).

---

## D-7 Hire → McLeod: create and reactivate

**Blocked on Q-1 and Q-4** (register §5; one reply). What ships before they are answered: the 360 half below with
both operations `off`; the close drawer says "Enter this driver in McLeod. 360 will connect them on the next McLeod
sync." (N-4's sweep link, council OF-3).

**Operations** (registry, here):
```ts
driver_create:     { subject: "driver", resend: "office_decides", phase: "MK5", alertSection: "recruitment" },
driver_reactivate: { subject: "driver", resend: "read_decides",   phase: "MK5", alertSection: "recruitment" },
```

**Files.**
- `packages/shared/src/mcleodDriverWrites.ts` gains `proposeMcleodDriverCode(first, last, taken)` (pure; the rule MK0
  measures: share of active ids equal to `upper(left(first,1) || left(last,7))` after stripping non-letters; ≥ 90 % →
  that rule with collisions replacing the last character by `2`, `3`…; < 90 % → the field starts empty and is
  required) and `mcleodHireBody(row, q1)` (Q-1's identity fields only when `q1`).
- `officeWrites.ts` gains `POST /api/integrations/mcleod/drivers/:id/hire-to-mcleod {code?}` — gate inline:
  `requireSection("recruitment","view")` + `requireNamedPermission(CLOSE_APPLICATION_PERMISSION)` (the close's own,
  `recruiting/routes/hire.ts:42-43`, `rolePermissions.ts:49`). It reads the row through roster's index and refuses 409
  `not_hired` unless `status='active'` with a `compliance.applicant_hired` audit. Then:
  - **the row has `mcleod_driver_id`** (a reopened former driver, N-16) → `driver_reactivate`, payload `{is_active: 'Y',
    hire_date: <the close's>, termination_date: null, reason_for_leaving: null}` (+ Q-1's identity fields when Q-1 =
    yes), expected `{is_active: 'N', license_no}`;
  - **no McLeod id** → `driver_create`, payload `mcleodHireBody`, expected `{absent_by_id: code, absent_by_licence:
    cdl_number}`.
  The web close drawer (`apps/web/src/features/recruitment/useHire.ts`, `HireDrawer`) calls it after
  `POST /api/recruitment/hire` answers 200; a failure of the second call never undoes the hire and the drawer shows
  "Not sent to McLeod yet. [Send now]" (the same idempotent call). Audit `mcleod.driver_create.requested` /
  `mcleod.driver_reactivate.requested`.
- **Backstop list** on Settings › McLeod fleets (D-5's surface): "Hired in 360, not in McLeod" — 360 hires of the last
  30 days with no `mcleod_driver_id` and no open create request, each with **Send**. Must read 0 after a normal day; the
  watch (T-5) raises a warning when it does not.
- Agent `writes/driverCreate.mjs` (CU rule): `GET /drivers/{code}` must 404 (else `conflict code_taken`);
  `GET /drivers/search` by licence (the parameter name read at MK0): an active driver → `conflict exists_in_mcleod`
  (the sweep links him, N-4); an inactive driver → `conflict former_driver_in_mcleod` with his id in `observed`
  (council OF-1 step 5: the office presses **Rehire this McLeod driver**, which enqueues a new `driver_reactivate`
  targeting the found id and links the 360 row with `linkHiredDriverToTms`, refusing 409 `mcleod_id_linked_elsewhere`
  when another 360 row holds it); else `GET /drivers/new` defaults + `toRowDriver(payload)` + SSN strip →
  `PUT /drivers/create` → read back → `confirmed`, `observed.mcleod_driver_id`. The result route links the 360 row with
  `linkHiredDriverToTms` (N-4) before the reconciliation post. `writes/driverReactivate.mjs`: precheck `is_active='N'`
  and licence equal; `can_rehire='N'` → `refused not_eligible_for_rehire` ("McLeod says this driver cannot be hired
  again (<code>).").
- While `driver_reactivate` is not `live`, N-16's sweep rule stands; when it is `live`, the sweep no longer waits for a
  hand reactivation (T1 N-16's condition reads the switch through `mcleod`'s index — `readWriteSwitch(admin, orgId,
  operation)`, exported here).

**Builds per owner answer.**

| Answer | Build |
|---|---|
| Q-1 yes, Q-4's sentence on file | both operations may go `test` → `canary` → `live`; create carries name, DOB, licence once; D-RL5a appended to `ROSTER-LIFECYCLE-PLAN.md` with the owner's sentence (RE-RULINGS row D-RL5) |
| Q-1 yes, Q-4 not given | `driver_reactivate` may go on (it creates nobody); `driver_create` stays `off` |
| Q-1 no | reactivation sends lifecycle fields only; `driver_create` stays `off` (a McLeod driver cannot be created without a name and a licence, council OF-4) |
| McLeod requires the SSN on create (K20, test company) | `driver_create` stays `off` for that company; the drawer says "Enter this driver in McLeod — McLeod needs the SSN, which 360 does not send." Sending the SSN would be a new owner ruling with its own plan |

**Tests.** `officeWrites.hire.test.ts`: "a reopened former driver's close asks McLeod to reactivate the same id, never
to create"; "a new driver's close asks McLeod to create once"; "the close's own permission is required"; "a hire that
failed asks McLeod nothing"; "it is scoped to the caller's org". `driverCreate.test.mjs`: "a code McLeod already has
ends code_taken"; "an active driver with the licence ends exists_in_mcleod without a PUT"; "an inactive driver with the
licence ends former_driver_in_mcleod with his id"; "the create body has no email and no SSN key". Shared:
`mcleodDriverWrites.test.ts` "a taken code gets the next free suffix"; "below 90 percent the code is left for the
office". Mutation: remove the licence search → "an active driver with the licence…" fails.

**Gates.** route-gate ledger, `lint:boundaries` (`mcleod -> recruiting`/`roster` comments name the functions),
`lint:filesize`. **Staging check:** close a staging applicant with both switches `off`: the drawer says "Enter this
driver in McLeod…"; no request row. **Rollback:** `off` rows; revert. **Release:** prod after D-6, N-4, N-16.

---

## D-8 Truck and trailer status asks McLeod

**What changes for a user.** On a McLeod-linked truck or trailer, the status is editable again for `equipment` managers
and **asks McLeod**: "Sent to McLeod. 360 changes when McLeod saves it (about 1 minute)." — with the switch on.
While `off`, the status stays read-only as today (`isStatusFromTms`, `tms.ts:382`).

**Operations:** `tractor_status`, `trailer_status` (`subject: "unit"`, `read_decides`, `alertSection: "equipment"`).

**Files.** New `packages/shared/src/mcleodUnitStatus.ts` (not `tms.ts`, 499 lines): `MCLEOD_UNIT_STATUS_REQUESTS` (truck:
Running → `tractor_status='A'`; In the shop → `'S'`; Sold — waiting for pickup → `'I'` with service `A`; Out of
service → `service_status='I'` + `outservice_date`; Back in service → `service_status='A'`; trailer: In service →
`is_active='A'`; Out of service → `is_active='I'` + `outservice_date`; `statuscode` and `disposition_code` never
written, council OF-6) and `statusEditRoute(row, switchOn): 'mcleod' | 'local' | 'readonly'`. "Running" on a truck
McLeod has at `V` is not sent (already running in 360's terms, audit D-69). The sub-status key on `RowTractor`
(`tractor_status` or another) is the capability `tractor_substatus_key` (MK0 on one S and one I truck; council OF-5);
absent → In the shop and Sold are not offered. New `apps/web/src/features/roster/UnitStatusMcleod.vue` (+ test) holds
the select, the chip "Waiting for McLeod: In the shop" and the call; `VehicleForm.vue`, `TrailerForm.vue` and the two
pages only mount it (VehiclesPage is 455 lines: one tag). `officeWrites.ts`: `POST
/api/integrations/mcleod/vehicles/:id/status` and `/trailers/:id/status` — `requireSection("equipment","manage")`
inline; 409 `not_linked` for an unlinked, `manual` or `efs` row; expected = the last swept facts. Agent `rowMap.mjs`
`toRowTractor`/`toRowTrailer` + the precheck (CU rule). **Retire outcome (audit D-40):** a truck McLeod has out of
service but whose gateway still reports stays active in 360 on `rosterRetire`'s held list: "Out of service in McLeod.
360 keeps it active while the truck still sends GPS." Unlinked units keep today's PostgREST status writes, unaudited —
out of scope, named (council OF-23).

**Tests.** `mcleodUnitStatus.test.ts`: "each office choice maps back to the status the sweep derives" (composes the
sweep's own `vehiclePatch(MAP.vehicles(row))` and the retire predicate, audit D-39); "Running on a V truck sends
nothing". Route: "only equipment managers may ask"; "an unlinked truck is refused". `UnitStatusMcleod.test.ts`: "a
linked unit with the switch on calls the API, never PostgREST, for status"; "with the switch off the status stays read-only".
Mutation: map In the shop to `V` → the first title fails.

**Gates.** `lint:vehicle-status` (the route spells no status), `lint:filesize`, route-gate ledger. **Staging check:**
switch `off`: a linked staging truck's status stays read-only. **Rollback:** `off`; revert. **Release:** prod after D-6.

---

## D-9a The phone-claim defect (no McLeod write; ship early)

**What changes for a user.** Editing a McLeod driver's phone in 360 no longer stops McLeod from refreshing that driver's
licence and medical dates. A Samsara-sourced row still becomes office-owned on a phone edit, as today.

**Files** (council OF-2, audit D-26/D-27): roster migration `<next>_claim_phone_only_from_samsara.sql` re-creates
`claim_identity_for_office()` (last defined `0241_identity_provenance_claim.sql`; `0242` re-created only the
vehicle/trailer triggers) so an argument `col@source` claims only when `old.identity_source = source`
(`split_part`), keeps `security definer`, `set search_path = ''`; re-creates the drivers trigger with
`'full_name','first_name','middle_name','last_name','phone@samsara'`. New `packages/shared/src/driverIdentityFields.ts`
(`{field, sources?}[]`), re-exported as `DRIVER_IDENTITY_FIELDS` from `rosterContract.ts` (`:360`); one helper
`claimsIdentity(field, identitySource)` used by `resolveDriverUpdate` and `wouldClaimFromTelematics`
(`driverEditMeaning.ts:42`). **Tests:** `rosterFields.claimParity.test.ts` "the trigger's arguments are the shared list
rendered as col and col@source"; trigger matrix "a phone edit on a McLeod row keeps it McLeod's"; "a phone edit on a
Samsara row makes it office-owned"; `driverEditMeaning.test.ts` "a phone edit on a McLeod row does not warn".
**Gates:** `lint:migrations`, `schema-drift-production-shape.test.mjs`, definer grants. **Staging check:** edit a
staging McLeod-sourced driver's phone; `identity_source` stays `mcleod`. **Rollback:** a migration re-creating 0241's
body. **Release:** prod, any time.

## D-9b Medical card and CDL: one click "Update McLeod"

**What changes for a user.** In Medical's "Sources disagree" list, a driver whose scanned card is the documented date
and whose McLeod date differs gets **Update McLeod to MM/DD/YYYY** (never automatic, D-MSUX7 unchanged). The same
button appears on a CDL certification whose scanned expiry differs from McLeod's.

**Operations:** `driver_medical_expiry`, `driver_cdl_expiry` (`driver`, `read_decides`, `alertSection: "safety"`).
`driver_cdl_expiry` exists only when MK0 shows `license_date` writable (capability `op.driver_cdl_expiry`); else the
CDL button is not shown.

**Files.** `officeWrites.ts`: `POST /api/integrations/mcleod/drivers/:id/medical` and `/cdl` —
`requireSection("safety","manage")` inline; the server recomputes `resolveMedicalExpiry` (`credentialSources.ts:51`)
through `evidence`'s index and refuses unless the rule is `documented` and McLeod's latest claim differs (the button's
date is never trusted); expected = McLeod's latest claim. After `confirmed` the reconciliation post records McLeod's new
claim through `recordSyncedCredentials` (`evidence/index.ts:39`), so the disagreement clears itself. `MedicalTab.vue`
(139) gains the button; the CDL row in the DQ file gains the same. Audit `mcleod.driver_medical.requested`,
`mcleod.driver_cdl.requested`.

**Tests.** "the button's date is recomputed on the server"; "a driver whose dates agree is refused"; "only safety
managers may ask"; "another org's driver is refused" (`expectOrgScoped`); `MedicalTab.test.ts` "the button shows only
on documented rows that disagree with McLeod". Mutation: drop the recompute → "the button's date is recomputed…" fails.

**Gates.** route-gate ledger, `lint:boundaries` (`mcleod -> evidence` comment), `lint:filesize`. **Staging check:**
with the switch `off` the button is absent. **Rollback:** `off`; revert. **Release:** prod after D-6.

---

## D-10a Finance, repo half: fuel purchases, the compare tool, the copy guard, the grants file

**What changes for a user.** Nothing yet; the Finance page footer later says where its figures come from ("From
McLeod, live, as of …" or "From the McLeod copy restored …").

**Files** (spec D MK2 with audit D-17/D-44/D-45 and council OF-12/OF-13/OF-14):
- Migration (mcleod) `<next>_mcleod_fuel_purchases.sql`: `mcleod_fuel_purchases` — the **28** columns
  `FUEL_PURCHASES` returns (`tools/mcleod-agent/queries.mjs:450`) plus `org_id`, `swept_at`; primary key `(org_id,
  company_id, external_id)`; `post_key`, `post_module` nullable (unposted purchases); RLS on; a set-based write RPC
  `mcleod_fuel_purchases_apply(p_org, p_rows jsonb)` (UPDATE then INSERT, never a partial upsert, `lint:upserts`);
  `RETENTION_FORBIDDEN` beside `mcleod_settlements` (books). Manifest: `raw`, `time`, 250/day.
- `POST /api/tms/fuel-purchases` in `mcleod/routes/tmsFinancial.ts` (shared zod schema, batches of 2,000); the agent
  posts `ex.purchases` after vouchers, and the comment at `tools/mcleod-agent/agent.mjs:832` ("Fuel purchases are
  deliberately NOT posted") is rewritten in the same PR.
- `source_db` (`lme` | `lme_analytics`) in `org_integrations.config` by `stampFinancialSynced` (`mcleod/tmsIngest.ts`),
  read by `readFinancialIntegration` — **no migration** (audit D-45).
- `tools/mcleod-agent/financeCompare.mjs` (+ test) with two configs: `--live-env` (`<read-only SQL login>` on LME) and
  `--copy-env` (`<analytics SQL login>` on the copy), run on the owner's Mac on the office network (council OF-13), so
  it never depends on Part 2 being re-run on the copy. "Closed month" = before the open period `mcleod_gl_control`
  holds in 360. Acceptance: every closed month equal to the cent per (statement, month, module, account).
- `agent.mjs` guard: `--financial` against the copy refuses unless `--allow-copy`.
- `tools/mcleod-agent/review/SILVICOM-GRANTS.sql` (a review file; it changes inside a connector commit only — T2 §T-2's
  checksum rule — so this edit is in **CU-1's** connector commit): Part 4 gains `drs_check` and `gl_summary` (marked
  "added <date>, NOT YET RUN"); the CHECK block's `IN (...)` gains both; Part 6 gets its own CHECK; the header corrects
  Part 5 to "run 2026-11-17" with `billing_history`, `drs_deduct_hist`; no Part 2 additions (council OF-12).
- F3's `GL_KEY_LINES` module list widened to every module, with the re-measured `mcleod_gl_key_lines` budget in the
  manifest (audit D-70) — a statement change, so it rides CU-1's SQL review.

**Tests.** `financeCompare.test.mjs`: "equal sets are equal"; "a one-cent difference in a closed month is listed with
its posting key"; "a difference in an open month is not a failure"; "two configs, one statement each side". Ingest:
"fuel purchases are written org-scoped and a re-send changes nothing"; "the freshness stamp records the source
database". Agent: "a financial run against the copy needs --allow-copy".

**Gates.** `lint:migrations`, `lint:rls`, `lint:table-*`, `lint:upserts`, `lint:comment-claims`, agent tests.
**Staging check:** `POST /api/tms/fuel-purchases` with a staging ingest token and a two-row fixture → 2 rows; re-post →
2 rows. **Rollback:** revert; the table stays. **Release:** prod; statements in CU-1.

## D-10b Finance cut-over (an operation)

**Blocked on Alex: Part 4's 13 tables + `drs_check`, `gl_summary` on LME** (the same request as 11-13; Alex message
item). Steps after the grants (spec D MK2.2 steps 2–6): the CHECK block shows 1 for every table; `agent.mjs
--financial --dry-run` on the VM; the compare run (D-10a) on the owner's Mac, output attached to the progress log;
`FINANCE_FEED=on` with a one-night `FINANCIAL_WINDOW_DAYS=322`; the freshness footer says "live". **Never answered:**
finance stays on the copy read by hand (F0), the footer says "From the McLeod copy restored …", and no API Kit step waits.

---

## D-11 DB7 — done

Run 2026-11-24 and diagnosed 2026-11-25 (`DISPATCH-BOARD-PLAN.md:595-672`; facts above). Nothing to build here. Its
re-run is D-12's gate.

## D-12 ETA write (conditional)

**Today: no ETA is written (D-MK6-1b).** The gate is re-applied once, after Q-DB4's reset fix ships (crediting rest
already taken; teams on the combined clock, `DISPATCH-BOARD-PLAN.md:666-670`): DB7 re-run on 14 days of predictions
recorded after the fix, **excluding stops whose McLeod arrival equals the appointment** (`:672`), with
`gps_age_seconds <= 900 and hos_known`, ≤ 6 h before `actual_arrival_at`, one prediction per stop per hour, n counted in
stops (audit D-48, council OF-16).

| Re-run result | Build |
|---|---|
| median \|error\| ≤ 30 min and p90 ≤ 90 min, n ≥ 300 stops | D-MK6-1a: MK0 path probe on the test company — call-in with `new_eta`, `automated=true` (council OF-15); `GET /stops/{id}` shows the ETA moved, nothing else changed, no service-failure row; Alex item 10 says no customer message → **path = callin**; else `PUT /stop/update` with `eta` only → **path = stop_update**; neither → D-MK6-1c, no write. Then the PR: operation `stop_eta` (`stop`, `read_decides`, `dispatch`), `apps/api/src/modules/mcleod/writes/etaWrite.ts` + scheduler `mcleod-eta-write` (15 min, lane `general`), `loads` export `latestStopPredictions` keyed by **stop id** (T1 N-15), migration (mcleod) `mcleod_eta_holds (org_id, stop_id, until)` for the 6-hour hold after a human edit ("the last value we wrote" is the newest confirmed `stop_eta` event, audit D-49) |
| either threshold missed | no write; the board keeps its own ETA; nothing else is re-run unless Q-DB4 ships another change |
| n < 300 | wait 14 more days; re-run |

Tests (when built): "a change under 30 minutes is not written"; "a stop the driver reached gets no ETA"; "a value a
person typed in McLeod holds 360 off that stop for 6 hours". **Gates/staging/rollback** as D-8 (switch `off`).

## D-13 Home time (probe first, then conditional)

**The feed fact first.** `driver_time_off` was last written 2026-11-17, and the connector posts `driver-time` only when
`MCLEOD_DRIVER_TIMEOFF_PATH` is set (`agent.mjs:397-405`). The Alex message asks whether that line is set on the VM and
whether the job still runs; the answer decides nothing else in T3 (360's own marks use `provider='silvicom'`).

**The probe** (`tools/mcleod-agent/oneoff/homeTimeProbe.mjs`, after T-6; `/ws` reads only, safe on the live company):
`GET /drivers/{id}` for every active driver daily for 14 days — counts of non-null `next_home_date`, `home_duration`,
`pta_date`, and how often `pta_date` changes within 5 min of a stop's `actual_departure` (council OF-18); TableRowService
`GET /equipstatus/…/search` for driver status events as the integration user — readable or 403 (council OF-17).
Writes a dated CSV for the owner; stores nothing in 360.

| Outcome | Build |
|---|---|
| H1: status events with a home code on ≥ 10 % of active drivers in 90 days, readable | operation `home_time` (`driver`, `read_decides`, `dispatch`); migration (mcleod) `mcleod_home_time_map (org_id, kind, mcleod_code)` chosen once by an admin; writes via TableRowService `PUT /equipstatus/create|update` |
| H2: `next_home_date` filled on ≥ 50 %, changing, ±1 day agreement with 360 periods on ≥ 80 % | operation `home_time` writing `next_home_date` and `home_duration` only; `pta_date` only if it never moves on a stop clear |
| H1 and H2 | both, one request each |
| H3: neither | D-HT5 stands as a measured fact; nothing is written; Q-HT1 closed as (b) |
| H2 fields filled but disagreeing on > 20 % | no write; imported read-only as a board hint through the existing `/api/tms/driver-time` (`driverTimeOffInputSchema`), started periods only, never open-ended (audit D-50) |

The write side (H1/H2) is a sweep in `mcleod` (`homeTimeWrite.ts`, 2 min) over a new roster export
`homeTimeChangesSince` in its own file under `roster/homeTime/` (`homeTime.ts` is 456 lines). Tests when built: "a
change after a change sends the latest only"; "a McLeod period never blocks a 360 mark".

---

## Rulings made in this document (no owner question; recorded in `v2/RE-RULINGS.md`'s preamble)

1. **Register defect 4: image canary scope is by customer.** D-MK12's `{"subject_ids"}` for "the others" cannot be
   written for images (a send id exists only after the paper); D-1 scopes image canaries by `customer_ids` (the
   request's `customer_id`), driver and unit operations keep `subject_ids`.
2. **Termination alerts go to the `roster` section** (the gate the act used); D-MK31's table names no row for it.
3. **Two image operations, not one** (`image_file_stop`, `image_file_office`), so office papers can go live before
   driver papers and each has its own proof (audit D-20/D-21; spec D MK4.9 step 3).
4. **D-MK30's staged schedule lives in the tunables file and is passed by the agent**; T-4's settle back-off cap is
   raised to 86,400 s by D-1.
5. **Driver field edits beyond medical-card and CDL expiry are not built** (O-2 narrow; audit D-61); the phone-claim
   defect is fixed on its own (D-9a).
6. **Late photos on a filed stop are filed as a new paper of only the new photos** — never a re-send of the old pages.
7. **T3's `/ws` adapters ride CU-1 if merged before it is cut, else one CU-2**; T3's SQL statements ride CU-1's one SQL
   review (§0).
8. **Non-stop prove requests use `mcleod_write_prove_subject`**, with synthetic ids for test-company drivers and units.

## Owner and outside answers this track waits on

Q-1 and Q-4 (D-7), Q-3 (who presses Hire again — N-16's permission tick), Q-9 (each briefing), Q-10 (D-4's module
outcome); billing's X6 (D-2); the write-capable test company (every T3 operation); McLeod: where a `/ws` image lands
(D-4), SSN on create (D-7); Alex: Part 4 grants (D-10b), `reason_for_leaving` codes if K25 cannot read them (D-6), call-in
customer messages (D-12), the driver-time line (D-13); the owner naming a billing clerk for the readability trial (D-4).
Q-1..Q-10 were unanswered on 2026-11-27; none is assumed.
