# Placard calculator — precise, reliable, production-ready (audit of 2026-10-26)

Owner, 2026-10-26: *"Reading is not precise and reliable, that is the main issue … instead of making this job
easy it is making it complicated … placard calculation has some issues. Let's make this feature precise,
reliable and production-ready, safe to use without concerns of making mistakes."*

This plan is the audit the owner asked for and the work that follows from it. It sits under
`READER-CORRECTNESS-PLAN.md` (its two promises and D-RC1–D-RC4 stand) and `DOCUMENT-READER-PLAN.md` §7A/§7B.
Everything in §2 was measured on 2026-10-26 by replaying the nine production reads that carry replay inputs
(2026-10-19 … 2026-10-23) through today's code — pairing, table, witnesses, audit, prefill, the Calculate gate
and the engine — and by reading the stored page images against what the system said.

---

## 1. The short version

The last week's reader work (RC1–RC8, Q-RC5, Q-RC7) did what it set out to do: the pairing, the UN-number
settle, the form invariant and the acceptance rule hold on every stored read, and **the placard engine answered
every verified load correctly once it was given the paper's lines.** What the owner hit is upstream and
downstream of that:

1. **The Hazardous Materials Table dataset carries no subsidiary hazard classes** — `subsidiaryClasses` is `[]`
   on all 2,479 entries in every cut (2026.07.1 … 2026.12.0), while column (6) label codes show that **561
   entries have one**. §172.202(a)(3) requires the shipper to print the subsidiary in parentheses after the
   primary class, so every correctly printed line of such a material — UN2922 "8(6.1)", UN3098 "5.1(8)",
   UN2924 "3 (8)" — is **refused by the table matcher**, lands on the calculator with **no product**, and the
   BOL check calls the correct paper **"wrong"**. The engine's §172.505(b) DANGEROUS WHEN WET subsidiary
   placard and the §177.848 segregation check read the same empty field, so both are blind to subsidiaries
   on the shipped dataset. The RC5 golden census printed the class from that field, so it never exercised the
   parenthesised format (a vacuously complete fold).
2. **A weight column in kilograms is null by the profile's own words** (`grossWeightLb` — "null when in another
   unit only"), so a KG-only paper fills no weight and nothing can be calculated.
3. **One upload is still one document** (Q-DR27, open since 2026-10-15): two different BOLs photographed
   together are judged as one paper — "The BOL has 2 pages and page 2 is missing", one certification for two
   papers.
4. **The screen multiplies what the person must do.** On a five-line paper of one product the calculator showed
   15 fields waiting for a check, 5 "wrong" and 32 "check by eye" findings — most of them the same sentence
   five times — above the product lines, and several of them questions a dispatcher cannot settle at a dock
   ("check the safety data sheet"). The owner never reached Calculate on that paper.
5. **The readers normalise silently where the schema makes them:** `pg` is an enum (I/II/III), so "PG 3" is
   written as "III" and the Roman-numeral rule can never fire; one reader closed a parenthesis the paper never
   printed, splitting the readers on every line.

Items 1–3 and 5 are deterministic code and data, provable over their whole input space (D-RC1). Item 4 is a
design ruling for the owner (§6). None of it is the model misreading the page.

## 2. Measured, 2026-10-26

### 2.1 The nine replayable production reads

| Read | Paper | Lines filled | Waiting on a person | BOL check: wrong / check / passed | Engine (van) | Verified against the page |
|---|---|---|---|---|---|---|
| 76979453, f1b91bba | Sonny's corrosives, 2 pp | 6 of 6 | 1 (UN3254/3264, now settled by Q-RC7) | 2 / 14 / 43 | CORROSIVE | right |
| e6dfc064, 350d2f27, 5f7a6c5c | Mayo 14182 | 2 of 2 | 0 | 0–2 / 1–3 / 20 | CORROSIVE | right; RQ owed on both lines (R-M1) |
| 3eb99651 | Russian River kegs, 2 pp | no hazmat | 0 | — | — | right (beer) |
| a4119634 | **Henkel master BOL, 4 lines, 2 pp** | **2 of 4** | 2 (two lines with no product) | **2 false "wrong"** / 6 / 29 | CORROSIVE only | **should be CORROSIVE + OXIDIZER, with the 8 × 5.1 "Away From" segregation warning** |
| 7c7e6468 | **Maintex, two BOLs (1205726-00 and 1205389-00), one hazmat line each** | 2 of 2 | 0 | 1 false "wrong" / 5 / 17 | CORROSIVE (96 cases, 3,456 lb) | data right; the audit judged two papers as one |
| f2dc74ed | **PureTech, 5 × UN2924 IBC, weights in KG** | **0 of 5 with a product; no weight on any** | **15** | **5 false "wrong"** / **32** / 11 | nothing | should be FLAMMABLE (five bulk IBCs, §172.504(a)); Calculate was never pressed |

