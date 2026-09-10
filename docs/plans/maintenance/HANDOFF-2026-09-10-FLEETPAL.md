# Handoff — FleetPal, F0–F3 shipped, resume at F4 · 2026-09-10

**Read this, then `FLEETPAL-INTEGRATION-PLAN.md` top to bottom.** This file is where the build
stopped, what is proven, and the traps that already cost time. The plan is the queue; this is the
map to it.

**Position:** `origin/main` at `b95de95`. Migration **0334 is APPLIED in production** — verified,
all four `fleetpal_*` tables live. **F0, F1, F2 and F3 are merged.** The next step is **F4**, and it
is the ONE step in the whole plan that needs the API key.

---

## 1. What is on main right now

| PR | Step | What it is |
|---|---|---|
| #714 | — | The plan. 16 steps F0–F15, 14 decisions D-FP1–14 |
| #716 | F0 | Canon (`ARCHITECTURE.md` §2, `SILVICOM-360.md` §2, `INVENTORY-PLAN.md` §I14), `docs/FleetPal/SOURCE.md`, and the stale ruling a customer could read |
| #717 | F1 | Contracts — 18 resources, 16 vocabularies — plus `lint:fleetpal-contract` in `package.json` **and** in `ci.yml`'s `gates` job |
| #719 | F2 | Migration **0334** (four tables) **and** `modules/fleetpal/`'s store. 66 matrix + 21 store assertions |
| #722 | F3 | The HTTP client and the vendor error vocabulary. 21 assertions |

### The files, so you do not have to hunt for them

```
packages/shared/src/fleetpalContract.ts          re-exports the four below
packages/shared/src/fleetpal/primitives.ts       money · metres · the vocabularies · paginated()
packages/shared/src/fleetpal/equipment.ts        Unit · Meter · PMSchedule · Interval · Defect · Issue · Expiration
packages/shared/src/fleetpal/repair.ts           WorkOrder · Job · JobItem · ServiceHistory
packages/shared/src/fleetpal/purchasing.ts       Part · Vendor · Shop · PurchaseOrder · POInvoice · POReceipt(Item)
packages/shared/src/fleetpal/fieldManifest.generated.json   ← what lint:fleetpal-contract reads

apps/api/src/modules/fleetpal/index.ts           the module's exported interface + D-FP2/D-FP3 header
apps/api/src/modules/fleetpal/client.ts          FleetpalClient — walk() follows `next`, bounded retry, deadlined
apps/api/src/modules/fleetpal/errors.ts          FleetpalError, kinds, parseRetryAfter
apps/api/src/modules/fleetpal/credentials.ts     sealed key in / out, the kill switch
apps/api/src/modules/fleetpal/syncState.ts       watermark vs window position
apps/api/src/modules/fleetpal/units.ts           stage + resolve; countUnmatched
apps/api/src/modules/fleetpal/deliveries.ts      webhook idempotency
apps/api/src/modules/fleetpal/{client,store}.test.ts

supabase/migrations/0334_fleetpal_collector.sql
supabase/tests/fleetpal-collector.test.mjs
scripts/gen-fleetpal-manifest.mjs · scripts/check-fleetpal-contract.mjs
```

### What is proven, and what is only typed

**Proven against fixtures**, with 13 mutation proofs across the four steps: the pagination walk, the
429/400/401/403/5xx branches, the sealed-key round trip, the two sync positions, the unit staging
that cannot unmatch, the webhook claim, and every constraint in 0334.

**NOT proven against a real account** — nothing has ever spoken to FleetPal. Every fixture is shaped
from the vendor's documented examples. That is exactly what F4 exists to change, and it is why F4's
output is a set of measurements rather than a feature.

---

## 2. What F4 is, in the order to do it

**Half a day, the first afternoon the credential exists.** Its deliverable is §8 of the plan gaining
real numbers, and `__fixtures__/` gaining real payloads.

### 2.0 Before anything: the key does NOT go in the database yet

