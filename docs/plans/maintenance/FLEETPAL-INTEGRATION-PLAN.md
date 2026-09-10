# FleetPal — the maintenance collector, and the first per-unit repair cost the stack has ever held · 2026-09-10

**Status:** ACTIVE, nothing built. **Owner:** Miki. **Section:** `maintenance`.
**Module:** `apps/api/src/modules/fleetpal/` — a collector under D-ARC1/D-ARC3, arriving through the
D-SEP8 gate.

**Supersedes** `INVENTORY-PLAN.md` §I14 as the queue for FleetPal work. I14 stays in the tree as the
record of the 2026-09-09 readiness audit that found nothing in I0–I3 blocking this, and its Q9
ruling is carried forward verbatim as **D-FP12** below.

**Read first:** `INVENTORY-PLAN.md` §2.7 and §8 (the 2026-09-09 FleetPal audit),
`FINANCE-FLEET-REPORT-PLAN.md` §0 (the rulings that took FleetPal out of Finance),
`docs/ARCHITECTURE.md` §2 (the `fleetpal` row) and `docs/MIGRATION-DISCIPLINE.md`.

---

## 0. Ground truth — the four rulings this plan starts from

The owner ruled all four on **2026-09-10**, before a line was written. Each closes a question that
would otherwise have been discovered halfway through a build.

- **The API key arrives in a couple of days, and the build does not wait for it.** Everything below
  except one named step is buildable, testable and mergeable with no credential at all — the
  contracts, the schema, the client, the matcher, the ingest, the read models and the screens all
  take fixtures. The key buys exactly one thing: the live smoke (**F4**) that turns the fixtures
  into recorded truth. Sequencing the build behind the key would waste the two days.
- **Per-truck maintenance expense is built, and it is an operational number** — Maintenance section
  only, never `financial_entries`, never the fleet report, and **always beside its coverage ratio**
  (D-FP4). The 2026-09-03 fleet ruling is untouched.
- **VMRS codes are stored; VMRS descriptions are never persisted** (D-FP8). No licence to buy, no
  contract to sign, and the reports still read in words.
- **FleetPal supplies the parts CATALOGUE; the shelf's opening balance comes from a physical count**
  (D-FP11). FleetPal has no quantity in its model at all, so there is nothing else it could supply.

---

## 1. Measured reality — 2026-09-10, `origin/main` at `3e39e9a`, migrations through 0333

### 1.1 What exists and is reused

| Thing | Where | How this plan uses it |
|---|---|---|
| `maintenance` section, live | `APP_SECTIONS` (`packages/shared/src/auth.ts:76`); manage = admin · fleet_manager · technician, view adds accountant · auditor (`auth.test.ts:226,234`) | every route below gates on it; nothing new in the matrix |
| Shop nav group, **fixed at six rows** by I4's ruling | `surfaces.ts:241–256` | this plan adds **no nav row** — it adds detail pages, cards and non-nav children |
| `recordMovement`, exported | `modules/maintenance/inventory/index.ts:11` | the ingest writes stock movements **through the owner's interface**, not `.from("part_movements")` |
| `PartMovementInput` carries a client-minted `id` (D-INV27) | `packages/shared/src/inventoryContract.ts` | a movement id derived from FleetPal's receipt-item / job-item id makes replay free |
| `createPart` / `updatePart`, exported | `inventory/index.ts:12` | the catalogue sync writes `parts` through the same door |
| Six closed movement reasons | `PART_MOVEMENT_REASONS` — received · issued · adjusted · transferred · counted · returned | the ingest uses **only** `received` and `issued`; it invents no seventh |
| `part_movements.work_order_ref`, `vehicle_id`, `trailer_id`, `unit_cost`, `supplier` | 0331 | the entire tie between our shelf and FleetPal's job (D-INV10). No schema change needed |
| Count sessions (I5, 0332) | `openCountSession` / `closeCountSession` | the opening-balance walk D-FP11 rules on. Already shipped |
| `secretBox` envelopes | `apps/api/src/lib/secretBox.ts` | `fleetpal_credentials`, on the 0091/0116/0012 precedent |
| Queue + `JobKind` + `KIND_CAPS` | `modules/org/jobs.ts:9`, `queue/handlers/index.ts`, `worker.ts:46` | the sync job kinds register here |
| `startAllSchedulers` | `apps/api/src/schedulers.ts:33` | one new poller, registered once. `docs/WORKER-DEPLOYMENT.md` first |
| `mcleod_ap_vouchers` (`invoice_number`, `vendor_id`, `amount`) | mcleod raw | the far side of the coverage bridge (§2.4) |
| `samsara_ifta_jurisdiction_miles`, `samsara_odometer_readings` | samsara raw | the denominator for cost-per-mile-per-truck, and the source of the meter push |

### 1.2 What does not exist

- **No `fleetpal` module, no table, no credential, no key.** Verified 2026-09-10: the only
  occurrence of the string in `apps/` is the header comment at
  `modules/maintenance/routes/index.ts:36` explaining why the old dedup contract was deleted.
- **No `fleetpal_id` on `parts`**, and no external id of any kind on it. `parts` is
  `part_number` · `description` · `manufacturer` · `category` · `unit_of_measure` · `upc` ·
  `image_path` · `last_cost` · `active` · `notes`. A renumbered FleetPal part would arrive as a
  duplicate today.
- **No external unit id on `vehicles` or `trailers`.** They carry `samsara_vehicle_id` /
  `samsara_asset_id` / `mcleod_trailer_id`, and nothing for FleetPal. **This plan does not add
  one** — see D-FP7.
- **No downtime anywhere in the stack.** Nothing records when a truck went out of service and came
  back. FleetPal's `started`/`completed` is the first source of it.
- **`vehicles.next_pm_due_odometer` and `next_pm_due_at` have had no writer since migration 0099
  created them.** Two dead columns, waiting for exactly this collector.

