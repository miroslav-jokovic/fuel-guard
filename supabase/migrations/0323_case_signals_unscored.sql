-- 0323: a rule that fires and scores zero still leaves a trace (Q-FUI17, answered (a)).
--
-- ── WHAT WAS WRONG, AND IT WAS ONE DAY OLD ──────────────────────────────────────────────────────
-- `correlateSignals` filters `weight > 0` before it builds `signals`, and `persist.ts` writes that
-- same list into `case_signals`. So a weight-0 rule leaves NOTHING: no case, no signal on the fill,
-- nothing for `explainCaseOutcome` to mention, nothing for the Fuel log's "why" panel to show.
--
-- That was invisible while the only weight-0 rule was `odometer_entry_suspect`, which has been silent
-- this way since it was written to be *"low severity, zero theft weight, so it never inflates a
-- correlated case"* — wording that reads as an intention to RECORD it, not erase it. Q-FUI11's ruling
-- on 2026-09-06 made `cumulative_overfuel` the second, and it was chosen over switching the rule off
-- on the argument that the detector survives and stays visible. Half of that was not true.
--
-- ⚠ AND IT QUIETLY DISABLED A GUARD NOBODY RULED ON. `contaminatesBaseline` reads `case_signals` for
-- `VOLUME_AXIS_RULE_IDS`, which contains `cumulative_overfuel`: a fill carrying that signal was
-- EXCLUDED from the rolling window that trains `effectiveBaseline`. Dropping the signal from
-- `case_signals` therefore let over-fuelled fills start training the MPG baseline they had always been
-- kept out of. Small in today's data because the re-score has barely begun (33 of 16,256 fills at
-- `SCORING_VERSION` 3), and it grows with every night of the sweep — which is why this ships now
-- rather than after.
--
-- ── WHY A COLUMN RATHER THAN APPENDING TO `case_signals` ────────────────────────────────────────
-- Appending was the cheaper option and is rejected on the call sites, which were read rather than
-- assumed. `entityRisk.ts` counts `case_signals` per rule to rank trucks and drivers, so folding
-- unscored rules in would raise a truck up a risk list on the strength of a signal the product has
-- just decided carries no weight — the exact confusion the Q-FUI11 ruling exists to remove. Keeping
-- the two lists apart means every existing reader keeps reading exactly what it read before, and the
-- ones that WANT the unscored rules ask for them by name.
--
-- Nullable, no default, no backfill: a fill scored before this column existed has no answer to the
-- question, and `null` says so. The sweep restamps the fleet within days anyway.
alter table fuel_transactions
  add column if not exists case_signals_unscored jsonb;

comment on column fuel_transactions.case_signals_unscored is
  'Rules that FIRED on this fill and scored zero (Q-FUI17). Evidence, never accusation: these '
  'contribute nothing to case_level or case_score, and are kept apart from case_signals so that '
  'entityRisk and every other existing reader is unaffected. Null = scored before 0323.';
