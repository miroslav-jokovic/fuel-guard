# McLeod as source of truth — connection counsel and driver-roster cutover

**Written:** 2026-08-23
**Inputs:** `docs/McLeod-Testing/` (sandbox inspection, 2026-08-21), `docs/plans/MCLEOD-TMS-INTEGRATION.md`
(the 2026-08-11 `ws`-API design), the shipped `tools/mcleod-agent`, and the current driver/telematics code.
**Status:** counsel — no code changed. Decisions D-MC1…D-MC9 below are proposals awaiting sign-off.

---

## 0. What changed since the last McLeod plan

`MCLEOD-TMS-INTEGRATION.md` closed with six open questions and named question 2 (**the network bridge**) as
the gating decision. The sandbox delivery answers a *different* question than the one that was asked: instead
of enabling the LoadMaster `ws` web-services API, the carrier's IT stood up a **read-only SQL Server database**
(`lme_analytics` on `10.0.1.171`) holding a snapshot taken at 09:30 on the delivery date.

That is a strictly better surface for what we want — the `ws` API exposes orders/movements/drivers through a
vendor-defined lens, whereas the database exposes all 1,459 tables and 34,852 columns directly — but it does
**not** answer the bridging question, and it introduces four new problems the `ws` path did not have
(snapshot freshness, credential blast radius, PII exposure, and schema coupling to a vendor's private model).

The rest of this document is: what the docs actually establish (§1), the six things that block a connection
(§2), the architecture I recommend (§3), the driver cutover in detail (§4 — this is the bulk of the work),
what "source of truth" can and cannot mean per domain (§5), and the execution order (§6).

---

## 1. What the inspection docs establish

All nine documents in `docs/McLeod-Testing/` are metadata-only inspections — schema, row counts, and column
types, with no business values read. They are high quality and I have no corrections to their content. The
findings that matter for this decision:

| Fact | Source | Consequence |
|---|---|---|
| 1,459 user tables, 552 populated, 907 empty; all under `dbo` | schema catalog | The empty ones are *supported but unused features*, not missing data. Do not plan around them. |
| `dbo.driver` — **1,491 rows, 159 columns**, populated | schema catalog | A real HR roster with hire/termination dates, CDL, medical, and endorsements. This is the prize. |
| `dbo.company` — **4 rows** | schema catalog / segments guide §1.1 | The database is multi-company. Every query is `company_id + record_id`; a query without `company_id` mixes tenants. |
| `dbo.movement` 296,242 · `dbo.orders` 150,990 | schema catalog | The reefer gate and load ingest from the 2026-08-11 plan are fully feasible. |
| `dbo.mc_position` 1,035,043 | schema catalog | McLeod holds its own position history — overlaps Samsara, does not replace it. |
| **`dbo.fuel_detail` — 3 rows** | schema catalog | **McLeod is not the fuel source of truth.** EFS stays authoritative. See §5. |
| `dbo.driver_hours` 1,433,721 — daily aggregate (`hours`, `off_duty_hours`, `remaining_hours`, `miles_driven`) | schema catalog | This is an HOS *summary*, not the per-status-change ELD record `hosSync` consumes. Not a Samsara replacement. |
| Dedicated repair/work-order/parts schemas are **empty** | maintenance inventory | There is no maintenance cost to import. Do not scope it. |
| The native cost-fact model is **empty**; CPM must be assembled from GL + allocation rules | CPM inventory §5.1, three-lists | CPM is a finance project requiring carrier-approved allocation rules, not an import. |
| `dbo.driver_application` — **2 rows**; `driver.tenstreet_id` exists | schema catalog | Their applicant flow lives in **Tenstreet**, not McLeod. This matters for the recruiting work — McLeod will not feed the application system. |
| Schema carries `social_security_no`, `birth_date`, `race`, `sex`, banking, payroll, and credential columns | extraction guide §3.7 | An explicit column allowlist is mandatory. `SELECT *` against `dbo.driver` pulls SSNs. |

The extraction guide's own rules (§3.1 scope by company, §3.5 don't double-count current/history layers, §3.7
allowlist columns) are correct and should be treated as binding on any code we write.

---

## 2. Six things that block a connection today

### 2.1 The host is unreachable, and that has not been solved

`10.0.1.171` is RFC1918 space. Verified 2026-08-23: no route and no TCP/1433 from this workstation. Railway
cannot reach it either — **this is the same gating decision the 2026-08-11 plan raised as open question 2 and
it is still open.** Handing us a database on a private IP does not bridge a network.

