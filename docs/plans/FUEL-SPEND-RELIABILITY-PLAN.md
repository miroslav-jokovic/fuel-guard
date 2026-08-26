# Fuel Spend & Reconciliation — Reliability, Architecture and Savings Plan

**Opened 2026-08-25 against `main` @ 78862bb.** Companion to `FUEL-SPEND-RECONCILIATION-PLAN.md`,
which built the thing. This one makes it precise, reliable, and worth selling to a carrier whose
controller will audit it.

The audit behind §0 is recorded at
`https://claude.ai/code/artifact/3d084778-59ee-425b-bc91-10693a71ee5e` — 47 findings with stable ids
(B1–B4, L1–L14, X1–X12, A1–A8, E1–E9, N1–N10). This plan cites those ids; it does not repeat them.

---

## 0. Ground truth (measured 2026-08-25, not recalled)

**What is built and good.** `packages/shared/src/fuelSpend/` is the strongest layer in this feature
and probably in the repo. `contractCapture` scores every fill against Pilot's own quoted "Your Price"
and reports what it could not measure rather than scoring it as correct. `operatingBridge` decomposes
Δspend to a $0 residual and withholds its miles/efficiency split when odometer coverage cannot
support it. `policyExceptions` prices each exception against the fleet's *other* fuel with the
exception excluded from its own baseline. 152 shared tests and 25 web tests pass.

**What is not.** That discipline stops at the module boundary. Four defects put visibly wrong numbers
on screen (B1–B4), and none is detectable by the suite, because **no test mounts
`FuelReconciliationPage.vue` or `ReconcileTab.vue`** — where all four live (E9). Beneath them:

- The matcher the page is named after is a card-and-date heuristic that ignores an exact vendor key it
  already parses (L1), cannot tolerate one day of business-date drift and emits *two* false findings
  plus a double-counted dollar figure when it happens (L2, L3), scores null as mismatch (L4), and
  gives different answers for the same week depending on which file format Pilot sent (L7, L8).
- A reconciliation run is ephemeral. Upload, read, navigate away, gone. Nothing persists what was
  compared, against what, with which tolerances, by whom, or what it concluded (E4, X11).
- An exception has no state, owner, dispute artifact or recovery tracking, so the product finds money
  and structurally cannot follow it (E1–E3). This is the half of the feature that does not exist.

**The one-line thesis.** The arithmetic is right and the *system around the arithmetic* is missing.
Everything in §5 is either closing that gap or protecting the arithmetic while it is closed.

---

## 1. The architecture this must end in

Five theses. Every step in §5 serves one of them; a step that serves none does not belong here.

### 1.1 A reconciliation is a domain object, not a screen state

Today: the browser parses a file, runs `reconcilePilotFuel` in memory, renders a table, and forgets
it. Every reliability property being asked for — reproducibility, audit, dispute, recovery tracking,
tolerance versioning, "what did we conclude in June" — requires the run to be a **persisted,
server-computed artifact**. This is the largest single change here and E1–E5, X11 and L8 all collapse
into it.

The pattern already exists in this codebase and does not need inventing: `POST /api/fueling/statements`
has the browser decode bytes to positioned words (only it has `pdfjs`) and send *words plus the
original bytes*, then the **server re-parses and refuses anything it cannot stand behind**. The
reconciliation takes exactly that shape. The browser never asserts a conclusion.

    browser                          server                                database
    ─────────                        ──────                                ────────
    decode bytes → words / grid ───▶ re-parse                              fuel_recon_runs   (evidence,
                                     tie out (both formats — L8)             append-only)
                                     read system fills (service role,
                                       org-filtered — RLS is bypassed)
                                     match (pure, @fuelguard/shared)  ───▶ fuel_exceptions  (operational,
                                     price                                   mutable lifecycle)
                                     persist + audit                  ───▶ fuel_exception_events
                                                                            (append-only act log)
    render the persisted run ◀────── GET the run

### 1.2 One ledger, many detectors

Reconciliation discrepancies, contract variance, off-network premium, missed-station savings and
plan deviation are **the same object**: a priced, dated, attributable finding with a lifecycle. If
each grows its own table, its own status vocabulary and its own screen, the product ends with six
half-workflows and no answer to "what did we recover last quarter" (E3).

One `fuel_exceptions` table with a `kind` discriminator, one lifecycle, one surface. A new detector is
a new `kind` and a new producer — never a new table.

**Why not `anomalies`, which already has this lifecycle.** `anomalies.transaction_id` is `not null`
and references `fuel_transactions`. A `missing_in_system` finding — the fuel-theft surface, the most
valuable thing the reconciler produces — has **no `fuel_transactions` row by definition**. That is the
whole point of the finding. `anomalies` structurally cannot hold half the reconciliation output, so
reuse is not available; the lifecycle *columns* are copied, the table is not (D-FX2).

### 1.3 The pure core stays pure, and grows the parameters it should always have had

`packages/shared/src/fuelSpend` and `packages/shared/src/reconcile` do no I/O, take no clock, and are
the reason the PDF and the page cannot disagree. Nothing in this plan moves logic out of them. B4's
fix is to **thread `FuelPolicy` in as a parameter** — which the signature already accepts and no
caller passes — not to relocate the decision. Same for tolerances (D-FX9).

The rule this makes explicit: **anything that varies by org is a parameter of the pure function and a
column in the database. It is never a constant in the module that computes it.**

### 1.4 Aggregation belongs where the rows are

Every feed-fed tab pages the *entire window* into the browser 1,000 rows at a time — in a serial
`await` loop — and aggregates client-side (E6). At ~1,400 fills/month this is fine. It is also the
exact shape of the problem migration 0248 found on the server, where two un-inlinable scalars cost
46× and took the spend report down silently.

Direction: the **line-level** reads stay (the exception tables genuinely need lines), but every
**aggregate** — tiles, weekly series, rollups, coverage — moves behind a set-based function beside
`fuel_spend_lines`, on the same `security invoker` + `coalesce(p_org, auth_org_id())` pattern (D-FC1,
0247). Not because it is slow today, but because the client-side half has never had the scrutiny the
server-side half got.

### 1.5 Evidence and operations are different tables, and each says which it is

House rule, already enforced: evidence is append-only and pinned in `RETENTION_FORBIDDEN`; operational
data is mutable and prunable. This feature needs both, and the split is not obvious, so it is decided
here rather than at the migration:

| Table | Side | Why |
|---|---|---|
| `fuel_recon_runs` | **Evidence** — append-only, `RETENTION_FORBIDDEN` | What we concluded about a vendor's bill on a date, with the inputs and tolerances that produced it. A correction is a new run that supersedes, never an overwrite — the `fuel_statements` argument verbatim. |
| `fuel_exceptions` | **Operational** — mutable lifecycle, prunable | Status, owner, note. A human's working state, not a record of fact. Its *evidence* is the immutable `run_id` + line snapshot it points at. |
| `fuel_exception_events` | **Evidence** — append-only act log | Who changed what, when, and why. 0213's trigger style (`auth_role() is null` passes) so retention can still prune with the exception it belongs to. |

---

## 2. Decisions

**D-FX1 — The reconciliation runs on the server and is persisted.** The browser decodes and displays;
it never concludes. Mirrors `POST /api/fueling/statements` (WP4). Consequence: the monthly export path
gains the tie-out gate it never had (L8), because there is now one place that can refuse.

**D-FX2 — One `fuel_exceptions` table, not `anomalies` and not one per detector.** Argument in §1.2:
`anomalies.transaction_id is not null` and `missing_in_system` has no transaction. Lifecycle columns
are copied from `anomalies` (`status`, `assigned_to`, `resolved_by`, `resolved_at`,
`resolution_note`, `evidence jsonb`) so the vocabulary and the badge tones are already familiar.

**D-FX3 — The match key is measured before it is chosen.** `PilotReportFill.authNo` is parsed and
unused (L1); `fuel_transactions.transaction_id` holds EFS's own id (0107) and `efs_transactions`
holds the verbatim `invoice`; `StatementLine` additionally carries `ticket` and `poNumber`. **Whether
any of these join is unknown and will not be assumed.** F0 measures the join rate of every candidate
pair on production and the answer is recorded in §6. The fallback if none joins above ~95%: keep the
heuristic, but make it drift-tolerant and deterministic (F4 ships either way).

**D-FX4 — Drift is a status, not a pair of findings.** A report line and a system fill that agree on
card, gallons and amount but sit one business day apart are **one fill, dated differently** — status
`date_drift`, one row, its dollars counted once. Today this is a `missing_in_system` plus a
`missing_on_report` plus double-counted exposure (L2, L3). The window widens by ±1 day, never further:
a two-day tolerance starts matching genuinely different fills.

**D-FX5 — Gross and net exposure are reported apart and never summed.** `dollarsAtStake` becomes four
figures with four meanings: `overbilled` (recoverable), `underbilled` (owed), `unbilled` (recorded,
never invoiced), `unrecorded` (invoiced, never recorded — the theft surface). A single "at stake"
number that adds all four is the thing being removed, not renamed.

**D-FX6 — Policy and tolerance are org configuration, everywhere.** `route_fuel_settings` already
carries `avoid_states`, `avoid_brands`, `preferred_brands`, is editable on the Fuel Planning Settings
page, and is honoured by the planner. The compliance report ignores it (B4). Fixed by threading, not
by moving. `DEFAULT_FUEL_POLICY` and `DEFAULT_TOLERANCES` survive as **documented defaults for an org
that has configured nothing** — which is what they were always meant to be.

**D-FX7 — Unmeasured is never zero, in `totalsOf` as well as `contractCapture`.** `contractCapture`
gets this right and says so at length. `totalsOf` does not: it sums `retailAmount ?? 0` and divides
by all gallons (B3), which is how the off-network tab prints a negative discount. Same rule, same
module, one gap. `SpendTotals` gains an explicit retail-bearing denominator; every consumer that
shows a discount figure shows what share of gallons it was measured over.

**D-FX8 — The page is Fuel Spend; Reconciliation is one tab of it.** Five of seven tabs are spend
analytics and the source comments say so throughout (X1). Rename nav and `meta.title`, keep
`/fuel-reconciliation` as a permanent redirect — links to it exist in the wild and the page's own
header argues that a link that dies is a page nobody can send.

**D-FX9 — Tolerances are snapshotted onto the run, not read at display time.** A run reconciled at 1¢
must still read as 1¢ after somebody widens the org setting to 2¢. The values in force are columns on
`fuel_recon_runs`.

**D-FX10 — A detector never writes a lifecycle.** Re-running a reconciliation over a period that
already has exceptions must not reset a human's work. Exceptions carry a deterministic
`fingerprint` (kind + the natural key of the thing found); a new run **upserts evidence and leaves
`status`, `assigned_to` and `resolution_note` alone**, and closes what it no longer finds with
`status = 'resolved_by_reingest'` and an event row saying so. Never `.upsert()` with a partial payload
(`lint:upserts`) — this is an UPDATE or a set-based RPC, on 0174/0175's model.

