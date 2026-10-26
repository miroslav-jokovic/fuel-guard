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

## 6. Open questions — researched 2026-10-26

The owner asked for answers "not based on assumptions". Each question below carries what was measured or
read, then the recommendation that follows from it. Where a fact could not be fetched first-hand it says so.

**Q-PC1 — Right classes, wrong punctuation ("3, 8" for 3 (8)): a failure or a format note?**

*What the rule says.* §172.202(a)(3) (eCFR via LII, read 2026-10-26): "Except for combustible liquids, the
subsidiary hazard class(es) or subsidiary division number(s) must be entered in parentheses … immediately
following the primary hazard class or division number"; (a)(3)(i) "The words 'Class' or 'Division' may precede
the primary and subsidiary numbers"; and the subsidiary "is not required to be entered when a corresponding
subsidiary hazard label is not required." §172.202(b)'s own example is "UN2744, Cyclobutyl chloroformate,
6.1, (8, 3), PG II". PHMSA interpretation 04-0188 (2004, found through PHMSA's site; the letter itself answered
403 to a fetch, so the wording is the site's summary) ruled that the parentheses are mandatory and that the
regulation's own un-parenthesised example was to be corrected. PHMSA 22-0041 (2022) and 25-0057 (2025, to
CVSA) read the "not required" clause as: when no subsidiary label is required under §172.402, the subsidiary
need not be on the paper; §172.400a(a)(5) drops labels on a placarded portable tank or freight container, and
§172.402(a)(2)'s table drops some subsidiary labels by packing group. So a paper that prints the subsidiary
in parentheses is right; one that prints it with a comma names the right hazard in the wrong form; one that
omits it is right only when §172.402 asks for no label.

*What the papers do.* Of the four subsidiary-class printings read on production in the last week, two are in
the required form ("8(6.1)", "5.1(8)" — Henkel), two are not ("3, 8" ×5 — PureTech, where the paper also
prints "PG 3" and leaves a parenthesis open). Both forms exist on real shippers' papers.