The review rows confirm the screen's side: on the Henkel paper the owner picked the two refused products by
hand (the rows record the paper's `8(6.1)` as *corrected* to `8` — a wrong label, §2.7); on PureTech only two
`paper_check` rows exist and no Calculate batch.

### 2.2 Subsidiary classes are missing from the dataset

- `packages/hazmat-data/import/hmtAssemble.ts:193` writes `subsidiaryClasses: []` for every entry. Column (6)
  label codes are imported per packing-group row (`pgRows[].labelCodes`): **561 of 2,479 entries carry a second
  code** (UN2922 `["8","6.1"]`, UN3098 `["5.1","8"]`, UN2924 `["3","8"]`, UN3123 `["6.1","4.3"]` …), and all
  561 have an empty `subsidiaryClasses`. §172.402(a): the subsidiary labels are the subsidiary hazards.
- `resolveHmtLine` (`resolveLine.ts` `classMatches`) already parses "3 (6.1)" and checks the parenthesised
  classes against `entry.subsidiaryClasses` — against an empty list, so it refuses. Probed 2026-10-26 on
  dataset 2026.07.1: **UN2922 "8(6.1)", "8 (6.1)", "8, 6.1" → `class_mismatch`; UN3098 "5.1(8)", "5.1 (8)" →
  `class_mismatch`; UN2924 "3, 8", "3 (8)", "3(8)" → `class_mismatch`;** "8" alone resolves.
- The paper audit's `paper_class_pg_match` takes `class_mismatch` as "differs" and prints *"prints class 8(6.1)
  where the table says 8"* — the table says 8 (6.1); the sentence is built from the same empty field.
- `@hazmat/engine` `subsidiary505()` reads `entry.subsidiaryClasses` for §172.505(b): **13 non-4.3 entries whose
  labels include 4.3** (UN2870 Aluminum borohydride, UN3094/UN3096 water-reactive corrosives, UN2210 Maneb, …)
  can never raise DANGEROUS WHEN WET. `segregation/check.ts` builds its class set from the same field (its own
  header says it reads it "one module over"), so a 3 (4.3) beside a Class 8 answers `segregation_none`.
- `paperGoldenCensus.test.ts` prints each entry's class as `classText(e)` = primary + `(subsidiaries)` — with
  the field empty, every golden paper printed the primary class alone, and the parenthesised printing that
  §172.202(a)(3) requires was never censused. `placardCensus.test.ts` invariant 6 ("a §172.505 subsidiary is
  asked for") was vacuous for the same reason.

### 2.3 The weight column in kilograms

`shippingDocumentContract.ts` `grossWeightLb`: *"The line's weight as printed in its weight column, when in
pounds; null when in another unit only."* The PureTech paper prints WEIGHT (KG) 1,814.00 on every line and
10,884.00 KG gross; both readers obeyed and wrote null. The Henkel paper prints both (3,194.10 KG / 7,041.81
LB) and was read. A KG-only weight column is ordinary on chemical shippers' papers; the calculator cannot
proceed without a gross weight, and the form then asks the person to type five weights the paper prints.

### 2.4 One upload, several papers (Q-DR27)

Maintex read 7c7e6468: two photos, two different BOL numbers (1205726-00 "Page 1 of 2", 1205389-00 "Page 1 of
4"), one hazmat line each (UN 1760, 48 CS, 1,728 lb — both read right by both readers). Judged as one document:
*"The BOL has 2 pages and page 2 is missing"* (each paper is missing its own continuation pages — a true finding
said wrongly), `bolNumber` = the first paper's, one certification for two papers. Q-DR27 recommended (a) one
document per shipping paper on 2026-10-15; nothing was built. The owner's 13-photo upload of 2026-10-15
(00fbbc63) was the same case.

### 2.5 What the screen asked for

PureTech f2dc74ed, as the owner saw it: the "Is this BOL written correctly?" card above the product lines with
5 "Wrong or missing" (all the same false class finding) and 32 "Check by eye" items — the same 6–7 sentences
on each of five identical lines, each with its own row of choice buttons, plus one whose choice read
`“[object Object]”` (the page-marker field offers an object as a button label). Below it, five product lines,
each saying "The hazard class does not belong to this UN/NA number" with no product, blank weight, and
"Yes, the page says …" buttons on count and packaging — **15 acts before Calculate**, after which the engine
would still have had no product on any line.

Maintex 7c7e6468: of five "Check by eye" items, four are two sentences said twice — *"names one component; if it
is a mixture of two or more hazardous materials, two must be named — check the safety data sheet"* and *"prints
only a weight and no separate quantity — check whether that weight includes the packaging"*. Both are
§172.203(k)(2) / §172.202(a)(5) questions a shipper answers, not a dispatcher at a dock; shown as things to
check, they read as blockers. They never gated Calculate — but nothing on the screen says so.

### 2.6 Silent normalisation by the readers

- `pg: z.enum(["I","II","III"])` — the reader must write Roman numerals. PureTech prints "PG 3"; both readers
  wrote "III"; the §172.202(a)(4) Roman-numeral rule cannot see the defect, and the paper-check review recorded
  "III" as what the page prints.
- PureTech's description cell prints "(Ethanol, Sulfuric Acid" with no closing parenthesis (the shipper's).
  Pass A copied it; pass B wrote "(Ethanol, Sulfuric Acid)". That one character split the readers on
  `descriptionText` on all five lines, which stopped the sequence, technical-name, LQ and marine-pollutant rules
  on each. The agreement rule (D-DR19) rests on both readers copying to the letter; the profile says so for
  `psn` and nowhere for the description.

### 2.7 Review rows record a wrong label

`bolReview.ts` `reviewEntries` compares the paper's class to the picked product's `hazardClass` (primary only):
Henkel's `8(6.1)` and `5.1(8)` were written as *corrected* to `8` and `5.1`. Those rows are RC7's labels; as
written they say the paper was wrong where it was right.

### 2.8 The pages themselves

The seven stored pages of the four latest reads are 810×1080, 768×1024, 960×1280 and 1200×1600 px (0.9–1.9 MP):
texted or mailed copies, as measured on 2026-10-20. Q-RC6 (a) — the driver app sends the camera's original —
is still the only thing that lifts the reading ceiling; nothing in this plan changes it, and nothing above
needed more pixels.

### 2.9 What is NOT wrong (measured, so it is not re-litigated)

The engine (0.20.0) on every verified load; the two-reader pairing (RC3) and the UN-number settle (Q-RC7) on
Sonny's paper; the arithmetic and row witnesses (Henkel's counts and weights are row- and sum-backed); the
no-hazmat answer on the keg paper; the data on the Maintex and PureTech reads (every number matches the paper).

## 3. Decisions

**D-PC1 — a subsidiary hazard class is a table fact, derived from column (6).** `subsidiaryClasses` = the label
codes of the entry's packing-group rows minus the primary class (§172.402(a)), computed in ONE function in
`@hazmat/data` — at assembly for future cuts and at `loadDataset()` for the shipped cuts, so no re-cut is
needed to ship it. A census asserts the count (561 on 2026.07.1) so the field can never be empty again
unnoticed, and the RC5 golden census, the placard census and the segregation tests gain a guard that fails
when the entries they fold over carry no subsidiary.

**D-PC2 — the matcher accepts every printing of the same classes; punctuation is the audit's business.** "8
(6.1)", "8(6.1)", "8, 6.1", "8/6.1" and "CLASS 8 (6.1)" name the same classes and resolve. The audit then says
one of three things: the classes are right and printed as §172.202(a)(3) requires (pass); the classes are
right in the wrong punctuation (*shipper must correct — format*, a distinct reason and sentence); the classes
are wrong (*wrong*, with the table's full class in the sentence). A subsidiary printed where the table has
none, or missing where the table has one, is wrong.

**D-PC3 — a weight column is read as printed, with its unit; code converts.** `grossWeightLb` becomes the
weight cell's text (same union count — a nullable string for a nullable number), parsed by a tested function
into pounds (LB, LBS, #, KG, KGS, kg, with thousands separators and decimals), the same way `quantity` is
normalised. A model is never asked to convert units or to leave a printed number out. The net column follows.

**D-PC4 — one shipping paper is one document (Q-DR27 (a), built).** The classifier already reads each page's
BOL number and page marker; pages with one BOL number are one paper, an unnumbered page follows the paper
before it, and a page that is not a shipping paper (load sheet, rate confirmation, delivery copy) is context.
Each paper is read and audited on its own; the calculator takes every hazmat line from every paper and shows
which paper each line came from.

**D-PC5 — the calculator asks only what the placard answer needs, and says so.** The Calculate gate stays what
D-DR24 made it (a disputed count, weight, product, package type or LQ waits on a person). Everything else — the
paper audit — moves below the product lines and collapses: failures first; identical findings across lines
folded into one ("on 5 lines"); "can't tell" items grouped under one line that says they do not hold up the
placards, opened on demand; a question only the shipper can answer (SDS, packaging weight) marked as the
shipper's. The person's acts stay (owner, 2026-10-15, "keep the click"), but each is asked once.

**D-PC6 — readers copy to the letter; the schema may not force them to normalise.** `pg` becomes the printed
text ("II", "PG 3", "III"); the normaliser maps it and the audit's Roman-numeral rule judges the print. The
description's instruction says "exactly as printed, including a missing bracket". Where one reader's reading
is the other's with one punctuation character added or removed and the parsed facts agree, the readings
agree (`readingExtent.ts` already does this for tails; it gains the one-character case, property-tested).

**D-PC7 — a review compares the paper's class to the product's full class.** `reviewEntries` judges the class
with the matcher's own comparison (primary + subsidiaries), so "8(6.1)" against a product whose table row is
8 (6.1) is *confirmed*, never *corrected*. Existing rows of 2026-10-21 are relabelled by the same function when
RC7 counts them.

## 4. Build order

Each step ships with the whole-space test that would have found it on every BOL (D-RC1), the replay of the
nine stored reads in its PR (D-RC2), and false-accept 0 on the gate (D-RC3).

| Step | What | Owner input | Done when |
|---|---|---|---|
| **PC1** | Subsidiary classes (D-PC1): `subsidiaryClassesOf(entry)` in `@hazmat/data`, applied in `hmtAssemble` and `loadDataset`; `resolveLine.census.test.ts` gains every subsidiary printing of §172.202(a)(3) for every entry that has one; `paperGoldenCensus` prints the real class and gains the vacuity guard; `placardCensus` adds a §172.505(b) invariant over the 13 entries and a segregation invariant over subsidiary pairs; the audit sentence prints the full class. Engine, data and golden versions bump; **needs a release** | — | census: 561 entries, 0 refused across ≥5 printings each; the Henkel replay fills 4 of 4 lines and the audit shows 0 "wrong"; the 13 DWW entries raise DANGEROUS WHEN WET |
| **PC2** | Class punctuation (D-PC2): matcher accepts the comma/slash/CLASS forms; `paper_class_pg_match` gains reason `class_format` with its own catalogue sentence and actor; property test: every entry × every printing → right classes resolve, only the non-parenthesised ones get the format note, a swapped or added subsidiary fails | Q-PC1 | PureTech replay: 5 products, 5 format notes, 0 "wrong" |
| **PC3** | Weight as printed (D-PC3): profile 1.6.0 (`grossWeightText`, `netWeightText`), `parsePrintedWeight` census over units × separators × decimals, prefill and arithmetic witness read the parsed pounds; replay | — | PureTech replay fills 1,814 kg → 3,999 lb on each line; the ten office BOLs unchanged on live re-read |
| **PC4** | PG and description as printed (D-PC6): profile 1.6.0 `pg` string, normaliser + Roman-numeral rule; one-character punctuation tolerance in `readingExtent.ts`, property-tested over every table name | — | PureTech replay: descriptions agree on 5 of 5, "PG 3" is a format finding |
| **PC5** | One paper per document (D-PC4): grouping by the classifier's BOL number in `read/readTarget.ts` (an assembly becomes N papers), one read per paper, the calculator panel reads them together and labels lines by paper; the audit per paper; `ASSEMBLY_MAX_PAGES` unchanged | Q-PC2 | Maintex replay: two papers, each "page 2 missing" on its own number, two certifications; the 13-photo upload of 10/15 becomes seven papers |
| **PC6** | The screen (D-PC5): findings below the lines, folded and grouped; `[object Object]` fixed (page markers shown as printed); `HazmatCalculatorForm.sequence.test.ts` extended with the fold; the three-fixture browser pass | Q-PC3 | PureTech on screen: 5 lines, 0 waiting (after PC1–PC4), one folded card; Henkel: 0 waiting |
| **PC7** | Review labels (D-PC7) and a relabel of the 2026-10-21 rows at RC7 count time | — | the Henkel rows read *confirmed* |
| **PC8** | Gate: `lint:reader-gate` pins the new censuses and the vacuity guards; `doc:replay` output of the nine reads in each PR; then the owner re-reads Henkel and PureTech on production | Q-PC4 (spend) | Henkel: 4 lines, 0 waiting, CORROSIVE + OXIDIZER + segregation notice; PureTech: 5 lines, 0 waiting, FLAMMABLE |

PC1 first and alone — it is the one that changes placard answers (OXIDIZER on Henkel; DANGEROUS WHEN WET on
13 entries) and it needs a release the owner approves. PC2–PC4 and PC7 need nothing from the owner. PC5 and PC6
wait on Q-PC2 and Q-PC3 but can be built behind them.

## 5. What this does to the owner's three complaints

- **Precise and reliable:** PC1–PC4 remove every false "wrong" and every needless stop measured on the nine
  reads except the ones the paper itself owes (Mayo's RQ, Sonny's digit). The reading was already right on
  every number the owner checked; what was wrong was what the system did with it.
- **Complicated:** PC5 and PC6 take PureTech from 15 acts + 37 findings to 0 acts + one folded card, and Maintex
  from 5 findings to 2; the Calculate gate asks only for what the engine reads.
- **Placard calculation:** the engine was right on every verified load. The wrong answers the owner could have
  seen (Henkel without OXIDIZER; PureTech with nothing) came from lines the table refused; PC1 fixes the cause,
  and PC1's census makes the §172.505(b) and segregation rules live on the real dataset for the first time.

## 6. Open questions

**Q-PC1 — Right classes, wrong punctuation ("3, 8" for 3 (8)): a failure or a format note?** §172.202(a)(3)
says parentheses. *(a)* a format note the shipper must correct, the calculator proceeds (the classes are
known); *(b)* a failure like a wrong class; *(c)* pass silently. **Recommendation: (a)** — the hazard is
established, the driver can placard, and the shipper hears about the comma.

**Q-PC2 — How are papers told apart in one upload?** *(a)* by the classifier's BOL number, an unnumbered page
joining the paper before it (recommended; the classifier reads BOL numbers on 18 of 18 corpus pages but drops
digits on some — a dropped digit splits a paper, which the person sees and re-groups); *(b)* ask the person to
group pages before reading; *(c)* one paper per upload, refuse the rest. **Recommendation: (a)** with (b)'s
re-grouping as the fallback on the review screen.

**Q-PC3 — Where does the BOL check live on the calculator page?** *(a)* below the product lines, failures open,
the rest folded (recommended); *(b)* its own tab beside the calculator; *(c)* as today, above the lines.
**Recommendation: (a)** — the page is the placard calculator; the paper audit is the second thing it answers.

**Q-PC4 — May PC8 re-read the Henkel and PureTech papers on production?** Two reads, ≈ $0.10, two production
rows. **Recommendation: yes** — they are the only two real papers that exercise PC1–PC4 end to end.

**Q-PC5 — Photo originals (Q-RC6 (a)), restated.** Every page of the last week is a texted copy under 2 MP. The
reading errors this plan found did not need more pixels; the next ones will. The driver-app change is a
release-lane build the owner starts.

## 7. Progress log

- **2026-10-26 — audit written.** Nine production reads replayed with today's code (`replayRead` →
  `auditForRead` with the stored `paper_check` rows → `productsByRef` → `bolPrefill` → `pendingCount` →
  `bolFindings` → `computeCalc`), the seven stored pages of the four latest reads read by eye, the resolver
  probed on every class printing, the dataset counted (561 of 2,479 entries with a second label code, 0 with a
  subsidiary class, in every cut), the assembler line found (`hmtAssemble.ts:193`). Engine answers computed for
  the Henkel and PureTech papers with their lines as printed: CORROSIVE + OXIDIZER with the 8 × 5.1 "Away From"
  notice; FLAMMABLE. Nothing built yet; PC1 is next and needs a release.