**D-FX12 — The tax table is minted from IFTA's own matrix, never typed, and never extrapolated.**
`scripts/fetch-ifta-rates.mjs` writes `packages/shared/src/fuelTax/rates2026.ts` and nothing else may.
Its gate is free and real: each quarter's matrix states the previous quarter's rate beside every
changed one, so consecutive quarters cross-check each other, and the script refuses to write on any
disagreement. Two consequences that outlive F10. **(a)** A date outside the captured quarters returns
`null`, not the nearest quarter — a tax rate that has expired has not gone missing, it has changed,
and carrying one forward would put a legislated number where an estimate belongs (this is the opposite
of `fuel_prices`' one-day quote carry-forward, which absorbs an operational gap in a daily report).
**(b)** Every figure derived from the table records which quarter priced it and whether IFTA has
finalised that quarter, because the current quarter is provisional for about ten weeks of every
thirteen. Cutting a new quarter is a person running the script and reading the diff, quarterly — never
CI, which cannot reach `iftach.org` and should not be silently re-cutting a table nobody has read.

**D-FX11 — Savings claims wait for fuel tax.** N1 (missed-station) and N3 (buy-quantity) both
recommend *where to buy*. Nothing in the repo models state fuel tax or IFTA; `ifta` appears once, as a
compliance licence label. Pump price is not landed cost, so a "buy here instead" recommendation can be
actively wrong and the California premium is overstated. F10 lands before F11/F13, or those steps ship
with the recommendation suppressed and only the observation shown. **SATISFIED 2026-08-26 by F10**,
which measured how overstated: 41% of the California premium is California's tax rate. F11 and F13
score candidates on `preTaxPremiumPerGal` — the price of the fuel, which is the only part a different
stop changes — and never on the pump price.

---

## 3. Facts the design is bound by (each verified 2026-08-25 against the tree; none recalled)

1. **`fuel_transactions.transaction_id` exists and is nullable** (0107), with partial unique indexes
   on `(org_id, transaction_id, tank_type)` — because one EFS transaction is *not* one fill: a
   tractor+reefer swipe is one id and two rows. Any exact-key matcher must key on the pair, never the
   id alone.
2. **`fuel_transactions` carries no DEF at all.** `fuelSpendRollup.ts:39` states it; DEF comes from
   `efs_transactions` on item codes `DEFD`/`DEF`. So `useSpendLines`' hardcoded `product: "diesel"`
   (A8) is *correct today* and becomes wrong the moment that changes. It gets a column, not a comment.
3. **`fuel_spend_lines` is `security invoker` with `coalesce(p_org, auth_org_id())`** (D-FC1, 0247) —
   a browser is scoped by its JWT, the API must pass `p_org` explicitly because the service role
   bypasses RLS, and a caller that passes neither gets no rows. Every new function follows this.
4. **Do not add `set search_path` to a per-row scalar** (D-FI1, 0248). It blocks inlining; measured at
   128× per row and 46× on the report, which timed out rather than slowing down. Entry points keep it;
   scalars schema-qualify instead.
5. **`anomalies.transaction_id` is `not null`** (0003) — the reason D-FX2 exists.
6. **`fuel_statements` / `fuel_statement_lines` are append-only by trigger and pinned in
   `RETENTION_FORBIDDEN`** (0243), with a superseded row frozen entirely. `fuel_recon_runs` copies
   this exactly.
7. **`fuel_prices` writes are service-role only** since 0245 (D-FP2); the client write policy was
   removed deliberately, because a price series a browser session can rewrite is not evidence.
   Idempotent on `(org, source, station, product, observed_at)`, `observed_at` being the report's own
   printed effective date at noon UTC — so re-uploading three months in any order is safe.
8. **Quotes carry forward at most one day** (`p_max_stale_days = 1`, 0248) and the price report is a
   **manual upload every 1–2 days** on `/import` — not this page (X2, A4). Coverage is therefore an
   operational fact the surface must show, not a footnote (X3).
9. **`route_fuel_settings` is readable by the browser** (`useRouteFuelSettings.ts` reads it via
   PostgREST) and already carries every field B4 needs.
10. **`TablePagination` lives at `apps/web/src/components/TablePagination.vue`**, not in
    `components/ui/`, and pairs with `DataTable`'s `#footer` slot — `OdometerPage.vue:191` is the
    reference call site. `DataTable` itself neither paginates nor virtualizes, by design (X12).
11. **No file in this feature is grandfathered** in `scripts/check-file-size.mjs`. Budget is 500 with a
    450 warning. `operatingBridge.ts` is at 481 and `pilotStatement.ts` at 462 — both already warn, so
    neither may absorb new code. `pilotFuelReport.ts` (329) will split in F4.
12. **PGlite matrices exist for the neighbours** — `fuel-spend-lines`, `fuel-spend-days`,
    `fuel-statements`, `fuel-price-history` — and `fuel-spend-lines.test.mjs` documents the four
    properties that fail quietly. New tables copy its shape, including the default-privileges block
    and `role` inside the claims JSON.
13. **The spend rollup rebuild and station re-resolve endpoints exist and have no UI anywhere**
    (`routes/fueling/spend.ts:77,100`) — X10 is a button, not a backend.
14. **`useIdleBreakdown` takes a date filter only** — no vehicle scoping — and is shared with the
    Idling page. X7 is therefore disclosure first; scoping only if it can be added without disturbing
    that page (memory: fix the state behind a shared control, never fork it).

---

## 4. Execution protocol

**Resume ritual (a fresh chat starts here):**

1. Read this document top to bottom, then `FUEL-SPEND-RECONCILIATION-PLAN.md` §6–§8 (the risks and the
   still-open contract questions), then the `CLAUDE.md` of every package the step touches.
2. Establish reality: `git log --oneline -15`, `pnpm verify:live`, and
   `gh run list --workflow=migrate.yml` before believing any schema mismatch — deploy and migrate
   finish at different times.
3. Find the first §5 step not marked **DONE**. Check its prerequisites against §6. A missing
   prerequisite means **run the fallback written next to it** — never guess.
4. One step per branch (`claude/<topic>`), branched from `origin/main` **explicitly** (parallel chats
   share this working tree), PR to `main`, merge after CI. `main` is branch-protected; there is no
   other path.
5. When a step ships, mark it **— DONE \<date\> (migrations NNNN–NNNN)** in place with a "What
   shipped" list and "Verified by:" naming the gates run. When a §6 question is answered, strike it
   through in place with the answer and the date. **This document is the memory between sessions.**

**Rules this feature is bound by, beyond the root `CLAUDE.md`:**

- Migration numbers are **never pinned in advance** — next-numbered at execution.
- Every new table: `org_id`, `enable row level security` (`check-rls.mjs`), no client write policy
  unless argued in a comment above it, a PGlite matrix printing a `RESULT` line, and a stated side of
  the evidence line (§1.5).
- Every service query org-filters itself; a test asserts it via `supabaseRecorder`'s `expectOrgScoped`.
  The service role bypasses RLS and this feature reads across four tables.
- Never `.upsert()` with a partial payload (`lint:upserts`) — D-FX10's re-ingest is an UPDATE or a
  set-based RPC (0174/0175).
- A comment claiming coverage quotes a real test title (`lint:comment-claims`).
- Money figures are **named by what they mean**, never "at stake" (D-FX5). A dollar figure whose
  denominator is not on screen beside it is a defect, not a formatting choice.
- Any new status vocabulary ships as machine tokens in shared **plus** an exported label map beside
  them, with tones in `apps/web/src/lib/badges.ts` only — no `.vue` file carries a status literal or a
  local tone `Record`. `ReconcileTab.vue`'s `STATUS_LABEL` and `statusTone` are existing instances and
  move in F4.
- Gates before any PR: `pnpm test`, `pnpm typecheck`, `pnpm lint`, plus the step's named extras.
  ⚠ `pnpm lint` scans `.claude/worktrees` — filter the path before believing a failure count.

---

## 5. Steps

Ordered so each phase makes the next one's numbers trustworthy. F1 and F2 are a pair and should land
in the same week; nothing after F2 is worth building on a screen a reader has learned to distrust.

---

### F0 · The match-key spike — DONE 2026-08-25 (no migrations, no PR)

**What it found.** Two questions answered, one blocked, and three facts that reorder the steps below.
All figures `supabase db query --linked`, org **Silvicom Inc** (11,043 fills) unless stated.

**Q-FX2 — ANSWERED: `state` is null on 0 of 11,310 fills, both orgs.** `localBusinessDate`'s UTC
fallback (`useFuelReconcile.ts`) **never fires in production**. L2's drift is therefore not the
systematic mis-dating the audit implied — it can still arise from the vendor's own business-date
cutoff, so D-FX4's ±1-day tolerance and the L3 double-count fix both stand, but neither is urgent.
L2 drops from Major to Moderate.

**Q-FX1 — BLOCKED, and the reason outranks the question. `fuel_statements` = 0 rows and
`fuel_statement_lines` = 0 rows in production.** No statement has ever been persisted. The join rate
cannot be measured because the vendor side of the join does not exist in the database, and the
WP4 ingest path — the server-side re-parse and tie-out gate — **has never run against the real
deployment**. Fallback taken, per this step's own instruction: F4 ships drift-tolerance and
determinism regardless, and takes the two evidence-backed key improvements already decided and never
built (below) instead of waiting on a key nobody can measure yet.

**Two F4 decisions already exist and were verified against all five real statements.** They belong to
`FUEL-SPEND-RECONCILIATION-PLAN.md` §3 and WP6 shipped without either:
- **D-FR6** — the statement's `Card Number` is the **last 6** of the EFS PAN
  (`7083050030490367971` → `367971`), verified. The matcher uses `last4`. A strictly stronger,
  collision-free key is available for free, with last-4 as a labelled weaker fallback.
- **D-FR7** — drop the `tank_type = 'tractor'` filter and match **within product class**
  (`020→tractor`, `033→reefer`, `021→tractor`, `140→def`), the codes resolved empirically against
  `efs_transactions.item` with exact count agreement. This is the audit's L7 under another name, and
  the older plan already calls it "a permanent false-positive block".

F4 cites these rather than re-deciding them. Q-FX1 stays open for a *third* improvement on top.

**System-side identifier shapes, for whenever Q-FX1 can be measured.** `fuel_transactions.transaction_id`
is 9–10 digits (`1494839957`, 10,844 of 11,310 populated) and equals field 2 of
`efs_transactions.external_ref` — so 0011's comment calling that field `invoice` is stale; it is the
EFS transaction id. **`efs_transactions.invoice` is a different number**: 10 chars with leading zeros
(`0036764554`, 20,830 rows) and a 12-char `…DB` variant (537 rows). That is the candidate that could
carry a Pilot-side ticket or authorization number, and it is 100% populated. Measuring it needs one
statement in production.

**THE FINDING THAT MOVES THE MOST MONEY, and it is not code.** Quote coverage on the default 90-day
window, tractor diesel:

    fills                   5,552
    with a contract quote   1,409     25.4% of fills
    spend                  $3,056,926
    spend measurable        $849,913   27.8% of spend

`fuel_prices` holds **20 days, 2026-08-02 → 2026-08-25**, and nothing before 2026-08-02. The gap is
**historical, not operational**: since the first priced day only 4 of 24 days are missing, which the
one-day carry-forward mostly absorbs. So the Discount Capture tab's headline variance describes
**28% of the fuel bill**, and the page does not say so at the headline.

0245 made the price ingest idempotent on `(org, source, station, product, observed_at)` with
`observed_at` taken from the report's own printed effective date — explicitly so that "re-uploading
three months of reports is safe in ANY order".

⚠ **CORRECTED 2026-08-25, after checking what is actually on disk.** F0 first recorded that
backfilling "the reports the carrier already has" would roughly triple the measurable share. That was
an assumption about which files exist and it is wrong. Every price file on the machine was parsed:
four are readable Pilot reports (2026-07-15, 08-02, 08-05, 08-12) and **three of those four days are
already loaded**. Exactly one day — 2026-07-15 — is new, reaching ~$108,853 across 200 fills, **3.5%**
of the window. The remaining unpriced $2,159,171 (70.4%, 4,055 fills, everything before 2026-08-02) is
**not backfillable from anything in hand**; those reports would have to come from Pilot. See Q-FX9 and
F7's C2, which is the fix that does not depend on them.

**Consequences for the steps below** — applied in place:
1. **B1 is downgraded.** Statements ignoring the page window is real, but with zero statements in
   production it is currently unobservable. It stays in F1 (it is three lines and a deletion) but it
   is no longer the reason F1 exists.
2. **Coverage is promoted out of F7 into F1.** A headline over 28% of spend that does not say so is a
   worse defect than any of B1–B4, and it is the same class of error: a figure without its denominator.
3. **F5 acquires a second purpose.** The statement ingest has never run in production; F5's runs
   endpoint should not be the first thing to discover that.

---

### F0-bis · Answer Q-FX1 without the upload — DONE 2026-08-25 (no code, no writes)

**What was done.** The upload itself needs an authenticated admin session and is still outstanding
(below). The QUESTION it was blocking did not: the five statement PDFs were parsed **locally with the
shipped parser** — `parsePilotStatement` driven by a Node mirror of `readPdfWords`, same top-left
origin, same `splitTextRun` — and the extracted keys joined against production read-only.

**All five parse and tie out outside the browser**, reproducing `FUEL-SPEND-RECONCILIATION-PLAN.md`
§1 exactly: 3,919 lines across invoices 790722856 → 795506105 (2026-07-20 → 2026-08-23),
`headerFound=true` and `tieOut.ok=true` on every one.

**Q-FX1 — there is no exact transaction key, and now we know rather than suspect.** Against the 4,634
`efs_transactions` rows in the same window:

| candidate | result |
|---|---|
| statement `ticket` (9 digits) → `efs.invoice`, zero-padded to 10 | **0 of 2,283** |
| statement `ticket` → `efs.invoice`, leading zeros stripped | **0 of 2,283** |
| statement `authNo` (6 digits) → `efs.invoice` | **0 of 1,511** |
| statement `cardRef` (6 digits) → last 6 of `efs.card_num` | **171 of 171 — 100%** |

Pilot's ticket and authorization numbers are Pilot's; `efs.invoice` is EFS's. They identify the same
physical fill and share no value. **F4 therefore stays a heuristic matcher** — D-FX3's fallback, taken
on evidence rather than on a missing measurement.

**D-FR6 is settled, and the case for it is stronger than the plan knew.** Among the 171 distinct cards
in the window, **39 last-4 groups collide, covering 121 of 171 cards (71%)**, and there are **zero**
last-6 collisions. More directly: **460 of 1,769 `(business day, last-4)` buckets hold more than one
physical card** — one bucket on 2026-08-19 holds five (`...7974` → 317974, 327974, 347974, 357974,
367974). Every one of those is a place today's matcher can pair a report line against the wrong truck's
fill, silently, and call it clean. Last-6 removes all 460.

**Also confirmed:** `authNo` and `ticket` repeat across the lines of one transaction (a 020 diesel line
and a 140 DEF line share both), so they key a TRANSACTION and not a line — the same fact 0107 records
for EFS's own id. Any future use of them must key on (id, product), never id alone.

---

### F0-bis-upload · Prove the statement ingest against production — STILL OPEN, needs the user

**Why it is not done.** `POST /api/fueling/statements` requires an authenticated admin or fleet_manager
session; production writes are the user's (see the standing note that writes go through Miki). Reads
were sufficient for everything above, and no write was attempted.

**Why it still matters, even with Q-FX1 answered.** `fuel_statements` holds **zero rows**, so WP4's
server-side re-parse and tie-out gate has never executed against the real deployment — only in tests
and, as of today, in a local harness. The first time it runs should not be the day someone needs it.

**Do.** Upload `db139445F.pdf` (invoice 795506105, 2026-08-17 → 2026-08-23) through **Reconcile a
file** on the deployed app. Expect: `fuel_statements` +1, `fuel_statement_lines` +844, the source PDF
in the private bucket, and `unresolvedSites` empty. All five files are in `~/Downloads`.

---

<!-- The original F0 spike brief, kept for the record: the candidate table it specified is the one
     measured above, and its answer is recorded there. -->

**The candidates it named.** For the five statement PDFs and the monthly exports already in hand, measure the join rate of
every candidate key pair against `fuel_transactions` / `efs_transactions` over the same window:

| Report side | System side | Notes |
|---|---|---|
| `PilotReportFill.authNo` (`Authorization_No`) | `fuel_transactions.transaction_id` | 0107's EFS id. Different issuers — may not join at all. |
| `authNo` | `efs_transactions.invoice` | The verbatim EFS column. |
| `StatementLine.ticket` | `efs_transactions.invoice` | Pilot's own ticket number. |
| `cardRef` + `tranDate` + `gallons` | same | Today's heuristic — the control. |

Report, per pair: match rate, collision rate (one report line matching >1 system row), and the shape of
the misses. Also measure **how many `fuel_transactions` rows have a null `state`**, which is L2's
trigger via `localBusinessDate`'s UTC fallback.

**Deliverable:** §6 Q-FX1 and Q-FX2 answered in place, with the numbers. **No PR.**

**Done when:** F4 can be written without a guess about its join key.

---

### F1 · Stop showing wrong numbers — DONE 2026-08-25 (no migrations)

**What shipped.** C1, B1, B2, B3, B4a as specified, plus the two things the work turned up.
- **C1** — `ContractCapture.measuredSpendShare` (paid ÷ in-scope paid). The Discount Capture hero now
  reads *"measured over $849,913 of $3,056,926 — 27.8% of this window's fuel"* beside the variance,
  and the PDF's contracted-price lead carries the same sentence. `ExceptionReport` gained
  `discountMeasuredShare` for the same reason.
- **B3** — `totalsOf` accumulates a retail-bearing subset (`retailLines`, `retailGallons`,
  `retailShare`) and every retail figure divides by it. **Verified against production**: 201
  off-network fills over 21,102 gallons, *none* with a posted price, printed
  **−$4.779/gal** under the label "Discount captured", in red, captioned "none captured at all". It
  now reads "—  ·  no posted price for these fills".
- **B2** — the ONE9 blurb uses `usd3`; it read "$4 a gallon against $4".
- **B1** — `useStatementsQuery` takes the page window and selects statements by **overlap**; the dead
  `scope`/`scopeOptions`/`watch` block is deleted, not wired (one period control, and it is the URL's).
  The empty state names the window it searched.
- **B4a** — both callers pass `DEFAULT_FUEL_POLICY` explicitly with the reason above the call, so F3
  is a change at two named sites.
- **Not in the original scope, found while doing it:** `spendTabs.test.ts`'s `fill` helper *required*
  `retailAmount: number`, so every fixture in the file was more measurable than production and the
  B3 defect was unreachable by construction. Widened to `number | null`.

**Verified by:** `pnpm test` (all suites, 26 PGlite matrices), `pnpm typecheck`, `pnpm lint` (the only
real-source finding is 2 pre-existing `vue/one-component-per-file` warnings in a file this branch does
not touch; the 700 errors are the `.claude/worktrees` copy), `lint:filesize`, `lint:funcsize`,
`lint:comment-claims`, `lint:boundaries`, `lint:upserts`, `lint:tokens-parity`, `lint:ui-adoption`,
`pnpm --filter web lint:tokens`. Six new tests: two on `totalsOf`, two on `analyzeContractCapture`,
four on the tabs.

**Prerequisites:** none. Do this first; it is small and everything else sits on top of it.

**Scope raised by F0.** The largest defect on this page is not in B1–B4 — it is that Discount
Capture's headline variance describes **27.8% of the fuel bill** ($849,913 of $3,056,926 on the
default window) and says so only in a caution strip below the fold. A figure without its denominator
is the same class of error as B3, so the coverage line moves out of F7 and ships here.

**Build.**
- **C1 (new, first)** — every discount, capture and variance headline states the share of spend it
  was measured over, beside the figure and not below it. Discount Capture's hero reads
  *"$96 net variance, measured over $849,913 of $3,056,926 — 28% of this window's fuel"*. The same
  line goes on the PDF's discount section. No new query: `ContractCapture` already carries
  `measuredLines`, `unmeasuredPaid` and the rest; it needs `measuredPaid` beside them and a consumer
  that prints it.
- **B2** — `FuelReconciliationPage.vue:169`: `usd()` → `usd3()` on `netPerGal` and `baselinePerGal`.
  A per-gallon figure printed with `maximumFractionDigits: 0` reads "$4 a gallon against $4".
- **B3** — `packages/shared/src/fuelSpend/types.ts`: `totalsOf` counts retail-bearing gallons
  separately from all gallons. `retailPerGal`, `discountPerGal`, `discount` and `capturePct` divide by
  the **retail-bearing** denominator and are `null` when it is zero. Add `retailLines` /
  `retailGallons` to `SpendTotals` so a consumer can state the share. Then `ExceptionsTab`'s "Discount
  captured" tile shows the share it was measured over, or an em dash — it currently prints a large
  negative dollar figure on the off-network tab (D-FX7).
- **B1** (downgraded by F0 — `fuel_statements` is empty in production, so this is currently
  unobservable there; it stays because it is three lines and a deletion) — statements obey the page
  window. Two halves, both required:
  `useStatementsQuery` takes the window and filters on overlap (`period_start <= to and period_end >=
  from`); and the dead `scope` / `scopeOptions` / `watch` block is **deleted**, not wired — the window
  is the page's one period control (`useSpendFilters`' whole argument) and a second scope selector
  reintroduces the disagreement it was written to end. The statement tab's empty state names the
  window it found nothing in.
