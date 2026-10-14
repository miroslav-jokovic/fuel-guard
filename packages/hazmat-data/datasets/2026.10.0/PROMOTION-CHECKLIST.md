# HazmatGuard datasets 2026.10.0 and 2026.12.0 — promotion checklist (prepared 2026-10-14)

Owner ruling Q-DR14a (2026-10-14): **(b)** — the triangulation accepts a difference a cited Federal
Register rule explains (`import/reconciliations.ts`, #1527), and the next datasets are cut from the
current text. This file replaces `datasets/2026.08.0/PROMOTION-CHECKLIST.md`, whose re-cut can no
longer run (it is kept as the record of the currency check). Attesting is a named person's act and
nothing in this file performs it.

| | 2026.10.0 | 2026.12.0 |
|---|---|---|
| Takes effect | 2026-10-14 (on attestation) | **2026-12-02** — 91 FR 49305 |
| eCFR source | Title 49 at 2026-10-09 | same |
| `hazSubstances` | §172.101 Appendix A — 1,351 rows | 40 CFR 302.4 Table 302.4 — 1,340 rows with lb+kg RQ |
| Second source | GovInfo CFR-2025-title49-vol2 (2025-10-01) | same, plus CFR-2025-title40-vol30 (2025-07-01) |
| Triangulation | ALL CLEAN — HMT 2397/2400 keys + 4 cited differences, placards 23/23, segregation 173/173 | the same, plus Table 302.4 1340/1340 |
| Committed | provisional, sha256 `fa3822a3…` | provisional, sha256 `e8119928…` |
| Report | `datasets/2026.10.0/triangulation-report.md` | `datasets/2026.12.0/triangulation-report.md` |

Both re-cut byte-for-byte from the committed fixtures (checked 2026-10-14 with `cmp`). **Do not
recapture Title 49 before both are attested**: the attested re-cut must read the text the reports
describe, and `buildDataset.ts` refuses a `sourceEcfrDate` other than the captured one.

## 1. What the attester checks

1. **The four cited differences** (each report's "explained by a cited rule" section) against
   91 FR 51098, FR doc 2026-16111, published 2026-08-07, effective 2026-09-08
   (federalregister.gov/d/2026-16111, amendatory text to §172.101): special provision 200 added to
   UN0431 *Articles, pyrotechnic*, UN0335 *Fireworks* and UN0101 *Fuse, non-detonating*; the rule's
   own UN0431 row prints its cargo-aircraft limit as "75kg". All three are Class 1, outside the fuel
   scope, and the engine reads no special provision 200.
2. **The rest of each report reads CLEAN**: the in-scope fuel gate, placards, segregation, and on
   2026.12.0 Table 302.4.
3. **A PDF spot-check** of any rows the attester chooses (RELEASING.md step 5).

## 2. What changes against 2026.08.0 and 2026.07.1 (measured)

- **2026.08.0 → 2026.10.0:** exactly the three fireworks rows above, plus `namesChemicalGroup` on 470
  n.o.s./generic entries (125 true). Placards, segregation, Appendix A, Appendix B and ERG identical.
- **2026.10.0 → 2026.12.0:** `hazSubstances` only. Appendix A and Table 302.4 pair 1,316 substances
  with no RQ difference; 35 names are only in Appendix A and 24 only in Table 302.4, mostly the same
  substance spelled differently (`npx tsx import/hazSubstancesDiff.ts`). Table 302.4 adds
  **PFOA and PFOS (RQ 1 lb) and 1-bromopropane**, which no released dataset carries.
- **Against production's 2026.07.1:** everything 2026.08.0 added — HMT columns 8A/8B — so the
  Limited Quantity change in `datasets/2026.08.0/PROMOTION-CHECKLIST.md` §4 applies unchanged.

## 3. Promotion simulation (in memory, nothing saved)

Each dataset forced `provisional: false` and set as LATEST, then: `@hazmat/engine` 300/300,
`@hazmat/golden` 4/4 (every scenario), `@hazmat/data` 240/240, the API's hazmat and document-reading
suites 405/405, the web hazmat suites 109/109 — on both. The golden pin
`_pkg-lq-refused-pre-8a.yaml` (2026.07.1) keeps the pre-8A refusal tested.

## 4. Expected behaviour change on promotion

- **Limited Quantity** (2026.10.0 on): a line declared LQ whose HMT row authorises it drops out of
  placarding and gets the LIMITED_QUANTITY mark; a claim the row does not authorise is still refused.
- **Technical name (§172.203(k))** (2026.10.0 on): an n.o.s. line marked G with no technical name
  printed is now a "technical name missing" finding when its shipping name names no chemical group;
  today it is "cannot tell". A line that prints one is unchanged — production read dffc6330
  (UN3082, "TRIMETHYLOLPROPANE TRIMETHACRYLATE") passes on both datasets before the flag is read.
- **RQ list** (2026.12.0): a BOL line naming PFOA, PFOS or 1-bromopropane at or above 1 lb gets the
  RQ requirement. The 35 Appendix-A-only rows are gone; most return under Table 302.4's spelling of the same substance (the diff lists each).
- **Saved `hazmat_runs` keep their `dataset_version`** and replay on it (`reproduce.ts`).

## 5. The commands (from `packages/hazmat-data/`), once a person is named

```
npx tsx import/buildDataset.ts 2026.10.0 2026-10-09 2026-10-14 --attested-by "<name>" --attested-on <YYYY-MM-DD>
npx tsx import/buildDataset.ts 2026.12.0 2026-10-09 2026-12-02 --attested-by "<name>" --attested-on <YYYY-MM-DD>
```

1. Expect `provisional: false (triangulation CLEAN + attested → non-provisional)` for each, and new checksums.
2. Save each printed report over its `triangulation-report.md`.
3. **First PR:** both attested files, `LATEST_DATASET_VERSION = "2026.10.0"`, the `src/index.ts`
   comment updated. Then `pnpm --filter @hazmat/data test && pnpm --filter @hazmat/engine test &&
   pnpm --filter @hazmat/golden test` and the repo gates. Released by the train as usual. No migration.
4. **Second PR, merged 2026-12-01:** `LATEST_DATASET_VERSION = "2026.12.0"`, approved for the 01:07 CT
   release run on 2026-12-02. Not earlier — Appendix A is the law until that day. Merging puts it on
   staging at once, which is fine: staging is not shipping anything.

## 6. Post-release checks

- `pnpm verify:live` serves the release; Hazmat Calculator: the LQ load in the 2026.08.0 checklist §4
  gives no placard and the LQ mark; a new saved run records the new `dataset_version`.
- Reproduce an older saved run: its stored side still names 2026.07.1.
- The clear endpoint no longer refuses for "provisional dataset".
- Diary: when GovInfo lists `CFR-2026-title49-vol2`, recapture and cut again — the gate will then fail
  on the 91 FR 51098 entries until they are deleted from `reconciliations.ts`.
