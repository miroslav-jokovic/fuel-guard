# HazmatGuard dataset 2026.08.0 — promotion checklist (Q-DR14, prepared 2026-10-09)

Owner ruling Q-DR14 (2026-10-09): release the dataset that carries HMT column 8A, through
`RELEASING.md`, in this order — (1) step-0 currency check, (2) pin the pre-8A golden guard, (3) a
NAMED PERSON attests. Steps 1 and 2 are done on branch `claude/hazmat-dataset-release-prep`. Step 3
is the owner's act and nothing in this file performs it. **Step 1 did not come back clean — read the
open question below before attesting.**

- Dataset: `datasets/2026.08.0.json` · provisional `true` · sha256 `0ddbc023…44efc6e`
- Sources: eCFR pinned 2026-07-28 (effective 2026-08-15) · GovInfo CFR-2025-title49-vol2 (2025-10-01)
- Triangulation at cut: ALL CLEAN — HMT 2400/2400 keys, placards 23/23, segregation 173/173 (`triangulation-report.md`)
- Only data change vs 2026.07.1: each `pgRows[]` gains `exceptionsRef` (col. 8A) and `nonBulkPackagingRef` (col. 8B)
- Reproducible: re-running the unattested cut (`buildDataset.ts 2026.08.0 2026-07-28 2026-08-15`) rewrites the committed file byte-for-byte (checked 2026-10-09 with `cmp`)

## 1. Currency check (RELEASING.md step 0) — run 2026-10-09, read-only

**eCFR** (`checkTitleForUpdate`, `latestSectionAmendment`, versioner `versions/title-49.json?part=…`):

- Title 49 `latest_amended_on` 2026-10-05 (fixture recorded 2026-07-22) → `changed: true`; `up_to_date_as_of` 2026-10-07
- §172.101 last amended **2026-09-08** · §172.504 last amended **2026-09-03** · §177.848 last amended 2023-01-26 (unchanged)

**Federal Register** (`fedRegisterSmoke.ts`; `checkHmrCurrency` since 2026-07-28): 15 relevant PHMSA
final rules, 13 already effective, 2 pending. The ones that touch a section the dataset parses:

| FR doc | Citation | Effective | Section | Touches carried data? |
|---|---|---|---|---|
| 2026-16111 | 91 FR 51098 (2026-08-07) | 2026-09-08 | §172.101 HMT: UN0431, UN0335, UN0101 revised (SP 200 added to col. 7); §172.102 SP 200 | **Yes** — three HMT rows (Class 1, outside the fuel scope) |
| 2026-15809 | 91 FR 49305 (2026-08-04) | **2026-12-02 (pending)** | §172.101 App. A replaced by a pointer to 40 CFR 302.4 | **Yes, from 12-02** — `hazSubstances` (1,351 rows) loses its source text |
| 2026-15820 | 91 FR 49335 (2026-08-04) | 2026-09-03 | §172.504(d) empty-package exceptions (also §172.331, §172.514, §173.29) | No — the parser reads the §172.504(e) tables; placards still 23/23 identical |
| 2026-15805 | 91 FR 49332 (2026-08-04) | 2026-09-03 | §172.315(a)(2)(iii) reduced-size LQ mark (25 mm) on shipping labels; §173.25(a)(6) overpacks | No table — but it is the LQ mark this release turns on; engine wording, not data |

The other effective rules touch §§171.7/171.8/171.23, 172.320/172.331/172.514/172.602/172.800,
173.6/173.7/173.23/173.25/173.29/173.64/173.65/173.252/173.306/173.307 and 177.834 — none of them
parsed into the dataset. 2026-19741 (91 FR 61144, effective 2026-10-28) touches Parts 171/173/178–180
only.

**Source-level diff** (the same parsers over the 2026-07-28 fixtures and over eCFR 2026-10-07):
HMT 2,479 → 2,479 rows, **3 differ** (UN0431 SP `381` → `200, 381` and cargo-aircraft `75 kg` →
`75kg`; UN0335 SP `108` → `108, 200`; UN0101 SP none → `200`). Placards, segregation, App. A
(1,351) and App. B (554): 0 differences. Every fuel row in scope is unchanged.

**What a re-cut would say today**: Source A at 2026-10-07 against the committed Source B (GovInfo
CFR-2025) gives in-scope fuel gate CLEAN, placards and segregation CLEAN, but full-table HMT
**3 disagreements → TRIANGULATION NOT CLEAN** — `crossCheckAll()` requires `hmt.full.disagree === 0`,
so a 2026.10.0 cut would be forced provisional however it is attested, until GovInfo publishes the
CFR-2026 Title 49 edition. No capture was run (no `GOVINFO_API_KEY` is configured, and recapturing
Source A overwrites the committed fixtures that reproduce 2026.07.1 and 2026.08.0).

### Open question Q-DR14a — attest 2026.08.0 although §172.101 moved on 2026-09-08?

