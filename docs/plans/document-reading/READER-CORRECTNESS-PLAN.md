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
the paper's answer then follows the person's checks, and it reuses the review rows D-DR24 already records.

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