The three options from that plan still stand, re-scored for a SQL surface:

1. **Outbound on-prem agent (recommended).** Runs on their network, connects to SQL Server locally, POSTs
   normalised rows to FuelGuard over HTTPS. No inbound hole. `tools/mcleod-agent` already exists in this exact
   shape and is already documented for their IT.
2. **Site-to-site / WireGuard tunnel from Railway.** Now more attractive than it was for `ws` (a long-lived
   pooled SQL connection wants a stable tunnel more than a REST call does), but it puts a live database socket
   in the blast radius of a cloud service and requires their IT to operate a tunnel endpoint.
3. **Expose SQL Server to the internet behind an IP allowlist.** Do not do this. Exposing TDS/1433 publicly is
   materially worse than exposing an HTTPS `ws` endpoint, and the credential in play today is a shared human
   analyst login (§2.2).

> **D-MC1 (proposed):** bridge with the outbound agent (option 1). Revisit a tunnel only if a domain needs
> sub-minute freshness, which none currently does.

### 2.2 The credential is a shared human login, and it is sitting in the working tree in plaintext

`docs/McLeod-Testing/setup.md` contains a username and password in clear text. The directory is currently
**untracked and not gitignored** — one `git add -A` publishes it. `docs/psp-docs/` is already ignored for
exactly this reason (`.gitignore:80`); this needs the same treatment before anything else happens.

Separately, `NikiAnalytics` reads as a person's analyst account. A service integration must never share a
human's credential: it cannot be rotated independently, its permissions drift with that person's job, and its
audit trail is ambiguous.

> **D-MC2 (proposed):** (a) gitignore `docs/McLeod-Testing/` immediately and rotate the shared password;
> (b) ask their DBA for a dedicated `fuelguard_ro` SQL login, and (c) store it sealed with `secretBox` under a
> new purpose constant, exactly as `samsaraToken.ts` seals the Samsara token — never in an env var on a shared
> host, never plaintext in `org_integrations.config`.

### 2.3 "Read-only" is a posture, not a grant

`db_datareader` grants SELECT on every table including `social_security_no` and the payroll/banking columns.
Read-only protects *them* from us; it does not protect us from holding PII we never wanted and cannot lawfully
justify.

> **D-MC3 (proposed):** ask for one of, in order of preference: (a) a set of `dbo.fg_*` views exposing only the
> allowlisted columns, with SELECT granted only on those; (b) explicit per-table `GRANT SELECT (col, col, …)`;
> (c) `db_datareader` plus `DENY SELECT` on the PII columns. Whichever we get, the agent still queries an
> explicit column list and never `SELECT *` — belt and braces, and it is what extraction guide §3.7 requires.
> All connections carry `ApplicationIntent=ReadOnly` and a statement timeout.

### 2.4 We do not know what `lme_analytics` actually is

The setup note calls it "the SQL snapshot that was taken today at 0930". A one-off restore, a nightly restore,
and an Always On readable secondary have completely different freshness contracts, and a product feature
cannot be built on the first. Everything downstream — how often the roster syncs, whether termination dates
are trustworthy within a day, whether load context is fresh enough for the reefer gate — depends on this.

> **Ask, blocking:** is `lme_analytics` refreshed on a schedule, and at what lag? Is there a readable secondary
> of the live LoadMaster database we should target instead for production?

### 2.5 We do not know which company we are

Four rows in `dbo.company`, and 1,491 driver rows against roughly 248 active FuelGuard drivers for Silvicom.
Some of that gap is terminated drivers; some of it is other companies. Until we know the carrier's
`company_id` value(s) we cannot write a single correct query.

> **Ask, blocking:** which `company_id` (of the four) is the carrier, and are any of the other three in scope?

### 2.6 We do not know what the status codes mean

`driver.status_code char(4)`, `driver.is_active char(1)`, `driver.termination_date`, `driver.start_status_date`
/ `end_status_date`, and `driver.reason_for_leaving char(3)` all bear on "is this person on the roster". Their
`dbo.code` / `dbo.reason_code` reference tables hold the vocabulary. Guessing here means either a roster that
misses working drivers or one that carries 1,200 ghosts into a per-driver-priced product.

> **Ask, blocking:** the `status_code` and `reason_for_leaving` code lists, and confirmation of which
> combination means *currently employed and driving*.