### 1.3 The gates — what each requires of this plan

| Gate | What it demands here |
|---|---|
| `lint:rls` | every new table `enable row level security`, no client policy → deny-all, API-only |
| `lint:table-writers` · `lint:table-modules` | a `fleetpal` entry per table in `scripts/table-modules.json` (`layer=raw`, except credentials/sync-state which are `infra`); **and the regenerated `supabase/schema.generated.sql` committed in the same PR** |
| `lint:table-access` | raw-layer `.from()` only inside `modules/fleetpal/`. The web never reads a `fleetpal_*` table; it reads an endpoint |
| `lint:boundaries` | `modules/fleetpal/` may not reach into another module's internals — the stock writes go through `modules/maintenance/inventory`'s exports, which is the permitted door |
| `lint:migrations` · `lint:migration-ordering` | next-numbered at execution, never pinned. **Every table here is new, so the two-merge rule does not apply** and each step's reader may ship with its own migration |
| `lint:upserts` | the ingest never `.upsert()`s a partial payload. Set-based UPDATE RPCs on the 0174/0175 pattern |
| `lint:filesize` · `lint:funcsize` | 500-line file / 200-line function budgets. The ingest is one file per resource family, not one `fleetpalIngest.ts` |
| `lint:comment-claims` | a comment claiming coverage quotes a real test title |
| `lint:matrix-exit` | every new table gets a PGlite matrix printing a `RESULT` line |
| `lint:surfaces` | new screens are `NAV_SURFACES` entries with `parent:`, not routes invented in `apps/web/src` |

### 1.4 Production measurements — 2026-09-10, `supabase db query --linked`

| Measurement | Value | Why it matters |
|---|---:|---|
| Active tractors | **207** | the match population |
| …carrying a VIN | **200** (96.6%) | VIN is a viable primary match key |
| Active trailers | **234** | trailers are the majority (D-INV12) |
| …carrying a VIN | **228** (97.4%) | ditto |
| Active units with **no** VIN | **13** | the `unit_number` fallback population, and it is small enough to reconcile by hand |
| Maintenance-and-tires GL family, Jan–Jul 2026 | **$1,383,683.90** over 15 accounts | the denominator of the coverage ratio (D-FP4) |
| `mcleod_gl_totals` grain | org × company × period × `post_module` × `glid` | **no equipment dimension**, which is why per-unit cost cannot come from the ledger |
| `mcleod_ap_vouchers` unit identification | free text in `description` ("754 Repair") | D-FS5 forbids guessing at it; it is not a per-truck source either |

### 1.5 The vendor spec, measured — `docs/FleetPal/Fleetpal API.json`, 830 KB, 71 endpoints

Read 2026-09-10. **The spec is gitignored** (beside the PSP guide), so nothing in CI can read it;
§F1 vendors a derived field manifest so the contracts can still be gated.

Conventions the client must honour: bearer `fp_…` (or `X-Api-Key`); `snake_case` both ways; **money
is a decimal number in currency units, not cents** and must be parsed into a decimal type, not a
binary float; **distances are canonical METRES** (÷ 1609.344); timestamps ISO 8601 UTC; `limit`
default 50 / max 200, walk by following `next`; `updated_after` is **exclusive**, so a stored
watermark does not re-deliver its own row; `DELETE` does not exist in v1 — objects archive or close;
unknown response fields must be ignored, not rejected.

**The complete filter matrix, which is what decides the sync design:**

```
units                      is_archived, model_year, number, ownership, vin, updated_after
work-orders                completed_after, number, priority, shop, status, unit, updated_after
jobs                       billable, source, unit, work_order, updated_after
job-items                  job, part, type, unit, work_order, updated_after
service-history            unit, period_start, period_end, component, shop, vendor,
                           customer, billable, work_order, updated_after
meters                     unit, type, source, timestamp_after, timestamp_before, updated_after
pm-schedules               unit, name, updated_after
parts                      number, universal_product_code, updated_after
vendors                    code, type, updated_after
shops                      code                                        ← no updated_after
issues                     unit, priority, status, updated_after
defects                    unit, severity, is_resolved, detected_after  ← NO updated_after
expirations                unit, is_completed, expires_before           ← NO updated_after
purchase-orders            work_order, vendor_location, number, status, type, updated_after
purchase-order-invoices    purchase_order, payable_to, number, dated_after/before, updated_after
purchase-order-receipts    purchase_order, invoice, number, created_after
purchase-order-receipt-items  purchase_order, purchase_order_item, receipt, type, created_after
vmrs-*                     code, level, parent, search                  ← NO updated_after
```

---

## 2. The findings that decide the shape

### 2.1 `GET /v1/service-history/` is the endpoint this whole plan exists for

It is a job on a **closed** work order, pre-joined by the vendor with exactly the context a
per-unit maintenance report needs, so a consumer never makes a second call per work order:

`unit` · `unit_owner_name` · `work_order_reference` · `shop` · `vendor` · `customer` ·
`started` · `completed` · `name` · `description` · `source` · `component` · `reason_for_repair` ·
`complaint` · `pm_schedule` / `defect` / `issue` · `billable` · `items_count` ·
**`total` · `total_parts` · `total_labor` · `total_fees` · `total_tax` · `total_services`** ·
**`total_labor_hours`** · **`odometer` · `engine_hours` · `hubometer` · `apu_hours`** (canonical
units, the reading nearest that work order).

Cost split five ways per job, labour hours, the meter at the time, the VMRS coding of what and why,
and whether it was planned. Cost per mile per truck, cost per VMRS system, PM-versus-breakdown
ratio and days-out-of-service all fall out of that one collection.

