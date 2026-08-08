# Hazmat consolidation — audit and plan (2026-08-07)

Triggered by the product owner's review of the dashboard: five hazmat nav items where there should be
none, duplicating Loads, Trailers and Compliance. Four of the five pages were mine (2026-07-31 and
08-01, built to the H5/H7 page list); `HazmatPage.vue` predates them.

The page count was the symptom. The audit below found the causes, and two of them are live defects.

## 1. The principle that was missing

**A sellable module is not a navigation section.** HazmatGuard is a line item in `org_modules` — a
commercial fact about what a customer bought. It says nothing about where the work belongs in the
product. Hazmat is a property of a load, a property of a trailer, and a property of a driver's
qualification file. Loads, Trailers and Compliance were already the right homes for all three.

Recorded as **D-H1**, because this will come up again with Training, Navigation and Messages.

## 2. What the audit found

### 2.1 Loads — two parallel load entities

`loads` already carries `hazmat boolean not null default false` (`0085_driver_loads.sql:40`), and
`LoadsPage.vue:83` already renders it as a badge column. `0092_hazmat_core.sql:37` then created
`hazmat_loads` as an entirely separate table **with no foreign key to `loads`**. Marking hazmat on a
load and opening the hazmat work from there — which is what the owner asked for — is impossible today
because those are two different loads.

There is a real reason the separation exists: HazmatGuard is separately sellable, so a customer who
buys it without Dispatch has no `loads` rows at all. The separation is defensible; the *absence of a
link* is not.

### 2.2 Cargo-tank profiles — a separate page over a child of `trailers`, feeding nothing

- `hazmat_cargo_tank_profiles` (`0092:128-139`) is already a **1:1 foreign-key child of `trailers`**
  (or of `vehicles`, for straight trucks — `check (num_nonnulls(trailer_id, vehicle_id) = 1)`).
- `trailers.trailer_type` has allowed `'tanker'` since `0100_trailers_master.sql:26-29` — eight
  migrations *after* the hazmat table was created.
- **The whole of `0100`'s master column set is dead in the application.** `trailer_type`, `vin`,
  `capacity_cube_ft`, `capacity_weight_lb`, the registration and inspection expiries — a repo-wide
  grep returns zero hits outside the migration. The shared `Trailer` interface
  (`packages/shared/src/fleet.ts:145-161`) and the web's column list (`useTrailers.ts:5-6`) still
  describe the 0030/0032 trailer. What users actually see is the single `is_reefer` boolean.
- The equipment picker offers **every trailer in the fleet**, dry vans included — it does not filter
  on type (`useHazmatProfiles.ts:43`).
- **Nothing reads the data.** `cargo_capacity_gal` and `compartments` appear in the engine in exactly
  two places: the input schema, and `UNEVALUATED_INPUTS` (`hazmat-engine/src/eligibility.ts:26-27`).
  Providing them raises a `conditional` finding — so **filling in a cargo-tank profile today makes a
  load *less* likely to auto-clear and changes nothing else.** The service file says so itself
  (`hazmatProfiles.ts:9-14`): the capacity and compartment rules are H2 and have not landed.

So the owner's instinct is right, and the data is stronger than the instinct: the page collects
information that has no consumer and a negative effect.

### 2.3 Compliance — the duplication is real, but not where it looked

`qualification_records` (`0129`) does **not** duplicate `certifications` (`0127`). Their `kind`
vocabularies are disjoint; one models credentials that expire and renew, the other models dated DQF
events (MVR pulled, road test taken, drug test performed). `0128` is one `jsonb` column on the
immutable run row and duplicates nothing.

The table that actually duplicates is **`certifications` (0127)**, which re-expresses
`drivers.cdl_expires_at`, `drivers.medical_card_expires_at` and `driver_endorsements` (all `0098`) in
temporal form. And it is the only one of them any enforcement path reads.

More striking: most of the declared compliance system has **no application code at all**.

| Object | Migration | Application code |
| --- | --- | --- |
| `certifications` | 0127 | Read + written; the qualification gate's only source |
| `qualification_records` | 0129 | API built; **zero web UI** |
| `compliance_items` | 0101 | **Zero** reads, zero writes |
| `master_documents` | 0101 | **Zero** |
| `driver_endorsements` | 0098 | **Zero** — despite `0098:86-87` claiming the hazmat gate reads it |
| `compliance_scan` job | named in 0101 | **Does not exist** |
| `documents` table | referenced by `document_id` | **Does not exist** |

### 2.4 Two live defects found on the way

**F-H1 — every hazmat load is currently unclearable.** The qualification gate reads `certifications`
and fails closed; no UI has ever populated that table, so `qualifyDriver` emits `driver_unqualified:cdl`,
`:medical`, `:endorsement_hazmat`, `:endorsement_tank` and four `training_*` findings for every driver.
`hazmatReview.ts:42-48` makes those flags **impossible to override** by design — correctly, since a
lapsed qualification is a legal disqualification. This is intended behaviour meeting an empty table.

