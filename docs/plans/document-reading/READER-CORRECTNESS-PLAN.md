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