*Recommendation: (a), with the omission rule from the letters.* The matcher resolves the classes however they
are punctuated (the hazard is known, the placard follows); the audit records three distinct outcomes:
*parenthesised* (pass), *right classes, not in parentheses* (shipper must correct — a format reason, the
sentence quoting 04-0188's wording), *wrong or extra subsidiary* (wrong). A subsidiary missing from the
paper is a defect only where §172.402 requires its label — the engine already derives label requirements
from the row, so the audit reads them from there rather than guessing. This is also what keeps D-PC1 from
over-failing bulk IBC lines such as Henkel's, where 25-0057 says the printed subsidiary was optional.

**Q-PC2 — How are papers told apart in one upload?**

*Measured.* (1) Multi-page uploads are the norm: of the 61 Samsara submissions in the corpus, 41 hold more
than one photo (12 hold three, 11 hold five or more). (2) Production uploads are all office uploads of
texted photos (29 sources, every one `origin = upload`, largest 803 KB); 10 of the 17 finished reads carry
more than one page. (3) **The OCR witness already reads each page's paper number and marker, and it is
stored on the read:** on the five replayable multi-page reads it found "1205726-00 / Page 1 of 2" and
"1205389-00 / Page 1 of 4" on the two Maintex pages, the same "02875600040217722" on both Henkel pages with
"Page 1/2" on the first, "13114" on both keg pages, and "Page 2 of 2" then "Page 1 of 2" on Sonny's — whose
two photos were uploaded in the wrong order and read correctly anyway. (4) The classifier (Haiku 5.5)
records only the page class and rotation; the 2026-10-13 measurement found it reads "page n of m" 18/18 but
drops digits in BOL numbers, so grouping on its word alone would split papers.

*Recommendation: (a) by the paper's own number, from two witnesses, with the person able to regroup.* Pages
whose OCR text (and, where present, the text layer) carries the same document number are one paper; a page
with a marker "n of m" and no number joins the paper whose number precedes it in upload order; a page with
neither is its own paper until the person says otherwise. The readers then read each paper on its own and
their `identity.bolNumber` must agree with the grouping, or the read stops and shows the pages for regrouping
— the same two-witness rule the fields already live by (D-DR19). No new model call: the OCR runs per page
today. The classifier gains nothing it cannot do reliably. (b) alone (ask the person first) adds a step to
every upload, including the 7 single-page ones in the last week; (c) (one paper per upload) refuses the
ordinary multi-stop load (the 13-photo upload of 10/15 held seven papers).

**Q-PC3 — Where does the BOL check live on the calculator page, and what does it show?**

*Measured on the eight hazmat reads.* The check produced 92 findings a person saw (47 distinct sentences; 49
with choice buttons). By outcome: 12 failures — of which 7 were the false class failures of §2.2, 4 were a
missing basic-description element, 1 a missing page — and 2 RQ failures; 61 "confirm it first" stops where
the readers disagreed on a field; 28 "can't tell" items the paper cannot answer (14 weight-only lines, 8
"mixture — check the SDS", 5 RQ per package, 1 ER-phone exception). After PC1–PC4 the 7 false failures and
the disagreement stops on description, class and weight go; what remains for a correct paper is roughly
one real failure per three papers and three to four "the paper does not say" items per paper, every one
addressed to the shipper, not the dock. The dispatcher cannot act on a single one of the 28 at the dock.

*What the literature says about showing them anyway.* Operator compliance with automated alerts falls with
their false-alarm share: an airport-screening study found operators ignoring about half of the TRUE alarms
once positive predictive value fell to ≈0.3 ([Sonar.ch](https://sonar.ch/global/documents/189939)); Dixon &
Wickens found false-alarm-prone automation hurt both compliance and reliance where miss-prone automation hurt
only reliance ([DTIC](https://apps.dtic.mil/sti/tr/pdf/ADA496817.pdf)); a 2025 fault-detection paper argues
the false-discovery rate, not the raw rate, predicts the cry-wolf effect
([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0951832025010907)); and transparency
about why an alert fired mitigates it ([Yang et al., HRI 2017](https://people.csail.mit.edu/unhelkar/files/preprints/2017_Yang_HRI.pdf)).
On the PureTech paper 5 of 5 failures and 32 of 32 checks were not actionable — a false-discovery rate of 1.

*The plan's own reason for "above the form"* (DOCUMENT-READER-PLAN §6, 2026-10-08) was that the audit
answers "what the shipper left out" before the person fills the form. That stood when the audit's output
was a few sentences; measured, it is 11 lines per paper and the calculator's own gate (D-DR24) is below
them.

*Recommendation: (a).* The product lines and the Calculate gate first — they are what the page is for and
what a person can act on; the check below them as one card: real failures open, addressed to who acts
(driver / shipper); "the paper does not say" folded under a count with the shipper named; identical findings
across lines said once ("on 5 lines"). Nothing in the folded part gates Calculate, and the card says so. No
user study exists for this page; the counts above and the cry-wolf findings are the evidence, and the
browser pass (PC6) measures the fold on the three fixtures before it ships.

**Q-PC4 — May PC8 re-read the Henkel and PureTech papers on production?**

*Cost, from the reads' own token counts* (both readers and the classifier together, priced at the dearer
reader's list rate, Sonnet 4.6 $3 / $15 per MTok): Henkel 29,364 in + 3,153 out ≈ $0.14; PureTech 26,034 in +
3,077 out ≈ $0.12. Two production rows, no schema change. *Recommendation: yes* — they are the only two real
papers that exercise PC1–PC4 end to end, and the replay cannot stand in for them because PC3 and PC4 change
what the readers are asked to write.

**Q-PC5 — Photo originals (Q-RC6 (a)), restated with what the pipeline can use.**

*Measured.* (1) Every production read to date came from an office upload; none from the driver app or
Samsara. So the driver-app change (camera original) would not have touched a single read made so far. (2)
The Samsara corpus photos are 3 MP (median 2000×1500; 1.7–8.4 MP); the office uploads of the last week are
0.8–1.9 MP, the largest file 803 KB — texted or mailed copies. (3) The readers cannot use all of it anyway:
pass A is locked to Sonnet 4.6 (D-DR20), whose standard vision tier is 1,568 px and 1,568 tokens — a ceiling
of ≈1.2 MP, so a 1200×1600 upload is already shrunk for it and only the 768×1024 and 810×1080 pages fall
below it; pass B (Sonnet 5.5) is on the high tier (2,576 px / 4,784 tokens ≈ 3.75 MP) and the OCR witness
reads the original — those two gain from every pixel up to 3.75 MP.

*Recommendation, in order of measured effect.* (i) On the office path: show the page size at upload and warn
below 1.5 MP ("this is a texted copy — upload the original photo or PDF"), free and today; (ii) when the
Samsara intake (N7) lands, its photos are already 3 MP and need nothing; (iii) the driver app's camera
original (Q-RC6 (a)) stays right but matters only once drivers read through the app; (iv) the question of
pass A's tier is the owner's (D-DR20 locked Sonnet 4.6 on 2026-10-11, when Sonnet 5.5 showed no UN error on
the ten office BOLs and Sonnet 4.6 read 9 drums for 6 once) — nothing here reopens it, but it is the only
change that would let pass A see more than 1.2 MP.

**Q-PC6 — A subsidiary left off the paper: when is it a defect?** (opened 2026-10-26, building PC2)

*What the rule says.* §172.202(a)(3): the subsidiary "is not required to be entered when a corresponding subsidiary
hazard label is not required" — PHMSA 22-0041 and 25-0057 read it so (Q-PC1). Whether the label is required is
§172.402's question: its (a)(2) table excuses some subsidiary labels by packing group, §172.400a(a)(5) drops labels
on a placarded portable tank or freight container, and a bulk packaging (IBC, cargo tank) is placarded, not
labelled. So "3" for a 3 (8) material is right on Henkel's IBCs and may be wrong on a drum of the same material.

*What the engine has.* Nothing derives §172.402. `placards/classify.ts` accepts an optional `labelCodes` on a
line and no module reads it for a requirement; `paper_class_pg_match` passes a line that prints the primary alone
— the resolver accepts "3" for 3 (8), as it must, since the omission is lawful on bulk — on bulk and non-bulk
alike. PC2 did not guess at the rule: today an omitted subsidiary is never a finding, and the rule's comment says
so.

*Candidate answers.* (a) Derive §172.402 in the engine — packaging kind from the caller's `packagingKind`, PG from
the row, the (a)(2) table from the regulation's own text, §172.400a's exceptions — and fail `class_or_pg_wrong`
with a reason `subsidiary_omitted` only where the label is required; one new module, property-tested over every
entry with a subsidiary × packaging × PG. (b) Answer `cannot_tell` ("the paper prints 3; the table says 3 (8) —
required on a package, not on a placarded bulk packaging") on every non-bulk line that prints the primary alone —
cheap, but one more "can't tell" per such line in the fold Q-PC3 is shrinking. (c) Leave it: an omitted subsidiary
never changes a placard (the engine reads the row's subsidiaries, not the paper's), so the cost is one paper
defect unreported.

*Recommendation: (a), after PC3–PC7.* It changes no placard, and the two real papers are either lawful (Henkel,
bulk) or print the subsidiary (PureTech). Until it is built, (c) holds.

## 7. Progress log

- **2026-10-26 — audit written.** Nine production reads replayed with today's code (`replayRead` →
  `auditForRead` with the stored `paper_check` rows → `productsByRef` → `bolPrefill` → `pendingCount` →
  `bolFindings` → `computeCalc`), the seven stored pages of the four latest reads read by eye, the resolver
  probed on every class printing, the dataset counted (561 of 2,479 entries with a second label code, 0 with a
  subsidiary class, in every cut), the assembler line found (`hmtAssemble.ts:193`). Engine answers computed for
  the Henkel and PureTech papers with their lines as printed: CORROSIVE + OXIDIZER with the 8 × 5.1 "Away From"
  notice; FLAMMABLE. Nothing built yet; PC1 is next and needs a release.
- **2026-10-26 (later) — owner: "research and recommend solutions not based on assumptions."** §6 rewritten
  with the measurements behind each answer: §172.202(a)(3) and PHMSA 04-0188 / 22-0041 / 25-0057 for Q-PC1;
  the corpus (41 of 61 submissions multi-page), the stored OCR rows (paper numbers and markers found on every
  multi-page read) and the classifier's limits for Q-PC2; the 92-finding tally and the cry-wolf literature for
  Q-PC3; token counts for Q-PC4; the readers' vision tiers, the all-upload origin of production reads and the
  corpus resolutions for Q-PC5. Recommendations unchanged in direction, sharpened in rule: the missing-subsidiary
  case follows §172.402, the paper grouping uses the OCR's numbers under the two-witness rule, the upload path
  warns on small pages.
- **2026-10-26 — PC1 built (owner: "build PC1").** `@hazmat/data` `subsidiaryClasses.ts`: one derivation from column
  (6)'s label codes, used by the assembler and by `loadDataset()` for the shipped cuts (561 entries on 2026.07.1;
  the eCFR's "8.6.1", "6.1. 4.1" and "Empty" cells read for what they say). `resolveHmtLine` (normalizer 1.4.0):
  "Class"/"Division" may precede the numbers ((a)(3)(i)), a Class 1 division keeps its compatibility group inside
  the parentheses, and where same-name rows differ only in their subsidiaries the exactly printed row is chosen
  (`row_chosen_by_class`, D-RC4) — UN1230 Methanol "3" is the D row, "3 (6.1)" the I row; UN2031 nitric acid
  "8, PG I" still goes by PG. RC1 census now runs every entry × four class printings with a guard of >550
  entries carrying a subsidiary; RC5 golden census prints the real class, gains the same guard and a defect
  "a subsidiary class the table does not list"; placard census gains §172.505(b) over every 4.3-subsidiary
  entry (13) and a segregation invariant over every subsidiary × restricted class (>100 pairs); engine 0.21.0,
  acceptance rule 13; `lint:reader-gate` pins the guard. **Replay of the nine stored reads:** Henkel a4119634
  4 of 4 lines with products (was 2), 0 waiting (was 2), 0 "wrong" (was 2), CORROSIVE + OXIDIZER; the other
  eight unchanged in every status (relaxed 0, tightened 0); PureTech's five "3, 8" lines still refused — that
  is PC2 — and its sentence now reads "where the table says 3 (8)". Needs a release.
- **2026-10-26 — PC2 built (class punctuation, D-PC2).** `parsePrintedClass` in `@hazmat/data` (normalizer 1.5.0)
  reads a printed class however it is punctuated: "3 (8)", "3(8)", "3, (8)" and "Class 3 (Division 8)" are the
  §172.202(a)(3) form; "3, 8", "3/8", "3 8", "CLASS 3, 8" and an unclosed "3 (8" are the same classes without it.
  `resolveHmtLine` resolves all of them — the one reader of the printed class — and records
  `subsidiary_not_in_parentheses` on the unparenthesised ones; a subsidiary the table does not list stays
  `class_mismatch` in every form. `paper_class_pg_match` (engine 0.22.0) answers `class_format` for the right
  classes outside parentheses — the catalogue's sentence quotes §172.202(a)(3) ("must be entered in parentheses")
  and PHMSA 04-0188, and the actor is the shipper's (`actorFor`, the catalogue's first per-reason actor, read
  through `bolFindingActor`) — and `class_or_pg_wrong` with the format in its facts when the PG is wrong beside it.
  Acceptance rule 14. Censuses: RC1 now runs every entry × ten class printings (four parenthesised, five
  unpunctuated, the primary alone) and asserts the finding on exactly the unpunctuated ones; a second census swaps
  and adds a subsidiary no row of the number lists, in five punctuations, on every entry with a subsidiary (>550)
  and expects `class_mismatch` on all; the RC5 golden census gains the defects "a subsidiary class printed after a
  comma, not in parentheses" (class_format) and "… swapped for one no row of the number lists" (class_or_pg_wrong);
  `lint:reader-gate` pins both RC1 titles. Three mutants (the finding never recorded; the comma form read as
  parenthesised; the rule never answering class_format) each failed the tests that own them. **Replay of the nine
  stored reads, PC1 code → PC2 code, same stored inputs:** PureTech f2dc74ed 0 of 5 lines with a product → 5 of 5,
  15 waiting → 10 (the KG-only weight column — PC3), 5 "wrong" (class_or_pg_wrong, driver) → 5 format findings
  (class_format, shipper), 32 "check by eye" → 32 (Q-PC3), placards not computable → FLAMMABLE; the other eight
  reads identical in every count and status (Henkel's "8(6.1)" and "5.1(8)" are the parenthesised form and carry
  no finding); relaxed 0. Not built: the omitted-subsidiary rule — the engine derives no §172.402 label requirement,
  so it is Q-PC6 rather than a guess. Needs a release with PC1.