- **B4a** — thread the policy parameter. `analyzePolicyExceptions(lines, policy)` already accepts one;
  neither caller passes it. Page and `fuelSpendReport.ts:87` both pass an explicit
  `DEFAULT_FUEL_POLICY` **for now**, so F3 is a one-line change at each call site rather than a hunt.

**Verify:** a unit test on `totalsOf` where half the lines carry no retail, asserting the discount is
measured over the retail-bearing gallons and the share is reported; a test that an off-network report
(no retail anywhere) yields `discountPerGal: null` rather than a negative number; a test that a
capture headline over a partial denominator renders the share (the C1 pin, and the one that would
have caught this class of defect twice).
**Done when:** the ONE9 blurb quotes cents, the off-network discount tile shows an em dash rather than
a negative dollar figure, the Statements tab shows the weeks the filter bar says it does, and no
headline dollar figure on the page is missing the share of spend it covers.

---

### F2 · Pin the page under test — DONE 2026-08-25 (no migrations)

**What shipped.** 29 tests across four files that nothing mounted, taking the reconcile feature from
25 web tests to 58.

| File | Tests | The failure it is aimed at |
|---|---|---|
| `pages/FuelReconciliationPage.test.ts` | 10 | a control that reaches nothing — the shape of B1, B2 and B4a |
| `reconcile/ReconcileTab.test.ts` | 6 | the tab the page is named after, previously zero coverage |
| `reconcile/spendTrendTab.test.ts` | 7 | a period still running compared against a finished one; a bucket labelled past the window |
| `reconcile/statementsCard.test.ts` | 6 | a button that opens nothing where evidence should be |

**The pins were verified to fail.** Reverting `FuelReconciliationPage.vue` and `useStatements.ts` to
their pre-F1 state (d231d4e) turns exactly four of the ten page tests red — the statements window, the
window moving on both queries together, the policy argument, and the per-gallon formatting. A test
that cannot fail pins nothing, so this was checked rather than assumed.

**Two notes carried in the test files themselves.** `spendTrendTab.test.ts` records L13's *current*
behaviour — headline tiles describe the last complete period and name no period — as an explicit
negative assertion, so F7's fix announces itself by turning that test red instead of landing silently.
`statementsCard.test.ts` records that `fuel_statements` is empty in production, so every assertion in
it describes a surface no carrier has seen yet (F0-bis).

**Verified by:** `pnpm test` (all suites, 26 PGlite matrices), `pnpm typecheck`, `pnpm lint` (only
real-source finding is the same 2 pre-existing `vue/one-component-per-file` warnings), `lint:filesize`,
`lint:funcsize`, `lint:comment-claims`, `lint:boundaries`, `lint:upserts`, `lint:ui-adoption`,
`lint:tokens-parity`, `pnpm --filter web lint:tokens`.

**Prerequisites:** F1 (so the tests pin the corrected behaviour).

**Build.** Component tests for the four files with no coverage, in
`apps/web/src/features/reconcile/` beside `spendTabs.test.ts`:

- `FuelReconciliationPage.vue` — every tab renders; **the filter bar's controls all reach the data
  they claim to** (the B1 regression pin); the tab and window survive a round-trip through the URL;
  an unknown `tab=` falls back to `spend`.
- `ReconcileTab.vue` — a parsed report renders its buckets; a bucket tile filters the table; the
  status vocabulary comes from shared, not from the file.
- `SpendTrendTab.vue` — tiles name the period they refer to (pins L13 once F7 lands); the empty state
  renders; the rejected-interval footnote appears only when there are rejects.
- `StatementsCard.vue` — a statement with no stored source shows an em dash rather than a dead button.

**Verify:** `pnpm --filter web test`; the new tests fail if F1's fixes are reverted.
**Done when:** every one of B1–B4 is caught by a test that would have failed before F1.

---

### F3 · Policy becomes org configuration — DONE 2026-08-25 (no migrations)

**What shipped.**
- **Shared** — `fuelPolicyFromSettings(row)` maps the three `route_fuel_settings` columns to a
  `FuelPolicy`, and `policyLabels.ts` names them (`avoidedStatesLabel`, `avoidedBrandsLabel`,
  `listStates`, `STATE_NAMES`). Brand names reuse `BRAND_LABELS` rather than a second catalogue.
- **The null-vs-empty distinction, which is the subtle part.** `resolveRouteFuelConfig` treats `[]` as
  unset and substitutes the default — correct for the PLANNER, which can plan nothing without a
  preferred list. It is wrong for a compliance report: a carrier who clears `avoid_states` is saying
  *there is no state we avoid*, and answering with a California report is the same error as ignoring
  the column. So `fuelPolicyFromSettings` keeps them apart: `null` → default, `[]` → no rule, no tab.
  Values are also case-normalised, because the settings form takes free text and a lower-case `"ca"`
  in a `Set` match simply never fires and reports a clean period.
- **Web** — `useRouteFuelSettings` moved from `features/fueling/` to `@/composables/` (shared state
  belongs there per `apps/web/CLAUDE.md`, and the reconcile feature must not reach into another
  feature). `useFuelPolicy()` sits on the SAME query, so saving settings invalidates both surfaces at
  once rather than giving them two caches to disagree from.