**It only covers closed work orders.** In-flight work — which is what "is truck 654 in the shop
right now" asks — comes from `/v1/work-orders` + `/v1/jobs` + `/v1/job-items`. Both are ingested;
neither substitutes for the other.

### 2.2 Per-unit maintenance cost exists nowhere else in the stack

`mcleod_gl_totals` has no equipment dimension (§1.4). `mcleod_ap_vouchers` identifies the truck in
free text D-FS5 forbids parsing. `truck_cost_schedules` was deleted by the fleet ruling. There is no
`pft_cost` configuration in McLeod (measured, `mcleod-data-model-traps`). FleetPal is the only
source of the fact, and that is why this collector is worth building even though Finance does not
want a dollar of it.

### 2.3 Operational truth and financial truth will disagree, and the gap is not an error

FleetPal knows what the shop spent **through FleetPal**. The GL knows what the company spent on
maintenance, every vendor, every channel — a roadside call invoiced straight to AP never touches
FleetPal. Summing FleetPal's per-unit totals and placing them next to the fleet report would put a
number covering an unknown fraction of $1.38M in front of somebody who reads it as all of it.

That is exactly the plausible-but-wrong figure D-FIN10 exists to refuse, and it is why D-FP4 makes
the coverage ratio part of the feature rather than a footnote.

### 2.4 The invoice bridge — how coverage is measured without touching Finance

FleetPal chains work to money:

```
work_order ──> GET /v1/purchase-orders?work_order=<id>   (type = WORK_ORDER)
           ──> GET /v1/purchase-order-invoices?purchase_order=<id>
                 → number      (the VENDOR's own invoice number, as entered)
                 → payable_to  (a /v1/vendors id)
```

`mcleod_ap_vouchers` carries `invoice_number` and `vendor_id`. Joining those two measures, per
month, what fraction of the GL maintenance family FleetPal actually saw. **No dollar crosses into
`financial_entries`, no dedup key is needed, and D-FLEET2 is not reopened** — the join produces a
*ratio*, which is a statement about coverage, not a second source of money.

The spec warns that a vendor invoice `number` is not unique across vendors, so the match key is
`(payable_to → vendor, number)`, never `number` alone.

### 2.5 FleetPal has no on-hand quantity — anywhere

`Part` is `number` · `description` · `type` · `universal_product_code` · `component` ·
`manufacturer` · `manufacturer_part_number` · `unit_of_measure` · `position_applicable` ·
`serialized_part`. There is no quantity, no location, no reorder point, and no stock endpoint. This
is not an omission we can work around; it is the vendor's own model, and it is what D-INV10 was
asserted against and is now **confirmed by**: FleetPal models the part DEFINITION and the repair
JOB. The shelf is ours because the shelf is not theirs.

So "upload the inventory we have in FleetPal" can bring the catalogue and the movement *events*
(receipts in, job consumption out) — and cannot bring an opening balance. D-FP11 rules that the
opening balance comes from the count session I5 already shipped.

### 2.6 Identity: VIN first, unit number second, unmatched stays visible

`Unit` carries `number` (the fleet number, "how most integrations match their own records") and
`vin` (check-digit validated, stored uppercase). We hold both on `vehicles` and `trailers`, at
96.6% and 97.4% VIN coverage on the active fleet (§1.4).

Match on VIN, fall back to `unit_number`, and **leave the rest unmatched and shown as unmatched** —
the posture `/shop/repair-spend` already takes with McLeod's free-text units. Thirteen active units
is a reconciliation somebody can finish in an afternoon; a fuzzy matcher is a source of wrong
answers forever.

**Truck or trailer?** `Unit.vmrs_equipment_category` is the vendor's own answer. The matcher reads
it as a *hint* and the VIN/number match as the *decision*, because a unit that matches trailer 4102
is a trailer whatever its category says.

### 2.7 Three sync tiers, forced by the filter matrix

| Tier | Resources | Strategy |
|---|---|---|
| **Watermarked delta** | units, work-orders, jobs, job-items, service-history, meters, pm-schedules, parts, vendors, issues, purchase-orders, purchase-order-invoices | store the highest `updated` seen per resource in `fleetpal_sync_state`; pass it back as `updated_after`. Exclusive, so no row repeats itself |
| **Bounded re-read** | defects, expirations, shops, purchase-order-receipts(-items) | no `updated` column, so no watermark is possible. Defects: `is_resolved=false` in full **plus** `detected_after=<last run>` to catch newly-resolved ones. Expirations: `is_completed=false` in full — it is small. Receipts: `created_after` |
| **Catalogue, rarely** | the five `vmrs-*` collections | code + description, no watermark, small. Fetched on demand and never persisted (D-FP8) |

**Do not page by `offset` for a full sync.** The spec is explicit: results are newest-first and rows
added mid-walk shift between pages. Follow `next` for a single walk; page by `updated_after` for
stability across runs.

### 2.8 Webhooks are wake-up signals, never sources of truth

`work_order.completed` is the one event key the spec names; the catalogue is dynamic and
`GET /v1/webhook-events` against the live account is the only way to enumerate it (**F4**).

The delivery rules matter and are easy to get wrong:
- Verify `X-Fleetpal-Signature` = `sha256=` + HMAC-SHA256 over **`"{timestamp}.{rawBody}"`**, keyed
  with the subscription secret, `timestamp` being `X-Fleetpal-Timestamp` verbatim and `rawBody`
  being the bytes **before JSON parsing**. Constant-time compare (`safeEqual`). Reject a stale
  timestamp.
- Idempotency key is `X-Fleetpal-Delivery` — stable across retries.
- **Order by `X-Fleetpal-Event-Timestamp`, never `X-Fleetpal-Timestamp`.** The latter is *this
  attempt's* signing time, so a retried old event arrives looking newer than an event that
  succeeded first time. This is the trap the spec spells out and it would corrupt work-order state.
