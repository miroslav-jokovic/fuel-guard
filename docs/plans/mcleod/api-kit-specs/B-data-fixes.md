# Spec B — McLeod data fixes N4, N5, N6, N8, N9 (and Q-LMR5 PU #, Q-LMR10 BOL #)

**Status:** build spec, 2026-11-19, written from `origin/main` at `cc590a62b` (newest migration
`0636_toll_plazas_and_observations.sql`). Parent plan: `docs/plans/mcleod/MCLEOD-API-KIT-PLAN.md` §4.
None of these steps needs the API Kit. Every choice below is closed; where the repo or McLeod has to
confirm a fact first, the check is a numbered verification step with the build for each outcome.

Decision ids: **D-MKN4.x, D-MKN5.x, D-MKN6.x, D-MKN8.x, D-MKN9.x**. They do not collide with the parent
plan's D-MK1–5 or the D-MK* numbers a parallel rewrite will hand out.

Migration numbers below are written **M-A, M-B**. At build time use the next two free numbers
(`ls supabase/migrations | tail -1`, then +1, +2; the 2026-11-19 value is 0637 and 0638). Re-check right
before you push. A parallel chat taking the number is the known race (memory
`migration-number-race-with-parallel-chat`).

---

## 0. What the code says today (checked line by line)

| Fact | Where |
|---|---|
| The driver contract has no customer, PU #, BOL #, weight, pieces, references or McLeod actual times | `packages/shared/src/loadsContract.ts:69-108` |
| The database has customer/weight/pieces (`loads`) and McLeod actual arrival/departure (`load_stops`) | `0366_loads_mirror_columns.sql:46-63`, `0384` |
| `loads.pickup_number` exists and **nothing writes it** | `0366:49`; `git grep pickup_number` finds no writer |
| McLeod's `blnum` reaches raw only (`mcleod_dispatch_movements.blnum`); the projection never reads it | `0364:86`; `dispatchProjection.ts:18-20` (`MOVEMENT_COLUMNS` has no `blnum`) |
| **The agent does not read `reference_number` at all.** No statement in `queries.mjs` selects it, although the login has held SELECT on it since 2026-09-28 | `tools/mcleod-agent/queries.mjs:1078-1172`; `review/SILVICOM-GRANTS.sql:77` |
| Measured 2026-09-28 (LOADS-MIRROR-PLAN Q-LMR5): `reference_number` hangs off STOPS only, `element_id` 128 on all 34,592 rows, joins on `stop_id` + `company_id`; open-board qualifiers ZZ 105, PO 82, P8 70, SI 35, TZ/SCA 33, CR 31, DO/RB/VD/TH 14–15, PU 13; P8 or PU on a PU stop on 50 of 143 open movements | `LOADS-MIRROR-PLAN.md:422-430` |
| Required photos are written in two places, identically | `loads/mirrorLoads.ts:120`, `mcleod/tmsLoadIngestWriters.ts:157` |
| Trucks/trailers on a load resolve by unit number only; `vehicles.mcleod_tractor_id` / `trailers.mcleod_trailer_id` (0239, unique per org) are never consulted | `mcleod/entityLookup.ts:63-73`, `tmsLoadIngest.ts:96-109`, `tmsIngest.ts:258-268` |
| Raw `tractor_id`/`trailer_id` are McLeod's own ids: `continuity.equipment_id` of type T / L = `tractor.id` / `trailer.id` | `queries.mjs:1097-1098, 1124-1127` |
| The reefer quirk: Silvicom unit `R532159` = McLeod trailer `532159`; the roster sweep stores the link as `532159` | `MCLEOD-READ-ONLY-INTEGRATION-HANDOFF.md:234`; `rosterIngest.test.ts:134`; `tms.ts:436` (`trailerUnitMatchKey`) |
| An unresolved code becomes `null` and only reaches the connector's log | `dispatchProjection.ts:69-76, 99` |
| The office's exception queue is the Loads page **Exceptions** tab, fed by `listExceptions` (event kinds + derived `auto_timeout`) | `loads/dispatchLoads/exceptions.ts`, `dispatchContract.ts:87-128`, `web/features/dispatch/LoadExceptionsTable.vue` |
| The rig pick list is the whole org, ranked last-used → "your truck" → free → held | `driver-app/dutySessions.ts:89-168`, `driver/src/features/duty/checkInModel.ts:125-139` |
| The board's arrival is McLeod's only; the truck drawer **merges** McLeod's and the driver's into one unlabelled "Arrived" | `loads/truckLoadPlanReads.ts:156`; `web/features/dispatch/DispatchTruckDrawer.vue:88-90, 220` |
| File budgets that bind this work: `DispatchLoadsPage.vue` 496/500, `tmsLoadIngest.ts` 490/500, `me.ts` 444, `check-in.tsx` 438, `dutySessions.ts` 437 | `wc -l` |
| `references` is a reserved word in Postgres; every new column below is named `reference_numbers` | — |
| Staging has no McLeod feed (seeded demo org only); staging rows come from posting a fixture with a staging ingest token | memory `release-practice-position`; `apps/api/src/scripts/issueMcleodToken.ts` |

---

## 1. PR boundaries and order

| PR | Contents | Depends on | Migration |
|---|---|---|---|
| **B1** | N5 (shared required-photo rule) | — | none |
| **B2** | M-A + M-B, schema only, PGlite matrix, `schema.generated.sql` | — | M-A (mcleod), M-B (loads) |
| **B3** | N6: resolver link-first, `external_unmatched` written, relink compares it, exceptions kind, web | B2 on staging | none |
| **B4** | N4a: BOL # + customer/weight/pieces/McLeod times in the shared contract, readers, driver + web display; the wire **accepts** `reference_numbers` (expand), raw stores it; agent reads `reference_number`; read routine regenerated; re-projection script | B2 on staging | none |
| — | **V1** (verification, §3.6): VM runs the B4 connector after B4 is in production; qualifier counts in production; dispatcher confirms three loads | B4 in production + VM updated | — |
| **B5** | N4b: PU # and stop references projected into core, contract + display; the wire **requires** `reference_numbers` (contract phase) | V1 passed | none |
| **B6** | N8: rig pick list, planned unit first | — (reads existing columns) | none |
| **B7** | N9: driver-reported arrival on the board, labelled | — | none |

B1, B6, B7 are independent of everything and may merge in any order. B2 must merge alone
(`lint:migration-ordering`: a column and its first reader/writer in different merges). B3 and B4 merge
only after `migrate-staging` has applied B2 (check `information_schema.columns` on staging, not the clock).
Production: the release train applies B2's migrations before B3/B4's code in any release that carries
both (`docs/MIGRATION-DISCIPLINE.md` §2026-10-04), so no extra wait is needed there.

Each PR: branch `claude/<topic>` from `origin/main`; title written for an office reader; body with the four
template headings; every gate in root `package.json` run locally with `$?` checked (memory
`run-all-ci-gates-before-push`), not just `pnpm lint`.

---

## 2. N5 — one required-photo rule (PR B1)

**D-MKN5.1** One constant in `@silvicom/shared`, beside the slot list it draws from, read by both writers.
No settings screen and no table (Q-MK9 as recommended): nobody has named a stop that needs another list,
and `load_stops.required_photos` stays free-form `text[]` so a future per-stop rule needs no migration.

`packages/shared/src/loadsContract.ts`, after `photoSlotLabel` (line 57):