By RELEASING.md step 0 the dataset is no longer current: the text it was cut from was amended after
its source date. The amendment changes three Class 1 fireworks rows, which no fuel load resolves to
and which D4 never clears (an out-of-scope row is recognised and fail-closed), and adds special
provision 200, which the engine does not read (`specialProvisions` is empty; the engine fail-closes
on it).

- **(a)** Attest 2026.08.0 as cut, and name the three stale rows and 91 FR 51098 in the attestation
  record. Promotion moves no fuel verdict beyond the LQ change it exists for. Cut 2026.10.0 (or
  whatever month it lands) when GovInfo's CFR-2026 edition is out, before 2026-12-02 if possible.
- **(b)** Do not attest. Cut 2026.10.0 now: it stays provisional until the gate accepts a
  difference reconciled to a cited FR amendment, which `crossCheckAll()` cannot do today. That is new
  gate code and needs its own ruling.
- **(c)** Wait for the CFR-2026 GovInfo edition, then cut and attest the newer version instead.

*Recommendation:* (a). The three rows are out of scope and fail-closed, and the 8A data was checked
against the 2026-07-28 text. Waiting leaves every authorised Limited Quantity line placarded as
fully regulated.

**Whatever is chosen, 2026-15809 (effective 2026-12-02) forces a cut by itself:** captured after that
date, §172.101 App. A is a pointer to 40 CFR 302.4 and `parseHazSubstances` will find no table. The RQ
source has to move to 40 CFR 302.4 (EPA, not PHMSA), or the hazardous-substance check fails closed
for every load. That needs its own decision before December.

## 2. The golden pin (done on this branch)

`packages/hazmat-golden/scenarios/_pkg-lq-refused-pre-8a.yaml` now carries `datasetVersion: "2026.07.1"`.
It asserts the pre-8A refusal (FLAMMABLE kept, `lq_claim_refused`), which exists only on a dataset
without column 8A. Unpinned on a promoted LATEST it fails three ways: eligibility `eligible`,
placards `[]`, findings `[segregation_none]`.

Promotion simulation (every scenario on 2026.07.1 against 2026.08.0 with `provisional: false`, done in
memory and not saved): **13/13 pass both ways, no expectation changes**. A temporary local
`LATEST = "2026.08.0"` *without* attestation fails 7 PKG scenarios on `eligibility: expected
eligible, got not_checked`. That failure is the provisional flag at work, not a regression. It is
also why LATEST must not move before the attested file is in.

## 3. The owner's commands (in this order, from `packages/hazmat-data/`)

```
npx tsx import/buildDataset.ts 2026.08.0 2026-07-28 2026-08-15 --attested-by "<name>" --attested-on <YYYY-MM-DD>
```

1. Expect `provisional: false (triangulation CLEAN + attested → non-provisional)` and a new checksum.
   `entries 2479 · erg 1988 · placards 23 · segregation 173 · hazSubstances 1351 · marinePollutants 554`.
2. Save the printed report over `datasets/2026.08.0/triangulation-report.md` (it will read "attested by").
3. In `src/index.ts`, set `LATEST_DATASET_VERSION = "2026.08.0"` and replace the RAW-map comment on
   2026.08.0 (it says "ships PROVISIONAL").
4. `pnpm --filter @hazmat/data typecheck && pnpm --filter @hazmat/data test && pnpm --filter @hazmat/engine test && pnpm --filter @hazmat/golden test`,
   then the repo gates (`pnpm lint`, `pnpm typecheck`, `pnpm lint:codegen`).
5. One PR, then the release train as usual. No migration.

## 4. Expected behaviour change

- A line declared Limited Quantity whose HMT row authorises it (col. 8A → e.g. §173.150) **drops out of
  placarding** (§172.500(b)(2)) and gets the **LIMITED_QUANTITY** mark (§172.315). It no longer counts
  toward the 1,001-lb aggregate. Example: 40 retail cases of UN1203 PG II, 2,000 lb → no FLAMMABLE.
- A claim the row does not authorise is still refused (`lq_claim_refused`, fully regulated, reviewer).
- **Saved `hazmat_runs` keep their `dataset_version`.** A run saved on 2026.07.1 replays on 2026.07.1
  (`reproduce.ts` loads `run.dataset_version`), so a filed verdict does not change. Only new
  evaluations and the "current" side of a reproduce use the new LATEST.

## 5. Post-merge checks

- Staging `GET /api/version` serves the merge commit (`pnpm verify:live staging`). After the release,
  production (`pnpm verify:live`).
- Hazmat Calculator on staging: the §4 LQ load → no placard, LQ mark; same load without the LQ
  declaration → FLAMMABLE; a new saved run records `dataset_version = 2026.08.0`.
- Reproduce an older saved run: its stored side still names 2026.07.1 and is unchanged.
- The clear endpoint no longer refuses for "provisional dataset" (2026.08.0 `provisional: false`).
- Diary: re-run step 0 before 2026-12-02 (2026-15809) and when GovInfo lists `CFR-2026-title49-vol2`.