- The secret is returned **once**, at subscription creation. It goes into the secretBox envelope in
  the same transaction or it is lost.
- Respond 2xx fast, queue the work, and **fetch the referenced resource back through the
  authenticated API** — the repo's standing webhook rule.

### 2.9 VMRS is licensed IP, and the design avoids the licence rather than buying it

`component`, `complaint`, `reason_for_repair` and `manufacturer` come back as `code` + a
`description` in words. VMRS is licensed by TMC: internal use runs $1,000–2,500/yr and *shipping*
the descriptions inside a product is the ~$6,000/yr Distribution tier. Silvicom 360 is SaaS sold to
carriers, which is the distribution case.

**D-FP8: we persist the code and never the description.** A VMRS code recorded against a repair we
performed is a fact about our own maintenance; the code set's English is TMC's. Descriptions are
fetched from `/v1/vmrs-*` on demand into a short-lived in-process cache, rendered, and dropped. The
reports read in words, no contract is signed, and a later decision to license changes one resolver.

### 2.10 What FleetPal cannot give us — measured against the spec, not assumed

1. **DVIRs are dangling.** `Defect.dvirs` is an array of ids and **there is no `/v1/dvirs`
   endpoint**. We get defects, never the inspection report they came from. Anything the product
   wants to say about DVIRs must come from our own driver app.
2. **No technician.** `total_labor_hours` exists; who turned the wrench does not. No labour
   productivity, no mechanic scorecard.
3. **No wheel or axle position on a line.** `Part.position_applicable` is a boolean on the
   *catalogue*; `JobItem` carries no position value. Per-position tyre tracking is impossible.
4. **No warranty flag.** No warranty-recovery reporting is derivable.
5. **No unit status endpoint.** `Expiration.target_status` refers to "a unit status id" three times
   and nothing exposes those ids. `Unit` itself has only `archived`.
6. **No current meter on `Unit`.** Reconstruct from `/v1/meters`, or take it from a service-history
   row.
7. **No fault codes, no telematics.** That stays Samsara's, and it is a reason the meter push
   (§2.11) is worth doing.

Each of these is a gap in the *vendor*, not in this plan. None is worked around; where the product
needs the fact, the fact comes from our own source or the product does not claim it.

### 2.11 The meter push — the highest value per line in the integration

`POST /v1/meters` accepts a reading pushed **in**: `unit`, `type`
(`ODOMETER`/`ENGINE_HOURS`/`HUBOMETER`/`APU_HOURS`), `value`, `timestamp`. We already hold Samsara
odometer per vehicle per day. Pushing it makes FleetPal's PM schedules fire on real mileage instead
of on whatever the shop last typed into it.

Three vendor rules the pusher must respect, each an outright rejection if broken: the value is in
**canonical units** (metres, or hours); the meter type must **already be tracked on the unit** or
the request fails with `non_field_errors`; and a reading is rejected if it would sit **out of order
against the readings either side of its timestamp** — so the pusher sends monotone series and
treats an out-of-order rejection as expected, not as an error to retry.

This is also what finally feeds `vehicles.next_pm_due_odometer` / `next_pm_due_at`, dead since 0099.

---

## 3. Decisions

| # | Decision | Source |
|---|---|---|
| **D-FP1** | **FleetPal is a collector under D-ARC1/D-ARC3.** It owns its credentials, its `fleetpal_*` staging tables, its poller, its vendor error vocabulary and the mapping into core rows. Nothing outside `modules/fleetpal/` parses a FleetPal payload. | ARCHITECTURE §2 |
| **D-FP2** | **The collector writes no table it does not own.** Not `vehicles`, not `trailers`, not `financial_entries`, not `parts` / `part_stock` / `part_movements`. Where it must affect a core row it calls the owning module's **exported function** — `createPart`, `updatePart`, `recordMovement` — which is the door D-ARC3 provides and `lint:table-access` permits. | §1.3 |
| **D-FP3** | **Per-unit maintenance cost is an operational number in the Maintenance section.** It never reaches `financial_entries` and never appears in the fleet report. D-FLEET1, D-FLEET2 and D-FLEET8 stand untouched. | Owner 2026-09-10 |
| **D-FP4** | **Cost is never shown without its coverage ratio.** Every surface printing FleetPal money also prints, for the same months, FleetPal's invoiced total as a percentage of the GL maintenance family — computed from the §2.4 invoice bridge. A page that cannot compute the ratio does not print the cost. | §2.3; owner 2026-09-10 |
| **D-FP5** | **`service-history` is the historical record; `work-orders` + `jobs` + `job-items` are the in-flight one.** Both are staged. Neither is derived from the other. | §2.1 |
| **D-FP6** | **Collectors stage the finest grain the source asserts (D-FLEET9).** `fleetpal_job_items` is line-grained. No pre-aggregation in the collector; the read model aggregates. | D-FLEET9 |
| **D-FP7** | **Identity resolution lives in `fleetpal_units`, not on the roster.** The collector adds no column to `vehicles` or `trailers`; its own table carries `fleetpal_id` alongside nullable `vehicle_id` / `trailer_id`. This keeps roster ownership intact and makes an unmatched unit a visible row rather than a missing join. | §2.6 |
| **D-FP8** | **VMRS codes are stored; VMRS descriptions are never persisted.** Resolved on demand from `/v1/vmrs-*` into a short-lived in-process cache and dropped after render. | §2.9; owner 2026-09-10 |
| **D-FP9** | **Money is parsed as a decimal, never a float**, and lands in `numeric` columns. Distances arrive in metres and are converted once, at the edge, by a named helper — never inline. | §1.5 |
| **D-FP10** | **A webhook is a wake-up signal.** Verify, dedupe on `X-Fleetpal-Delivery`, order on `X-Fleetpal-Event-Timestamp`, enqueue, and re-fetch the resource through the authenticated API. An unverifiable delivery is rejected, never accepted quietly. | §2.8 |
| **D-FP11** | **FleetPal supplies the parts catalogue; the opening balance comes from a count.** FleetPal has no quantity in its model. The I5 count session sets on-hand. The locked-header CSV stays the escape hatch for stock bought outside FleetPal. | §2.5; owner 2026-09-10 |
| **D-FP12** | **Stock arriving is received in FleetPal and ingested** (carried forward from INVENTORY-PLAN Q9, ruled (a) 2026-09-09). Our `receive` verb stays manual-only for stock bought outside a purchase order, and the drawer already says so. The ingest writes `received` movements with an id derived from FleetPal's receipt-item id. | INVENTORY-PLAN Q9 |
| **D-FP13** | **A `PART` job item is an `issued` movement**, carrying `work_order_ref`, `unit_cost` and the resolved `vehicle_id`/`trailer_id`. Its movement id is derived from the FleetPal job-item id, so a replay is a no-op. **It is not a spend event** — D-INV11 stands, GL `30230000` already holds the money. | §2.5, D-INV11 |
| **D-FP14** | **The unmatched unit is a first-class state, not an error.** Every read model reports its unmatched count, and no surface silently drops rows it could not resolve. | §2.6 |