---

## 3. Recommended architecture

**Extend `tools/mcleod-agent` with a SQL Server source. Do not build a SQL Server client into `apps/api`.**

The reasoning is that the seam already built is the right seam. `packages/shared/src/tms.ts` defines a
**provider-neutral wire contract** and its header states the intent explicitly: the agent owns the McLeod
field mapping so FuelGuard never learns a vendor's schema. That seam is worth more with a database source than
it was with `ws`, because a database schema is a *private* vendor interface — 159 columns on `dbo.driver` that
McLeod may reshape in any release, with no compatibility promise of the kind an API carries. Putting `mssql`
and knowledge of `char(8)` driver ids inside `apps/api` couples our deployable to that private schema forever.

Concretely:

- `tools/mcleod-agent/agent.mjs` gains `SOURCE=sqlserver` alongside `mock` and `mcleod`. The `ws` path stays —
  it is not dead, and some carriers will only ever offer it.
- The agent takes its first dependency (`mssql`, pinned). It already has a `package.json`; the README's
  "zero dependencies" claim gets updated. This is a real cost — an air-gapped install now needs a package
  fetch — and it is worth paying to avoid hand-rolling TDS.
- Every query lives in one file (`queries.mjs`) as a named, parameterised, column-explicit statement with
  `company_id` bound. That file is the entire surface of our coupling to McLeod's schema, and it is reviewable
  in one sitting.
- The agent posts to the existing ingest endpoints. Auth, org resolution, and idempotency are already built
  and tested (`tmsIngest.orgForIngestToken` matches by hash against an *enabled* integration only).

> **D-MC4 (proposed):** the agent is the only component that speaks SQL Server. `apps/api` gains no database
> client and no McLeod-schema knowledge; it gains one new ingest route per domain.

### What is new on the FuelGuard side

- `packages/shared/src/tms.ts` — a `tmsDriverInputSchema` + payload (§4.3). This is the only genuinely new
  contract; movements and loads already have theirs.
- `apps/api/src/services/tmsDriverIngest.ts` — the roster upsert. Modelled on `samsaraDriverSync.ts`, which
  already encodes every hard-won rule we need (enrich-never-clobber, collision-aware name matching, the
  mass-deactivation guard). Note the 500-line file budget: matching, mapping, and applying should be three
  files from the start rather than one that has to be split later.
- One migration (§4.1).
- `org_integrations.config` gains the non-secret settings: `company_id`, the status-code vocabulary, and which
  domains are enabled. `last_synced_at` already exists and is already stamped.

---

## 4. The driver cutover — McLeod as roster master

This is the substantial change, and it has one trap at the centre of it.

### 4.1 The trap: Samsara is not just a roster, it is a join key

`samsara_driver_id` is the join key for **every telematics feature in the product**. It appears in
`hosSync.ts` (17 sites), `idleRollup.ts`, `idleSync.ts`, `idleDutyEvidenceSync.ts`, `driverScoreSync.ts`,
`driverReconcile.ts`, `efsImport/reconcile.ts`, and `rosterContract.ts`. Turning off `samsaraDriverSync`
does not merely change where names come from — it stops maintaining the link that HOS, idle attribution, and
driver scores all read. New drivers would arrive from McLeod with a null `samsara_driver_id` and silently have
no HOS, no idle evidence, and no score, with nothing failing loudly.

So the cutover is **not** a replacement. It is a split of two responsibilities that Samsara currently holds
together:

| Responsibility | Today | After |
|---|---|---|
| Who is on the roster (create/deactivate rows) | Samsara sync | **McLeod sync** |
| Identity fields (name, phone, CDL, medical, hire/termination) | Samsara sync | **McLeod sync** |
| The telematics link (`samsara_driver_id`) | Samsara sync | **Samsara sync, link-only** |
| Office corrections | `resolveDriverUpdate` → claims row to `manual` | unchanged |

> **D-MC5 (proposed):** when McLeod is enabled for an org, `syncDriversFromSamsara` runs in **link-only mode**:
> it matches Samsara drivers to existing rows (same precedence: samsara id → phone → `driverMatchKey`) and
> writes `samsara_driver_id` and nothing else. It does **not** INSERT, and it does **not** run the
> deactivation pass — McLeod's `termination_date` is better evidence than absence from a telematics roster,
> and two systems both deactivating will fight. An unmatched Samsara driver is reported, not created: it means
> someone is driving who is not on the HR roster, which is a finding, not a row to invent.