```ts
/**
 * The photos a driver is asked for at each kind of stop, on every load the office did not author
 * (McLeod's mirror and the old TMS feed). McLeod knows no carrier photo policy, so this is ours, stated
 * once (MCLEOD-API-KIT-PLAN Q-MK9). It was written twice, identically, until <date>:
 * `mirrorLoads.ts` and `tmsLoadIngestWriters.ts`.
 */
export const REQUIRED_PHOTOS_BY_STOP_KIND: Readonly<Record<StopKind, readonly PhotoSlot[]>> = {
  pickup: ["trailer", "bol"],
  dropoff: ["bol"],
};

/** A fresh array: the value is written into a `text[]` column and must not alias the constant. */
export function requiredPhotosFor(kind: StopKind): PhotoSlot[] {
  return [...REQUIRED_PHOTOS_BY_STOP_KIND[kind]];
}
```

Callers (all of them — `git grep -n '"trailer", "bol"'`):
- `apps/api/src/modules/loads/mirrorLoads.ts:118-120` → `required_photos: requiredPhotosFor(s.kind),`; keep the
  WHY comment, pointing at the shared constant.
- `apps/api/src/modules/mcleod/tmsLoadIngestWriters.ts:155-157` → same. (`s.kind` is the TMS contract's
  `StopKind`; if it is typed as `string` there, narrow with the contract's own enum, not a cast.)

Not changed: `apps/driver/src/features/loads/sampleOffers.ts` (gallery samples state their own slots on
purpose), the SQL in `0141` (reads the row, not the rule).

Tests:
- `packages/shared/src/loadsContract.test.ts`
  - `"every required photo slot is one the driver app can label"` — each slot of every kind is in `PHOTO_SLOTS`.
  - `"requiredPhotosFor returns a copy, so a writer cannot change the rule"` — push onto the result, re-read.
- `apps/api/src/modules/mcleod/tmsLoadIngest.test.ts:136-140` — replace `toContain("bol")` with
  `toEqual(requiredPhotosFor(kind))` per stop: `"the TMS feed writes the shared required photos per stop kind"`.
- New in `apps/api/src/modules/mcleod/routes/tmsIngest.dispatchProjection.test.ts`:
  `"the mirror writes the shared required photos on every stop it writes"`.
- Mutation proof: change `pickup` to `["bol"]` in the constant → both API tests fail by name; revert and
  show the diff is empty (memory `mutation-revert-must-prove-itself`).

Gates touched: `lint:boundaries` (shared import only), `typecheck`. Staging check: none needed beyond CI
(behaviour identical); the B5 staging walk re-checks the photo tiles on a mirrored stop.

---

## 3. N4 — the shared load contract, and Q-LMR5's PU number, Q-LMR10's BOL number

### 3.1 Decisions

- **D-MKN4.1 — BOL # (Q-LMR10): candidate (a), `loads.bol_number`.** Nullable text, written by the
  projection from raw `blnum`, read by the board hover, the load page and the driver. (b) still needs
  (a); (c) throws away a field dispatchers quote to customers. `ref` stays `orders.id` — `blnum`
  collides 2,020 times in 134,315 orders (`queries.mjs:1065-1069`), which is why it is a column, not a key.
- **D-MKN4.2 — References are read per stop, as rows, in their own statement.** One new SELECT per
  read path (board, close, delivered backfill) returning `stop_id, qualifier, value`, stitched to stops by
  `stop_id` in `loads.mjs`. Rejected: a `STUFF(... FOR XML PATH)` column on the stop query (the
  `driver_codes` pattern) — reference values are free text, `FOR XML PATH('')` entitizes `&`/`<`, and the
  `TYPE).value()` form errors on control-character separators; rows need no encoding at all.
- **D-MKN4.3 — Every reference is kept, raw and core.** Raw `mcleod_dispatch_stops.reference_numbers` and
  core `load_stops.reference_numbers`, both `jsonb` arrays of `{"qualifier","value"}`, null = "McLeod not
  asked yet" (rows before the feature), `[]` = "asked, none". Raw keeps everything so the PU rule is
  re-projectable (D-LMR4); core keeps everything because a driver at a dock is asked for whichever number
  the shipper uses, and the office cannot know in advance which.
- **D-MKN4.4 — The PU # rule (Q-LMR5 candidate (a)).** `loads.pickup_number` = the values carrying the
  first qualifier in `PICKUP_NUMBER_QUALIFIERS = ["P8", "PU"]` found on the load's first `PU` stop (by
  McLeod sequence) that carries any of them; several values of that qualifier on that stop are joined
  `", "` (never dropped); no such stop → null; any `PU` stop whose `reference_numbers` is null → null
  (not yet read is not "none"). P8 is X12 element 128's "Pickup Reference Number". **PU is subject to V1:**
  the X12 128 code list defines PU as "Previous Bill of Lading Number", and McLeod's qualifiers are 128's
  (`element_id` 128). If V1's dispatcher check shows PU rows are pickup numbers, the constant ships as
  above; if they are BOL numbers, it ships as `["P8"]` and PU is labelled "Previous BOL #". Either outcome
  is a one-line constant plus its test, decided before B5 merges — not after.
- **D-MKN4.5 — PO is shown once.** The stop's own `po_number` (`stop.ponum`) is displayed as "PO #"; a
  `PO` reference with the same value is not repeated. One pure helper decides the lines.
- **D-MKN4.6 — Every new driver-contract field is `.nullable().default(null)`.** An older API response
  parses in a newer app and vice versa (zod strips unknown keys), so the API release and the OTA may land
  in either order.
- **D-MKN4.7 — The web types derive from the shared fragments.** `DispatchLoad`/`DispatchStop` in
  `web/features/dispatch/useDispatchLoads.ts` are a pre-existing app-local restatement. The new fields are
  declared once in shared (`loadMcleodFactsSchema`, `stopMcleodFactsSchema`) and the web interfaces
  `extend` their inferred types instead of restating them. Moving the whole `DispatchLoad` into shared is
  a separate refactor and is not done here; nothing new is added to the restated part.
- **D-MKN4.8 — Wire contract, expand then contract.** B4 accepts `reference_numbers` on a stop as an
  optional key: absent = a connector older than the field, and the raw upsert then omits the column so a
  stored value is kept (PostgREST upsert updates only the keys sent). B5 makes the key required, the house
  rule of `tmsDispatchMirror.ts:11-14`, once V1 has proven the VM sends it. This is the expand/contract
  dance the migration discipline prescribes for a rename, applied to a wire field, and B4's comment says
  so and names B5 as its removal.

### 3.2 Schema (PR B2) — M-A and M-B, two files because `lint:table-modules` refuses one migration across two modules

`supabase/migrations/M-A_mcleod_dispatch_stop_references.sql` (module `mcleod`):

```sql
alter table mcleod_dispatch_stops
  add column if not exists reference_numbers jsonb
    constraint mcleod_dispatch_stops_reference_numbers_array
    check (reference_numbers is null or jsonb_typeof(reference_numbers) = 'array');
comment on column mcleod_dispatch_stops.reference_numbers is
  'dbo.reference_number rows on this stop, verbatim: [{"qualifier","value"}]. Null = not read yet.';
```

`supabase/migrations/M-B_loads_mirror_references_bol_unmatched.sql` (module `loads`):

```sql
alter table loads
  add column if not exists bol_number        text,   -- orders.blnum (Q-LMR10, D-MKN4.1)
  add column if not exists external_unmatched jsonb  -- N6, D-MKN6.3
    constraint loads_external_unmatched_array
    check (external_unmatched is null or jsonb_typeof(external_unmatched) = 'array');
alter table load_stops
  add column if not exists reference_numbers jsonb
    constraint load_stops_reference_numbers_array
    check (reference_numbers is null or jsonb_typeof(reference_numbers) = 'array');
```

Headers in the house register: the gap (§0 rows), why nullable with no default (missing = null, the 0366
rule), why `reference_numbers` and not `references` (reserved word), why `external_unmatched` lives on the
load (§4.1), and that nothing names these columns in this merge.