---

## 4. Execution protocol — read before executing anything, every session

**Resume ritual:**

1. Read this document top to bottom, then root `CLAUDE.md`, then the `CLAUDE.md` of every package
   the step touches (`apps/web`, `supabase`).
2. Establish reality, never assume it: `git log --oneline -15`, `git branch --show-current`,
   `pnpm verify:live`. The working tree is shared with other sessions — **branch from
   `origin/main`, in a worktree if the tree is dirty**, and re-check the branch before every commit
   and push.
3. Find the first §5 step not marked **DONE**. Check its prerequisites. A missing prerequisite
   means run the fallback written beside it; it never means guess.
4. One step per branch (`claude/<topic>`), PR to `main`, merge after CI. `main` is branch-protected
   (required check `build`); there is no other path.
5. When a step ships, mark it **— DONE `<date>` (migrations NNNN–NNNN)** in place with a "What
   shipped" list and a "Verified by:" naming the gates run. Append dated lines to §8 rather than
   editing adjacent table rows — parallel PRs conflict on rows and never on appended lines.

**Rules for every step here:**

- Migration numbers are **never pinned in advance** — next-numbered at execution.
- Every new table: `org_id`, `enable row level security`, no client policy (deny-all, API-only), an
  entry in `scripts/table-modules.json`, a PGlite matrix printing `RESULT`, and the regenerated
  `supabase/schema.generated.sql` **committed in the same PR** (the check hides inside
  `lint:table-writers`).
- Every service query org-filters itself, asserted via `supabaseRecorder`'s `expectOrgScoped` — the
  API reads with the service role and bypasses RLS.
- `supabaseRecorder` does **not** filter: use function fixtures, or a flat array answers April with
  March's rows.
- **Prove a test can fail.** Mutate the code under it and watch it go red before claiming coverage.
  Two assertions in this programme's sibling plan passed while proving nothing; both times the cause
  was a fixture too uniform to discriminate.
- Vendor payloads at rest are stored whole; nothing PII-shaped reaches logs or `meta`.
- A new job kind joins the closed `JobKind` union (`modules/org/jobs.ts`), registers in
  `queue/handlers/index.ts`, and takes a `KIND_CAPS` entry in `worker.ts` — **cap 1 until FleetPal's
  rate limits are measured**.
- Schedulers run in exactly one process fleet-wide. `docs/WORKER-DEPLOYMENT.md` before adding one,
  and `RUN_SCHEDULERS_IN_PROCESS=false` on every service but `api`.

---

## 5. Steps

Steps **F0–F3** and **F5–F7** need no credential. **F4** is the only step the key gates, and it is
positioned so that everything ahead of it is already merged when the key arrives.

### F0 — Governance — *no migration*

Canon says FleetPal is planned and operational-not-financial; it does not yet say a collector is
being built or where its plan lives.

- `docs/ARCHITECTURE.md` §2 `fleetpal` row: `— not built` → the module path, the staging tables, and
  a pointer to this plan. The financial-deletion paragraph stays exactly as written.
- `docs/SILVICOM-360.md` §2 FleetPal row: `Planned` → `In build`, pointer to this plan. The ⚠
  paragraph stays.
- `INVENTORY-PLAN.md` §I14: retitle to point here, keeping the 2026-09-09 audit text.
- `docs/FleetPal/SOURCE.md` — a committed note (the spec itself stays gitignored) recording the
  spec's provenance, version `v1`, retrieval date and byte size, on the model of
  `inspections/render/assets/SOURCE.md`.

**⚠ One string in shipped code still carries the deleted contract, found while writing this plan.**
`modules/maintenance/routes/index.ts:124` answers the empty repair-spend page with *"…and the
FleetPal feed awaits its dedup contract."* I0 rewrote the header above it on 2026-09-09 and missed
the user-facing sentence underneath. It is the only place in the product where a **customer** reads
the superseded ruling, and it will read as a promise that maintenance money is coming from FleetPal.
It is corrected in this step, and a test pins the replacement text — the same treatment Q9's ruling
got on the Receive drawer, and for the same reason: a ruling nobody can see from the screen decays.

**Done when:** no canon document describes FleetPal as unstarted, and every one of them points at
this plan. **No document — and no string the product prints — instructs a FleetPal financial
projection.** That is the I0 done-when, re-asserted and widened to code, because this plan is the
first thing that could quietly reintroduce one.

### F1 — The contracts and the field manifest — *no migration*