### 4.2 Schema

Next migration is `0239` (`0238_applicant_dispositions.sql` is current head).

```sql
alter table drivers add column if not exists mcleod_driver_id  text;  -- dbo.driver.id, char(8)
alter table drivers add column if not exists mcleod_company_id text;  -- dbo.driver.company_id, char(4)

create unique index if not exists uq_drivers_org_mcleod
  on drivers (org_id, mcleod_driver_id) where mcleod_driver_id is not null;

alter table drivers drop constraint if exists drivers_identity_source_check;
alter table drivers add constraint drivers_identity_source_check
  check (identity_source in ('samsara', 'manual', 'efs', 'mcleod'));
```

Two things this migration **must** do that are easy to miss:

- **`merge_driver` must learn the new column.** `0203_merge_driver_preserves_dqf.sql` handles `efs_driver_id`
  by nulling it on the source row *before* coalescing it onto the canonical, precisely so the partial unique
  index does not trip mid-merge. `mcleod_driver_id` needs the identical treatment. Nothing checks this — no
  lint gate covers `merge_driver` completeness — so it has to be done deliberately and pinned by a PGlite
  matrix case.
- The unique index will refuse to build over duplicates, by design (that is 0123's whole posture). The first
  sync run into a fresh column cannot create duplicates, but a re-run after a partial failure can, so the
  ingest must key on `(org_id, mcleod_driver_id)` and never blind-insert.

### 4.3 Field mapping — `dbo.driver` → `drivers`

Every one of these columns exists on both sides today; this is unusually clean.

| McLeod | FuelGuard | Notes |
|---|---|---|
| `id` (char 8) | `mcleod_driver_id` | The stable key. Trim — `char` is space-padded. |
| `company_id` (char 4) | `mcleod_company_id` | Also the mandatory query filter. |
| `name`, `first_name`, `name_mid_initial` | `full_name`, `first_name`, `middle_name`, `last_name` | `name` is `char(28)` and likely "LAST, FIRST". Confirm against real rows before trusting a parse; `deriveFullName` already exists for the reverse direction. |
| `phone`, `cell_phone` | `phone`, `phone_alt` | Prefer `cell_phone` for `phone` if it is the one that reaches drivers — confirm. |
| `email` | `email` | `char(30)` — will truncate real addresses. Treat a truncated value as absent rather than writing a broken address. |
| `license_no`, `license_state` | `cdl_number`, `cdl_state` | See §4.4 — this changes the D6 enrich-only rule. |
| `license_date` | `cdl_expires_at` **or** `cdl_issued_at` | **Ambiguous and consequential.** Must be confirmed against real rows before writing: getting it backwards puts every driver's licence permanently expired or permanently valid. |
| `medical_cert_expire`, `medical_cert_exempt` | `medical_card_expires_at` | Feeds the DQ file directly. |
| `hire_date`, `termination_date` | `hire_date`, `termination_date` | See §4.5 — retention consequences. |
| `is_active`, `status_code` | `status` | Needs the code vocabulary (§2.6). |
| `address`, `city`, `state`, `zip` | `address_line1`, `city`, `state`, `postal_code` | |
| `birth_date` | `date_of_birth` | PII; DQ needs it. Pull deliberately, not incidentally. |
| `hazmat_certified`, `hazmat_date`, `tanks_endorsement`, `doubles_certified` | `cdl_restrictions` / endorsements | We have no structured endorsement columns. Either add them or skip — do not stuff them into free text. |
| `mvr_date`, `physical_date`, `fmcsa_clearinghouse_date`, `last_review_date` | *(no home)* | These map onto the DQ file's qualification records, not onto `drivers`. Out of scope for the roster sync; a strong candidate for a later DQ-evidence import. |
| `tractor_id` | *(do not import)* | Dispatch's assignment. `driver_equipment_timeline` (0150) is authoritative for what a driver was *actually* in — D43. Importing this would create a second, conflicting answer. |
| `payee_id`, `dri_uid`, `mc_login`, `tenstreet_id` | *(hold)* | Useful later for settlement and ATS linkage. Not now. |
| `social_security_no`, `race`, `sex`, `name_of_spouse` | **never** | Not in the allowlist, not in the query, not in a log line. |

### 4.4 The CDL rule has to change, and it is an improvement

`samsaraDriverSync` writes `cdl_number` **only when empty** (the D6 enrich-only rule), with a documented
reason: editing a licence does not claim a row for the office, so a hand-corrected licence on a telematics row
would be silently reverted by the next sync. That reasoning was sound *for telematics*, where the licence is a
convenience field.

McLeod is the carrier's system of record for driver qualification. Its `license_no` / `license_state` /
`medical_cert_expire` are the values the carrier's safety department maintains and would defend in an audit.

> **D-MC6 (proposed):** for rows with `identity_source = 'mcleod'`, the CDL and medical fields are
> **authoritative and refreshed every sync**, not enrich-only. The office's escape hatch is unchanged: editing
> an identity field claims the row to `manual` via `resolveDriverUpdate`, after which McLeod stops writing it.
> This does mean a safety clerk correcting a licence in FuelGuard rather than in McLeod will see it reverted —
> which is the correct outcome (fix it in the system of record), but it must be said out loud in the UI.

### 4.5 Termination, deactivation, and the retention clock

`drivers.termination_date` is not an ordinary field: it starts the retention clock, and `resolveDriverUpdate`
stamps one when an edit implies it. Evidence tables (`certifications`, `qualification_records`, `documents`,
`dq_exports`) are append-only and pinned in `RETENTION_FORBIDDEN`.

An automated writer for that column therefore needs an explicit decision rather than a default.

> **D-MC7 (proposed):** the McLeod sync may **set** `termination_date` from `dbo.driver.termination_date` and
> may move `status` to `inactive`. It may **never clear** a termination date and never delete a row. A
> re-hire (McLeod clears the date) surfaces as a review item for the office, not as an automatic reactivation —
> mirroring the existing Samsara rule that reactivation stays an admin decision.
>
> The mass-deactivation guard from `samsaraDriverSync` carries over verbatim and matters more here: never
> deactivate more rows than the incoming active roster size, and skip the pass entirely on a thin fetch. A
> failed or mis-scoped query against a 1,491-row table could otherwise terminate an entire fleet in one run,
> with retention consequences that are not reversible by simply re-running.

### 4.6 The EFS stub reconciliation — the quiet win

Migration 0204 measured it: **81 of Silvicom's 248 "active" drivers are EFS stubs** — fuel-card names
auto-provisioned so a fill always had somebody to point at. They are payment identities, not employees. They
are excluded from qualification surfaces and SambaSafety enrolment, but they still sit in the roster.

A real HR roster is the first thing that can actually resolve them. For each `identity_source = 'efs'` row,
match against McLeod on `driverMatchKey(full_name)` plus `license_no`; a confident match becomes a
`merge_driver` call (which is why §4.2's merge fix is a prerequisite, not a nicety), and the rest stay stubs.

> **D-MC8 (proposed):** ship the reconciliation as a **review queue**, not an automatic merge. `merge_driver`
> is irreversible and touches DQF evidence. `driverReconcile.ts` already exists as the place for this.

### 4.7 Sequencing risk

Do not cut over in one release. The order that keeps every step reversible:

1. Add the columns; sync **link-only** (write `mcleod_driver_id` onto matched rows, change nothing else).
   Measure: how many of the ~248 match, how many McLeod actives have no FuelGuard row, how many FuelGuard
   actives are absent from McLeod. That report is the go/no-go, and it is worth having before any argument
   about semantics.
2. Turn on identity writes for matched `mcleod` rows only.
3. Turn on creation of new rows from McLeod, and demote the Samsara sync to link-only (D-MC5).
4. Turn on termination/deactivation (D-MC7).
5. Open the EFS reconciliation queue (D-MC8).

---

## 5. What "source of truth" can honestly mean, domain by domain

The blanket framing — McLeod becomes *the* source of truth — is right for identity and dispatch and wrong for
fuel, and acting on the blanket version would cost real money. Per domain:

| Domain | McLeod evidence | Verdict |
|---|---|---|
| **Driver roster / identity / qualification dates** | `driver` 1,491 rows, 159 cols, populated | **Yes — McLeod becomes master.** §4. |
| **Tractors / trailers** | `tractor` 660, `trailer` 459 | **Yes for identity** (unit numbers, in/out of service). Samsara keeps VIN, odometer, and telematics. Same link-only split as drivers. |
| **Movements / orders / stops** | `movement` 296k, `orders` 151k | **Yes.** This is what the 2026-08-11 plan wanted, now reachable in bulk. Unblocks the reefer gate and load ingest. |
| **Fuel transactions** | **`fuel_detail` = 3 rows** | **No. EFS remains authoritative.** McLeod is not being used for fuel at this carrier. Any plan that assumes otherwise is planning against an empty table. |
| **HOS / duty status** | `driver_hours` 1.4M **daily aggregates** | **No.** Samsara's per-status-change ELD record is what `hosSync` and idle attribution need. The McLeod aggregate is a useful cross-check, not a substitute. |
| **Positions** | `mc_position` 1.0M | **No.** Overlaps Samsara. Possible reconciliation input; not a replacement. |
| **Settlement / driver pay** | `drs_settle_hist` 260k, `drs_payee` 537 cols | **Candidate, later.** Genuinely rich, and adjacent to the seven-day statements (0236). Needs its own scoping — extraction guide §3.5 warns that settlement, payroll, checks, and GL are lifecycle views of one payment and must not be summed. |
| **Maintenance / work orders** | dedicated schemas **empty** | **Nothing to take.** |
| **Cost per mile** | native cost-fact model **empty**; requires GL + carrier-approved allocation rules | **A finance project, not an import.** The three-lists document is the right scoping artefact; do not start until §2's asks are answered and finance has signed the allocation rules. |
| **Applicants / recruiting** | `driver_application` **2 rows**; `driver.tenstreet_id` present | **No — their ATS is Tenstreet.** Worth knowing before any more recruiting work assumes a McLeod feed. |

> **D-MC9 (proposed):** "source of truth" is declared **per domain** in `org_integrations.config`, not
> globally, and the UI shows provenance per field. A carrier on McLeod for identity and EFS for fuel is the
> normal case, not an exception.

---

## 6. Execution order

**Blocked on answers (§2.4, §2.5, §2.6) — ask this week:**

1. Is `lme_analytics` a one-off restore or a scheduled refresh? What lag? Is there a readable secondary of live?
2. Which `company_id` is the carrier?
3. The `status_code` / `reason_for_leaving` vocabularies, and which mean *currently employed*.
4. Does `driver.license_date` mean issue or expiry?
5. Dedicated `fuelguard_ro` login with a column allowlist (§2.3), and the equivalent for production.
6. Network bridge: agent on their box (recommended) or tunnel.

**Not blocked — do now:**

- **M0.** Gitignore `docs/McLeod-Testing/` and rotate the credential in `setup.md`. Ten minutes; do it first.
  Consider scrubbing the internal host IP from the catalog header before that document is committed.
- **M1.** `SOURCE=sqlserver` in the agent, `queries.mjs`, and one read-only smoke query (`select count(*) from
  driver where company_id = ?`) run from inside their network. Proves connectivity, the login, and the company
  filter in one step. *Done when:* the count is reported and matches the carrier's expectation.
- **M2.** Migration 0239 (columns, index, `identity_source`, **`merge_driver`**) + PGlite matrix pinning the
  merge case and the unique index. *Done when:* `pnpm test` is green with the new matrix printing `RESULT`.
- **M3.** `tmsDriverInputSchema` in `packages/shared/src/tms.ts` + `tmsDriverIngest` in link-only mode +
  the match report from §4.7 step 1. Fixture-driven tests using a de-identified sandbox capture and an
  injectable row-lister — the `listerOverride` pattern from `samsaraDriverSync`, so CI never needs SQL Server.
  *Done when:* the match report is produced against real sandbox data and reviewed.
- **M4.** Identity writes, then creation + Samsara demotion, then termination — one PR each, in that order.

**Explicitly out of scope until the above lands:** CPM, maintenance, settlement, and anything touching
`gl_ledger`. They are well-documented and they will still be there.

---

## Open questions for you

1. **Is the sandbox a stand-in for production, or is production a different database entirely?** The plan
   above assumes the same schema and a different host/credential. If production is Oracle rather than SQL
   Server — the 2026-08-11 plan noted an "Oracle/SQL-Server backend" — the agent needs a second driver and
   `queries.mjs` needs dialect handling.
2. **Do we want tractors/trailers in the same cutover as drivers, or after?** Same pattern, roughly the same
   size of change, and doing both at once halves the review cost but doubles the blast radius.
3. **Who owns the McLeod side operationally?** Every one of the §2 asks needs a named person at the carrier or
   their IT provider. Without that, this stalls exactly where the `ws` path stalled in August.