PGlite matrix `supabase/tests/loads-mcleod-references.test.mjs` (copy the harness of
`loads-customer-name.test.mjs`), printing `RESULT:`:
- `"existing loads read null for bol_number and external_unmatched"`
- `"a stop's reference_numbers accepts an array and null"`
- `"a stop's reference_numbers refuses an object"` (each of the three check constraints, one test each)
- `"no new column has a default"` (`information_schema.columns.column_default is null`)

Then `node scripts/gen-schema-snapshot.mjs` and commit `supabase/schema.generated.sql`.
Gates: `lint:migrations`, `lint:migration-ordering`, `lint:table-modules`, `lint:schema-snapshot`,
`lint:table-writers`, `check-rls` (no new table), `pnpm test` (matrix discovered automatically).
Staging: after merge, `select column_name from information_schema.columns where table_name in
('loads','load_stops','mcleod_dispatch_stops') and column_name in ('bol_number','external_unmatched','reference_numbers');` → 4 rows.

### 3.3 The agent (PR B4)

**Step 0 (before writing the statement), on the Board VM under `<read-only SQL login>`, counts only:**
`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'reference_number'`.
The statement below assumes `stop_id`, `company_id`, `reference_qual`, `reference_number` (the names the
2026-09-28 measurement grouped by). If the qualifier or value column is named otherwise, the statement
uses the measured names; nothing else changes. Record the column list in the PR body.

`tools/mcleod-agent/queries.mjs` — after `DISPATCH_LOAD_STOPS_SELECT` (line 1163):

```js
/**
 * The reference numbers on those stops (Q-LMR5, D-MKN4.2): one row per reference, stitched to its stop
 * by `stop_id` in loads.mjs. Hangs off STOPS only — `element_id` 128 on all 34,592 rows and `partner_id`
 * never an order id (measured 2026-09-28) — and joins on stop AND company: stop ids repeat across companies.
 * Rows, not a FOR XML string: the values are free text a dispatcher typed.
 */
const DISPATCH_LOAD_REFERENCES_SELECT = `
    SELECT
      LTRIM(RTRIM(r.stop_id))                      AS stop_id,
      NULLIF(LTRIM(RTRIM(r.reference_qual)), '')   AS qualifier,
      NULLIF(LTRIM(RTRIM(r.reference_number)), '') AS value
      FROM dbo.reference_number AS r
      JOIN dbo.stop AS s     ON s.id = r.stop_id AND s.company_id = r.company_id
      JOIN dbo.movement AS m ON m.id = s.movement_id AND m.company_id = s.company_id`;

export const DISPATCH_LOAD_REFERENCES = `${DISPATCH_LOAD_REFERENCES_SELECT}${BOARD_WHERE.replace("m.company_id = @companyId", "r.company_id = @companyId")}
     ORDER BY r.stop_id, qualifier, value`;
export const DISPATCH_LOAD_REFERENCES_DELIVERED = `${DISPATCH_LOAD_REFERENCES_SELECT}${DELIVERED_WHERE.replace("m.company_id = @companyId", "r.company_id = @companyId")}
     ORDER BY r.stop_id, qualifier, value`;
```

`closeReadQueries(n)` (line 1235) returns a third key `references` built the same way. Every caller of
`closeReadQueries` destructures by name (`loads.mjs` `fetchClosedLoads`, `review/build-routine.mjs:39`), so
adding a key breaks none.

`tools/mcleod-agent/loads.mjs`:
- `fetchDispatchLoads`, `fetchClosedLoads`, `fetchDeliveredLoads`: run the references statement on the
  same connection after the stop statement; group by `stop_id`.
- `mapDispatchStop(s, refs)` (line 185) gains
  `reference_numbers: refs.filter((r) => r.qualifier && r.value).map((r) => ({ qualifier: r.qualifier, value: r.value }))`,
  de-duplicated on `qualifier|value`, in the statement's order. A stop with no rows sends `[]`.
- `mapDispatchMovement(row, stopRows, refsByStop)` passes each stop its list.
- The movement hash (`loadHash`) changes for every movement → the next cycle re-posts the whole board once
  (~160 movements). That is the backfill of raw; it is why the VM update waits for B4 in production (§3.6).

`tools/mcleod-agent/dryRun.mjs` `describeMirrorDryRun`: add a block, counts only (Alex's condition,
2026-09-25): per qualifier on `PU` stops, per qualifier on `SO` stops, and "movements with P8 or PU on a
PU stop: n of m". No value is printed.

Read routine: `tools/mcleod-agent/review/build-routine.mjs` PART 1 gains
`["REFERENCE NUMBERS ON THOSE STOPS", "The pickup and PO numbers dispatch types on each stop. Read-only, granted 2026-09-28.", Q.DISPATCH_LOAD_REFERENCES]`;
PART 2 (close) gains `close.references`; the backfill part gains `Q.DISPATCH_LOAD_REFERENCES_DELIVERED`.
Run `node review/build-routine.mjs` and commit `SILVICOM-READ-ROUTINE.sql`. No grant change
(`reference_number` whole table is granted, `SILVICOM-GRANTS.sql:77`).

