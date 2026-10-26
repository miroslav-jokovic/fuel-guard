# BOL reader — works every time (correctness programme)

Owner, 2026-10-19, after the seven-line corrosives BOL (#1607): *"this is just one case — we need to make
the system work properly, not fix this one case. It should work without issues every time."*

This plan answers that as a system: what "every time" means, which layer can break it, and the test
that proves each layer over every case it can meet — not the cases somebody happened to upload. It sits
under `DOCUMENT-READER-PLAN.md` (§7B precision by agreement, D-DR19–D-DR25 stand) and replaces its
step A6 ("score it all on a labelled corpus") with the concrete steps below.

---

## 1. What "every time" means — two promises, measured apart

**Promise 1 — never silently wrong.** No value reaches the placard calculation unless independent
witnesses agree on it or a person acted on it (D-DR19, D-DR24). This one is engineered to hold on every
BOL: a gate, not a percentage. Its measure is the false-accept count on the critical fields (UN/NA id,
class, PG, gross weight, package count, RQ / marine-pollutant marks), and the only acceptable number is 0.

**Promise 2 — no needless stops.** A legible, correctly printed BOL fills every line with nothing to
check. This is yield, it is measured per field, and it climbs; it can never be bought with Promise 1.

A misprinted or illegible paper that stops and asks is the system *working*. What the owner hit on
2026-10-19 was the other thing: a correct paper that stopped (Promise 2), for reasons in our code.

## 2. Measured, 2026-10-19

- **The three failures of 2026-10-19 were all deterministic code**, not model misreads: the name
  matcher's plural fold, the bare-number rule, and the form's equipment reset (#1607). The fourth — UN3264
  read as UN3254 by one reader becoming two products — is a model misread *turned into* a wrong result by
  deterministic pairing (`alignLines.ts` pairs lines on the id's digits).
- **Table census** (every entry of dataset 2026.07.x × every printing §172.101(c) allows: as printed,
  upper case, singular, `RQ,` prefix, spaced id, technical name on G entries, bare number): **2,479
  entries, ≈21,700 printings, 0 wrong picks; 33 printings of ≈10 numbers refused even when printed
  exactly** — UN1950 Aerosols, UN1005 Ammonia anhydrous, UN3318, UN2790, UN1197, UN3412, UN1790, UN1796,
  UN2031, UN2037. Each has several table rows under one name, told apart by italic qualifiers the paper
  does not print; the printed class or PG is what tells them apart, and the resolver collapses before
  it looks at either. 12 of 130 bare numbers whose UN and NA rows carry the SAME name are refused — that
  refusal is correct (the paper cannot say which).
- **Production holds 7 finished reads** (2026-10-12…19) and **0 labelled documents.** Samsara held ≈490
  BOL submissions in 30 days when measured on 2026-10-08. Every failure so far was found by the owner by
  hand, one BOL at a time — the system has no way to find them itself.
- **A read stores pass A's document whole, pass B's only as the values aligned to it** (`document_reads.result`
  holds one document; `evidence` the per-path sources). So a pairing or witness change cannot be re-run
  over past reads: each fix is checked only on the BOL that exposed it.

## 3. The layers, and the test that covers each one completely

| Layer | Kind | How it can break a promise | The complete test (step) |
|---|---|---|---|
| Table matching (`resolveHmtLine`) | code | correct name refused; wrong entry picked | census over the whole table, in CI (RC1) |
| Pairing the two readers' lines | code | a one-character misread splits one line into two, doubling weight | injected-misread property test (RC3) |
| Evidence / witnesses / acceptance | code | a disagreement not shown; a stale verdict replayed | replay of every stored read (RC2) |
| Form prefill | code | a read's value lost or altered without a person | action-sequence property test (RC4) |
| Paper audit rules | code | correct paper called wrong; wrong paper called right | golden BOL per table entry + single-defect mutants (RC5) |
| The model readers | model | misread | synthetic BOLs of known truth (RC6), labelled real BOLs (RC7) |

The code layers can be proven over *every* input they can meet, because their inputs are enumerable
(the table) or generatable (misreads, form actions, defects). Only the model layer needs samples — and
even there, synthetic pages give a known answer without a person labelling.

## 4. Decisions

**D-RC1 — every layer is tested over its whole input space, not over the BOLs that exposed a bug.** A
fix for one BOL ships with the census, property or replay test that would have found it on every BOL; a
fix with only a single-case test is not done.

**D-RC2 — a read keeps everything needed to judge it again.** Both readers' documents, the OCR / text
layer rows, and the versions that judged them. Any change to a code layer is replayed over every stored
read and the whole corpus before it merges, and the diff (fields that changed state, lines that changed
product, findings that appeared or went) is in the PR.

**D-RC3 — the merge gate is Promise 1.** A PR touching the reader, the table matching, the evidence, the
prefill or the audit does not merge if the false-accept count on any critical field moves off 0 on the
census, the property tests, the replay or the synthetic set. Yield is reported, never traded for it.

**D-RC4 — narrowing by class or PG never removes the table as a witness silently.** Where several rows
share a name (§2), the printed class / PG may pick the row, but the class field is then backed by the
readers alone, not by the table: it stays *Check* unless both readers agree on it (ammonia printed 2.2
but read as 2.3 is a different placard).

## 5. Build order

| Step | What | Owner input | Done when |
|---|---|---|---|
| **RC1** | Table census as a permanent test (`resolveLine.census.test.ts`): every entry × every legal printing resolves to itself, never to another entry; narrow same-name rows by printed class, then PG, before refusing (D-RC4) | answered (Q-RC3) — **built 2026-10-19** | 0 wrong, 0 refused except the same-name UN/NA bare numbers |
| **RC2** | Store both readers' documents and the OCR rows on the read (migration, then writer in a second merge — `lint:migration-ordering`); `doc:replay` re-runs pairing → evidence → table → audit → prefill over stored reads and the corpus and prints the diff | — | replay of the 7 production reads + 10 office BOLs is reproducible and runs in CI on the fixtures |
| **RC3** | Pair lines by position and content (order on the page, description, count, weight), with the id one signal of several; an id the readers split on is a *disputed id on one line*. Property test: every corpus line × a one-character misread in each field → never two products, always a disputed field | — | the UN3264/UN3254 case and every generated one yield one line |
| **RC4** | Form invariant: a read's value changes only by a person's act. Property test over random sequences of equipment, trailer, add/remove line, reset, re-read | — | no sequence alters or drops a read's value |
| **RC5** | Golden BOLs: a correctly printed description for every table entry passes every description rule; each single defect (no prefix, wrong PG, missing technical name on G, missing RQ…) fails exactly its rule | — | 0 false "wrong", 0 missed defect |
| **RC6** | Synthetic rendered BOLs of known truth — real BOL layouts, fax 1-bit, photo skew, glare, stamps — read by the production readers and scored per field | spend (Q-RC2) | per-field false-accept and yield table, re-run on every reader change |
| **RC7** | Labelled real BOLs from Samsara + office, scored the same way; grows with every explicit review (D-DR24) | answered (Q-RC1) | ≈600 per critical field for a 0.5 % bound, ≈3,000 for 0.1 % (D-DR24 arithmetic); labels = dispatchers', Safety's and Admin's explicit reviews (Q-RC1) |
| **RC8** | The merge gate (D-RC3) in CI over RC1–RC6 | — | a PR that moves false-accept off 0 fails `build` |

RC1's census, RC2–RC5 and RC8 need nothing from the owner and come first: they cover the layers every
failure so far came from. RC1's narrowing waits on Q-RC3; RC6 on Q-RC2.

## 6. Open questions

**Q-RC1 — Who labels real BOLs, and how many first?** *(a)* the office labels 200 Samsara BOLs in the
calculator's review screen, ≈3 min each, ≈10 hours, then explicit reviews keep growing it; *(b)* rely on
explicit reviews alone (7 reads in a week today — months to 600); *(c)* an outside labelling service
(shipper and consignee data leave the company). **Recommendation: (a)**, and synthetic pages (RC6) carry
the measurement until it lands.

**Q-RC1 ANSWERED 2026-10-19 (owner): dispatchers and Safety check the BOLs — and, for now, Admin.** The labels
come from their daily work: every explicit act on the calculator (D-DR24 — a tick, a picked reading, a change)
is a labelled field. Owed with RC7: confirm those three roles can open the calculator and post reviews, and
count explicit reviews per critical field toward the ≈600 / ≈3,000 bounds; synthetic pages (RC6) carry the
measurement until the counts reach them.

**Q-RC2 — May RC6 spend model money?** ≈$0.03–0.05 per page per dual read (§8 prices): 1,000 synthetic
pages ≈ $30–50 a run, re-run on reader changes only. **Recommendation: yes, capped at $50 a run.** *Answered 2026-10-19 (owner): yes, as recommended.*

**Q-RC3 — Same-name rows (§2): narrow by class/PG under D-RC4, or keep refusing?** Refusing keeps the
table as a class witness on ≈10 numbers but stops every correct aerosol and anhydrous-ammonia BOL.
**Recommendation: narrow, under D-RC4.** *Answered 2026-10-19 (owner): narrow — built in RC1.*

**Q-RC4 — Should a read be judged again when it is opened?** (Found building RC2.) The audit already is (view
time, today's code); the evidence — the table verdict that picks the calculator's product, the agreement that
gates Calculate — is fixed when the read finished. *(a)* judge at view time from `replay_inputs` (an old read always
shows today's verdict; Calculate's review rows record which rule they were judged under); *(b)* keep the stored
judgement and offer "Read again" (a model call); *(c)* as today. **Recommendation: (a)** for reads with replay
inputs — a fix reaches every open BOL at once, and the audit and the product match can never disagree again.

**Q-RC5 — Should the audit take what a person confirmed on the form?** (Found 2026-10-19, read 76979453.) Today
the audit is computed from the two readers' evidence only; a person's "Matches the page", picked reading or change
(D-DR24) reaches `document_read_reviews` only when Calculate is pressed, and the audit never reads it. So a line
whose number the readers split keeps "confirm the number first" after the person confirmed it. *(a)* the form
posts each act as it happens and the audit is re-judged with confirmed values as *Read* (and a changed value
replacing the printed one); *(b)* the audit re-runs after Calculate only; *(c)* as today. **Recommendation: (a)** —
the paper's answer then follows the person's checks, and it reuses the review rows D-DR24 already records. *Answered 2026-10-21 (owner): (a), as recommended.*

## 7. Progress log

- **2026-10-19 — plan written.** #1607 merged first (plural fold, bare number, equipment reset). Census,
  production read count and storage findings in §2 measured the same day.
- **2026-10-19 — owner: "proceed as proposed" — Q-RC2 answered (yes, ≤ $50 a run) and Q-RC3 answered (narrow, under
  D-RC4).** **RC1 built.** `resolveLine.census.test.ts` runs every entry × every legal printing (as printed, upper
  case, `RQ,`, spaced id, NOS, singular, technical name on G entries, bare number): 0 wrong, 0 refused; it fails on
  the last-word plural fold #1607 fixed, so it would have found that bug before a BOL did. Same-name rows are picked
  by the printed class, then a row's own name over an alternate (UN2037 "Gas cartridges"), then the PG; a pick says
  so (`row_chosen_by_class` / `_by_pg`, normalizer 1.2.0, acceptance rule 9). **Found by the census and fixed in the
  same PR — a placard defect, not a reader one:** 81 entry ids hold a "#" (`UN1950-aerosols#2`) and every engine
  and dataset reader split the ref at the FIRST "#", so the engine looked up the sibling row: UN1950 Division 2.1
  (flammable aerosols) was placarded NON-FLAMMABLE GAS, and 12 such rows land on a different class or PG. It hit
  any product picked by hand in the calculator, not only reads. Now `parseHmtRef` (last "#") in @hazmat/engine and
  @hazmat/data (D3 keeps them apart), engine 0.16.1, and `@hazmat/golden`'s ref census proves every such row gives
  the same verdict, BOL description and permit/plan answer as a control dataset with the "#" spelled out —
  4 of 6 call sites mutated back fail it; the other two are no-ops on the shipped table (no class-1 "#" entry; the
  one two-PG "#" entry has equal column 8A) and are pinned by unit tests instead.
- **2026-10-19 — RC2 built.** 0487 (#1614, applied on staging) gives `document_reads` a `replay_inputs` column
  through the one transition; the writer (#1615) stores `{ passB, ocr, textLayer }` exactly as the witnesses were
  handed them (the text layer kept as judged — its page set and turn hang on page verdicts a person may change).
  `replayRead` (`read/replay.ts`, pure) re-runs pairing → table → row/arithmetic witnesses → acceptance → audit over
  them and returns the fields and findings that moved; `doc:replay -- --org <uuid>` prints it per read with a
  one-line summary, including `relaxed` — fields that stopped asking a person, the direction a PR must explain
  (D-RC3). **Found while building it:** the audit is not stored — `requests.ts` runs it at view time with the code
  of the day — while the table verdict the calculator's product comes from IS stored. So an old read shows today's
  audit beside yesterday's product match, which is why the owner's re-opened BOL still had no product while its
  audit had moved. Re-judging stored evidence at view time is a design question for RC2's follow-up, recorded as
  Q-RC4. The 7 reads before the writer cannot be replayed (no pass B kept); every read from the writer on can.
- **2026-10-19 — RC3 built.** `alignLines` pairs in the paper's order first (an LCS over the id keys, ties to the
  pairing whose name, count and weight agree most), then by id for a reader that listed two lines the other way,
  then pairs a leftover line with the ONE leftover of the other reader in the same stretch of the paper whose id
  is one misread apart (one digit, a swapped pair, or no id) and whose name, count or weight agrees (two of them
  without an id). `alignLines.property.test.ts`: the owner's seven lines plus 300 seeded papers from the whole
  table, every one-character misread of id, name, count and weight by the second reader (> 30,000 cases) → every
  line stays one line paired with itself; a dropped line leaves only itself unpaired; 2,000 pairs of different
  products read alone are never paired. The old pairing fails all three. The table now also judges pass B's
  reading of a line the readers read differently (`passB` on its verdict), and the calculator fills the reading
  that fits the printed name and class, still waiting on a person ("Check the number on the page."). Rule 10.
- **2026-10-19 — the owner re-read the corrosives BOL in production (v2026.10.19.1, read 76979453, the first read with
  replay inputs) and three faults were left; each fixed for every case, not this one, and the read replayed.**
  (1) **The audit judged against a row the readers had not agreed on.** Pass A read UN3254, pass B UN3264 (the
  paper's number); RC3 paired them as one line with the id disputed, but `paper_psn_matches_hmt`, gated on the
  name alone, told the shipper the name was wrong for UN3254 ("Tributylphosphane"). Seven of ten line rules use the
  row and leave its fields out of their own gates, so the gate is now central (`heldToItsRow`): any rule that reads
  the resolution while id, name, class or PG is unconfirmed answers "confirm it first". `paperRowGate.test.ts` is
  metamorphic — a rule whose answer changes with the row must wait — and fails with the gate removed.
  (2) **Formatting read as disagreement.** "CORROSIVE LIQUID , N.O.S." against "CORROSIVE LIQUID, N.O.S." (and the
  same in two descriptions, and three addresses broken across lines) stopped three lines of the audit.
  `normalisedForAgreement` now folds spacing around punctuation and a line break for ", ";
  `agreement.property.test.ts` holds, over every name in the table, that formatting always agrees and every
  one-character change never does. (3) **"The BOL gives the amount by volume"** on a line that prints only a gross
  weight: no unit is not a volume (`package_quantity_unknown` now). **Replayed:** 18 → 11 disagreements, all real
  (the id, certification A missed, page marker "2" vs "Page 2 of 2", pallets, a customer reference, four non-hazmat
  counts pass A shifted by a row); the false "wrong name" is gone and a real one appears that the noise hid — both
  bare "1760" lines lack the "UN" (§172.202(a)(1)). **Left, a design gap, Q-RC5:** the audit is computed from the
  readers alone, so after a person confirms UN3264 on the form it still says "confirm the number first".
- **2026-10-19 — the owner's Mayo Products BOL 14182 (read 350d2f27; 8 totes UN1824 caustic soda 50 %, 2 totes
  UN1830 sulfuric acid 93 %, 3 totes non-regulated flocculant, dry van).** The reading was right: both readers
  read both lines, counts, weights, class, PG and the CHEMTREC number the same, and the table agreed. Three faults
  sat downstream of it, plus three stops the reader caused.
  (1) **Placards — the answer the driver hangs lost UN1830.** Both totes are bulk, so §172.331(c) puts both numbers
  on each side and each end; the engine gave every number every required placard and the panel drew the first.
  Fixed #1639 (engine 0.17.0): a number rides only its own class's placard (§172.332(c)), one placard per number
  when the numbers cover the class (§172.334(d), PHMSA Interp. 16-0026), else an orange panel beside it.
  `idCarriers.test.ts` holds three CFR invariants over all 8,420 loads of up to three lines.
  (2) **A false PASS on RQ.** Appendix A was matched to the HMT name exactly, so "Sodium hydroxide solution" read as
  not listed (each tote holds ≈1,800 lb NaOH against a 1,000 lb RQ); "Ammonia, anhydrous" and "Acrolein,
  stabilized" likewise. Fixed (engine 0.18.0, `hazSubstanceMatch.ts`, census in hazmat-golden): +52 neat, +37
  solution entries. The replayed read now answers "can't tell", not "pass".
  (3) **Still open — the reader, needless stops (P2), in the order to build them:**
  - **R-M1 the per-line NET WEIGHT column is not read as the line's quantity.** The paper prints 28,800 and
    6,500 lb net; both readers left `quantity` null, so RQ cannot be judged. Worked by hand from the printed
    figures, the paper owes "RQ" on BOTH lines and prints it on neither: UN1830 3,250 lb net per tote at 93 % ≈
    3,020 lb sulfuric acid, UN1824 3,600 lb at 50 % = 1,800 lb sodium hydroxide, each against a 1,000 lb RQ.
    Judging the solution needs the concentration the description prints ("50%", "93%") — R-M1 reads it too. Profile field
    description + the arithmetic witness (net column ↔ freight.netWeight 42,425) as its row backing.
  - **R-M2 cell extent read as disagreement.** Pass A carried the description cell's trailing commercial text
    ("CAUSTIC SODA 50% 3600# TOTE") and the packaging cell's item-code line ("FG00035-3600T"); pass B stopped at
    the basic description. Same facts, different cell boundaries — and every rule gated on `descriptionText` or
    `packaging` stopped (sequence, technical name, LQ, marine pollutant, quantity, package count: 12 of 13 stops).
    Agreement for these two fields should hold when one reading is the other's prefix at a field boundary
    and the parsed facts (id, name, class, PG / count, type) agree — a property test over every table name, as
    `agreement.property.test.ts` does for formatting.
  - **R-M3 certification null from one reader.** Pass B returned null for a printed, signed certification; one
    reader abstaining should be backed by the OCR row witness (the statement's words are on the page) rather
    than stop the rule.
- **2026-10-20 — R-M2 built: a cell one reader read further no longer reads as a disagreement.** Measured first, over
  the four production reads with replay inputs (76979453 and f1b91bba, the corrosives BOL; e6dfc064 and 350d2f27,
  Mayo): 384 fields, 329 agreed, 55 disagreed; the audit 98 pass, 4 fail, 70 "confirm it first". Of the 55: 14 cell extent (Mayo's descriptions, packaging and — on e6dfc064 — `marks`, 10; consignee name and address, 4), 24 one reader returning null where the other read (certification ×4, pallets, delivery date and signature, pieces, weight unit, per-package weight, customer reference, non-hazmat counts), 1 formatting (page markers, already folded by the audit), 16 real misreads (UN3254/UN3264 and its description, page number, the PO, the CCN number, customer references, non-hazmat counts and a description). Two readings of a description, packaging or marks cell now agree when one is the
  other plus a tail at a field boundary holding no token any §172.202/§172.203 element is spelled with
  (`readingExtent.ts` in shared, so the screen and the audit agree; packaging also keeps its count and type), and
  the audit judges such a cell under BOTH readings and refuses only the rule whose answer moves — the guard for a
  tail no word list foresees (an EPA waste code standing for a technical name, §172.203(k)(2)(i)).
  `readingExtent.property.test.ts`: every table entry × five commercial tails agrees; × 31 regulated tails, and
  every word-boundary prefix of the basic description, never does (it found "LTDQTY", which the engine reads as
  Limited Quantity, and the 1.3J / 1.4S compatibility groups — both now held). Five mutants (no token check, no
  boundary, no both-readings guard, text comparison, no packaging facts) each fail it or `paperAudit.test.ts`.
  **Replayed:** 55 → 45 disagreements; the audit 118 pass, 4 fail, 50 "confirm it first"; Mayo 350d2f27 15 → 5
  stops — every one of its ten new passes checked against the photo (sequence, technical name not required, no
  LQ, no marine pollutant, package count, both lines); the corrosives reads unchanged; false-accept 0. Left on
  Mayo: RQ ×2 and quantity ×2 (R-M1), certification (R-M3). **Found while measuring:** the OCR read neither line's
  anchor ("UN124", "XUN1830"), so no row witness judged a Mayo line; and it returned NO word of the printed,
  signed §172.204 certification block on any of the four reads — R-M3's OCR witness has nothing to find on them.
  Also "8 3600LBTOTE" reads as no package type (`packageTypeFromPrinted` needs a word boundary before TOTE).
- **2026-10-20 — R-M1 built (profile 1.5.0, engine 0.20.0): RQ is judged from the net weight column and the printed
  concentration.** The handoff's first idea — tell `quantity` that a net column counts — is the wording the
  2026-10-11 measurement rejected (the readers split on copying a weight column into `quantity` on 6 of 10 papers),
  so the net column became a field of its own, `netWeightLb`. The lines section is at 15 of the 16 unions the API
  accepts, so it took the slot of `perPackageWeightLb`: no consumer of a read used it (the vision extractor, which
  does, keeps it in its own line schema, `bolFields.ts`), and on Mayo the readers split on it. `descriptionText` now
  runs to the end of the description cell, where a shipper prints "CAUSTIC SODA 50%" — R-M2 makes a reader that
  stops earlier agree by its facts, and its both-readings guard is what keeps a percentage only ONE reader copied
  from deciding RQ (the rule's answer moves with it, so it waits: `paperAudit.test.ts`). `paper_rq`: contents
  (description quantity, else net ÷ count) × the printed share (a neat name is all substance unless a share is
  printed) at or over the RQ fails; under it by a printed percentage waits (§171.8 is by weight, a paper's "%"
  does not say); a package whose whole gross is under the RQ clears. The arithmetic witness checks the net column
  against the printed NET: two-sided when every loaded row is hazmat, an upper bound only on a mixed paper (the
  freight rows have no net field), never a pick there. `rqCensus.test.ts` (hazmat-golden) over every HMT row
  Appendix A reaches × seven amounts × RQ printed or not: 0 false passes, 0 false fails, 0 missed; five engine
  mutants and three witness mutants each fail a test. **Replayed** (the four stored reads were read under 1.4.0, so
  they carry no net column): 50 → 46 "confirm it first" — the corrosives BOL's UN1760 and UN3266 lines, boxes of
  50 and 58 lb gross against 5,000 and 1,000 lb RQs, now clear; false-accept 0. Mayo's RQ answers need a re-read
  under 1.5.0, which costs a model call and writes a production row: **waits on the owner's OK** — by the tests,
  both lines then fail RQ (1,800 lb sodium hydroxide, 3,022.5 lb sulfuric acid per tote).
- **2026-10-20 — R-M3 built: one reader abstaining on the certification is settled by the page's own words.**
  `certificationWitness.ts`: the OCR (or text layer) backs "present" where a page prints every word of one of
  §172.204(a)'s two statements (certify/declare, classified, described, packaged, marked, labeled) within 60 words
  in reading order; it records nothing otherwise, so it can never say "absent". The audit takes it only when one
  reader read the statement as present and the other returned null — never against a reader that read it absent.
  `certificationWitness.test.ts`: both statements × every wrap of 3–12 words a line × three cases, beside the
  consignor boilerplate, are found; every statement missing one of its key words, spread across the page, or the
  boilerplate alone is not; five mutants (accept against "absent", no witness needed, five of six words, no window,
  audit document not set) each fail it. **Replayed: no change — measured before building:** the OCR returned no
  word of the small-print certification block on any of the four stored reads (Mayo prints it under a
  handwritten date and signature), so `paper_certification` still waits on Mayo and the corrosives BOL. What would
  move it there is better OCR of that region (a crop re-read, plan Phase 5), not a looser witness.
- **2026-10-20 — First read under profile 1.5.0 (5f7a6c5c, Mayo BOL 14182, owner's re-read), and the packaging cell fixed.** RQ answered as R-M1 predicted: both lines fail `rq_not_printed` (1,800 lb sodium hydroxide, 3,022.5 lb sulfuric acid per tote). Seven stops remained, six on the packaging cell, from two causes. (1) The paper prints its item code `8 3600LBTOTE FG00035-3600T` and `packageTypeFromPrinted` needed a word boundary before TOTE, so the line read as no package type and the calculator prefill asked "choose one". It now splits a FULL package word glued to a capacity (a digit and an optional lb/kg/gal/l unit) before reading; short codes ("55GALDR") and words glued to letters ("SUITCASE") are not split. The package words are one table (`PRINTED_PACKAGE_WORDS`) and the glued words derive from it — the first, hand-copied list missed hopper and pneumatic, and the whole-table test found it. (2) Pass B copied the cell as `3600LBTOTE`, without the count pass A printed. The extent rule now lets a count-less packaging reading agree past the other's count, with the same package type and a commercial tail only; the count is read in `packageCount`, and where it is not, `paper_package_count` moves between the readings and the both-readings guard stops it (`paperAudit.test.ts`). Tests: every full package word × singular/plural × seven units × three casings reads glued as spaced; every table word × three cells × three counts agrees count-less and never with a regulated tail, another count or another type. Nine mutants, all caught; one more (no boundary after the glued word) was a no-op, since the reading regex keeps its own boundary, and the redundant code was removed. **Replayed:** 5f7a6c5c 7 → 1 stop (certification only, which needs the crop re-read, Phase 5); the four older reads 46 → 42; fails unchanged; false-accept 0. Why not a directive to the readers instead: both readers copied the cell to the letter, which is what the profile asks and what agreement rests on. Telling a model to rewrite "3600LBTOTE" as "3600 LB TOTE" would make it paraphrase a field two readers must copy alike, and a prompt cannot be tested over the whole space offline; the reading of what was copied can.
- **2026-10-20 — Would a better normalisation layer stop the reader's misreads? Measured: half the remaining stops are pixel-limited, and the pixels are lost before the upload.** Owner's question. The five production reads with replay inputs hold 43 "confirm it first" stops: 21 pixel-limited (16 from ONE digit, UN3264 read as UN3254 on the Sonny's corrosives page, 8 on each copy of the read; 5 certifications); 16 the paper's own silence (weight-only lines, mixtures without a share — no image fixes those); 4 the 1.4.0 profile (gone on a 1.5.0 read); 2 page-marker interpretation. Every one of the 22 stored production pages is an office UPLOAD, a JPEG at most 2,048 px long (1536×2048, 1200×1600: about 3 MP — a phone's 12 MP frame shrunk by the messaging or mail path before anybody uploaded it; our upload resizes nothing). The model already reads all of it: a 1536×2048 page is 4,015 visual tokens, inside the high tier's 4,784, so no server-side preparation can give it a pixel the photo does not hold, and the plan's own research rules out the ones that pretend to (R4 upscaling, R8 binarisation/sharpening, R11 generative restoration — a digit like 3264/3254 is exactly what an upscaler decides). OCR-witness experiment, offline, production PP-OCRv6 models on the real pages: the library's `maxSideLength: "auto"` detects at 75 % of the page (min(1920, max(960, 0.75 × long edge))); detecting at full size changes nothing; a 2× Lanczos enlargement for the OCR alone finds 11 of 17 checked Mayo values instead of 8 (UN1824 and both weights), at ~3× the time (11 s a page); greyscale+normalise adds nothing; on the Sonny's page no variant finds any UN number (0 of 9), and on Mayo no variant — straightened, padded, cropped and enlarged 3× — finds the certification statement a person reads plainly. **What would move the 21:** full-resolution originals. The driver app's capture shrinks a 12 MP frame to 1,568 px lossy WebP q80 (`capture-engine` `modelFacing`) — the copy `canonical.ts` argues against for 7-pt type — so it would arrive worse than today's uploads; sending the camera's original and letting the server prepare it is the first step, and Phase 5's crop re-read pays only on top of it (a crop of a 3 MP photo holds no more pixels than the page the model already sees). Candidate answers in Q-RC6.
- **Q-RC6 — Where do full-resolution BOL photos come from?** (a) The driver app sends the camera's original (JPEG/HEIC, metadata stripped on the phone as today) and the server's D-DR13 stage does all preparation — recommended; needs a driver build through the release lanes. (b) Office guidance: upload the original file (AirDrop / "actual size" mail), not a texted copy — free, today, unenforceable. (c) Accept 3 MP and build Phase 5 crops anyway — measured above to add nothing at this resolution. Then, on full-resolution pages, measure the 2× OCR witness and the table crop on the labelled corpus before either ships.
- **2026-10-20 — CORRECTION to the entry above: the pixels were enough; the geometry was not.** Owner proposed paper-edge detection and straightening. Spike, offline, on the two stored pages, with the opencv.js already installed under `ppu-ocv` (so Q-DR21's install question is answered) and the production PP-OCRv6 witness. (1) **Rectify (P3):** Otsu threshold on a 640 px copy, largest 4-corner convex hull over 20 % of the frame (else no crop), one `warpPerspective` from the original at the paper's own edge lengths (no enlargement). Both pages found a confident quad (paper 67 % and 77 % of the frame). Mayo: OCR 8 → **15 of 17** checked values (UN1824, both weights, the CHEMTREC phone, most of the certification). Sonny's: 1 → 2 of 13. (2) **Level:** Sonny's printed table sits ~2° off its own paper. Turning it −2° took the OCR to **13 of 13 — UN3264 among them**, the digit the readers split on (16 of the 43 stops); on the original photo levelling alone also gives 13/13. So the OCR fails on tilted text lines, not on 7 px type, and "pixel-limited" above was wrong for these pages. (3) **The tilt must be measured, and the measure is not yet good enough:** `DeskewService.calculateSkewAngle` measures Sonny's at 1.77–1.93° (right), but the flattened Mayo at 0.71°, where turning it costs 15 → 12 — the signature and handwriting pull the estimate. Each page needs a different fix (Mayo perspective, Sonny's level), so the pipeline is rectify → measure → level, with the measure judged on the 196-photo corpus, not two pages. What NOT to do stands (R4/R8/R11): no whitening, binarising, sharpening or AI upscaling — the gain here came from geometry alone. **Next (no model spend):** build P3 + level as the OCR witness's view only — the witness only ever BACKS a reader's value, so a better witness can clear stops but never accept a value no reader read (P1); measure OCR-backed fields over every stored page, original vs prepared, false-backs counted against the readers' agreed values. Only then the model's view, which needs paid re-reads (owner OK). Q-RC6 stays for the driver app later; the SMS / Google Voice / Samsara photos of today are what this step is for.
- **2026-10-20 — The OCR witness reads a prepared view of each photographed page (owner's go on the rectify spike).** `ocr/prepareOcrView.ts`, in the engine thread: find the paper (Otsu outline, four corners, 20–97 % of the frame), flatten it at its own edge lengths, measure the printed-line angle from long straight lines on the flattened paper (the median of at least 8 segments, 60 % of them within 0.75° of it), level it — one resample from the original, never enlarged, whitened, binarised or sharpened. **Every view checks itself:** its lines must come out level and agreeing, else it is thrown away, and the next candidate tried — flattened and levelled, then levelled only, then the page as it is. The boxes are judged in the view and reported through `toPage` (`evidence/pageGeometry.ts` `pageBox`) onto the upright page the reviewer sees. `DOC_OCR_PREPARE=off` reads every page as before. The model readers' copy is unchanged; the witness only ever backs a value a reader read (P1). **Two faults found by measuring and fixed before shipping:** (1) the first build flattened 122 of the 196 corpus photos and LOST UN numbers on 8 — a page lying against a second white sheet makes one bright blob with a four-cornered outline that is not the page (60974485 page 7); the self-check rejects such a view (64 synthetic two-sheet photos: the unchecked build made 8 crooked views, this one none). (2) Once the engine could find Mayo's UN1824 row, its 8 totes — on a class 8 line, whose printed "8" the row cannot tell from the count — were recorded as "not shown" and four rules stopped; the row witness now ABSTAINS when every reading is a token of the line's own class (`rowCanJudge`), so the field rests on the readers as before A5; a provable reading is backed or refused as before. **Measured, final build:** corpus, 196 photos, PP-OCRv6 — view made on 27, left alone on 169, 0 errors; valid UN/NA numbers read 41 → 44, numbers not in the table 2 → 1, **0 pages losing a number**; preparation 447 ms median (p90 855 ms), OCR 2.9 → 3.4 s a page. The two production photos: Mayo 8 → 15 of 17 checked values, Sonny's 1 → 13 of 13 (UN3264 included). Replay of the five production reads with the witness re-run: 43 stops → 43, false-accept 0 — **this step adds no stop and clears none yet**, because the stops the better OCR could clear are on IDENTIFYING fields (UN3264 vs UN3254, 16 stops), which the row witness never judges by design ("identifying fields stay with the table and the readers"). Tests: `prepareOcrView.test.ts` (a ruled page at 9 turns × 3 perspectives × 2 scales on a dark surface — level, and a mark carried back to within 0.6 % of the photo; a page printed crooked on paper filling the frame at 7 angles; a straight page, a blank frame and a signed page left alone; the 64 two-sheet photos), `pageOcr.test.ts`, `rowWitness.test.ts`, `shippingEvidence.test.ts`; 11 mutants each fail a test (a twelfth, the fill check, survived because the self-check already covers it — it was removed, not kept untested). Next: Q-RC7.
- **Q-RC7 — May the OCR witness back a line's UN number?** The prepared view now reads Sonny's UN3264, the digit the two readers split on (16 of the 43 stops). Today identifying fields are judged only by the readers and the table; the table already says pass A's UN3254 (Tributylphosphane, 4.2) does not fit the printed name and class, while pass B's UN3264 does. (a) **Recommended:** the witness may settle a split UN number only when the OCR shows exactly one of the two readers' numbers on the line's printed row, AND that one is the reading the table finds consistent with the name, class and PG both readers agreed on — three independent sources, never a value no reader read. Needs a whole-table test: every HMT entry × every one-digit neighbour that is also an entry. (b) Leave identifying fields to a person (today).
- **2026-10-21 — RC4 built: a value a read put on the calculator changes only by a person's act.** `HazmatCalculatorForm.sequence.test.ts` drives the real form through 320 seeded sequences of 14 acts, on the public and the fleet calculator: the equipment, a fleet trailer and the tab between the two, add and remove a line, type a count or weight, pick or clear a product, change the package type, tick Limited Quantity, pick a reading, confirm a field, work down every waiting field, Calculate, Reset, and nine reads (agreeing, disputed count, disputed weight, unmatched, a line only pass B saw, pass B's number the only one the table fits, Limited Quantity beside a pre-printed template line, a line with only a volume, no hazmat line, a lookup that fails). After every act it holds, against a model of the form: each line is the line expected, in order (a read's lines go only by Remove, Reset or the next read; a typed line survives the next read); each field a read filled holds the read's value until a person changes, picks or clears it; a field a person confirmed never asks again, and one nobody touched waits exactly as it did when the read filled it; a Calculate press posts its review to the read whose lines are on the form. A last test fails unless every act and every read ran at least 20 times. **It found two faults on its first run, both fixed:** (1) a re-read whose product lookup failed left the earlier read's lines on the form — as designed, "changes nothing" — but had already wiped every confirmation on them, so the person had to confirm each field again; (2) the next Calculate then posted those lines' review under the FAILED read's id, against paths of a document the values did not come from — a review row recorded on the wrong read, which would corrupt the explicit-review labels RC7 counts. The acts are now reset only when the lines are replaced, and the review goes to `filledFrom`, the read that filled the lines. **Mutants, 11, each caught by this test alone:** both bugs; the 2026-10-19 equipment reset as shipped (`untouched` = no product yet) and with its prefill guard removed; the 2026-10-19 deep-ref confirm bug (#1631); a re-read and a no-hazmat read keeping the earlier read's lines; a trailer reshaping every line; a picked reading or a confirm landing on the first line; a failed lookup clearing the lines. 18 s for the file.
- **2026-10-21 — RC5 built: the paper audit over a golden paper for every table row.** `paperGoldenCensus.test.ts` (hazmat-golden) prints every HMT row as a correct paper prints it — prefixed id, the row's own name, class with subsidiaries, PG, in §172.202(b)'s order; two technical names on a G entry; "RQ" where the package holds the RQ; "MARINE POLLUTANT" on a bulk Appendix B material; quantity with its unit, count and type — once in two drums and once in a cargo tank, runs it through the real `resolveHmtLine` and `auditPrintedPaper`, then breaks it one defect at a time (19 defects: bare id, a PG no row of the number has, PG left off, another class, name before the id, a lot number inside the description, no quantity, no unit, no count, no type, a name the table does not give the number, G entry without its technical name, RQ left off, MARINE POLLUTANT left off, LQ where 8A allows none, LQ before the description, no emergency number, no certification, a missing page). It runs on the dataset production reads under (2026.07.1) and on the newest cut (2026.12.0, which carries column 8A and the chemical-group flag): 3,001 rows, ≈80,000 audits, 34 s. What holds: the golden paper passes every rule on every row, but for one pinned wait; each defect fails its own rule with its own reason, and no other rule says "wrong"; no defect passes its rule unless the regulation excepts that material (§172.604(d)'s list for the phone, §172.203(k)(2)(ii) for samples), and where only facts off the paper decide (a G name that names its chemical group, a solution's concentration, a dataset without the column) the rule waits — never passes. **What it found, all fixed:** (1) **a correct paper called wrong** — "Samples, explosive" (UN0190) carries no class in the table (§173.56 assigns the division with the approval), and the matcher refused every printed division as `class_mismatch`, so the class rule failed the paper and the calculator could fill no product. The matcher now takes a Class 1 division for that entry (normalizer 1.3.0, acceptance rule 11 — a re-read of an already-read page set calls the readers again, as on every rule bump), and the class rule waits (`class_not_in_table`) rather than judge which division the approval gave — while a class outside Class 1 is still wrong. (2) **a needless stop on every UN2910 paper** — its name, "Radioactive material, excepted package-limited quantity of material", read as a Limited Quantity claim; only the words printed beside the row's own name are a claim now. **Left, recorded here:** the calculator's prefill (`bolPrefill.ts` `lqOf`) reads the same name the same way and ticks Limited Quantity on a UN2910 line both readers read; no placard moves (Class 7 excepted packages need none either way), but the tick is wrong — the next prefill change strips the product's own name before reading the words. (3) **a missed defect on rows that share a name** — UN2790 "Acetic acid solution" (PG II and PG III rows), UN1197, the four UN1950 "Aerosols": a PG or class that fits none of them could not pick a row, so the rule said "can't tell" for a paper that is wrong whichever row it means. The class and sequence rules now judge against every row the name fits (`sameNameRows`) and fail only when all of them say so; they never pass on them. (4) **two look-alike rows that differ in column 8A** — UN1738 "Benzyl chloride" is two rows of the 2026.12.0 cut, the same on paper, one excepting under §173.153 and one excepting nothing; the matcher names the first, so a correct LQ paper of the second read "not authorised". The LQ rule now waits when look-alike rows disagree (`rows_differ`), and a new census test holds that the row the matcher names is never the one that excepts more — the placard engine lifts placards for LQ on that row, so a cut that reordered the pair would otherwise turn an unexcepted material into an LQ (today the order is the safe one, by luck). **Mutants, 20, each caught by the census:** the five fixes reverted (one at a time); twelve rules made to miss their defect (bare id, a PG no row has, no unit, no count, interspersed text, technical name, RQ, marine pollutant, LQ, certification, missing page, phone); two made to call a correct paper wrong (a PG always required, RQ owed under the RQ). The first run had one survivor — UN0190 printed with class 8 waited instead of failing, because the census excused UN0190's pinned wait in the defect tests too; the excuse is now for the golden paper only, the guard that caused the wait is gone, and the class defect covers UN0190. **Replayed** (the five production reads with replay inputs): 146 pass, 6 fail, 43 "confirm it first" before and after — none of them carries UN0190, UN2910, UN1738 or a shared-name row; false-accept 0.
- **2026-10-21 — RC8 built: the merge gate.** Every Promise-1 test already fails `build` when a layer lets a wrong value through (the census, property, sequence and replay tests above all run in CI's test jobs); what none can catch is its own absence — a file renamed out of a glob, an `it.skip` left from debugging, a loop narrowed to one BOL. `lint:reader-gate` (`scripts/check-reader-gate.mjs`, its own step in ci.yml's `gates` job) pins nine files by their key test titles — RC1 census, RC2 replay, RC3 pairing and agreement, R-M2 cell extent, RC4 sequences, RC5 census, R-M1 RQ census, the audit row gate — and refuses `.skip`, `.only`, `.todo`, `.fails`, `skipIf`, `runIf` and `xit` in them; retiring one is an edit to its list in the same PR. Self-test 9 cases; on the real repo an `it.skip` and a renamed title each fail it. **Left for RC6:** the synthetic-page false-accept count joins the gate when RC6 exists; it needs model spend per run and so runs on reader changes, not on every PR.
- **2026-10-21 — owner: "proceed as proposed and recommended" — Q-RC7 answered (a), Q-RC5 answered (a), RC6 go (≤ $50 a run, Q-RC2).**
- **2026-10-21 — Q-RC7 built: the page settles a UN/NA number the readers split on.** `evidence/idWitness.ts`: on a paired line whose two readings of the id differ, the OCR (and a text layer) record the reading the page settles — only when (1) the readers agree on the line's shipping name, class and PG, (2) the table finds exactly one of the two numbers consistent with them, and (3) that number is printed as often as the lines carrying it, on the row that also prints the agreed name, and the other reading is printed nowhere the other lines do not account for. Otherwise nothing: the witness never says an identifying reading is wrong. The description settles with it when the two differ only by the number. `settledReading` (shared) reads it off the evidence; the paper audit judges the line as the settled number (which may be pass B's) and counts it confirmed (acceptance rule 12). The calculator keeps its one click on the product (owner, 2026-10-15, "keep the click"), and its note now says the page scan shows the number. **Measured,** the five production reads with the OCR re-run on the prepared view (#1673): 43 "confirm it first" → **29**, 146 → 160 pass, fails 6 → 6; the 14 cleared are the seven row rules of the Sonny's UN3264 line on each of its two reads, each checked against the page (sequence in order, name matched, class 8 PG II, two technical names printed, RQ under by its 54 lb boxes, no LQ, not a marine pollutant). The plan's "16" counted two `weight_only` answers on that line, which the paper's own silence leaves (it prints only a weight). False-accept 0. **Tests:** `idWitness.test.ts` — every HMT entry × every one-digit neighbour that is also an entry (> 10,000 pairs), either reader misreading: the OCR printing the true number settles it whenever the table fits it and not the neighbour; the OCR printing the misread number — also a shipper's misprint — never settles anything; both printed, a row without the name, no OCR: nothing; plus the helper, the description and two lines sharing one number. `paperAudit.test.ts`: the owner's line judged as UN3264 end to end, and still waiting with the other number on the row or no OCR. Mutants, 11: ten caught; the eleventh (the settled number's printed count) was a no-op — `rowOf` already refuses a wrong count — and the duplicate check was removed. The test joins `lint:reader-gate`.
- **2026-10-21 — Q-RC5 built: the paper audit takes what a person said the page prints.** A check is recorded as it is made, as the review row D-DR24 already defines, under its own consumer `paper_check` (migration 0509, its own merge #1702 before this one), and `POST /reads/:id/reviews` answers with the paper audit as it now stands; `GET /reads/:id` judges with every `paper_check` review of the read too (`personChecks`: each field's latest — `confirmed` keeps the read's value, `corrected` gives the person's, `unreadable` withdraws an earlier check). The audit sets the person's value on the document it judges, after every witness, and counts the field confirmed (the `reviewer` witness: D-DR19's "a person acted on it"). Two places a person says it: (1) under each "confirm it first" finding the panel now asks "What does the page show for …?" and offers the readings the two readers gave — never a value neither read — or yes/no on a yes/no field (the certification, which no form field ever offered, so that stop could not be cleared before); (2) on the form, "Yes, the page says …" and a picked reading record the page's value of that field at once — the product's UN/NA number, the count, the gross weight in pounds. **Narrower than the recommendation's wording, on purpose (P1):** a Calculate press (`hazmat_calculator`) never reaches the audit — a value a person TYPES, or a product picked from the list, is not taken as the paper's — a typed weight may be the load's, not the print's, and judging the paper by it could pass an RQ the paper owes; the package type and Limited Quantity tick are the calculator's reading of the print, not the print, so they are not either. A Calculate press leaves out what was already recorded, so one act is one row. **Found building it:** a product filled from pass B's reading (RC3) was recorded at Calculate as `confirmed` with pass A's number — on the Sonny's BOL, a "confirmed UN3254" for the misread — which D-DR5 would have counted as a correct reading; the number is now compared, never assumed (`reviewEntries`), and the tests' fake products no longer give their table reference as the number, which had hidden it. **Tests:** `requests.test.ts` (a person's certification judged; implicit, earlier and withdrawn reviews ignored; the reply carries the audit with the new check; org-scoped), `HazmatCalculatorForm.bol.test.ts` (a picked count recorded at the pick and not again at Calculate; a choice under a finding posts its review and the panel shows the answer), `bolFindings.test.ts` (`fieldChoices`). Mutants, 16, all caught: the audit ignoring the person's word or judging pass A's value under it, Calculate rows or implicit reviews reaching it, the first review winning, `unreadable` not withdrawing, the reply without the new check, a witness overriding the person, the view ignoring reviews; on the screen a Calculate recording a check twice, a check always `confirmed`, form acts not recorded, findings not refreshed, a blank reading offered, a weight not in pounds, the product number labelled pass A's (the last two survived the first run and got their tests). Replay of the five production reads is unchanged (a replayed read carries no reviews). Graduation (D-DR5), when it is built, counts these rows as it would count a Calculate's.
- **2026-10-26 — owner: "reading is not precise and reliable … making it complicated … placard calculation has
  some issues."** Audited by replaying the nine stored production reads and reading their pages; the answer is
  `PLACARD-CALCULATOR-RELIABILITY-PLAN.md`. The reader's layers above held; what failed was the dataset (no
  subsidiary classes on any of 2,479 entries, so every correctly printed "8(6.1)" line is refused and called
  wrong), the profile (a KG weight column is null by design), the unbuilt Q-DR27, and the screen. PC1 of that
  plan is next.