- **The page** — tab labels, titles and blurbs derive from the policy; a tab whose list is empty is
  hidden, and a stale link to it falls back to the trend rather than blanking.
- **Server** — `readFuelPolicy` reads the row org-scoped (service role bypasses RLS), and the PDF's
  exception rows are named from it.

**Found and fixed while doing it — the verdict band was triple-counting.** `supportLine` summed
`offNetwork.excess + avoidedStates.excess + avoidedBrands.excess`. Those three reports select
OVERLAPPING populations: a ONE9 fill in California appears in all three with its full excess, so the
one line of the document guaranteed to be read multiplied it by three. This is L11, in the worst
possible place. `PolicyExceptions` gained `offPolicy` — the union, scored once against the fills that
broke no rule — and the band reads it. The PDF's own note now says the rows must not be added, which
it could not honestly say before.

**On production this changes nothing visible today, and that is the correct outcome.** Silvicom's
configured policy is exactly `{CA} / {one9} / {pilot, flying_j}`, and the QA org has no row at all, so
both render as before. What changed is that the value is now *read* rather than assumed — the day
either org adds a state, the report follows the planner instead of contradicting it.

**Verified by:** `pnpm test` (all suites, 26 PGlite matrices), `pnpm typecheck`, `pnpm lint`, plus
`lint:filesize`, `lint:funcsize`, `lint:comment-claims`, `lint:boundaries`, `lint:upserts`,
`lint:ui-adoption`, `lint:tokens-parity`, `pnpm --filter web lint:tokens`. 16 new tests: 11 shared
(mapper, labels, `offPolicy` de-duplication), 5 page/API including `expectOrgScoped` on the new
service-role read.

**Prerequisites:** F1.

**Build.** The page reads `route_fuel_settings` through the existing `useRouteFuelSettings` and passes
a `FuelPolicy` to `analyzePolicyExceptions`; `renderFuelSpendReport` reads it server-side with the
service role, org-filtered. Tab labels become **derived**: "California" is generated from
`avoid_states` (`"California"` for one state, `"Avoided states"` for several, and named in the blurb);
"ONE9 & off-brand" from `avoid_brands`. An org with an empty `avoid_states` gets the tab hidden rather
than an empty report labelled with a state it does not avoid.

`DEFAULT_FUEL_POLICY` stays and its comment changes to say what it now is: the default for an org that
has configured nothing.

**Verify:** unit test — an org with `avoid_states = {CA, OR}` produces a report covering both and a
label that names both; an org with `avoid_states = {}` produces no avoided-state report.
`expectOrgScoped` on the server-side settings read.
**Done when:** changing `avoid_states` on the Fuel Planning Settings page changes what the compliance
tab measures, and the two surfaces can no longer disagree about the policy.

---

### F4 · The matcher, rewritten — DONE 2026-08-25 (no migrations)

**What shipped.** `pilotFuelReport.ts` 329 → 199 lines (parser only), plus `fuelProducts.ts` (88, the
product taxonomy) and `fuelMatch.ts` (the reconciler). The parser keeps its filename: it *is* the
grid parser now, every consumer imports through the barrel, and a rename would have been churn without
a behavioural gain.

- **L1 / D-FX3** — no exact key exists (F0-bis measured it). The matcher keys on the card's last SIX
  (D-FR6) with last-4 as a *labelled weaker* fallback, and the summary reports the two populations
  apart (`matchedOnCard6` / `matchedOnCard4` / `matchedOnDateGallons`).
- **L2 / D-FX4** — `date_drift`: ±1 day, one row, and a same-day candidate always beats a drifted one.
- **L5** — candidates are scored, sorted and consumed cheapest-first. Order-independence is pinned by
  permuting report and system **independently** (36 combinations); an earlier version of that test
  shuffled them in step and passed against a first-come scan, which is why it is written this way.
- **L4** — `within()` returns `null` for unknown, and a fill with no recorded cost is `amount_unknown`,
  not an amount mismatch worth $0.00.
- **L7 / D-FR7 — and my audit had this wrong.** I wrote that reefer in the export "becomes a false
  `missing_in_system`". It does not: `/truck diesel|diesel(?! exhaust)/i` never matched "Reefer", so
  those lines fell into `other` and **vanished**. Measured on the real 2026-06/07 export: 120 reefer
  lines dropped, while the screen reported `0 reefer`. The defect is real and worse in a quieter way —
  billed fuel, invisible. One code-keyed taxonomy now classifies both documents, and the system query
  fetches both tanks (the matcher keeps the classes apart itself).
- **L6** — the window comes from the report's declared dates.
- **L9** — a card-less line is never bucketed with other card-less lines.
- **L3 / D-FX5** — `dollarsAtStake` is gone. Four figures with four meanings, and nothing sums them.
- Status vocabulary + labels in shared; tones in `lib/badges.ts` (`reconStatusBadge`).

**Verified against all five real statements and production fills** (3,919 lines, 2,432 fills):

| invoice | clean | drift | missing in system | missing on report | keys |
|---|---|---|---|---|---|
| 790722856 | 451 | 2 | 0 | 4 | 453 all card6 |
| 791794052 | 454 | 3 | 0 | 2 | 457 all card6 |
| 793170296 | 458 | 5 | 0 | 4 | 463 all card6 |
| 794335795 | 438 | 2 | 0 | 2 | 440 all card6 |
| 795506105 | 495 | 4 | 1 | 7 | 501 all card6 |

**2,314 matches, every one on the card's last six — zero fell back.** The 16 drifted rows are the ones
the old matcher would have reported as 16 `missing_in_system` PLUS 16 `missing_on_report`, with their
dollars counted twice in "at stake".

**The real data corrected the exposure arithmetic.** The first version summed every non-zero amount
delta and reported *"85 lines overbilled"* on a week whose overbilling came to **one dollar** — EFS
bills a four-decimal rate and rounds to the cent, so a cent of disagreement is arithmetic. Exposure now
counts only rows whose status says they disagree. The same week then reads: overbilled $55 (1 row),
underbilled $54 (1), unrecorded $242 (1), unbilled $2,334 (7).

**The golden corpus is generated, not copied.** A week at the fleet's shape — 316 fuel lines, 100 DEF,
40 cards colliding on their last four — with four planted defects. The real statements and the fills
they were checked against are a carrier's billing records and do not belong in this repository
(`data-samples/` is gitignored for the same reason); what the generator keeps is the shape, not the
right to call the numbers Silvicom's.

**Verified by:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `lint:filesize`, `lint:funcsize`,
`lint:comment-claims`, `lint:boundaries`, `lint:upserts`, `lint:ui-adoption`, `lint:tokens-parity`,
`pnpm --filter web lint:tokens`. Matcher tests 8 → 23; every determinism and drift test was confirmed
to FAIL against a regressed matcher before being kept.

**Prerequisites:** F0 (the key), F2 (the tests). This is the step the page is named after.

**Build.** Split `pilotFuelReport.ts` (329 lines, and growing past budget) along the seam it already
has: `pilotReportParse.ts` (the grid → fills parser) and `fuelMatch.ts` (the reconciler). Then:

- **L1 / D-FX3** — match on the exact key F0 chose, first. Fall through to the heuristic only for
  lines the key could not place, and **report the two populations apart** — "1,380 matched on the
  vendor's transaction id, 29 matched on card and date" is a materially different claim from one
  number.
- **L2 / D-FX4** — `date_drift` status. Candidate window widens to ±1 day; a line that agrees on card,
  gallons and amount one day apart is **one row**, not two.
- **L5** — deterministic assignment. Within a (key, day) bucket, resolve as a minimum-cost assignment
  over |Δgallons| then |Δamount|, not a first-come greedy scan. Two fills on one card-day must not be
  paired crosswise, and re-exporting the same month in a different row order must produce a byte-identical
  result. Pin that with a test that shuffles the input.
- **L4** — `within()` stops returning `false` for null. A missing amount yields
  `amount: "unknown"`, never `amount_mismatch` worth $0.00.
- **L7** — reefer is separated in **both** formats. `isDieselRow`'s `/diesel(?! exhaust)/i` claims dyed
  reefer diesel in the monthly export, which is then matched against a tractor-only system set. The
  product taxonomy moves to one table keyed on Pilot's product code (`020`, `021`, `033`, `140`),
  which the statement parser already reads from the printed legend, with description matching as the
  fallback for the export.
- **L6** — the `missing_on_report` window comes from the report's declared `startDate`/`endDate`, the
  same window the fills were fetched on. Not the min/max of the fills found.
- **L9** — a card-less line is never bucketed with other card-less lines. No card, no card-key match;
  it goes to the heuristic or to `unmatched`.
- **L3 / D-FX5** — `dollarsAtStake` is deleted and replaced by `overbilled`, `underbilled`,
  `unbilled`, `unrecorded`, each with its own count. No function returns their sum.
- Status vocabulary and label map move to shared with tones in `lib/badges.ts` (§4).

**Verify:** the matcher's test file goes from 8 single-row cases to a real matrix — date drift in both
directions; a null amount; two fills on one card-day; the same input shuffled; a reefer line in each
format; a card-less line; a report line matching two system rows. Plus a **golden-file test** over one
real monthly export and one real statement, asserting the bucket counts, so a future change to the
matcher has to state what it moved.
**Done when:** the same week reconciles identically from the PDF and the export; a one-day drift
produces one `date_drift` row rather than two false findings; and no single number on the tab adds
recoverable dollars to owed dollars.

---

### F5 · A reconciliation run is persisted, and the export gains its tie-out — DONE 2026-08-25 (migration 0249)

**What shipped.**
- **`fuel_recon_runs` (0249)** — evidence. Append-only by trigger in 0243's style, **undeletable even
  by the service role** (SQLSTATE `FR010`/`FR011`), no client write policy at all, pinned in
  `RETENTION_FORBIDDEN`. The verdict is stored as `summary jsonb` — `ReconSummary` verbatim — because
  it is a snapshot of a typed result and thirty numeric columns would drift from the type the day a
  status is added. Period, source, tolerances and who ran it are real columns. There is deliberately
  no `dollars_at_stake`.
- **The tolerances are snapshotted (D-FX9)**, so a run reconciled at a cent a gallon still reads that
  way after the setting widens, alongside a `matcher_version` so two runs are only compared when the
  matcher matches.
- **`POST /api/fueling/recon-runs`** — the browser decodes (only it has `pdfjs` and ExcelJS) and sends
  words or the grid; the server re-parses, gates, reads the org's fills with the service role, matches
  and writes. Plus `GET` for the history. Audited as `fuel.recon_run` with the data-quality counts,
  because the run row itself is immutable and this is the only place they can accumulate.
- **L8 — the export is gated now, and the total was there all along.** The workbook is three sheets;
  only the first was ever read. The third is a `PivotTable` whose Grand Total prints `Sum of Quantity`.
  Verified on the real 2026-06/07 export: **parsed 418,537.23, printed 418,537.23**. A file with no
  pivot is *not* refused — older exports may lack one — but the run records `tie_out_gated = false`,
  because "we checked and it agreed" and "there was nothing to check" must never look the same.
- **Web** — `ReconcileTab` posts instead of computing, renders what the server recorded, says the run
  is kept, and gained **the CSV export it was the only tab on the page never to have**. It no longer
  pages `fuel_transactions` from the browser at all.

**Verified by:** `pnpm test` — including the new PGlite matrix `fuel-recon-runs` (**18 passed**),
covering append-only for the service role, undeletable in single and bulk form, no client insert for
admin/fleet_manager/dispatcher, org scope on read, and the supersede chain. Plus 9 service tests with
`expectOrgScoped`, and 3 new tab tests pinning that the browser posts rather than concludes.
`pnpm typecheck`, `pnpm lint`, `lint:migrations`, `lint:rls`, `lint:filesize`, `lint:funcsize`,
`lint:comment-claims`, `lint:boundaries`, `lint:upserts`, `lint:ui-adoption`, `lint:tokens-parity`,
`pnpm --filter web lint:tokens`.

**One deviation from the plan, stated:** the run stores the summary, not every row. Row-level
persistence is F6's `fuel_exceptions`, which is where a row acquires a lifecycle; storing them twice
would leave two records of the same finding with nothing to say which was authoritative. The POST
returns the full result so the tab renders immediately.

**Prerequisites:** F4.