Alex: per his condition the changed routine reaches him before the VM runs it. Write
`tools/mcleod-agent/review/REQUEST-TO-ALEX-<date>-REFERENCES.md` as **one complete message** (memory
`it-requests-are-one-complete-list`): the three new statements, their cost from Step 0's `SET STATISTICS
TIME` run, the update zip (`git archive --prefix=connector/ <B4 sha>:tools/mcleod-agent` minus `launchd/`),
and the instruction to apply it only after the date we name (B4's production release). The owner sends it.

Agent tests (`node --test tools/mcleod-agent/*.test.mjs`):
- `loads.test.mjs`: `"a stop carries its reference numbers, qualifier and value, de-duplicated"`,
  `"a stop with no reference rows sends an empty list, never omits the key"`,
  `"a reference with no qualifier or no value is not sent"`.
- `queries.test.mjs`: `"the reference statements join stop and company, never stop alone"`,
  `"the close read returns a references statement with one parameter per id"`.
- `dryRun.test.mjs`: `"the mirror dry run prints reference qualifier counts and no reference value"`.
- `review.test.mjs` existing tests cover the routine (`"every statement the agent can run is in the
  routine the carrier reviews"`); it must fail before the routine is regenerated — show that in the PR.

### 3.4 The API data path

**B4 (expand + BOL + the fields that already exist):**

`packages/shared/src/tmsDispatchMirror.ts` — new schema and the stop field:

```ts
export const tmsStopReferenceSchema = z.object({
  qualifier: z.string().trim().min(1).max(10),
  value: z.string().trim().min(1).max(100),
});
// in tmsDispatchStopSchema:
  // EXPAND phase (D-MKN4.8): optional only until the Board VM runs the connector that reads
  // reference_number. Absent = an older connector, and the ingest then leaves the stored value alone.
  // B5 makes it required like every other key here, which is what removes this sentence.
  reference_numbers: z.array(tmsStopReferenceSchema).max(50).optional(),
```

`apps/api/src/modules/mcleod/dispatchMovementIngest.ts:151-155` already spreads `...s` into the raw row, so
the column is written when present and omitted when absent. Because PostgREST refuses a bulk upsert whose
rows differ in keys, assert one shape per batch: if some stops in a payload carry the key and others do
not, answer 400 `mixed_reference_shape` (a connector sends all or none). Test below.

`packages/shared/src/mcleodLoadProjection.ts`:
- `RawDispatchMovement` + `blnum: string | null`; `RawDispatchStop` + `reference_numbers: StopReference[] | null`.
- `ProjectedLoad` + `bol_number: string | null` (= `m.blnum`, trimmed, empty → null).
- `ProjectedStop` + `reference_numbers` — **B5**, not B4 (see below).

`apps/api/src/modules/mcleod/dispatchProjection.ts:18-24`: `MOVEMENT_COLUMNS` + `blnum`;
`STOP_COLUMNS` + `reference_numbers` (B5).

`apps/api/src/modules/loads/mirrorLoads.ts` `loadColumns` (line 54): + `bol_number: l.bol_number`.

Shared contract fragments (new file `packages/shared/src/loadMcleodFacts.ts`, exported from the barrel; keeps
`loadsContract.ts` under budget and gives web and driver one home, D-MKN4.7):

```ts
export const stopReferenceSchema = z.object({ qualifier: z.string(), value: z.string() });
export type StopReference = z.infer<typeof stopReferenceSchema>;

/** What McLeod says about a load, beside the driver app's own facts. Null on a load McLeod never sent. */
export const loadMcleodFactsSchema = z.object({
  customer_name: z.string().nullable().default(null),
  bol_number: z.string().nullable().default(null),
  pickup_number: z.string().nullable().default(null),          // written from B5
  weight_lbs: z.coerce.number().nullable().default(null),      // numeric → string over PostgREST
  pieces: z.number().int().nullable().default(null),
});
export const stopMcleodFactsSchema = z.object({
  actual_arrival_at: z.string().nullable().default(null),      // McLeod's witness — never the driver's arrived_at
  actual_departure_at: z.string().nullable().default(null),
  po_number: z.string().nullable().default(null),
  reference_numbers: z.array(stopReferenceSchema).nullable().default(null), // filled from B5
});
```

`loadsContract.ts`: `loadSchema = z.object({...}).extend(loadMcleodFactsSchema.shape)`;
`loadStopSchema` likewise with `stopMcleodFactsSchema.shape`. The `Load`/`LoadStop` output types gain
required properties, so every typed fixture gains them (list in §3.7).

Readers:
- `apps/api/src/modules/loads/driverLoads.ts:67-73` — `LOAD_COLUMNS` + `customer_name, bol_number,
  pickup_number, weight_lbs, pieces`; `STOP_COLUMNS` + `actual_arrival_at, actual_departure_at, po_number,
  reference_numbers`. (Selecting `pickup_number`/`reference_numbers` in B4 is safe: the columns exist
  since B2; they read null until B5 writes them, which is the truth.)
- `apps/api/src/modules/loads/dispatchLoads/shared.ts:16-31` — `LOAD_COLUMNS` + `bol_number,
  pickup_number, weight_lbs, pieces, external_unmatched` (the last for B3's load-page banner; add it in B3);
  `STOP_COLUMNS` + `po_number, reference_numbers`. Callers of these lists: `queries.ts`, `detail.ts`,
  `history.ts`, `activity.ts`, `search.ts` (search selects its own list — unchanged).
- `apps/web/src/features/dispatch/useDispatchLoads.ts:28-91` — `interface DispatchStop extends
  Partial<z.infer<typeof stopMcleodFactsSchema>>` and `DispatchLoad extends
  Partial<z.infer<typeof loadMcleodFactsSchema>>`; delete the now-duplicated `actual_*`/`customer_name`
  lines from the restated interfaces.

**B5 (PU # and stop references):**

`mcleodLoadProjection.ts`:

```ts
/** D-MKN4.4. The order is the preference: P8 is X12 128's "Pickup Reference Number". PU per V1. */
export const PICKUP_NUMBER_QUALIFIERS = ["P8", "PU"] as const;

export function projectPickupNumber(stops: Pick<RawDispatchStop, "stop_type" | "movement_sequence" | "reference_numbers">[]): string | null {
  const pickups = stops.filter((s) => (s.stop_type ?? "").trim() === "PU")
    .sort((a, b) => (a.movement_sequence ?? 0) - (b.movement_sequence ?? 0));
  if (pickups.some((s) => s.reference_numbers == null)) return null; // not read yet is not "none"
  for (const s of pickups) for (const q of PICKUP_NUMBER_QUALIFIERS) {
    const values = [...new Set(s.reference_numbers!.filter((r) => r.qualifier === q).map((r) => r.value))];
    if (values.length) return values.join(", ");
  }
  return null;
}
```

`projectMcleodMovement`: `pickup_number: projectPickupNumber(ordered)`; each `ProjectedStop` gets
`reference_numbers: s.reference_numbers` (verbatim). `mirrorLoads.ts` `loadColumns` + `pickup_number`;
`writeStops` already spreads `...s`. `tmsDispatchMirror.ts`: delete `.optional()` and the EXPAND comment;
the dispatch-movements route test gains `reference_numbers` in its `it.each` of required fields.

Display helper (pure, shared, `loadMcleodFacts.ts`), used by driver and web:

```ts
export const REFERENCE_QUALIFIER_LABELS: Record<string, string> = {
  P8: "Pickup #", PU: "Pickup #" /* or "Previous BOL #" per V1 */, PO: "PO #", BM: "BOL #",
  SI: "SID #", CR: "Customer ref #", DO: "Delivery order #",
};
/** The stop's reference lines, PO first from the stop itself, a PO reference of the same value dropped (D-MKN4.5). */
export function stopReferenceLines(stop: { po_number: string | null; reference_numbers: StopReference[] | null }): { label: string; value: string }[];
```
An unlisted qualifier is shown under its own code ("ZZ 4471"), never hidden and never guessed.

### 3.5 Display

**Driver app** (`apps/driver/app/loads/[id].tsx`, "This load" card, lines 196-222): keep the first `Fact`
row; add two rows beneath it with the same `Fact` component — **Customer · PU # · BOL #**, then **Weight ·
Pieces** (`"42,000 lb"`, `"24"`, `—` when null). The PU # row is where a driver looks before the first
stop; it appears with B4 reading `—` until B5 writes it — acceptable for one release because the field is
honestly unknown, and B5 follows V1 directly.

**Driver stop screen** (`apps/driver/app/loads/[id]/stop/[stopId].tsx`, after the `verdict` section,
line 233): a "Stop details" `Section` with one `Card padded={false}`: a `ListRow` per
`stopReferenceLines(stop)` (title = value, subtitle = label), then, when McLeod has a time, a `ListRow`
`icon="schedule"` titled `McLeod: arrived 10:42 · departed 11:30` (same `clockOf` formatter). The driver's
own arrival stays the `Badge` in `StopHero.tsx:75`; the two are never merged (Q-LMR2 is open). The file is
310 lines; extract the section as `apps/driver/src/features/loads/StopDetails.tsx` (≤ 60 lines).

**Web Loads page** (`apps/web/src/pages/DispatchLoadsPage.vue`, 496/500): first move the Load # cell
(load number, customer, dispatcher) into `apps/web/src/features/dispatch/LoadRefCell.vue`, then: the load
number gets a tooltip `BOL # <bol_number>` (Q-LMR10's hover; plain `title` is not keyboard-reachable — use
the shared tooltip component the Status cell already uses); the **Pickup** cell gains a muted second line
`PU # <pickup_number>` (B5). Not a new column: at 1440 px the row menu already ends at 1384 of 1440
(LR7 log), and the pickup cell is where the number is used. Remove the "⚠ Two columns … NOT here" comment
block (lines 18-22) in B5 and say where each went.

**Web load page** (`DispatchLoadDetailPage.vue:86-96` `loadFacts`): add BOL #, PU #, Weight, Pieces with the
existing "only facts about some loads" rule; per stop (line 259 block) one line `References: PU # 4471223 ·
PO # 88812` from `stopReferenceLines`.

### 3.6 V1 — the PU qualifier, verified before B5 merges

1. B4 is in production (`pnpm verify:live` shows its commit). The owner sends Alex's message; the VM runs
   the B4 connector. `node agent.mjs --loads --dry-run` output (counts) pasted into the B5 PR.
2. Production, read-only (`supabase db query --linked`, memory `fuelguard-prod-db-access`):

