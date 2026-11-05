# Ads golden scenarios

The ads agent's golden scenarios (`ADS-AGENT-BUILD-WORKFLOW.md` §4R, step 7d). Each scenario is a
timeline a campaign lives through, with what must be true at the end. Together they are the
Orchestrator's L3 bar, "golden scenarios green", and they carry the L2 faults §4R names for it: a
process killed after a side effect, the same job delivered twice, two campaigns in one org, the kill
switch, a missing approval, a budget exhausted mid-step, settings changed mid-run.

## Where things live, and why

- `scenarios/*.yaml` — the scenarios. One per file. `TEMPLATE.yaml` is the annotated starting point.
- `src/schema.ts` — what a scenario may say. Its header explains why this package holds data only.
- `apps/api/src/testing/adsGolden.ts` — the runner. It drives the REAL `orchestratorTick` and
  `runCampaignStep` over `adsWorld`, with only the vendors faked.
- `apps/api/src/modules/ads/orchestrator/golden.test.ts` — runs every scenario. It also runs a
  negative control, the §4R coverage list, and a sweep that kills the happy path at each of its
  writes in turn.

`@hazmat/golden` can import its engine because that engine is a package. The ads engine is a service
module in `apps/api`, and a package may not import an app, so the runner lives beside it.

## The monitor's scenarios

`scenarios/monitor/*.yaml` are the Monitor's L3 bar. They are a different shape: what Meta reports and which
job reads it, not a campaign's walk through the machine. So they have their own schema (`src/monitorSchema.ts`),
runner (`apps/api/src/testing/adsMonitorGolden.ts`) and test (`apps/api/src/modules/ads/monitor/golden.test.ts`).
`loadScenarios` does not descend into the folder, so the orchestrator's suite never meets them.

- `hourly_job` is the pull then the checks; `daily_reconcile` is the 28-day re-read then the comparison. Spend
  goes in as `meta_reports`, so it reaches `ads_spend_hourly` through the real pull.
- `expect.pauses`, `flags`, `bell` and `failures` are each the WHOLE list. Write `expect` from `monitorChecks.ts`
  and `adsReconcile.ts`.
- Start from `scenarios/monitor/TEMPLATE.yaml`. A rule's scenario holds a campaign a cent under, at, and over.
- Run `pnpm --filter @silvicom/api exec vitest run src/modules/ads/monitor/golden.test.ts`.

## The independence rule

`expect` is written from the rules, never pasted from a run:

- the machine: `packages/shared/src/ads/campaignMachine.ts`;
- the runner's header: what happens in each state, the kill switch, an unknown launch outcome;
- the guard's fences: `budgetGuard.ts`, `approvals.ts`.

`why` names the rule; `verifiedBy` names who read it. If the orchestrator disagrees with a scenario,
find out which one is wrong before changing either. When the code is right and the rule is surprising,
it goes into the plan's open questions; `launch-delivered-twice.yaml` and Q-AD23 are the example.

## Writing one

1. Copy `TEMPLATE.yaml`, and seed the fewest campaigns that show the case.
2. Write the timeline: people act through `person` / `approver`, the agent through `tick` / `settle`,
   and faults through `crash`, `deliver_twice` and the vendor scripts.
3. Write `expect`: every campaign's final state, and the whole ledger of each campaign you care
   about. A partial ledger hides the row that should not be there.
4. Run `pnpm --filter @silvicom/api exec vitest run src/modules/ads/orchestrator/golden.test.ts`.
5. Break the rule it is about (one line in the orchestrator) and watch the scenario go red. Then
   restore the file byte for byte (`cp` + `cmp`). A scenario that stays green under its own mutation
   proves nothing.

## The ledger lines

| Row | Line |
|---|---|
| a move | `draft -compose-> composing succeeded` |
| a move another writer beat | `launching -launched-> live failed` |
| a move left open by a crash | `launching -launched-> live started` |
| a move the machine refused | `review -launch- refused` |
| any other act | `launch succeeded`, `launch refused`, `pause failed`, `launch started` |

## Crash points

`crash: { table, nth }` kills the Nth write to that table counted from that step. A step's writes, in
order:

1. any open transition from an earlier stint is settled;
2. the vendor act's `started` row, then its completion;
3. the transition's `started` row;
4. the campaign's compare-and-set (the `ads_campaigns` write);
5. the transition's completion.

The sweep in `golden.test.ts` already crashes the happy path at every write. Write a named crash
scenario when a crash point deserves its whole ledger stated.
