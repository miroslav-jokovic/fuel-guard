**2026-11-06 · Track W · w-two-smalls, PR 2: the Analyst's period label (#2089)** — no migration. **Analyst L2 → L3.**

- **Why:** analyst@2's one refusal, in 2 of 2 live runs, was the model writing "November 2026". The year was not on
  the fact sheet, so the check refused it (correctly).
- **Fixed at the source:**
  - The fact sheet carries `period: { day, month }` from one formatter (`showPeriod`: "November 3, 2026",
    "November 2026").
  - `checkNarration`'s tokenizer reads a date written in words as ONE figure of kind `date` (`date:2026-11`,
    `date:2026-11-03`), compared exactly against the sheet's dates, and blanks its digits so they are not read again
    as counts.
  - So the label allows exactly its own day and month: no stray count of 2026 or 3, and no other year. Years and
    dates were NOT exempted.
- **Red/green:** "November 2025" and "November 4, 2026" are refused, and "2026 leads" is still refused. A planted
  fixture, `planted-wrong-year`, is refused in the replay.
- **Prompt analyst@3:** explains `period`; rule 3 allows its words copied as they are and never a year, month or day
  that is not on the sheet. All model fixtures re-recorded.
  - **Live eval: 11 of 11, twice** (the `--record` run, then a second run). The model now writes "November 2026" from
    `period` in 10 of the 11 briefs.
- **L3 moved.** The line is "the evaluation set at its bar: 0 numbers in the narration that the fold did not produce".
  - The check holds it absolutely, and the model now meets it on every fold.
  - Yesterday's gap also said "the set grows over real folds". That cannot be an L3 condition: real folds exist only
    after live campaigns, which need L4. It is L4/L5 work.
  - A new test pins the bar in CI. Every model recording under the prompt in force must be `ready`, and
    `baseline.json` must agree on all of them. A replay alone passes whatever verdict a fixture was recorded with, so
    without this test a refused re-record would have kept L3. `pnpm gen:ads-readiness` was run.
- **Mutation:** 6 mutants, all red, each file restored byte for byte. Covered: years exempted (the test and the
  planted fixture), the period dropped from the sheet, word dates read as counts, the label's digits not blanked,
  and a model recording re-recorded as refused.
- Open questions: none.