```sql
-- Fill: every open stop should have been re-sent with references by now.
select count(*) filter (where s.reference_numbers is null) as not_read,
       count(*) filter (where s.reference_numbers = '[]'::jsonb) as none,
       count(*) as stops
  from mcleod_dispatch_stops s
  join mcleod_dispatch_movements m using (org_id, company_id, movement_id)
 where m.org_id = (select org_id from org_integrations where provider = 'mcleod') and m.closed_at is null;

-- Qualifiers by stop type on the open board.
select s.stop_type, r.qualifier, count(*) as refs, count(distinct s.movement_id) as movements
  from mcleod_dispatch_stops s
  join mcleod_dispatch_movements m using (org_id, company_id, movement_id)
  cross join lateral jsonb_to_recordset(s.reference_numbers) as r(qualifier text, value text)
 where m.org_id = (select org_id from org_integrations where provider = 'mcleod') and m.closed_at is null
 group by 1, 2 order by 1, 3 desc;

-- Three loads for the dispatcher: one with only P8, one with only PU, one with both, on a PU stop.
select m.order_id, s.movement_sequence,
       jsonb_path_query_array(s.reference_numbers, '$[*] ? (@.qualifier == "P8" || @.qualifier == "PU")') as pu_refs
  from mcleod_dispatch_stops s join mcleod_dispatch_movements m using (org_id, company_id, movement_id)
 where m.org_id = (select org_id from org_integrations where provider = 'mcleod')
   and m.closed_at is null and s.stop_type = 'PU'
   and s.reference_numbers @? '$[*] ? (@.qualifier == "P8" || @.qualifier == "PU")'
 order by m.order_id limit 30;
```

Pass: `not_read = 0`; the qualifier shape matches 2026-09-28's within the board's churn (P8 the leading
pickup-side qualifier; P8-or-PU on roughly a third of open movements). Then a dispatcher opens three of the
listed orders in McLeod (one P8-only, one PU-only, one both) and reads the field their screen calls the
pickup number. **Outcome A** — all three match → ship `["P8","PU"]`, PU labelled "Pickup #". **Outcome B** — the
PU-only load's PU value is a bill-of-lading number → ship `["P8"]`, PU labelled "Previous BOL #".
**Outcome C** — the P8 value is not what they call the pickup number → B5 does not merge; the finding goes
into `LOADS-MIRROR-PLAN.md` Q-LMR5 with the qualifier the dispatcher pointed at, and the constant becomes
that qualifier after the same three-load check on it. Record the outcome and the three order numbers (no
values) in the plan's progress log.

3. After B5 (and after B4 for `bol_number`) run the re-projection script (§3.8) once per environment, then:
`select count(*) filter (where pickup_number is not null), count(*) from loads where source='tms' and external_closed_at is null;`
— expect the V1 movement count, ± board churn.

### 3.7 Every caller the contract change touches

- Shared: `loadsContract.ts`, `loadsContract.test.ts` (fixtures at lines 31, 102-120 gain the new keys via
  a `withMcleodFacts()` helper in the test), `index.ts` barrel export of `loadMcleodFacts.ts`.
- API: `driverLoads.ts` (columns), `driverLoads.test.ts` (fixture rows; assert the new keys round-trip:
  `"a driver's load carries McLeod's customer, BOL, PU, weight and pieces"`).
- Driver: `features/loads/useLoads.ts` (uses `loadSchema`, no change), `sampleOffers.ts` (add nulls),
  `app/gallery.tsx` (uses `SAMPLE_OFFERS`, no change), tests `itinerary-model.test.ts:30-35`,
  `offer-deck-model.test.ts:20`, `today-model.test.ts:13` (fixture factories gain the null keys).
- Web: `useDispatchLoads.ts`, `DispatchLoadsPage.vue` → `LoadRefCell.vue`, `DispatchLoadDetailPage.vue`,
  tests `DispatchLoadsPage.test.ts` (`"the load number's tooltip names the BOL"`, `"the pickup cell shows
  the PU number"`), `loadListFilters.test.ts`/`loadListOrder.test.ts` (fixtures only), `tutorials/fixtures/endpoints.ts:200`.
- `lint:shared-contracts`: new names end in `Schema` and live only in shared — passes; nothing app-side may
  export `stopReferenceSchema` etc. The driver's private `meLoadsResponseSchema` (`useLoads.ts:39`, not
  exported) is untouched.

### 3.8 Re-projection command (B4)

D-LMR4 promised "core is rebuildable from raw at any time"; nothing makes that a command. Add
`apps/api/src/scripts/reprojectMcleodMirror.ts --org <uuid> --name "<org name>" [--since-days 60]`
(owner-run, `node --env-file=<api env> --import tsx …`, the `issueMcleodToken.ts` shape): reads open and
recently closed movement ids per company (the `relinkDispatchMovements` window), calls
`projectDispatchMovements` in chunks of 50, prints created/updated/statusChanged/refused counts, writes one
`audit_logs` row `integration.mcleod.reprojected`. Idempotent. Test
`reprojectMcleodMirror.test.ts`: `"re-projecting twice writes the same loads"`,
`"it refuses an org whose name does not match"`.

### 3.9 N4 tests (API/shared), titles

`packages/shared/src/mcleodLoadProjection.test.ts`:
`"the BOL number is McLeod's blnum, empty is null"`, `"the PU number is P8 on the first pickup stop"`,
`"PU is used only when no pickup stop carries P8"`, `"two P8 values on one stop are both kept"`,
`"a pickup stop not yet read gives no PU number, not a guess"`, `"a PO on a pickup stop is not a PU number"`,
`"references on a stop are projected verbatim"`.
`loadMcleodFacts.test.ts`: `"the stop's PO is shown once, from the stop"`, `"an unknown qualifier is shown under its own code"`.
`routes/tmsIngest.dispatchMovements.test.ts`: B4 `"a stop's references are stored raw"`,
`"a connector that sends no references leaves stored ones alone"`, `"a payload mixing stops with and
without references is refused by name"`; B5 the `it.each` of required fields gains `reference_numbers`.
`routes/tmsIngest.dispatchProjection.test.ts`: `"the projection writes bol_number"`, `"…pickup_number"`,
`"…each stop's reference numbers"`. Mutation proofs: swap the qualifier order; drop the null guard; read
`blnum` from the wrong field — each fails a named test.

Staging walk (B4, B5): issue a staging ingest token for the demo org (`issueMcleodToken.ts` with the staging
env — staging has no live connector to revoke), POST the `tmsIngest.dispatchProjection.test.ts` fixture
(extended with `blnum`, P8/PU/PO references, weight, pieces, a driver code = a demo driver's
`employee_id`) to the staging API, Dispatch it to the staging test driver, and check: the Loads page tooltip
and pickup line, the load page facts and stop references, the driver app "This load" rows and the stop's
"Stop details" (simulator, memory `driver-simulator-dev-client-recipe`). Screenshots at 1440 and 390 px in
the PR; 390 px must scroll 0 px sideways.

---

## 4. N6 — McLeod id first; an unmatched assignment becomes an office exception (PR B3)

### 4.1 Decisions

- **D-MKN6.1 — Resolve by link, then by unit among the unlinked only.** For trucks and trailers: an exact
  match of McLeod's code on `mcleod_tractor_id` / `mcleod_trailer_id` (unique per org, 0239) wins. The
  unit-number fallback (normalised exactly as today: `vehicleUnitKey`, `trailerUnitMatchKey` with the `R`
  strip) considers **only rows with no McLeod link**: a row linked to another McLeod id is not this unit,
  whatever its painted number says. The reefer quirk needs no special case on the link path — McLeod sends
  `532159`, the link is `532159`; it stays on the fallback path for trailers the sweep has not linked.
- **D-MKN6.2 — Company is part of the link.** A link whose `mcleod_company_id` is set and differs from the
  movement's company is not a match (ids repeat across companies, 16,948 order ids; `queries.mjs:1069`).
  Null company = legacy row, still matches. Applied to drivers too (`mcleod_driver_id`), so all three
  links follow one rule; `employee_id` stays a company-free key as today (D-FG7).