`fleetpal_credentials.api_key_sealed` needs `SECRETS_ENCRYPTION_KEY`, which **is set in production**
(verified 2026-09-10 on Railway service `@fleetguard/api`) and is **not in your local
`apps/api/.env`**. F4 does not need the database at all: the probe takes the key from an environment
variable and constructs `FleetpalClient` directly. Storing it is F8's business, when a scheduler
first needs it.

So: `export FLEETPAL_API_KEY=fp_…` in the shell that runs the probe, and **do not commit it, do not
echo it, and do not put it in a fixture**. `lint:secrets` will catch the obvious slip; the log
assertion in `client.test.ts` ("never puts the api key in the log") is what catches the subtle one.

### 2.1 The probe script

`apps/api/src/scripts/fleetpalSmoke.ts`, with `"fleetpal:smoke": "tsx src/scripts/fleetpalSmoke.ts"`
in `apps/api/package.json`. **`pspUatProbe.ts` is the precedent** — read it first: it is the repo's
one sanctioned pattern for calling a vendor by hand, and it shows how to guard, how to write what
comes back, and how much of the reasoning belongs in the header.

FleetPal needs none of PSP's billing interlocks (reads are free), but it does need two guards worth
writing: refuse to run without `FLEETPAL_API_KEY`, and refuse to write a fixture that still contains
anything person-shaped.

### 2.2 The five things to do, in order

1. **`GET /status` and `GET /v1/units?limit=1`.** Auth works, and the shape is what F1 says it is.
   If `fleetpalUnitSchema` rejects the real payload, that is the finding — fix the contract, then
   regenerate the manifest (§4 below).

2. **`GET /v1/webhook-events` — enumerate the catalogue.** The spec names only
   `work_order.completed` and says the catalogue is dynamic. **F15 cannot be designed until this
   list is known**, and it is the single highest-value call in the probe. Write the result into the
   plan's §2.8.

3. **Record real fixtures** into `apps/api/src/modules/fleetpal/__fixtures__/`, one file per
   resource in §2.7's three tiers, redacted of anything person-shaped. Then **replace the hand-built
   fixtures in `client.test.ts` and `store.test.ts`** — this is a substitution, not a rewrite; both
   files were written so that it would be.

4. **Measure, and write each number into the plan's §8:**
   - unit count, and how many carry a VIN;
   - how many match ours **by VIN**, **by number**, and **not at all** — against 207 active tractors
     (200 with VIN) and 234 active trailers (228 with VIN), measured 2026-09-10;
   - work-order and service-history row counts, and the earliest `completed`  (this answers **Q8**,
     how far back a backfill is worth going);
   - parts-catalogue size;
   - **whether purchase orders and PO invoices are actually used at all.** This is **Q7**, and it is
     load-bearing: if FleetPal is only used for work orders and nothing is ever received against a
     PO there, then D-FP12 and D-FP13 are re-opened as a question rather than built around, and F13
     changes shape.

5. **Measure the rate limit empirically** and set `KIND_CAPS` from it in F8. Until then the cap is
   1.

### 2.3 F4's done-when

§8 of the plan carries those measurements; the fixtures are real; the webhook catalogue is written
into §2.8; and Q7 and Q8 are answered in §6.2 (struck through in place, with the date).

**F4 ships no feature.** If it produces a green feature and no measurements, it was not F4.

---

## 3. The traps, each of which already cost time

- **`on delete set null` on a roster FK makes the roster row UNDELETABLE.** The FK action's UPDATE
  is checked against `fleetpal_units_match_agrees`, fails, and the DELETE fails with 23514. No gate
  sees it; only the PGlite matrix did. Same class as the `merge_driver` cascade trap. **Any new
  `fleetpal_*` table pointing at `vehicles` or `trailers` must cascade**, and must call
  `inventory_holder_is_ours` for IV012 rather than trusting the foreign key to carry the org.
- **`lint:table-producers` has an EMPTY waiver list.** A new table must ship with application code
  that writes it **in the same PR**, or that ratchet regresses. This is why F2 shipped the store as
  well as the schema — F6 and F7 will hit it too, so plan their ingest into the same PR as their
  migration.
