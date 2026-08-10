# Re-scoring history after the Stage 3 rule fixes — recommendation

**Date:** 10 August 2026 · **Status:** decision required from you; nothing has been re-scored.

## The situation

Stage 3 corrected several detection defects. Two of them change verdicts on data that has already
been scored and, in some cases, already acted on by a fleet manager:

| Fix | Direction | Consequence for existing data |
|---|---|---|
| Reefer over-fuel compared 96 h of purchases against a 48 h burn ceiling | **Retires** alerts | `high`-severity theft alerts against honest drivers — some may be open in the review queue right now, some may already have been actioned |
| Capacity resolution used the raw nameplate, so six detectors were silently ineligible | **Creates** alerts | Fills previously scored clean on affected trucks were never really examined |
| Odometer `eventTime`, intermediate gallons, siteKey, market-price memo | Mixed | Evidence text and thresholds move; a re-score produces different numbers for the same fill |

This is not a deployment question. It is a question about **accusations made against named employees**
on the basis of automated evidence that has since been corrected.

## Recommendation

**1. Do not mutate open cases. Supersede, annotate, recommend.**
An investigation opened in March was opened on March's evidence. Rewriting that evidence in place
destroys the basis of a decision someone is actively making. Anomalies here are already superseded
rather than deleted, and `anomaly_transitions` is append-only — keep both properties. A corrected
rule should append a transition, not overwrite a row.

The strongest reason is not an AI regulation, it is ordinary US litigation practice: once an employer
investigates a driver for theft, a wrongful-termination claim is plausibly "reasonably anticipated",
which triggers a duty to preserve under FRCP 37(e). Overwriting the evidence blob on an open case is
exactly the fact pattern that produces a spoliation argument.

**2. Give rule-defect dismissals their own terminal state.**
Today the lifecycle ends in `resolved` or `dismissed`. A driver dismissed because *the rule was
wrong* and a driver dismissed because *we looked and it was fine* are not the same fact, and the
difference is the whole ballgame if that driver is ever disciplined or asked about it later. Add a
distinct disposition — `dismissed_rule_defect` — carrying the defect identifier and the ruleset hash
that produced the bad alert.

**3. Retire the false reefer alerts by transition, and tell the humans.**
Do not let a `high`-severity theft accusation silently vanish from a queue somebody already worked.
Append the superseding transition, set the new disposition, and notify the fleet managers who saw it.
A retraction nobody is told about is indistinguishable from a cover-up if it surfaces later.

**4. Shadow-run the capacity backfill before surfacing anything.**
The six re-enabled detectors will generate alerts on historical data. Re-score into a shadow table,
surface nothing, and compare volume, severity mix and — most importantly — **per-driver
concentration** against the clean baseline. If the fix makes three drivers look like career thieves,
you want to know that before a manager does.

**5. Re-score the full history for analysis; surface only within a bounded window.**
Bank AML practice for a broken monitoring rule is a full **lookback**, because the harm there is a
*missed* alert. Consumer anti-abuse practice is forward-only, because the harm there is a *false*
alert on a settled transaction. You are between the two, and your population is identifiable
employees. Analyse everything; show managers only a defensible window — tied to something you can
justify in writing, such as your retention horizon or a fuel-card billing cycle. **Write the memo
that explains how you chose the window.** In AML lookbacks, the defensibility of the methodology
matters as much as the result, and the memo is the artifact that survives.

**6. Never auto-open a disciplinary case from a backfilled anomaly.** Backfilled findings go to
triage, not to a manager's action queue.

**7. Ship behind a kill switch, one friendly fleet first.** Alarm on both directions — a spike in the
six re-enabled detectors *and* the reefer rule going to zero are both expected, so alarm on magnitude
outside what the shadow run predicted, not on movement itself.

## What already landed (prerequisite)

The research is unanimous that none of the above works without being able to answer *"which logic
produced this score?"* — and you could not answer it. `scoringEngineVersion()` returned the **git
commit**, or the literal string `"unknown"` when build info was absent. A README typo minted a new
"engine version"; the Stage 3 rule corrections were indistinguishable from any other deploy.

So `RULESET_HASH` now exists: a content hash of the detection contract — rule ids, axes, weights,
suppression — emitted by `pnpm gen:rules` into `catalog.generated.ts` and stamped on every scoring
attempt as `rs-<hash>+<commit>`. Verified: changing a rule weight moves the hash; changing a rule's
label does not. `lint:codegen` already fails on generated-file drift, so it cannot silently rot.