- **D-MKN6.3 — An unresolved code is stored on the load, by the one projection.** `loads.external_unmatched`
  = `[{ "role": "driver"|"co_driver"|"truck"|"trailer", "code": "512", "reason": "unknown"|"ambiguous" }]`,
  null when everything McLeod named resolved. A code McLeod did not send (5 of 119 loads have no trailer)
  is not unmatched. Rejected: an event per miss (the sweep posts ~1.1 movements per call, so it needs
  open/close bookkeeping and de-duplication, and it cannot close itself when the roster catches up);
  deriving on every feed read (re-reads the whole roster on each poll — the D-RLY12 cost). The column is
  core's projection of raw like every other mirror column, rewritten on every projection, so it cannot drift.
- **D-MKN6.4 — The exception is derived and resolves itself.** New derived kind `unmatched_assignment`
  over open McLeod loads (`external_closed_at is null`, status not delivered/canceled) with
  `external_unmatched is not null`. Every open load counts, not only dispatched (`P`) ones: an `A` load
  with an unknown truck is called "Uncovered" by `loadBoardState` when it is "Planned", which is the same
  silent lie. Synthetic id `unmatched_assignment:<load_id>:<role>:<code>`. It cannot be acknowledged away:
  the action is `fix_roster`, a link to the page where the person fixes the roster, and the row disappears
  when the relink pass links the code (D-LA3). `resolveException` answers 422 `resolves_itself` for this kind.
- **D-MKN6.5 — Relink also re-projects when the unmatched set changed.** `relinkDispatchMovements`'s
  "stale" test gains: the stored `external_unmatched` differs from what the codes resolve to now. This
  backfills every open load on the first pass after B3 (all read null) without a script, and it re-projects
  a load whose linked unit has since become unresolvable — writing null and raising the exception, which is
  the truth; today such a load silently keeps the old id.

### 4.2 Code

`apps/api/src/modules/mcleod/entityLookup.ts` (95 lines; receives the readers from `tmsLoadIngest.ts`, which
shrinks from 490):

```ts
export type Resolution = { kind: "hit"; id: string } | { kind: "unknown" } | { kind: "ambiguous" };
export interface KeyResolver {
  lookup(raw: string | null | undefined, companyId?: string): Resolution;
  /** The id, or undefined when unknown or ambiguous — the old callers' shape, derived from lookup. */
  get(raw: string | null | undefined, companyId?: string): string | undefined;
}
export interface LinkedUnitRow { id: string; unit_number: string | null; link: string | null; link_company: string | null }
export function unitResolver(rows: LinkedUnitRow[], entity: "vehicles" | "trailers"): KeyResolver;
//   1. link index over rows with link (trimmed; unique by 0239, but built with the poison rule anyway)
//   2. unit index over rows with link === null, normalised as today
//   lookup: link hit with company agreeing → hit; link hit with company disagreeing → falls to 2;
//           2 → hit / ambiguous (poisoned) / unknown
export async function readUnitResolver(admin, table, orgId): Promise<KeyResolver>; // moved from tmsLoadIngest `lookup`,
//   selects "id, unit_number, mcleod_tractor_id|mcleod_trailer_id, mcleod_company_id", fetchAllPaged, throws on error
export async function readDriverResolver(admin, orgId): Promise<KeyResolver>;   // moved `driverLookup`, + mcleod_company_id
export async function loadEntityResolvers(admin, orgId);                          // moved, same return shape
```

Callers to update (`git grep -n "unitResolver\|driverResolver\|loadEntityResolvers"`):
- `mcleod/tmsLoadIngest.ts:96-138` — delete `lookup`, `driverLookup`, `loadEntityResolvers`; import from
  `entityLookup.ts`; re-export nothing (`dispatchProjection.ts:4` imports from `entityLookup.js` instead).