- **Run all 38 `lint:*` gates by name from `package.json`, not a chosen subset.** I ran 13 and CI
  caught two I had skipped. And `for g in $ALL` does **not** word-split in zsh — write the list to a
  file and `while read`.
- **`pnpm --filter @fuelguard/shared …` prints "No projects matched" and exits 0.** The packages are
  `@silvicom/*` since the re-founding. The only symptom was one matrix reporting *"NO RESULT
  REPORTED"* while every other passed.
- **Re-run `pnpm install --frozen-lockfile` after rebasing onto a new main**, not only at worktree
  creation. A merged PR that adds a workspace package (`@silvicom/qr` did) fails `typecheck` with
  `Cannot find module` until you do.
- **`envCasts.test.ts` forbids `{ … } as unknown as Env`** in an api test. Use `testEnv({ … })`.
- **Never guess a PR number.** `gh pr list --head <branch>`. Parallel sessions take the numbers in
  between — I nearly merged another session's PR while looking for my own.
- **The working tree is shared.** Branch from `origin/main` in a worktree; re-check
  `git branch --show-current` before every commit and push.

---

## 4. Two mechanisms that are not obvious from the code

**The manifest indirection, and why it is not ceremony.** `docs/FleetPal/` is gitignored, so the
830 KB OpenAPI document is in every working tree and in **no CI checkout**. A gate reading it
directly would find nothing and **pass by skipping**, on every run — which is exactly the ten days
`lint:wsdl` spent crashing on a stale path with nobody able to notice. So
`scripts/gen-fleetpal-manifest.mjs` runs **by hand**, beside a tree that has the spec, and commits a
field-names-only artefact; `scripts/check-fleetpal-contract.mjs` compares that against the schemas.
**If the vendor's document ever changes: regenerate the manifest and update the schemas in the same
PR**, and update `docs/FleetPal/SOURCE.md`'s byte size and endpoint count, which are the only
fingerprints `info.version: v1` cannot give.

**Tolerance is deliberate, and so is the thing that makes it safe.** Every object is
`z.looseObject` and every vocabulary is `z.string()` plus an exported `const`, because the vendor
adds response fields and enum members inside v1 and tells consumers to ignore what they do not
recognise — a `z.enum` would turn a change they told us to expect into an outage. The parser
therefore ACCEPTS an unknown member, and `lint:fleetpal-contract` plus the contract test are what
make somebody LOOK at it. Do not "tighten" one without the other; alone, each is wrong.

---

## 5. The four rulings that are settled — do not re-litigate them

| | Ruling | Owner |
|---|---|---|
| **D-FP3 / D-FP4** | Per-truck maintenance cost IS built, as an **operational** number in the Maintenance section. Never `financial_entries`, never the fleet report, and **never printed without its coverage ratio**. D-FLEET1/2/8 are untouched | 2026-09-10 |
| **D-FP8** | Store the VMRS **code**, never persist the **description**. Resolved live and dropped. No licence bought | 2026-09-10 |
| **D-FP11** | FleetPal supplies the parts **catalogue**; the shelf's opening balance comes from the I5 count session. FleetPal has no quantity in its model at all | 2026-09-10 |
| **D-FP2** | The collector writes no table it does not own. Stock and catalogue changes go through `recordMovement` / `createPart` | plan |

The dedup contract this module would have needed under the pre-2026-09-03 ruling is **deleted, not
deferred**. If you find yourself designing one, read `ARCHITECTURE.md` §2 and
`FINANCE-FLEET-REPORT-PLAN.md` §0 first — there is no second door left for it to guard.

---

## 6. After F4

**F5** (the pure matcher — VIN, then unit number, then unmatched-and-visible) and **F6/F7** (the
ingest) need no credential either and can be built against F4's recorded fixtures. **F9** is where
per-unit cost and the coverage ratio arrive, and D-FP4 requires them in the same PR.

The owner's stated goal, in one sentence, so the sequencing stays honest: *precise maintenance data
for trucks and trailers, and the parts catalogue into the shop feature.* That is F9 and F12/F13.
Everything before them is the ground they stand on.