`packages/shared/src/fleetpalContract.ts` — Zod schemas for every resource ingested: `Unit`,
`WorkOrder`, `Job`, `JobItem`, `ServiceHistory`, `Meter`, `PMSchedule` + `Interval`, `Part`,
`Vendor`, `Shop`, `Defect`, `Issue`, `Expiration`, `PurchaseOrder`, `POInvoice`, `POReceipt`,
`POReceiptItem`, plus the enums (`OwnershipEnum`, `LineItemTypeEnum`, `MeterTypeEnum`,
`RepairPriorityClassEnum`, `IssueStatusEnum`, `IssuePriorityEnum`, `POReceiptItemTypeEnum`) and the
paginated envelope.

Every schema is `.passthrough()`-tolerant of unknown fields — the vendor reserves the right to add
response fields within v1, and rejecting one would take the feed down for an additive change.

**The spec is gitignored, so a gate cannot read it.** This step therefore also commits
`packages/shared/src/fleetpal/fieldManifest.generated.json` — resource → field-name list, generated
from the spec by a script in `scripts/`, carrying **no descriptions and no VMRS content** (names
only). `lint:fleetpal-contract` asserts every contract schema covers its manifest's fields and names
no field the manifest does not have. Add it to root `package.json` **and** to the `gates` job in
`.github/workflows/ci.yml` by name, with a sibling `"//lint:fleetpal-contract"` comment — a gate in
neither list is not a gate.

**Done when:** `pnpm typecheck` green, the contract test pins each enum's members and the
money/metre units in a comment citing the spec, and `lint:fleetpal-contract` fails when a field is
deleted from a schema (proved by deleting one).

### F2 — Schema: credentials, units, and the sync state — *next-numbered migration*

The smallest schema that lets F3's client be exercised end to end.

| Table | Layer | Notes |
|---|---|---|
| `fleetpal_credentials` | infra | `org_id` PK, api key in a secretBox envelope, `enabled`, `last_synced_at`, `base_url` (defaulted, so a sandbox can be pointed at) |
| `fleetpal_sync_state` | infra | `(org_id, resource)` PK, `watermark timestamptz`, `last_run_at`, `last_error`, `rows_seen`. One row per resource in the §2.7 tiers |
| `fleetpal_units` | raw | `(org_id, fleetpal_id)` unique. `number`, `vin`, `name`, `ownership`, `model`, `model_year`, `vmrs_equipment_category` (**code only**), `archived_at`, `updated`; plus nullable `vehicle_id`, `trailer_id`, `match_method` (`vin` \| `number` \| `manual` \| `unmatched`), `matched_at` |
| `fleetpal_webhook_deliveries` | infra | `(org_id, delivery_id)` unique — the D-FP10 idempotency ledger. Prunable |

All RLS-enabled, no client policy. PGlite matrix per table.

**Done when:** the matrices print `RESULT`, `schema.generated.sql` is committed, and
`check-table-modules.mjs` passes with the new `fleetpal` module entries.

### F3 — The client — *no migration*

`modules/fleetpal/client.ts` (+ `errors.ts`, `units.ts` for conversions). No key needed: it is
tested against fixtures hand-built from the spec's own examples.

- Bearer auth from the secretBox envelope; `X-Api-Key` unused.
- **`next`-following pagination**, never offset arithmetic (§2.7).
- **429 with `Retry-After`** → bounded backoff, and a `KIND_CAPS` of 1 until real limits are seen.
- Error vocabulary: `400` field-keyed validation (`{field: {message, code}}` plus
  `non_field_errors`) — **branch on `code`, never on `message`**, which the spec says may be
  reworded; `401` credential dead; `403` role; `404` no such object *or another company's*; `5xx`
  retry with backoff.
- `money(v)` → decimal, never float. `metresToMiles(v)` → the one conversion site (D-FP9).
- Every request and outcome recorded to a run row so a failed sweep is visible without log-diving.

**Done when:** unit tests cover the pagination walk, a 429 retry, a field-keyed 400, and the two
conversions; and a mutation removing the `next`-follow makes a test fail.

### F4 — The live smoke — **the only step the API key gates**

Half a day, the first afternoon the credential exists, and its output is a document rather than a
feature.

1. `GET /status` and one `GET /v1/units?limit=1` — auth and shape.
2. **`GET /v1/webhook-events`** — enumerate the catalogue. The spec names only
   `work_order.completed`; F10 cannot be designed until this list is known.
3. Record real payload fixtures for every resource in §2.7 into
   `apps/api/src/modules/fleetpal/__fixtures__/` (redacted of anything person-shaped) and **replace
   the hand-built ones from F1/F3**.
4. Measure, and write into §8: unit count and how many carry a VIN; how many match ours by VIN,
   by number, and not at all; work-order and service-history row counts and the earliest
   `completed`; parts-catalogue size; whether purchase orders and PO invoices are actually used.
5. Confirm the rate limit empirically and set `KIND_CAPS` from it.