- `mcleod/tmsIngest.ts:258-268` (`unitMap`, the movements feed) — replace with `readUnitResolver`. This also
  fixes its unpaged, unchecked read (the 2026-09-28 audit's bug, still present here).
- `mcleod/tmsIngest.ts:340` (`driverResolver(driverRows)`) — its select adds `mcleod_company_id`.
- `mcleod/dispatchProjection.ts:69-76`:

```ts
const unmatchedOf: UnmatchedRef[] = [];
const resolve = (role: UnmatchedRole, code: string | null, by: KeyResolver): string | null => {
  if (!code) return null;
  const r = by.lookup(code, companyId);
  if (r.kind === "hit") return r.id;
  unmatched.add(code);                              // the connector's log, unchanged
  perLoad.push({ role, code, reason: r.kind });
  return null;
};
```
  and each `MirroredLoad` gets `external_unmatched: perLoad.length ? perLoad : null`.
- `loads/mirrorLoads.ts`: `MirroredLoad` + `external_unmatched: UnmatchedRef[] | null`; `loadColumns` writes
  it; `MirroredLinks`/`readMirroredLinks` select + return it.
- `dispatchProjection.ts` `relinkDispatchMovements:146-159`: compute the resolutions for the four codes,
  build the would-be unmatched list, compare with `l.external_unmatched` (order-insensitive, by
  `role|code|reason`); stale if links differ **or** the lists differ.

Shared (`packages/shared/src/dispatchContract.ts`):
- `UNMATCHED_ROLES`, `unmatchedRefSchema` (`role`, `code`, `reason: z.enum(["unknown","ambiguous"])`) and
  `type UnmatchedRef` — the shape the projection writes and the feed reads, one definition.
- `EXCEPTION_KINDS` + `"unmatched_assignment"`; `EXCEPTION_ACTIONS` + `"fix_roster"`;
  `EXCEPTION_LABELS.unmatched_assignment = "Not linked to McLeod"`.

`apps/api/src/modules/loads/dispatchLoads/exceptions.ts`: a fourth read in the existing `Promise.all`:
`loads.select("id, ref, status, drivers(full_name), external_unmatched").eq("org_id", orgId).eq("source","tms")
.is("external_closed_at", null).not("status","in","(delivered,canceled)").not("external_unmatched","is",null)`;
parse each array with `unmatchedRefSchema` (a malformed row is logged and skipped, never thrown); one
`DispatchException` per entry, `detail: { role, code, reason }`, `action: "fix_roster"`,
`occurred_at` = the load's `external_synced_at` (add it to the select). `summarize`:
`"0135527: McLeod's truck 512 matches no truck in Silvicom 360."` / `"… matches two trucks — fix the duplicate."`;
roles worded driver / co-driver / truck / trailer.

`apps/api/src/modules/loads/dispatchLoads/mutations.ts:29`: `if (input.kind === "unmatched_assignment")
return { ok: false, status: 422, code: "resolves_itself", message: "This clears when the roster links McLeod's code." }`.

Web `apps/web/src/features/dispatch/LoadExceptionsTable.vue`: for `row.action === "fix_roster"` render an
`AppButton variant="ghost" size="sm" :to=…` instead of the resolve button — driver/co-driver →
`{ name: "drivers", query: { search: code } }` (the page that holds `RosterHeldList`, where a McLeod driver
without a Silvicom record waits), truck → `{ name: "vehicles", query: { search: code } }`, trailer →
`{ name: "trailers", query: { search: code } }` (all three pages read `search` from the URL, `qs.param("search")`).
Labels "Find in Drivers" / "Find in Trucks" / "Find in Trailers". `ACTION_LABELS` + `fix_roster`. Badge tone
`warning`. Load page (`DispatchLoadDetailPage.vue`): a warning banner listing the same sentences from
`load.external_unmatched` so the person who opens the load sees it without the tab.

### 4.3 Tests, titles

`mcleod/entityLookup.test.ts`: `"a truck resolves by its McLeod id before its unit number"`,
`"a reefer resolves by McLeod's trailer id with no R-prefix handling"`,
`"an unlinked R-prefixed trailer still resolves by unit number"`,
`"a unit linked to a different McLeod id is never matched by its painted number"`,
`"a link from another McLeod company is not a match"`,
`"two unlinked units with the same number are ambiguous, not the last one read"`,
`"get is undefined exactly when lookup is not a hit"`.
`mcleod/dispatchProjection.test.ts`: `"an unknown truck code is stored on the load as unmatched"`,
`"an absent trailer is not unmatched"`, `"a load whose codes all resolve stores null"`,
`"relink re-projects a load whose unmatched list is stale"`, `"relink leaves a load alone when nothing changed"`
(asserts zero writes — the D-RLY12 cost guard).
`mcleod/relinkScheduler.test.ts`: existing tests keep passing with the new select.
`loads/routes/dispatchRoutes.test.ts`: `"an unmatched McLeod code is an open exception with a roster link"`,
`"the exception names the load and the code, scoped to the caller's org"` (`expectOrgScoped`),
`"a closed load raises no unmatched exception"`, `"resolving an unmatched exception is refused: it clears itself"`.
Web `LoadExceptionsTable.test.ts` (new): `"an unmatched truck links to Trucks with the code searched"`,
`"an unmatched exception has no Acknowledge button"`.
Mutations: drop the company check; let the unit fallback include linked rows; make `stale` ignore the list;
let `resolveException` accept the kind — each fails by name.

### 4.4 Verification

Before B3 merges, production read-only (the size of the change):

```sql
with o as (select (select org_id from org_integrations where provider='mcleod') as org)
select count(*) filter (where m.trailer_id is not null)                                         as trailers_named,
       count(*) filter (where exists (select 1 from trailers t, o where t.org_id=o.org and t.mcleod_trailer_id = m.trailer_id)) as trailer_by_link,
       count(*) filter (where m.trailer_id is not null and not exists (select 1 from trailers t, o
              where t.org_id=o.org and (t.mcleod_trailer_id = m.trailer_id
                 or (t.mcleod_trailer_id is null and regexp_replace(upper(trim(t.unit_number)),'^R(?=[0-9])','') = upper(trim(m.trailer_id)))))) as trailer_unresolved,
       count(*) filter (where m.tractor_id is not null)                                         as trucks_named,
       count(*) filter (where exists (select 1 from vehicles v, o where v.org_id=o.org and v.mcleod_tractor_id = m.tractor_id)) as truck_by_link
  from mcleod_dispatch_movements m, o where m.org_id = o.org and m.closed_at is null;
```
Paste the numbers in the PR. After B3 is in production and one relink pass has run (minutes):
`select count(*) from loads where external_unmatched is not null and external_closed_at is null;` equals the
Exceptions tab's unmatched rows; each row's link opens the page with the code searched.
Staging: post the fixture with one tractor code no demo truck carries → the tab shows it within one relink
pass; set that unit on a demo truck → the row disappears on the next pass.

Gates: `lint:table-access` (exceptions reads `loads`, its own; driver-app untouched), `lint:boundaries`,
`lint:filesize` (`tmsLoadIngest.ts` shrinks; `entityLookup.ts` stays < 250), `lint:funcsize`,
`lint:comment-claims` (any "pinned by" quotes a title above).

---

## 5. N8 — the rig pick list puts the load's truck and trailer first (PR B6)

### 5.1 Decisions

- **D-MKN8.1 — "Planned" is the driver's current load on McLeod's plan.** The load where the driver is
  `driver_id` **or** `co_driver_id` (a team shares the truck), `isLoadWithDriver` true, not closed, first by
  `compareLoadsOnTruck` — the same two shared functions the map and Assignments use, so the three cannot
  disagree. Its `vehicle_id` and `trailer_id` are the planned units (D-TL1: planning = McLeod).
- **D-MKN8.2 — The pick list says "Dispatch planned", never the load number.** Whether a load reaches a
  driver before it departs is N2's ruling (Q-MK5), not this step's; a unit is not load content, a load
  number is. So the flag is on the unit and no ref travels.
- **D-MKN8.3 — Order:** planned → last used → "your truck" → free → held. A held planned unit keeps its
  "In use" badge and its first place: the driver should see that dispatch's truck is taken, not hunt for it.
- **D-MKN8.4 — The one-tap start prefers the plan.** `startShortcut`: when the roster has a planned truck,
  the shortcut uses it (and the planned trailer if free, else bobtail) instead of yesterday's rig; if the
  planned truck is held, no shortcut (a doubtful case, the function's own rule). No write to McLeod (Q-MK10).

### 5.2 Code

`packages/shared/src/dutyContract.ts:46-55` — `equipmentOptionSchema` + 
`/** McLeod's plan for the driver's current load (D-TL1) — pinned first as "Dispatch planned". */ is_planned: z.boolean().default(false),`

New `apps/api/src/modules/loads/driverPlannedEquipment.ts`, exported from `loads/index.ts`:

```ts
export async function readDriverPlannedEquipment(admin, orgId, driverId): Promise<{ vehicleId: string | null; trailerId: string | null } | null> {
  const { data, error } = await admin.from("loads")
    .select("id, ref, status, source, vehicle_id, trailer_id")
    .eq("org_id", orgId)
    .or(`driver_id.eq.${driverId},co_driver_id.eq.${driverId}`)
    .in("status", [...WITH_DRIVER_CANDIDATE_STATUSES])
    .is("external_closed_at", null);
  if (error) throw new Error(`[loads] planned equipment could not be read: ${error.message}`);
  const load = (data ?? []).filter(isLoadWithDriver).sort(compareLoadsOnTruck)[0];
  return load ? { vehicleId: load.vehicle_id, trailerId: load.trailer_id } : null;
}
```
(`driverId` comes from `resolveDriverId`, a uuid from our own table, never the request; still validate it
with the `recordId` regex before interpolating into `.or()`.)

`apps/api/src/modules/driver-app/dutySessions.ts:89` — `getEquipmentPickList(admin, orgId, driverId,
planned: { vehicleId: string | null; trailerId: string | null } | null = null)`; `toOption` sets
`is_planned: row.id === (kind === "vehicle" ? planned?.vehicleId : planned?.trailerId)`. A planned unit that
is retired stays out (the `selectable` rule wins: a retired truck cannot be checked into). Stays ≤ 450 lines.

`apps/api/src/modules/driver-app/routes/me.ts:124-136` — `const planned = await readDriverPlannedEquipment(...)`
then pass it. A failed planned read must not cost the driver the pick list: catch, log
`[me/equipment] planned read failed`, pass null (the list without a pin is still correct; the list without
trucks is a dead end).

Driver app:
- `apps/driver/src/features/duty/checkInModel.ts:125` `rankEquipment` — first comparison
  `if (a.is_planned !== b.is_planned) return a.is_planned ? -1 : 1;` and the doc comment's order.
- `apps/driver/app/duty/check-in.tsx:83-88` `EquipmentRow.right`: `in_use_by` → "In use"; else `is_planned`
  → `<Badge label="Dispatch planned" tone="brand" icon="assignment" />`; else `is_default` → "Your truck".
  When planned and held: show "In use" and subtitle `Dispatch planned · in use by <name>` via `unitSubtitle`.
- `apps/driver/src/features/duty/startShortcutModel.ts` — D-MKN8.4; `StartDayCard.tsx:94-99` row subtitle
  "Dispatch planned" when the option is planned.
- The load detail banner (`app/loads/[id].tsx:109-114`, "Dispatch planned Unit X; current equipment is…")
  is unchanged and now agrees with the pick list by construction.

### 5.3 Tests, titles

`packages/shared/src/dutyContract.test.ts`: `"an equipment option without is_planned parses as not planned"`.
`apps/api/src/modules/loads/driverPlannedEquipment.test.ts`: `"the planned units are the driver's current McLeod load's"`,
`"a co-driver gets the team's truck"`, `"a delivered or closed load plans nothing"`,
`"of two loads on the driver the in-transit one wins"`, `"the read is scoped to the caller's org"` (`expectOrgScoped`).
`driver-app/dutySessions.test.ts`: `"the planned truck and trailer are flagged"`, `"a retired planned truck is not offered"`.
`driver-app/routes/me.test.ts` (or the existing me route test): `"the pick list still answers when the planned read fails"`.
`apps/driver/tests/check-in-model.test.ts`: `"the planned unit ranks above the last-used one"`,
`"a held planned unit still ranks first"`. `start-shortcut-model.test.ts`: `"the shortcut offers the planned
truck over yesterday's"`, `"no shortcut when the planned truck is held"`, `"a planned truck with no planned
trailer starts bobtail, never yesterday's trailer"`. Fixtures in both files gain `is_planned: false`.
Mutations: drop the co-driver branch; rank planned after last-used; let a held planned truck make a shortcut.

Staging: the B4 fixture load (driver code = the staging test driver's `employee_id`, tractor = a demo unit)
→ the simulator's check-in shows that unit first with "Dispatch planned"; the Start card offers it.

---

## 6. N9 — the board shows the driver's arrival where McLeod has none, labelled (PR B7)

### 6.1 Decisions

- **D-MKN9.1 — One rule, in shared:** `stopArrival(s) = actual_arrival_at ? { at, by: "mcleod" } :
  arrived_at ? { at, by: "driver" } : null` (new export in `packages/shared/src/loadBoard.ts`). McLeod first
  because it is the office's system of record (Q-MK3 as proposed); the driver's tap fills the gap, and the
  label says whose it is. Never merged silently — which the truck drawer does today (`DispatchTruckDrawer.vue:88`).
- **D-MKN9.2 — The on-time verdict and "no ETA once arrived" use the effective arrival.** Computing an ETA to
  a stop the driver says they are at is wrong in either labelling; `onTimeVerdict` and
  `livemap/dispatchBoard.ts:226,233` read `arrivedAt` unchanged, which now carries the fallback.
- **D-MKN9.3 — ETA scoring stays McLeod-only.** DB7's 14-day score (`recordStopEtaPredictions`, the
  `actual_arrival_at` join in DISPATCH-BOARD-PLAN:523-541) measures against McLeod's stamp and is not touched:
  changing the witness mid-measurement would break the comparison D-DB4 rests on.

### 6.2 Code

`packages/shared/src/dispatchBoardContract.ts:28-29`:
```ts
  /** The truck reached the stop: McLeod's actual arrival, else the driver app's tap (D-MKN9.1). */
  arrivedAt: iso.nullable(),
  /** Whose arrival `arrivedAt` is — the board says "driver app" when McLeod has none. */
  arrivedBy: z.enum(["mcleod", "driver"]).nullable().default(null),
```
`apps/api/src/modules/loads/truckLoadPlanReads.ts`: `StopRow` + `arrived_at`; the stop select (lines
105-106) + `arrived_at`; `toBoardStop` (line 146): `const a = stopArrival(s); arrivedAt: a?.at ?? null,
arrivedBy: a?.by ?? null`.

Web:
- `apps/web/src/features/dispatch/DispatchBoardTable.vue:254-261` (Next stop cell): when
  `row.current.nextStop.arrivedAt`, the second line reads `Arrived 10:42` + a muted
  `· McLeod` or `· driver app — not in McLeod yet` (the latter in `text-warning`), with a tooltip
  "Reported by the driver in the Silvicom 360 app. McLeod has no arrival for this stop." Otherwise the
  current "Pickup by …" line.
- `apps/web/src/features/dispatch/DispatchTruckDrawer.vue:88-90, 220`: replace the local `arrivedAt` with
  `stopArrival(s)`; line 220 becomes `Arrived {{ at(a.at) }} <span>({{ a.by === "mcleod" ? "McLeod" : "driver app" }})</span>`;
  the marker logic keeps using `a !== null`.
- `apps/web/tutorials/fixtures/endpoints.ts` board fixture: add `arrivedBy` beside every `arrivedAt`.

### 6.3 Tests, titles

`packages/shared/src/loadBoard.test.ts`: `"McLeod's arrival wins over the driver's"`,
`"the driver's arrival fills the gap and says so"`, `"no arrival from either is null"`.
`packages/shared/src/dispatchBoard.test.ts`: `"a stop the driver reports arrived is judged by that arrival"`.
`apps/api/src/modules/livemap/dispatchBoard.test.ts`: `"no ETA is computed to a stop the driver reports arrived"`.
New `apps/api/src/modules/loads/truckLoadPlanReads.test.ts`: `"the board stop carries the driver's arrival
when McLeod has none, labelled driver"`, `"the read is org-scoped"`.
`apps/web/src/features/dispatch/DispatchTruckDrawer.test.ts`: `"a driver-reported arrival is labelled driver app"`
(and update the existing arrival expectation). `dispatchBoardView.test.ts` / a new `DispatchBoardTable.test.ts`:
`"the next-stop cell says when the arrival is the driver's"`.
`etaPredictions` tests unchanged — run them to show D-MKN9.3 held.
Mutations: swap the precedence; drop `arrivedBy` from `toBoardStop`; label both as McLeod.

Staging: the B4 fixture with stop 1 departed in McLeod and stop 2 without an arrival; on the simulator the
test driver taps "Mark arrived" on stop 2 → the board's Next stop cell and the drawer say "driver app";
post the fixture again with stop 2's `actual_arrival` set → both say "McLeod".

---

## 7. Gates per PR (all of them run; these are the ones each PR moves)

| PR | Gates that change state |
|---|---|
| B1 | `typecheck`, `lint:boundaries`, `test-packages`, `test-api` |
| B2 | `lint:migrations`, `lint:migration-ordering`, `lint:table-modules`, `lint:schema-snapshot`, `lint:table-writers`, `matrices` |
| B3 | `lint:table-access`, `lint:filesize` (shrink), `lint:funcsize`, `lint:comment-claims`, `test-api`, `test-web` |
| B4 | agent `node --test`, `review.test.mjs`, `lint:upserts`, `lint:shared-contracts`, `lint:filesize` (`DispatchLoadsPage.vue` must drop below 450 after the extraction), `test-*`, `typecheck-build` |
| B5 | same as B4 minus the agent's routine (unchanged) |
| B6 | `lint:table-access` (driver-app reads `loads` only through `loads/index.ts`), `test-api`, driver `pnpm --filter @silvicom/driver test` |
| B7 | `test-packages`, `test-api`, `test-web`, tutorial fixture typecheck |

## 8. Rollback

- B1, B6, B7: revert the PR; no data written.
- B2: columns are additive and unread until B3/B4; a rollback is a later migration dropping them, one
  release after their last reader is gone (MIGRATION-DISCIPLINE).
- B3: revert; `external_unmatched` stays written but unread; the relink pass returns to its old rule.
- B4/B5: revert the API; the VM's newer connector keeps posting `reference_numbers`, which an older API
  strips — the connector need not be rolled back. A wrong PU rule is a constant change plus
  `reprojectMcleodMirror.ts`, never hand SQL.

## 9. Plan bookkeeping on merge

Append to `docs/plans/mcleod/MCLEOD-API-KIT-PLAN.md` §8 and, for Q-LMR5/Q-LMR10, to
`LOADS-MIRROR-PLAN.md` §8 (append at the end, dated, one entry per merge; memory
`plan-progress-log-not-table-rows`). Mark Q-MK9 and Q-MK10 ruled as recommended by the owner's
"proceed" on this spec, Q-LMR10 ruled (a), and Q-LMR5's PU half ruled per V1's outcome.