**Build.**
- Migration (next-numbered): **`fuel_recon_runs`** — `org_id`, `source_kind`
  (`weekly_statement | monthly_export`), `statement_id` FK null, `source_filename`, `source_sha256`,
  `period_start`, `period_end`, the **tolerances in force** (D-FX9), the matcher version, the four
  exposure figures and their counts (D-FX5), `key_matched` / `heuristic_matched` counts (F4),
  `created_by`, `created_at`, `superseded_by` self-FK. **Evidence** (§1.5): append-only by trigger in
  the `fuel_statements` style — a superseded row frozen entirely — pinned in `RETENTION_FORBIDDEN`,
  named five-character SQLSTATE mapped by the API to an answer rather than a 500. Read policy
  org-scoped, no client write policy.
- API: `POST /api/fueling/recon-runs` — takes the same `{ words | grid, filename, sourceBase64 }` shape
  as `POST /api/fueling/statements`, **re-parses server-side**, and refuses anything that fails its own
  arithmetic. This is where **L8** is fixed: the monthly export gets a tie-out against its own
  PivotTable grand total, and the endpoint refuses rather than reconciling a file it mis-read.
  `GET /api/fueling/recon-runs` and `/:id`. Writes an audit row (`fuel.recon_run`) — E4.
- Web: `ReconcileTab` posts instead of computing, renders the persisted run, and gains a **run history
  list** — the reconciliation stops dying with the tab (X11). CSV export of the run's rows, which is
  the one tab that has never had one.

**Verify:** PGlite matrix `supabase/tests/fuel-recon-runs.test.mjs` — RLS deny-all for a client write,
the append-only SQLSTATE on UPDATE and DELETE, supersede leaves the earlier run intact, service-role
delete succeeds (the retention pin). Service tests with `expectOrgScoped` on every query. A test that
a mis-read export is **refused**, not reconciled.
**Done when:** a reconciliation run from three weeks ago can be reopened, and a monthly export that
does not add up is refused with the same rigour a PDF already is.

---

### F6 · The exception ledger

**⚠ SPLIT IN TWO, 2026-08-26.** As written this is three tables, an RPC, a shared module, an API, a
routed page with a slide-over, a rendered PDF and a recovery model — roughly four times F5 and past
the size at which a PR can be reviewed rather than waved through. The split is along the seam the
work already has:

- **F6a — the spine. DONE 2026-08-26 (migration 0250).** The tables, the RPC, the shared vocabulary and
  fingerprint, the producers, and the API. Findings are recorded and preserved across re-runs.
  No new screen — deliberately: the ledger has to be correct before it has a window.

  *What shipped.* `fuel_exceptions` + `fuel_exception_events` + `sync_fuel_exceptions`; shared
  `exceptions.ts` (kind/status/amount-kind vocabularies with label maps, the pure fingerprint, and the
  `reconFindings` / `contractFindings` producers); `routes/fueling/exceptions.ts` + a service split
  from day one; and `runFuelReconciliation` now files what it found.

  *The distinction that took the most care.* `fuel_recon_runs` is evidence — append-only, undeletable,
  `RETENTION_FORBIDDEN`. `fuel_exceptions` is deliberately **not**: status, owner and note are a
  person's working state, and an append-only queue would mean a typo in a note could never be fixed
  and the ledger could never be pruned when a carrier leaves. Its act log IS append-only, in 0213's
  style (exempting `auth_role() is null`) so retention can still prune the pair — an undeletable child
  would pin its mutable parent and quietly move the whole table across the evidence line.

  *D-FX10, half proven — and the other half was corrected in F16 (see below).* The matrix sets a
  finding to `disputed`, assigns it, writes a note, then re-runs the same period with changed
  evidence: the evidence updates and the status, owner and note do not. That half is real. The
  closing half — "a finding a run no longer produces is closed as `resolved_by_reingest`" — was
  **claimed here and could never have happened**: the close was scoped by `run_id`, which the upsert
  had already rewritten to the run doing the closing. The matrix agreed only because its fixture
  reused one run id across every call, which production never does. Fixed in **F16 (0253)**, with the
  fixture re-pointed at the production shape.

  *Two deviations, stated.* (1) The policy premiums are in the vocabulary and **no producer emits
  them** — 201 off-network fills in a 90-day window is not 201 actions, and choosing a threshold or a
  grouping is a product decision that belongs with the surface. (2) `contractFindings` files only the
  OVER side; a fill billed below contract is money in the carrier's favour and queueing it asks
  somebody to hand it back.

  *Verified by:* PGlite matrix `fuel-exceptions` (**31 passed**), 10 service tests with
  `expectOrgScoped`, 13 shared tests on the vocabulary, fingerprint stability and the producers.
  `pnpm test`, `pnpm typecheck`, `pnpm lint`, `lint:migrations`, `lint:rls`, `lint:upserts`,
  `lint:filesize`, `lint:funcsize`, `lint:comment-claims`, `lint:boundaries`, `lint:ui-adoption`,
  `lint:tokens-parity`.