**Done when:** §8 carries those measurements, the fixtures are real, and the webhook catalogue is
written into §2.8. **If FleetPal turns out not to be used for purchasing** (step 4's last item),
D-FP12/D-FP13 are re-opened as a question here rather than built around.

### F5 — Identity resolution — *no migration*

`modules/fleetpal/unitMatch.ts` — a **pure** matcher: `(fleetpalUnit, ourVehicles, ourTrailers) →
{vehicleId?, trailerId?, method}`. VIN first (normalised uppercase, both sides), `unit_number`
second, `unmatched` third. `vmrs_equipment_category` is a hint, never the decision (§2.6).

Plus `GET /api/maintenance/fleetpal/units` (section-gated) listing matched and unmatched with a
manual-link verb for the 13, writing `match_method='manual'`.

**Done when:** the matcher is covered by tests including a VIN that differs only in case, a unit
number that collides between a tractor and a trailer, and a unit that matches nothing; and
`expectOrgScoped` passes on the read.

### F6 — Schema and ingest: the repair record — *next-numbered migration*

The core of the plan. Tables `fleetpal_work_orders`, `fleetpal_jobs`, `fleetpal_job_items`,
`fleetpal_service_history`, `fleetpal_meters`, `fleetpal_pm_schedules` (+ intervals),
`fleetpal_vendors`, `fleetpal_shops` — all `layer=raw`, all storing **VMRS codes only** (D-FP8), all
money `numeric`, all distances stored as received (metres) with conversion at read.

Ingest is **one file per resource family** (the 500-line budget is a hard gate), each watermarked
through `fleetpal_sync_state`, each idempotent on `(org_id, fleetpal_id)` via a set-based UPDATE
RPC — **never a partial `.upsert()`** (`lint:upserts`).

**Done when:** each ingest is proved idempotent by running it twice over the same fixture and
asserting the row count and `updated_at` are unchanged; the watermark advances only on success; and
a deliberately mangled payload is rejected with a named error rather than a 500.

### F7 — Defects, issues, expirations — *next-numbered migration*

The bounded-re-read tier (§2.7). `fleetpal_defects`, `fleetpal_issues`, `fleetpal_expirations`.

**Their sync is not a watermark and the code must say so**, in a comment naming the vendor
constraint — otherwise the first maintainer to see three resources syncing differently will
"fix" it. Defects: `is_resolved=false` full + `detected_after=<last run>`. Expirations:
`is_completed=false` full. `Defect.dvirs` is stored as the opaque id array it is, with a comment
that no endpoint resolves it (§2.10.1).

**Done when:** a defect that flips to resolved between runs is picked up by the `detected_after`
half, proved by a fixture pair.

### F8 — The scheduler and the job kinds — *no migration*

`fleetpal_sync` job kinds joined to the `JobKind` union, registered in `queue/handlers/index.ts`,
`KIND_CAPS` set from F4's measurement (1 until then). One poller in `startAllSchedulers`, after
`docs/WORKER-DEPLOYMENT.md` is checked. Cadence: the repair record hourly, the catalogues daily.

**Done when:** `WORKER-DEPLOYMENT.md` names the new scheduler and its owning service, and the
handler is registered (a kind in the union with no handler is the failure this step exists to
avoid).

### F9 — Per-unit maintenance cost, and the coverage ratio — *no migration*

The read model, and the first per-truck repair cost the product has ever been able to print.

- `GET /api/maintenance/units/:kind/:id/maintenance?from&to` — jobs, five-way cost split, labour
  hours, VMRS component (description resolved live per D-FP8), meter at the time, downtime days
  from `started`→`completed`.
- `GET /api/maintenance/fleetpal/coverage?from&to` — the §2.4 bridge: FleetPal invoiced total over
  the GL maintenance family, per month, plus the unmatched-unit count (D-FP14).
- Cost per mile per truck joins `samsara_ifta_jurisdiction_miles`. **It is a maintenance metric on a
  maintenance page** and it does not enter the fleet report (D-FP3).

**⚠ The coverage ratio ships in the same PR as the first cost figure, not after it** (D-FP4). A PR
that prints cost without it does not merge.

**Done when:** the coverage endpoint reproduces, for one month, a hand-computed ratio recorded in
§8; and a test asserts the cost endpoint refuses to answer when coverage cannot be computed.

### F10 — Web: the unit's maintenance file — *no migration*

On `/shop/units/:kind/:id` (the surface exists): repair history, cost split, downtime, open defects,
PM due, expirations. Plus non-nav children under `parent: "maintenance.units"` for the work-order
detail. **No new nav row** — I4's ruling fixes the group at six.

The coverage ratio is on the page beside the money, not behind a tooltip. Per
`finance-is-a-fleet-report` register rules: plain word leads, industry term in the hover, one table
per page, everything paginates.

**Done when:** driven end to end under `preview:local` with Playwright route mocks — **raw JSON in
`route.fulfill`, never `{ok,data}`** — with no console errors, and screenshots in the PR.

### F11 — PM due, defects and expirations as worklists — *no migration*

Feeds `vehicles.next_pm_due_odometer` / `next_pm_due_at` — dead since 0099 — from
`fleetpal_pm_schedules` intervals against the latest meter. **Through the roster module's exported
writer, not `.from("vehicles")`** (D-FP2); if roster has no such writer, this step adds one to
roster in its own PR rather than reaching across.

**Done when:** a truck with a schedule 500 miles from due shows as due-soon, and one with no
schedule shows nothing rather than zero.

### F12 — The parts catalogue sync — *next-numbered migration*

`parts` gains `fleetpal_id` (nullable, unique per org where not null) — an **additive column on a
maintenance-owned table**, so it ships in a `maintenance` PR, and the sync calls `createPart` /
`updatePart` (D-FP2). Also needs a unit-of-measure mapping: ours is 8 values (`each`…`pound`),
FleetPal's is 22 and metric-heavy (`bx`, `cs`, `disp`, `ea`, `m`, `L`, `hr`, `cm`, …). The mapping
is a table in `shared` with an explicit `unmapped` outcome, never a silent default to `each`.

`serialized_part` maps onto our asset/stock seam: a serialized FleetPal part is an **asset type**
candidate, not a stock line. Flag it; do not auto-create.

**Done when:** a part renumbered in FleetPal updates in place rather than duplicating (the reason
`fleetpal_id` exists), and an unmappable unit of measure surfaces as `unmapped` on the part rather
than as `each`.

### F13 — Receipts in, consumption out — *no migration*

D-FP12 and D-FP13, both through `recordMovement`:

- `POReceiptItem` type `RECEIVE` → a `received` movement, `unit_cost` = `price`, `supplier` = the
  vendor, id derived deterministically from the receipt-item id. `CANCEL` lines are **not**
  movements — they reduce what is on order, which is FleetPal's business, not the shelf's.
- `JobItem` type `PART` → an `issued` movement carrying `work_order_ref` (the
  `reference_number` humans hold), `unit_cost`, and the `vehicle_id`/`trailer_id` from F5.

**Which location?** A movement is about a `(part, location)` pair and FleetPal names no location.
The org's default stock location is used and **the drawer/ledger says the row came from FleetPal**,
so a technician can see why a shelf moved without anyone touching it. If an org has more than one
stock location this is a question, not a guess — recorded as **Q4** below.

**⚠ This step is where a double-count would enter the shelf.** The derived-id idempotency is the
whole defence, and the test that proves it — running the ingest twice and asserting one movement —
is the point of the PR, not an extra.

**Done when:** two runs over the same fixture produce one movement; a `CANCEL` line produces none;
and D-INV11 is re-asserted in the module header (no part cost reaches Finance).

### F14 — The meter push — *no migration*

Samsara odometer → `POST /v1/meters`, monotone, canonical units, out-of-order rejections treated as
expected (§2.11). Gated behind an env flag **default off**, because it is the first write we make
into a vendor system.

**Done when:** a rejected out-of-order reading is recorded as skipped rather than retried, and the
flag defaults off in `env.ts`.

### F15 — Webhooks — *no migration*

Subscribe to the events F4 enumerated. Verification, dedupe and ordering exactly per D-FP10/§2.8.
The secret is stored in the secretBox envelope in the same operation that creates the subscription —
it is returned once and is otherwise unrecoverable.

**Done when:** a forged signature is rejected, a replayed `X-Fleetpal-Delivery` is a no-op, and an
out-of-order retry does not overwrite newer state — each proved by a test, and each mutation-checked.

---

## 6. Questions and assumptions

### 6.1 Answered

| # | Question | Answer | Decision |
|---|---|---|---|
| Q1 | Does per-truck FleetPal cost enter Finance? | **No.** Maintenance section only, with the coverage ratio. Owner, 2026-09-10. | D-FP3, D-FP4 |
| Q2 | Do we license VMRS to show descriptions? | **No.** Store codes, resolve descriptions live, never persist. Owner, 2026-09-10. | D-FP8 |
| Q3 | What does "upload the inventory we have in FleetPal" bring? | **The catalogue.** FleetPal has no quantity; the opening balance is a count. Owner, 2026-09-10. | D-FP11 |
| Q5 | Is VIN a viable match key? | **Yes** — 200/207 tractors, 228/234 trailers. Thirteen active units fall back to unit number. Measured 2026-09-10. | D-FP7 |
| Q6 | Does the collector need a roster column? | **No.** `fleetpal_units` carries the mapping. | D-FP7 |

### 6.2 Open

| # | Question | Candidates | Recommendation |
|---|---|---|---|
| **Q4** | Which stock location does an ingested movement land in when an org has more than one? | (a) the org's default location, with the row labelled as FleetPal-sourced; (b) a dedicated `FleetPal receiving` location; (c) refuse to ingest until a shop maps FleetPal shops → our locations | **(c) for receipts, (a) for consumption.** A receipt has a real physical destination and guessing it puts stock on the wrong shelf; a consumption is a decrement whose location matters less than its existence. Blocks **F13** only; measure at F4 whether more than one location is even in use |
| **Q7** | Is FleetPal actually used for purchasing at Silvicom, or only for work orders? | (a) yes — D-FP12/D-FP13 hold; (b) no — receipts never appear, and our `receive` verb goes back to being primary | **Measured at F4, not decided here.** If (b), D-FP12 is re-opened rather than built around |
| **Q8** | Does FleetPal hold enough history to be worth a backfill, and from when? | (a) full history via `service-history` with no `period_start`; (b) from a chosen date | **(a), bounded by what F4 measures.** `service-history` has `period_start`/`period_end`, so a backfill is a paged walk and not a special path |

### 6.3 Assumptions — each retired by the step that needs it

| # | Assumption | Retired by | Fallback if false |
|---|---|---|---|
| A1 | The key carries a role that may read work orders, jobs, job items and service history | F4 | keys are per-user and carry that user's role; ask support to reissue at a higher role |
| A2 | FleetPal's unit numbers match ours closely enough that the 13 VIN-less units resolve by number | F5 | the manual-link verb, which is in F5 anyway |
| A3 | Vendor invoice numbers in FleetPal match those in `mcleod_ap_vouchers` closely enough to measure coverage | F9 | report coverage as a **bound** ("at least X%") rather than a point estimate, and say so on the page |
| A4 | Rate limits allow an hourly delta sweep of the whole repair record | F4 | lengthen the cadence; the watermark design does not change |

---

## 7. Out of scope

- **Anything financial.** No projection into `financial_entries`, no dedup key, no per-truck cost in
  the fleet report. D-FLEET1/2/8 stand (D-FP3).
- **DVIR capture** — FleetPal exposes defects but no DVIR endpoint (§2.10.1). Any DVIR surface comes
  from our own driver app.
- **Writing work orders into FleetPal.** This collector reads; the only write is the meter push
  (F14), and that is behind a flag.
- **Customers, sales orders and customer invoices** (`/v1/customers`, `/v1/sales-orders`,
  `/v1/customer-invoice*`) — Silvicom does not sell shop work to third parties. Left unread rather
  than half-modelled.
- **VMRS as a product feature** (browsing the code tree, coding our own repairs). D-FP8 confines
  VMRS to display-time resolution.

---

## 8. What shipped

- **2026-09-10 · Plan written.** The spec read end to end (71 endpoints, filter matrix in §1.5),
  four owner rulings recorded as D-FP3/D-FP4/D-FP8/D-FP11, production measured (§1.4). Nothing
  built. The next step is **F0**, and it needs no credential.