**F-H2 — the Compliance page grades every fleet as a cargo-tank hazmat carrier.**
`CompliancePage.vue:85` hard-codes `vehicleKind: "cargo_tank"` and `orgHasSecurityPlan: false`, so a
non-hazmat fleet sees every driver as "Action required" against criteria that do not apply to them.
The page is also nav-gated on the **fleet** capability, not on the hazmat module, so it renders for
orgs that do not have HazmatGuard.

**F-H3 — qualification is enforced at clear, not at assignment.** `evaluateQualification` has no call
site in dispatch. An unqualified driver can be assigned to a hazmat load and can drive it; only the
*clearance* is blocked. Whether that is right is a product decision, not an oversight to fix silently.

## 3. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D-H1 | A sellable module is not a navigation section. | §1. Hazmat belongs to Loads, Trailers and Compliance. |
| D-H2 | `hazmat_loads` gains a **nullable** `load_id → loads(id)`. | Nullable preserves standalone HazmatGuard for a customer without Dispatch, while letting the two products present as one when both are entitled. |
| D-H3 | Cargo-tank capacity and compartments move onto `trailers` and `vehicles`; `hazmat_cargo_tank_profiles` is dropped. | It was already a 1:1 child of those tables. Two columns on the equipment row replace a table, a page, an API and a picker. |
| D-H4 | `trailer_type` becomes the real, surfaced equipment type, and marking a trailer `tanker` is the only place tank data is entered. | The column and its `'tanker'` value already exist and have since 0100; they were simply never wired to the UI. |
| D-H5 | The cargo capacity and compartment fields are **not surfaced** until the H2 engine rules read them. | Today entering them only blocks auto-clear. Collecting data that punishes the person who enters it is worse than not collecting it. |
| D-H6 | `certifications` is the single source of truth for qualification. The `0098` current-value columns stay for the roster's own display and stop being a second truth. | It is the only table any enforcement reads. Two sources of truth for a legal gate is the problem, not the schema shape. |
| D-H7 | Schema with no application code is deleted, not left in place. | `compliance_items`, `master_documents` and `driver_endorsements` read as protection in a review and provide none — the same failure as `requireStepUp` in the platform plane. Delete, or build; not neither. |
| D-H8 | The hazmat review queue keeps its route and loses its nav item. | It is reached from a Loads row action and from the notification that raised it, as the owner described. The route stays so it remains testable. |
| D-H9 | The public placard calculator stays; the internal duplicate becomes a tool inside the load's hazmat section. | The public one is lead generation on the marketing surface and has a different audience. |

## 4. Plan

### H-C0 — Stop the bleeding (small, independent, do first)

- **F-H2 — DONE.** `CompliancePage.vue` derives `vehicleKind` from the fleet's actual equipment and
  `orgHasSecurityPlan` from the org's certifications; both were literals.
- **F-H1 — DONE 2026-08-08.** The decision was the second option: an explicit state, not seeded data.
  Seeding Silvicom's certifications would have hidden the problem for one customer and left it for
  every customer after them.

  `qualifyDriver` and `qualifyOrg` now return `state: "qualified" | "not_started" | "incomplete"`.
  With **zero** certifications on file the findings collapse to one — `driver_unqualified:
  file_not_started` (or `org_unqualified:file_not_started`) — naming what the file needs. With one or
  more, every gap is named individually again, because from that point each is a distinct fact about
  a real file.

  **This is not a softening of the gate**, and the tests say so in as many words: `qualified` stays
  false, and the code keeps the `driver_unqualified:` / `org_unqualified:` prefix that
  `hazmatReview.ts` matches to make a finding UNCLEARABLE. If that prefix were ever dropped, an empty
  qualification file would silently become a supervisor-clearable risk decision.

  Two details worth keeping: employment status survives the collapse, because a terminated driver is
  disqualified whether or not anyone started their file; and the roster badge for `not_started` is
  neutral, not red. On a fleet's first day every driver is in that state, and a roster of red rows
  that all mean "nobody has filed anything yet" is how a real disqualification later gets scrolled
  past. The Compliance filter gained a **Not started** option, because onboarding a fleet and chasing
  an expired medical card are two different jobs.

  `qualificationGate.ts` also gained its first test file — 22 assertions, covering the §10.4/§10.5
  predicates that had never been tested directly as well as the new state.
- Record **F-H3** as a product decision. Recommendation: warn at assignment, block at clear.

### H-C1 — Link the loads (D-H2) — **DATA HALF DONE 2026-08-08; UI half deliberately held**

Split on purpose. The schema and API are the part that is safe to write while the driver-app design
system is being reworked by hand; the page deletions and the nav change touch surfaces that are
moving, and doing them now would mean writing against a moving target.

**Shipped — `0148_hazmat_load_link.sql` and the API around it:**

- Nullable `hazmat_loads.load_id`, with a partial unique index so a dispatch load carries at most one
  CURRENT hazmat record.
- The foreign key is **composite** — `(load_id, org_id)` against `loads(id, org_id)` — so a bug in a
  service-role path cannot link one carrier's hazmat record to another carrier's load. A plain FK on
  `load_id` alone would have allowed exactly that, and RLS would not have caught it, because the
  service role bypasses RLS. The matrix asserts the refusal.