That single change makes the partition possible: **every score is now attributable to the exact
ruleset that produced it**, so "was this fill scored before or after the reefer fix?" is answerable
with a query instead of an archaeology exercise.

Deliberately excluded from the hash: rule prose (wording is not detection) and per-org threshold
overrides (tenant configuration, not the shipped ruleset).

## What is NOT done, and needs your decision

- **The `dismissed_rule_defect` disposition** — a migration plus a transition reason code.
- **The evidence snapshot / freeze on case open** — needs a look at whether evidence is already
  immutable on the anomaly row, or whether the case reads through to live data.
- **The shadow-scoring table and the comparison run.**
- **The surfacing window**, and the memo justifying it. That is a business decision, not a technical one.
- **The retraction notification** to affected fleet managers.

I have deliberately not started these. Each changes what a fleet manager sees about a named driver,
and that is not a call to make on your behalf.

## A note on what does and does not bind you

Be careful here, and take this to counsel rather than to me:

- **GDPR Art. 22** (automated decisions) and the **EU AI Act** worker-monitoring obligations apply to
  **EU/UK data and the EU market**. For a US fleet with US drivers, they do not. If you sell into the
  EU, they do — and your human review queue is already most of the Art. 22(3) answer.
- **Illinois HB 3773** amended the Illinois Human Rights Act effective 1 Jan 2026 to cover AI in
  employment decisions including discipline, with notice obligations. Colorado's SB 24-205 was
  postponed and replaced in May 2026 with something narrower. Both are moving; verify current status
  before making any claim to a customer.
- **FCRA §1681a(y)** is the live US hook worth understanding: after adverse action based on an
  employee-misconduct investigation, the employer must give the employee a summary of the *nature and
  substance* of the communication it relied on. Whether an automated fleet-monitoring product counts
  is unsettled. The operational implication is one-directional and safe regardless: **your customers
  may have to hand a driver a written account of why they were disciplined — and if your evidence
  text silently changed underneath them, they cannot.**

## Sources

- [Hidden Technical Debt in Machine Learning Systems — Sculley et al., NeurIPS 2015](https://proceedings.neurips.cc/paper_files/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf) *(CACE: "changing anything changes everything"; configuration and reproducibility debt)*
- [Rules of Machine Learning — Google](https://developers.google.com/machine-learning/guides/rules-of-ml) *(Rule #29: log the features used at serving time)*
- [Bitemporal History — Martin Fowler](https://martinfowler.com/articles/bitemporal-history.html) *(record time vs actual time; "we don't change what we thought we knew"; the cheap alternative — snapshot the action inputs)*
- [SR 11-7 Supervisory Guidance on Model Risk Management — Federal Reserve](https://www.federalreserve.gov/supervisionreg/srletters/sr1107.htm) *(model inventory, change control, outcomes analysis)*
- [How Transaction Lookbacks Can Guide Fintech Companies — Jenner & Block](https://www.jenner.com/en/news-insights/publications/how-transaction-lookbacks-can-guide-fintech-companies-law360) *(lookback scope and methodology must be defensible)*
- [Automatic rule backtesting with large quantities of data — Grab Engineering](https://engineering.grab.com/automatic-rule-backtesting) *(replay against history as a substitute for shadow mode)*
- [Stripe Radar rules](https://docs.stripe.com/radar/rules) *(forward-only by design; 6-month backtest before enabling; rule-edit markers on the volume chart; rule activity audit log)*
- [Reliable Product Launches at Scale — Google SRE](https://sre.google/sre-book/reliable-product-launches/) *(canary, feature flags, kill switches)*
- [FRCP 37(e) — Cornell LII](https://www.law.cornell.edu/rules/frcp/rule_37) *(duty to preserve ESI)*
- [15 U.S.C. §1681a(y) — Cornell LII](https://www.law.cornell.edu/uscode/text/15/1681a) *(employee-misconduct investigation exclusion)*
- [GDPR Art. 22](https://gdpr-info.eu/art-22-gdpr/) · [EU AI Act Art. 26](https://artificialintelligenceact.eu/article/26/) *(EU only)*
- [NIST SP 800-92 — Log Management](https://csrc.nist.gov/pubs/sp/800/92/final)