- **F6b — the surface. DONE 2026-08-26 (no migrations).** The `/fuel-exceptions` page, the slide-over
  and event log, the dispute packet, and the identified/claimed/recovered figures.

  *What shipped.* `FuelExceptionsPage.vue` (`FilterBar` → `DataTable` + `TablePagination` → row-click
  `SlideOver`), `ExceptionSlideOver.vue` (evidence, act log, status/note/credit form),
  `useExceptions.ts`, `fuelExceptionStatusBadge` + `fuelExceptionAmountTone` in `lib/badges.ts`, the
  route + nav entry in the same commit, and `GET /api/fueling/exceptions/packet.pdf`.

  *Three numbers, never one.* The header is **identified / claimed / recovered**. "We found $14,200" is
  a claim about the software; "we recovered $14,200" is a claim about the business, and only the second
  renews a contract. Beneath them the four kinds of money stay apart (D-FX5).

  *The packet is grouped by kind and the totals are not added.* A line billed above the quoted price is
  an arithmetic disagreement; a line billed for a fill we have no record of is a question about whether
  it happened. Presented as one list they invite one answer.

  *Path note:* the page is `/fuel-exceptions`, not the plan's `/fuel-spend/exceptions` — there is no
  `/fuel-spend` parent route to hang it under (the spend page is still `/fuel-reconciliation`; D-FX8's
  rename is F8's). It is a sibling for now and moves with that rename.

  *Two gates caught real things.* The route table is snapshotted so a new path cannot slip in unpinned —
  updating it is how you acknowledge one. And `lint:ui-adoption` refused two raw `<input>` elements in
  the slide-over; they are `AppInput` now. The nav gate additionally requires a unique glyph per item,
  so `ExceptionLedgerIcon` (`BalanceScaleIcon`) was added to `packages/ui/src/icons.ts` first, per the
  barrel's own instructions.

  *Verified by:* 7 page tests, 5 packet tests (org-scoped, empty case, unfamiliar evidence blob, page
  count), plus the full gate list including `lint:ui-adoption` and the nav and route-table gates.

F6a is useless to a reader on its own and that is fine: the ledger has to be correct before it has a
window. F6b is the half a buyer evaluates and it goes in its own PR.

**Prerequisites:** F5. This is the step that makes the feature enterprise-grade; everything before it
is repair.

**Build.**
- Migration: **`fuel_exceptions`** — `org_id`, `kind` (closed set, opening with
  `recon_missing_in_system`, `recon_missing_on_report`, `recon_amount`, `recon_gallons`,
  `recon_date_drift`, `contract_variance`, `off_network_premium`, `avoided_state_premium`,
  `avoided_brand_premium`), `run_id` FK null, `transaction_id` FK **null** (D-FX2's whole argument),
  `statement_line_id` FK null, `vehicle_id`, `driver_id`, `station_id`, `occurred_on date`,
  `amount numeric` with `amount_kind` (`overbilled | underbilled | unbilled | unrecorded |
  premium | opportunity`), `evidence jsonb`, `fingerprint text not null` (D-FX10), plus the lifecycle
  columns copied from `anomalies`: `status`, `assigned_to`, `resolved_by`, `resolved_at`,
  `resolution_note`. **Operational** (§1.5) — mutable, prunable, deliberately not in
  `RETENTION_FORBIDDEN`, with the reason in the header. Unique on `(org_id, fingerprint)`.
- Same migration: **`fuel_exception_events`** — append-only act log, `on delete cascade`, 0213's
  trigger style so retention can prune with its parent. Named SQLSTATE.
- Same migration: RPC `sync_fuel_exceptions(p_org, p_run, p_findings jsonb, p_actor)` — `security
  definer`, set-based, **upserts evidence and never touches `status`, `assigned_to` or
  `resolution_note`** (D-FX10); closes what it no longer finds as `resolved_by_reingest` with an event
  row; writes its own audit row from `p_actor`. Not a partial `.upsert()` — an explicit UPDATE set
  (`lint:upserts`, 0174/0175 the pattern).
- Shared: `packages/shared/src/fuelSpend/exceptions.ts` — the `kind` and `status` vocabularies with
  their **label maps**, the fingerprint derivation (pure, so the server and a test agree), and the
  pure fold that turns a `ReconResult` + a `ContractCapture` + a `PolicyExceptions` into findings.
  One producer signature, so a new detector is a new call and not a new shape.
- API: `apps/api/src/routes/fueling/exceptions.ts` + a service (split from day one — six verbs).
- Web: `/fuel-spend/exceptions` — `FilterBar` (kind, status, owner, search, count) → `DataTable` +
  `TablePagination` (`components/TablePagination.vue`, `OdometerPage.vue:191` the call site) →
  `SlideOver` with the evidence, the assign/resolve actions and the event log. Tones in
  `lib/badges.ts`. Route record, `meta.title`, `parent`, and a **nav entry** in the same commit.
- **The dispute packet** (E2): `GET /api/fueling/exceptions/packet.pdf?ids=…` — rendered server-side
  from the persisted runs by the same `dqBinder/pdfDraw` machinery the spend report uses. Exception
  lines, quoted-vs-billed per line, invoice and auth references, the total, the period, the generating
  user and date. Writes `export.generated`.
- **Recovery** (E3): resolving an exception as `credited` captures the credited amount and date. The
  ledger's header figure is then `identified / claimed / recovered` — three numbers, never one.

**Verify:** PGlite matrix — RLS deny-all; the append-only SQLSTATE on the event log; **a re-ingest
over an exception a human has assigned and noted leaves both intact** (D-FX10's pin, and the one that
matters most); a finding that disappears is closed rather than deleted; cascade behaviour on prune.
Unit tests on the fingerprint being stable across runs and distinct across kinds.
**Done when:** a discrepancy found in March can be assigned, disputed, credited and counted, and
re-running March's reconciliation does not erase any of it.

---

### F7 · Say what is measured — DONE 2026-08-26 (migration 0251)

**What shipped.** Every item, plus the PDF half of two of them.
- **C2** — `fuel_price_coverage` (0251) returns one row per day INCLUDING the empty ones, with how
  stale the nearest quote is. `PriceCoverageStrip.vue` draws it as a day-per-cell strip in three
  states (quoted / carried forward / unreachable) and **offers** the priced range as a one-click
  filter change. Offered, never imposed: the window is in the URL so it can be sent to somebody, and a
  page that silently narrows it produces a figure the recipient cannot reproduce from their link.
- **E8** — one line above the tabs: what the window covers, what share is priced, what share resolved
  to a station, how many statements are on file.
- **X3** — the strip, which is C2's other half; built once, used for both.
- **L13** — the trend tiles say which period they describe. On the default view that is the week
  ending about ten days ago, above a table of every week, beside a fill count spanning ninety days.
- **L12** — "Fuel spend · tractor fuel only" and "Cost per mile · includes reefer and DEF". The two
  were never reconcilable and now say why.
- **L14** — the captured figure names its own denominator, on the page AND in the PDF, where "those
  fills" had been borrowing the sentence's earlier and wider population.
- **L11** — the exception tabs state that they overlap and must not be added. (The PDF's half of this
  shipped with F3, when `offPolicy` fixed the verdict band that was adding them.)
- **X6** — "showing 50 of 214" on both truncated tables.
- **X8** — the filter bar's count is the current tab's, not the unfiltered feed count it showed on
  four of six tabs.
- **N7** — `byUnit` and `bySite` render. They had always been computed and nothing displayed them,
  while the plan's own §2.3 records unit 754 hitting ONE9 three times in two days.

**Verified by:** PGlite matrix `fuel-price-coverage` (**11 passed** — a day with nothing still
appears, staleness looks back past the window's edge, org scope fails closed), 4 new tab tests, and
the full gate list. `pnpm --filter web lint:tokens` refused `rounded-[1px]` on the coverage cells;
they use `rounded-detail`.

**Prerequisites:** F1. Independent of F4–F6 and can run in parallel with them.

**Build.** Cheap, and each item removes a way to misread the screen.
- **C2 (new, raised by Q-FX9's answer)** — the priced range is a fact the page knows and does not use.
  Quotes exist from 2026-08-02; the window defaults to 90 days; so 70.4% of the default view's spend
  ($2,159,171 over 4,055 fills) can never be priced, and the reports that would fix it are not in hand
  and may never be. Waiting on a backfill is not a plan.

  Instead: a `fuel_price_coverage(p_org)` function returning the first and last priced day and the
  gaps between, and the Discount Capture tab **offering** that range — *"quotes start 2026-08-02;
  showing 90 days means 70% of this window cannot be priced. Narrow to the priced range?"* — as a
  one-click filter change, not a silent default override, because the window is the reader's and the
  page must not move it behind their back. The same function feeds X3's coverage strip and E8's
  coverage line; build it once.
- **E8** — one coverage line at the top of the page, from a new set-based function beside
  `fuel_spend_lines`: *"this window covers $312,400 of fuel; 94.1% priced against a contract quote,
  98.5% resolved to a station, 3 of 13 weeks have a statement on file."*
- **X3** — a price-report coverage strip on the Discount Capture tab: which days in the window have a
  quote, which carried forward, which have none. This is the reader's actual next action and is
  currently a count.
- **L13** — the trend tiles name their period. "Fuel spend · week of 2026-08-10", not "Fuel spend".
- **L14** — "Captured vs retail" states its own denominator, or moves out of a row whose other three
  figures share a different one.
- **L11** — the exception tabs state that they overlap and must not be summed; the PDF says the same.
- **L12** — the cost-per-mile tile says it includes reefer and DEF while the spend tile does not.
- **X6** — "showing 50 of 214" wherever a table truncates.
- **X8** — the filter bar's count is the count of what the **current tab** is showing.
- **N7** — render the `byUnit` and `bySite` rollups `ExceptionReport` already computes and no surface
  displays, plus a `byDriver` grouping on the field already carried per line. Template work over
  existing data; the cheapest coaching surface available.

**Verify:** extend `spendTabs.test.ts` — a truncated table states its truncation; a tile with a
partial denominator states it; the coverage line renders from a stubbed function.
**Done when:** no dollar figure on the page lacks a visible denominator, and no two figures share a
row without sharing one.

---

### F8 · The remaining UX debt — DONE 2026-08-26 (no migrations)

**What shipped.** Every item.
- **D-FX8** — the page is **Fuel Spend** at `/fuel-spend`, and the ledger moved under it at
  `/fuel-spend/exceptions` with `parent` set. Both old paths **redirect permanently, not for a
  deprecation window**: this page exists to be sent to somebody, links to it sit in emails and tickets
  in their full `?tab=&from=&to=` form, and `redirect` preserves the query string so a link sent in
  June still opens on what its sender was looking at.
- **X4** — `windowNotice` renders. It was computed, explained at length in its own header ("so the
  page can say so"), and displayed nowhere, so a forwarded link with a backwards range opened on a
  period the recipient had not asked for and was not told about.
- **X5** — `reset()` clears `grain` and `active` counts it. It sat in the same bar behind the same
  button and the button neither lit up for it nor cleared it.
- **X7** — the Idling card says it is fleet-wide when the tiles above it are narrowed. Disclosed
  rather than scoped: `useIdleBreakdown` belongs to the Idling page too, and the server report already
  states the same thing and explains why.
- **X9** — the reconcile filters are a `role="group"` of toggles with `aria-pressed`, not buttons
  inside a `dl`.
- **X10** — the empty state has the rebuild button for the endpoint it has always named.
- **X12** — `TablePagination` on the reconcile table. A monthly export runs to thousands of rows and
  "All rows" was one click away.
- **X2** — the Discount Capture empty state links to Import by name.

**Verified by:** 656 web tests, the full gate list, and two new pins (the filters render valid markup
and say which is pressed; a corrected window is mentioned). `lint:ui-adoption` flagged a raw button —
inside the HTML comment explaining why the raw buttons were removed. The comment was reworded rather
than the gate loosened, which is the right way round.

**Prerequisites:** F2.

**Build.** **X4** render `windowNotice` — it is computed, explained at length in its own header, and
displayed nowhere, so a forwarded link with a bad range is silently corrected. **X5** `reset()` clears
`grain`, and `active` counts it. **X7** the Idling card states that it is fleet-wide while the tiles
above it are filtered (`useIdleBreakdown` takes no vehicle filter and is shared with the Idling page —
disclose here; scope it only if that page is undisturbed). **X9** the reconcile summary tiles stop
being `<button>` children of a `<dl>`; selection state gets `aria-pressed`. **X10** the empty state
gets the rebuild button for the endpoint that already exists. **X12** `TablePagination` on the
exception and reconcile tables. **X2** the Discount Capture empty state links to the price-report
upload by name. **D-FX8** the page becomes Fuel Spend, with `/fuel-reconciliation` redirecting.

**Verify:** existing suites plus `lint:ui-adoption`, `lint:tokens`; a test that the reconcile tiles
render valid list markup.
**Done when:** every control on the page affects what is beneath it, and every claim the page makes
about its own scope is true.

---

### F9 · Aggregation moves to where the rows are — DONE 2026-08-26 (migration 0252)

**What shipped.** `fuel_spend_by_period` (0252) plus the split in shared that made it safe.

**Only the summation moved, and the seam was already in the code.** `periodTotals` folded truck-days
and then derived from the fold; those are separable and the split is exactly there. `sumSpendDays`
adds. `periodTotalsFromSums` — unchanged — still applies the MPG plausibility band, the implied-miles
identity, the idle coverage gate, and values an idle hour at what the period actually paid. Each of
those has been got wrong once and fixed; a second copy in SQL would sit where no unit test reaches.

**The parity test is what makes a second implementation safe.**
`apps/api/src/services/fuelSpendByPeriodParity.test.ts` runs both over the same rows across five
windows and three grains and compares them field for field, and separately checks the bucketing
matches `spendSeries` label for label. Verified it bites: replacing the `active_trucks` filter with a
naive `count(distinct vehicle_id)` — the exact mistake D-AG2 warns about — turns it red with
`sql=4 shared=3`. It lives in `apps/api` rather than beside the fold because `packages/shared`
compiles for the React Native driver app and its tsconfig carries no node types; reading migrations
from there would loosen a boundary that exists for a reason.

**⚠ The measurement corrected the claim, which is the whole reason the plan demanded one.** The first
draft of the migration header said "roughly 13× on query time alone". Measured on production:

    the aggregation as SQL:         14 rows out ·  23 ms
    one page of the browser's read: 1,000 rows  · 0.7 ms  → ~10 ms across all 14 pages

The server does **more** work, not less — grouping 13,095 rows costs more CPU than slicing them. The
win is elsewhere and is real: **14 sequential round trips → 2**, and **1,991 kB → 14 rows**. Fourteen
round trips is ~1s of network latency before the first tile renders, and that is what a reader waits
through. The header says so now, including that its earlier claim was wrong.

**`lint:filesize` and `lint:comment-claims` both caught real things**: the split pushed
`operatingBridge.ts` to 549 lines (now 261, with `spendPeriodTotals.ts` at 318 — the same
one-question-per-file pattern `spendPeriods.ts` established), and a comment still named the parity
test at the path it had before the move.

**Prerequisites:** F7 (which defines the aggregates worth moving).

**Build.** Set-based functions beside `fuel_spend_lines`, same `security invoker` +
`coalesce(p_org, auth_org_id())` contract (D-FC1), same **no `set search_path` on per-row scalars**
rule (D-FI1): `fuel_spend_totals`, `fuel_spend_by_period`, `fuel_spend_coverage`. The browser stops
paging the window to compute a tile. Line-level reads stay — the exception tables need lines.
⚠ Every new function ships with its `explain (analyze, buffers)` numbers in the migration header, on
0248's model. That migration exists because two scalars cost 46× and nobody measured.

**Verify:** the matrix asserts each function returns identical figures to the pure functions over the
same fixture — the page and the database must not become a second place arithmetic happens.
**Done when:** the first tile renders without fifteen sequential round trips.

---

### F10 · Landed cost — state fuel tax (purchase-state only, for now) — DONE 2026-08-26 (no migrations)

**What shipped.** A minted per-jurisdiction diesel tax table, `landedCostPerGal` with the
apportionment seam, and the split on both surfaces.

- **`packages/shared/src/fuelTax/`** — `rates2026.ts` (1Q/2Q/3Q 2026, 48 U.S. jurisdictions, cut from
  the IFTA, Inc. Tax Rate Matrix's Special Diesel column), `taxTable.ts` (types + the date→quarter→rate
  lookup), `landedCost.ts`, `taxPremium.ts`.
- **The table is MINTED, not typed.** `scripts/fetch-ifta-rates.mjs` fetches N quarters, parses them,
  and refuses to write unless consecutive quarters agree — every quarter's matrix marks each CHANGED
  rate with a tooltip naming the previous quarter's rate, so N quarters buy N−1 quarters of
  second-source verification for nothing. 240 hand-typed digits is where a wrong dollar figure on a
  forwarded compliance report comes from, and no gate can catch a plausible-looking tax rate (D-FX12).
- **The gate earned its keep on the first run.** It flagged all ten Canadian jurisdictions as changing
  between every pair of quarters while IFTA marked none of them as a change. They are not changes: a
  Canadian jurisdiction legislates in CAD per LITRE and the matrix's U.S. column is that rate converted
  at the quarter's Federal Reserve rate — Alberta's $0.13/L has not moved since 2024-04-01, and
  0.13 × 3.785411784 × 0.7151 = 0.3519, the 3Q2026 U.S. figure to four decimals. A number that drifts
  with FX between captures is a different kind of fact from a legislated rate and must not share a
  column with one, so the ten are **excluded** and a Canadian fill answers "unknown". Costs nothing
  measurable: 11,373 production fills across 46 jurisdictions, not one Canadian.
- **Three quarters cover 100% of the feed** (2026Q1 3,741 fills · Q2 3,896 · Q3 3,738), and a date
  outside them returns **null, never a nearest-quarter guess** — a rate is legislated, not
  interpolated. 3Q2026 carries `final: false`: IFTA does not finalise it until 2026-09-04, and a figure
  from a provisional matrix is a weaker claim that says so.
- **`landedCostPerGal(fill, apportionment)`** — pump price, purchase-state tax, pre-tax price, burn
  liability, landed. The apportionment defaults to `PURCHASE_STATE_APPORTIONMENT` ("burned where it was
  bought"), named so that grep finds every site that changes when Samsara mileage lands.
- **The measured finding, and it is worth more than the code.** Over the default 90-day window
  (674,333 of 681,494 tractor gallons priced, 98.95%): **California cost $1.554/gal above the rest of
  the fleet's fuel — $0.643 of it California's tax rate and $0.912 the price of the fuel itself. Of
  the $19,858 California premium this tab has always reported, $8,210 (41%) is a tax rate**, owed on
  the miles driven there whichever state the fuel was bought in. The tab reported it as though a
  dispatcher could have avoided it. This is the L11 class of error — arithmetically right, pointed at
  the wrong person — and it is the reason D-FX11 held F11 and F13 back.
- **Three things the table refuses to conflate.** A `null` rate (unknown, never zero — D-FX7).
  **Oregon**, which taxes heavy trucks by the mile and whose retailers may sell them untaxed diesel,
  so its zero is real but not comparable: stored as `basis: "weight_mile"` and excluded from both
  populations of the premium split rather than counted as untaxed fuel (1.05% of the window's gallons).
  And a **surcharge** — Kentucky and Virginia bill theirs on the quarterly return over gallons BURNED
  there, not at the pump, so it is kept out of every pump figure and added only to a burn liability.
  A gallon bought and burned in Kentucky lands 10.5¢ above the price on the sign; no surface in this
  product had ever said so.
- **Both surfaces, one arithmetic.** `ExceptionsTab.vue` prints the split beneath the excess, and
  `taxSharePhrase` puts the same sentence in the PDF; both read one `analyzePolicyExceptions` result,
  so they cannot disagree. Each states the scope in the required words — on the California tab today,
  *"Purchase-state tax at the pump — not net of IFTA — from the 2Q2026 and 3Q2026 IFTA matrix,
  measured over 100.0% of these gallons. The current quarter's matrix is not final until IFTA
  publishes it."* `measuredShare` is the share of the SELECTED fills, which is all of them here; the
  98.95% above is the whole window, where the shortfall is Oregon sitting in the baseline.
- **A negative tax premium is the off-network report's ordinary case** (those fills are wherever the
  truck happened to be, which averages below a report selecting one expensive state), so it reads
  "State fuel tax accounts for none of this premium" rather than printing a negative dollar figure
  under the word "tax" — B3's defect, in a new place.

**Three deviations from the step as written, all stated:**
1. **The dataset is not a package.** It takes `packages/hazmat-data`'s *shape* — minted rather than
   hand-edited, versioned, dated, source cited, with a finality flag — without its packaging.
   `packages/shared` compiles for the React Native driver app, and a new workspace dependency under
   that build buys nothing for ~60 rows of data that only `packages/shared` consumes.
2. **The second `Build.` paragraph contradicted the step's own decided scope and is deleted.** It said
   `landedCostPerGal` "nets the purchase-state tax against the burn-state liability" and that the tab
   reports "pump premium and landed premium apart" — but the scope box above it decided
   purchase-state-only, under which landed premium IS pump premium. What ships is the first
   paragraph's version: the netting exists and is reachable through the apportionment parameter, and
   is a no-op under the default by construction (pinned by a test that says so).
3. **What the tab shows is the pump/tax/pre-tax split, not a "landed premium".** Under the default
   apportionment a landed premium would be the pump premium relabelled — a number that looks new and
   is not. The split is the honest form of the same intent and is what a buying decision can act on.

**Verified by:** `pnpm test` (all suites, 31 PGlite matrices), `pnpm typecheck`, `pnpm lint` (only
real-source findings are the same 2 pre-existing `vue/one-component-per-file` warnings in a file this
branch does not touch), `lint:filesize`, `lint:funcsize`, `lint:comment-claims`, `lint:boundaries`,
`lint:upserts`, `lint:ui-adoption`, `lint:tokens-parity`, `lint:migrations`, `lint:rls`, `lint:tests`,
`lint:codegen`, `lint:secrets`, `pnpm --filter web lint:tokens`, and `pnpm --filter @fuelguard/shared
build:rn`. ⚠ `pnpm build` cannot complete the web half on this machine — `vite.config.ts` refuses to
load without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, which is environmental and happens before
any code is read; `vue-tsc --noEmit` passes and CI has the variables.

**36 new tests, and every one was made to fail before it was kept.** 26 shared (the table's date
boundaries and null-not-zero contract, landed cost's decomposition and apportionment, the split's
denominators), 5 tab, 5 PDF phrase. The regressions run: deleting the weight-mile guard so an unknown
state reads as zero (3 red), counting Oregon into the tax populations (1 red), dropping the surcharge
from the burn liability (1 red), hiding the tab's block (3 red), and widening the PDF's filter so a
negative tax premium prints (1 red).

**Prerequisites:** ~~Q-FX4~~ — answered 2026-08-26. **Gates F11 and F13** (D-FX11).

**⚠ SCOPE, DECIDED AND NARROWER THAN THE TITLE SUGGESTS.** This reports the tax actually PAID AT THE
PUMP, per purchase state. It is **not** net of IFTA, and every surface that shows it must say so in
those words. Three options were on the table and the middle one was rejected on measurement:

- *Purchase-state tax only* — **chosen.** Purchase state is on 100% of fills (0 nulls in 11,310). It
  is strictly better than pump price and honest about what it is not.
- *Infer burn states by interpolating between consecutive fills* — **rejected.** Trucks fuel every
  57.8 hours and cross a state line on 90.1% of consecutive-fill pairs, so each segment spans ~1,500
  miles and several jurisdictions. A savings recommendation built on that guess is worse than one that
  admits it does not know.
- *Real miles by jurisdiction* — **later, and the intended end state.** The carrier has stopped using
  McLeod's IFTA miles and moved to **Samsara-derived mileage**, which is not yet wired into this
  product. When it is, it replaces the denominator here and nothing else changes — which is what the
  seam below is for.

**Build.** A versioned per-state diesel tax rate table (the same shape as `packages/hazmat-data`:
pure, versioned, dated, source cited), and `landedCostPerGal` in shared. **Take the burn-state
apportionment as a PARAMETER that currently defaults to "same as purchase state"**, so wiring Samsara
miles in later is a new argument at a call site rather than a rewrite. The California tab reports pump
premium and purchase-state-tax premium apart, neither claiming to be IFTA-net.

<!-- A second `Build.` paragraph stood here and contradicted the scope box above it — it asked for a
     "landed premium" that, under purchase-state-only apportionment, is the pump premium relabelled.
     Deleted when F10 shipped rather than left to be executed by a future reader; the reasoning is in
     "Three deviations" above. -->

**Verify:** unit tests per state with the rate's effective date; a test that a purchase in a
high-tax state burned elsewhere nets down.
**Done when:** the California premium can be stated as landed cost, and a "buy here instead"
recommendation has a basis.

---

### F11 · Missed savings at the pump — ⚠ BLOCKED ON DATA, measured 2026-08-26. Do not build as written.

**Prerequisites:** F6 (the ledger), F10 (shipped). **A third was never written down and is the one
that blocks it: the route the truck actually drove.**

**⚠ THE SPIKE THAT STOPPED IT (read-only, no PR).** Two measurements; the second is decisive.

*1. The network-wide posted layer is not a time series.* `fuel_prices_posted` — which this step's
design leans on for "the cheapest qualifying station on that business date" — holds **3,003 rows
across three captures ever**: a Love's export and a Pilot public export both dated 2026-07-17, plus 54
Road Ranger rows from 2026-08-26. Off-network alternatives cannot be priced on the day of a fill at
all. Our own `fuel_prices` is dense but narrow — 683 Pilot/Flying J stations on each of **20 days**,
2026-08-02 → 2026-08-25 — so the only scoreable question is *"was there a cheaper PILOT or FLYING J
that same day"*, over 1,201 of the window's fills.

*2. Constrain the candidate to the road actually driven and 96% of the answer disappears.* Scored over
those 20 days against each fill's own quoted net price:

| candidate rule | fills with a cheaper alternative | saving |
|---|---|---|
| within 25 mi (straight line) | 214 | $1,699 |
| within 50 mi | 627 | $6,695 |
| within 100 mi | 948 | $16,197 |
| within 100 mi **and on the segment between this fill and the truck's next one** | 58 | **$581** |
| within 200 mi and within 5 mi of that segment | 241 | $4,348 |

The corridor test is `pointToSegmentMiles` from `smartFueling/geo.ts` — the primitive the planner
already uses — requiring the alternative to sit BETWEEN the two fills rather than behind or beyond it.
**It removes 96% of the claimed saving at the same radius.** That 96% is stations the truck was not
driving past, and a dispatcher refutes each one in a sentence: *"that Pilot is forty miles the wrong
way."* Shipping it spends the credibility of every other figure on the page to buy perhaps $10k a year.

The surviving 4% is itself weak. A straight line between two fuel stops is not a road, and Q-FX4
already measured that consecutive fills sit ~1,500 miles and several states apart; a corridor drawn on
that line is a guess wearing geometry.

**One thing from the pre-spike draft survives and binds every detector that prices an alternative,
F13 included:** price it with `landedCostPerGal`, and remember Oregon — `basis: "weight_mile"` means
the missing per-gallon tax is a different bill, not a cheaper station.

**What F11 actually needs** is the same dependency F10 named for burn states: the route the truck
drove, from Samsara GPS. With a real trail, `stationsAlongRoute` (`smartFueling/corridor.ts`) already
answers this properly — detour miles, the correct side of a divided highway, whether the station was
ahead of the truck. Nothing else in F11 changes.

**Until then F11 is not built, not even observation-only.** "There was a cheaper station somewhere
within a hundred miles" is not something a fleet manager can act on, and filing 948 of them would bury
the findings that are real. This measurement is the deliverable.

<!-- The original brief, right about everything except its candidate rule: -->

**Build.** For each fill: the cheapest qualifying station within N road-miles on that business date,
from `fuel_stations` (lat/lng), `fuel_prices` (our net) and `fuel_prices_posted` (the network-wide
public layer, already fetched on a scheduler behind parse, completeness and sanity gates). Emit a
`kind = 'missed_station'` exception with the alternative **named** and the difference priced at landed
cost. N and the brand filter come from `route_fuel_settings`.

This is also **the fix for L10**: the alternative station's price on the same day is the time-matched
baseline the current 90-day fleet average is not.

**Verify:** unit tests on the candidate selection (radius, brand policy, price freshness, a station
with no price that day); a test that a fill with no candidate emits **nothing** rather than a
zero-saving finding (D-FX7's rule, applied to a new detector).
**Done when:** "you fuelled somewhere expensive" becomes "the Flying J 14 miles further on was
$0.34/gal cheaper that morning", with a dollar figure and a lifecycle.

---

### F12 · Plan versus actual — ⚠ NOTHING TO JOIN, measured 2026-08-26

**`fuel_plans` holds ONE row in production, for one org, ever.** The dispatcher-facing planner has
essentially never been used, so "match a plan's recommended stops to the fills that followed it" has
one plan to match: no adherence to measure, no deviation to price.

Not a reason to delete the step — a reason to reverse its order. Why the planner is unused is a
product question, not a reconciliation one, and it has to be answered before this step means anything.

**Prerequisites:** F6, **and a fleet that generates plans.**

**Build (when there is something to join).** `fuel_plans` (0074) stores `total_gallons`, `total_cost`, `arrival_fuel_pct` and the full
plan JSON for every plan a dispatcher generates, and nothing joins it to what was actually bought.
Match a plan's recommended stops to the fills that followed it; report adherence and the cost of
deviation as a `kind = 'plan_deviation'` exception.

**Verify:** unit tests on the stop→fill match (a stop skipped, a stop taken late, a stop taken at a
different site); `expectOrgScoped`.
**Done when:** the planner can be evaluated — "plans followed ran $0.11/gal under plans ignored" — and
the two halves of the product are connected.

---

### F13 · Buy-quantity discipline · F14 · The weekly digest · F15 · The EFS invoice

Deliberately thin, because F6 will change what they should be. Each carries its argument:

- **F13** — SPLIT AND RESHAPED 2026-08-26. **F13a DONE (migration 0254)**; F13b is the surface.
  See the full entry below.
- **F14** (N10) — one weekly email: spend and its delta, variance against contract, the top five open
  exceptions, coverage, one link. Extends `NotificationCategory` **and** adds a `notificationRoute`
  entry in the same PR. Scheduler in exactly one process fleet-wide — `docs/WORKER-DEPLOYMENT.md`
  first.
- **F15** (N5, A1) — extend the reconciliation spine from one vendor's file to the EFS consolidated
  invoice, the instrument the carrier actually pays. The parse → tie-out → match → persist
  architecture generalises; what changes is the parser and the product taxonomy, not the spine. This
  is what makes every off-network dollar auditable.

---

### F16 · The ledger could never close a finding — DONE 2026-08-26 (migration 0253)

**Found while scoping F11.** Not a step anybody planned; a defect in F6a that the F6a matrix asserted
the opposite of. It jumps the queue because every detector after it files into the same ledger, and a
ledger that cannot close is a queue people stop opening.

**The defect.** D-FX10 has two halves. The first — a re-run refreshes evidence and never touches a
person's status, owner or note — works, and is proven. The second — *"a finding a run no longer
produces is closed as `resolved_by_reingest` rather than deleted"* — **had never fired in production
and structurally could not.** 0250 scoped the close to `where e.run_id = p_run`, and the upsert
immediately above it had already set `run_id = excluded.run_id` on every finding in the batch. The
rows carrying `p_run` were therefore exactly the rows in `v_seen`, so
`not (fingerprint = any (v_seen))` selected none of them. `closed` was always 0.

**Why the matrix said otherwise, which is the more useful half of this.** `fuel-exceptions.test.mjs`
created ONE `fuel_recon_runs` row and its `sync()` helper defaulted every call to it. That is the
single shape in which the broken clause works: with a fixed run id, the second call's `p_run` still
matches rows the first call wrote. Production never does that — `runFuelReconciliation` inserts a new
run per upload and passes that fresh id. **Re-pointing the fixture at a new run per sync, which is
what the deployed code does, turns three assertions red against 0250.** A fixture that is not the
production shape is a fixture that certifies the wrong system.

**What it cost.** Nothing was ever closed. A discrepancy that next week's corrected statement resolves
stays `open` for good, so the queue can only grow, and `resolved_by_reingest` — a status with a token,
a label ("No longer found") and its own event kind — has never been written.

**The fix: scope by KIND and PERIOD, never by run id.** "This producer no longer finds it" is a claim
about a window and a set of kinds; two runs over the same week are two readings of one period and the
later one supersedes, which is the same argument `fuel_recon_runs.superseded_by` already encodes.
- The **kinds** arrive as `p_kinds`, declared by the caller from `RECON_EXCEPTION_KINDS` in shared,
  because "which findings am I authoritative for" is the producer's knowledge. Deriving them from the
  batch cannot work: the week that produces no `recon_amount` rows is exactly the week that should
  close last week's, and a set derived from an empty batch is empty.
- The **period** is read from the run row, which already records it under an append-only trigger.
- **Fails closed everywhere**: null kinds, no run, or an unreadable run row → close nothing. A finding
  with a null `occurred_on` is never closed by period. Leaving a resolved finding open costs a second
  look; closing an open one silently retires money the carrier is owed.
- `disputed` stays out of the closable statuses: somebody is mid-conversation with the vendor.

**Deployment order, which is why `p_kinds` has a default.** `migrate.yml` applies on merge and the API
deploys separately, so the running code briefly calls the four-argument form. `create or replace`
cannot add a parameter — it leaves both signatures live and makes every four-argument call ambiguous —
so the old one is dropped and the new one takes `p_kinds text[] default null`. A four-argument call
still resolves, closes nothing, and behaves exactly as production does today. Expand, then contract;
no window in which anything is worse than it is now.

**Also recorded, not fixed here:** `contractFindings` has **no production caller**. No
`contract_variance` has ever been filed. When it is wired it must declare its own close-scope kind
set — reusing the recon set would let a reconciliation with no quotes in range close every contract
finding in its period as though it had looked.

**Verified by:** the `fuel-exceptions` matrix, **37 passed** (was 31), with the fixture on the
production shape. Restoring only the `run_id` clause and leaving everything else in place turns
**4 red** — the three that were green on the wrong fixture, plus the new empty-batch case. Six new
assertions cover the scoping that makes the fix safe rather than merely working: a run over one period
does not close another's findings; a producer only closes the kinds it declares; a null kind set closes
nothing; a `disputed` finding survives; an empty batch closes what is genuinely gone; and the audit row
carries the window and the kinds so "why did this go away" stays answerable. Plus an `apps/api` test
pinning that the caller passes the shared constant — regressed and watched fail. `pnpm test`,
`pnpm typecheck`, `pnpm lint`, `lint:migrations`, `lint:rls`, `lint:upserts`, `lint:filesize`,
`lint:funcsize`, `lint:comment-claims`, `lint:boundaries`.

---

### F13a · Fuel carried out of a dearer state — the analyzer — DONE 2026-08-26 (migration 0254)

**The step as written was the wrong question, and the settings table said so.** F13 asked for a
compliance report: given tank capacity, level and the state's landed-cost rank, how many gallons
*should* have been bought. Reading `route_fuel_settings` before writing any of it turned up something
better and something that would have been a defect:

- **`fill_cap_pct = 75` is not unwired — it is DORMANT.** `fillPolicy.ts:78` applies it only inside the
  `!alwaysFillFull` branch, and Silvicom has `always_fill_full = true`. Reporting the 84.5% of fills
  that end above that cap would have been a compliance report contradicting the planner reading the
  same table: B4 exactly, in a new place. `min_purchase_gal` IS live (`solver.ts:295`, a stop-skipping
  guard) and `fuel_before_states = {MA}` IS live (`fuelPlanning.ts:330`, the border top-off).
- **So the planner ALREADY implements buy-quantity discipline** — rule 4 of `fillPolicy.ts`,
  min-drawdown: buy just enough to reach the next cheaper station, floored at the minimum purchase,
  capped at `fill_cap_pct`, never so little it strands the route. It is switched off for this carrier.

F13 therefore stops being a report on a rule nobody turned on and becomes a measurement of what that
switch costs — which is policy-independent, provable, and actionable in one click.

**What shipped.**
- **`fuel_buy_fills` (0254)** — the fill sequence, per truck, in time order. `fuel_spend_lines` cannot
  serve it: it returns a `tran_date` (a DAY — and two fills on one business date either side of a
  state line is precisely this feature's case), no `vehicle_id`, and nothing about the tank. Same
  D-FC1 contract as its neighbour, and a **14-day lookback flagged `in_window = false`** so the leg
  that crossed INTO the window keeps its predecessor — worth about one pair per truck, and invisible
  if dropped. Measured: 6,109 rows, 95.4 ms, index scan, `fuel_business_date` inlined (D-FI1 holds).
- **`carriedFuel.ts`** — pure. Scores each consecutive pair: fuel bought in a dearer state that was
  still in the tank on arrival in a cheaper one, priced **pre-tax** through F10's rule.

**⚠ THE COVERAGE BUG IN MY OWN FIRST MEASUREMENT, which is the most useful thing here.** The first
version required a Samsara tank level and scored **9.8%** of fill pairs, which I reported as a data
gap. It was not: `fueling_time_basis = 'tank_confirmed'` is a claim about a fill's TIMING and sits on
24% of rows, and the question is how much fuel was on board. Two facts closed it:
- `miles_since_last` is on **99.3%** of fills and `vehicles.baseline_mpg` on 91% of trucks, so
  `gallonsBought − miles / baselineMpg` bounds the carried fuel from below with **no starting level**,
  because the level it does not know is non-negative and that is all the bound needs.
- `computed_mpg` cannot do it: it equals `miles_since_last / gallons` on **95.7%** of production rows,
  so feeding it back reduces the burn to "this fill's gallons" — the fill-to-full assumption this
  fleet violates (it arrives at 33% and buys 78% of the empty space). The estimator must be
  independent of the fill, which `baseline_mpg` is (validated across 169 trucks: 6.92 against 7.08
  observed, mean absolute error 0.52 mpg, and the understatement pushes the bound DOWN, safely).

**The bound was validated before it was trusted.** On the 1,262 production pairs carrying both
estimators it exceeded the tank measurement on **1.4%**, and averaged 13.0 gallons against 68.5 — so
it is a floor in practice as well as in algebra, and a conservative one.

**Measured end to end, by the shipped analyzer over production rows in the function's own shape**
(90-day window, org Silvicom):

    pairs 5,518 · same state 544 · toward dearer 2,565 · unpriceable 0 · NO BASIS AT ALL 9 (0.16%)
    findings 1,377 (25.0% of pairs) · 60,230 gal carried out of the dearer state
    by tank level   535 pairs   $8,248   (measured)
    by miles burnt  842 pairs   $5,381   (a floor)
    TOTAL pre-tax           $13,629      ← a FLOOR, not a measurement
    on pump price           $15,650      +15%, and that gap is a tax rate

**"25% of pairs produce a finding" is not 75% missing data.** 544 pairs stayed in one state and 2,565
travelled from cheaper fuel to dearer — the direction the policy wants — so they are not findings by
construction. **Nine pairs of 5,518 could not be evaluated at all.**

**Verified by:** the new `fuel-buy-fills` matrix (**17 passed**) and 20 shared tests. Every one was
made to fail: removing the lookback (2 red), trusting an unconfirmed tank level (1 red), ordering by
the business date instead of the instant (1 red — and it returns the pair reversed, silently),
dropping the previous-purchase cap (1 red), estimating burn from the arriving fill à la `computed_mpg`
(3 red), and folding the pump figure into the pre-tax total (2 red). Full suite, `pnpm typecheck`,
`pnpm lint`, `lint:migrations`, `lint:rls`, `lint:filesize`, `lint:funcsize`, `lint:comment-claims`,
`lint:boundaries`, `lint:upserts`, `lint:tests`.

**F13b — the surface — is next**, and it is deliberately a separate PR on F6a/F6b's precedent: the
arithmetic has to be correct before it has a window. It carries the sentence this is all for:
*"Min-drawdown is available in your fuel planner and switched off. Over the last 90 days, hauling fuel
out of dearer states cost at least $13,629."* It will NOT file 1,377 rows into the exception ledger —
201 off-network fills was already judged not to be 201 actions, and 1,377 is not 1,377 either.

**Also for Miki:** `always_fill_full = true` and `fill_cap_pct = 75` are both set and cannot both be
honoured. The settings form permits it and should not.

---

## 6. Prerequisites register

| Id | Question | Owner | Fallback the code takes until answered |
|---|---|---|---|
| **Q-FX1** | ~~Does any exact key join the Pilot report to our records?~~ | — | **ANSWERED 2026-08-25: NO — measured, not assumed.** The five statements were parsed locally with the shipped parser and joined against production `efs_transactions` over the same window. `ticket` → `invoice` **0 of 2,283**, in both zero-padded and stripped forms; `authNo` → `invoice` **0 of 1,511**. They are different issuers' identifiers for the same physical event and do not correspond. F4 stays a heuristic matcher — but `cardRef` → last-6 of `card_num` matched **171 of 171 (100%)**, which settles D-FR6. |
| **Q-FX2** | ~~What share of `fuel_transactions` has a null `state`?~~ | — | **ANSWERED 2026-08-25: zero, on both orgs (0 of 11,310).** The UTC fallback never fires in production. L2 downgraded Major → Moderate; D-FX4's ±1-day tolerance still ships, for the vendor's own cutoff. |
| **Q-FX3** | **The contract.** `fuel_discount_rules` is empty in production and the agreement has never been received (`FUEL-SPEND-RECONCILIATION-PLAN.md` §8.1). The measured `corr(retail, discount) = −0.614`, slope −$0.177/$1.00, is the cost-plus/rack-linked signature. | Miki | "Your Price" from the daily report stays the benchmark, and every surface calls it **the quoted price**, never *the contract price*. A repricing that moves the quote stays invisible and the surface says so. |
| **Q-FX4** | ~~Are the fleet's lanes and burn states known well enough to net IFTA?~~ | — | **ANSWERED 2026-08-26: no — F10 reports PURCHASE-STATE tax only.** Measured: no table pairs miles with a jurisdiction; the lat/lng tables are stationary points, not a drive trail; and trucks fuel every 57.8 hours crossing a state line on **4,870 of 5,405 (90.1%)** consecutive-fill pairs, so interpolating burn states between fuel stops would manufacture precision across ~1,500 miles and several jurisdictions per segment. The carrier has also **stopped taking IFTA miles from McLeod and moved to Samsara-derived mileage**, which is not yet wired up. F10 ships purchase-state tax labelled as such, behind a seam real jurisdiction miles can replace. |
| **Q-FX5** | **Any off-invoice rebate or volume tier?** (§8.5, still open.) If Pilot pays a quarterly rebate, true captured discount is higher than anything measurable here and every savings baseline is wrong. | Miki | Every "captured" figure is labelled *at the pump* and the surface states that off-invoice settlements are not included. |
| **Q-FX6** | Is ONE9 emergency-only per policy (an exception report) or tolerated (a cost report)? (§8.4.) | Miki | Exception report, per `route_fuel_settings`' current `avoid_brands`. F3 makes this a config answer rather than a code answer, which mostly retires the question. |
| **Q-FX9** | **Can the historical Pilot price reports be obtained from Pilot?** Measured 2026-08-25: of every price file on disk, only **one day (2026-07-15)** is not already loaded — worth ~3.5% of the window. The other ~70 unpriced days are **not in hand**; they would have to come from Pilot (the report arrives daily by email). | Miki | The window default is the honest fix, not the backfill — see F7's C2. Every discount figure already states the share of spend it covers (F1, shipped). |
| **Q-FX7** | Retention window for `fuel_exceptions` and its event log — they are deliberately **not** evidence (§1.5). | Miki | No prune rule ships. The tables are prunable by design and nothing prunes them until a window is set. |
| **Q-FX8** | Who owns an exception operationally — fleet manager, controller, or a new role? Decides the default assignee and whether a read-only controller view is needed. | Miki | `rolesThatManage("fuel")` writes; unassigned by default. No new role invented on a guess. |

---

## 7. What this plan deliberately does not do

- **It does not rewrite `fuelSpend`.** That layer is the reason the page and the PDF cannot disagree.
  It gains parameters (D-FX6, D-FX9) and one null-handling fix (D-FX7). Nothing moves out of it.
- **It does not add a second period control.** B1 deletes the dead statement scope selector rather
  than wiring it, because `useSpendFilters` exists to end exactly that disagreement.
- **It does not build a new lifecycle where one exists.** `fuel_exceptions` copies `anomalies`'
  lifecycle columns and vocabulary; only the table is new, and only because
  `anomalies.transaction_id is not null` forbids reuse (D-FX2).
- **It does not claim savings before it can price them.** F11 and F13 wait on F10, or ship the
  observation without the recommendation (D-FX11).
- **It does not pin migration numbers.** Next-numbered at execution; the training plan's pinned
  numbers went stale by 145 in a month.