- `on delete set null (load_id)`, column-scoped: deleting a dispatch load releases the link and never
  cascades into the hazmat record, which is evidence with its own retention.
- `link_hazmat_load(org, hazmat_load, load)` — SECURITY DEFINER, service-role grant only. A cleared
  hazmat load is immutable and a correction is a NEW row citing `supersedes_load_id`, so a naive
  unique index would have made every correction unlinkable. The function moves the link **forward
  along the supersede chain**, releases the predecessor, and refuses (HZ003) to take it from any
  record outside that chain — which is what stops an unrelated record quietly claiming a load's
  hazmat history. Re-linking the same pair is a no-op, not an error.
- Linking sets `loads.hazmat = true`, so the boolean the Loads board already reads can no longer
  disagree with the record. One-way on purpose: unlinking does **not** clear it, because dispatch may
  have marked a load hazmat for its own reasons and this function does not get to overrule them.
- `POST /api/hazmat/loads/:id/link` and `DELETE /api/hazmat/loads/:id/link`, both audited.
- `GET /api/dispatch/loads/:id` now returns `hazmat_record` — id, status, tank state, and the newest
  analysis outcome — or null, which is the shape for the overwhelming majority of loads. **This is
  what LD6 was waiting for.**

Twelve new assertions in `supabase/tests/load-lifecycle.test.mjs` (42 → 54).

**Still open, and intentionally so:**

- `LoadsPage.vue`: the hazmat column becomes the entry point, plus a hazmat filter.
- The workspace moves out of `/hazmat/loads/:id` and onto the load detail page as a section. The
  dependency this plan flagged — "there is no load detail page today" — is gone: LD2 shipped
  `DispatchLoadDetailPage.vue`, and `hazmat_record` is already on its payload.
- Delete `HazmatLoadsPage.vue`, `HazmatPage.vue`, their routes and their nav items. Keep
  `HazmatLoadDetailPage.vue`'s content; it becomes the section, not a page.

### H-C2 — Fold equipment into Trailers (D-H3, D-H4, D-H5)

- Migration: `cargo_capacity_gal numeric(8,1)` and `cargo_compartments jsonb default '[]'` on
  `trailers` and on `vehicles`; backfill from `hazmat_cargo_tank_profiles`; drop the table and its
  RLS, its module gate in `0103`, and the `hazmat/profiles` routes and service.
- `packages/shared/src/fleet.ts`: extend `Trailer` and `trailerInputSchema` to the columns that
  actually exist — starting with `trailer_type`, which has been dead since 0100.
- `TrailerForm.vue` gains a **Type** select (dry van / reefer / flatbed / tanker / hopper / other).
  `is_reefer` stays as the fuel domain's own flag and is kept in sync from `trailer_type` rather than
  edited separately.
- The three engine read sites (`hazmatAnalysis.ts:177`, `orchestrate.ts:144`, `reproduce.ts:111`) read
  the equipment row instead of the profile table.
- Delete `HazmatEquipmentPage.vue`, its route, its nav item and `useHazmatProfiles.ts`.

### H-C3 — Consolidate compliance (D-H6, D-H7)

- Surface `qualification_records` in the Compliance page — the API is built and has no UI, which is
  why the DQF event history is invisible.
- Add the missing `CertManager` affordances the audit found: document upload (which needs the
  `documents` table that `document_id` already points at and which does not exist), history view
  (`includeHistory` is supported by the API and never requested), and the fields the API accepts but
  the form omits.
- Delete `compliance_items`, `master_documents` and `driver_endorsements` unless a consumer is being
  written in the same change. Remove their `schemaCheck.ts` assertions with them.
- Equipment and organization certifications are already expressible (`subject_type` allows 'tractor',
  'trailer', 'organization') and unreachable in the UI — wire the org one at least, since the hazmat
  gate reads org-level certs and blocks on them.

### H-C4 — Nav and shell

Five items removed from the sidebar: HazmatGuard, Hazmat Loads, Placard Calculator, Hazmat Review,
Cargo-Tank Profiles. Nothing added. The hazmat module's presence changes what appears **inside** Loads,
Trailers and Compliance — never whether a new section appears.

## 5. Not in scope

The visual rework of the existing hazmat pages — the owner is doing that by hand. A page-composition
fitness check (asserting every page uses `PageHeader`, the standard container and the shared table and
empty-state components) is worth adding *after* that rework, so its grandfather list starts near empty;
adding it now would fight the edits in flight.

## 6. Open questions

1. **H2 capacity rules** — D-H5 hides the fields until the engine reads them. If H2 is far off, is
   there a reason to keep the columns at all, or should they land with the rules?
2. **Load detail surface** — Loads has no detail page. Does the hazmat workspace open in a SlideOver
   from the table, or is this the moment to build a real load detail page that dispatch also needs?
3. **F-H3** — warn at assignment and block at clear, or block at assignment too? Blocking at assignment
   is safer and will be resented by dispatchers at 5am.
4. `certifications.subject_type` is polymorphic with **no foreign key**. Worth fixing while the model
   is being consolidated, or deliberately left as-is?
