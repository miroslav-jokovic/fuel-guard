# Handoff 2026-10-28: card control after the AWS move

Paste this into a new chat. Work from a fresh worktree on `origin/main` (parallel chats share the main
checkout). Owner rule for this work: **zero assumptions**. Every claim must cite a file:line or a
production query, and every fix is proven by reverting it and watching its test fail.

## Read first
- Plan: `docs/plans/fuel/CARD-CONTROL-CORRECTIONS-PLAN.md`, in **PR #1805 (open, not merged)**. Merge it
  first if CI is green, or work from its branch `claude/card-control-corrections-plan`.
- Card-control history: `docs/28-EFS-EXECUTION-PLAN.md`, `docs/27-EFS-CAPABILITY-ARCHITECTURE.md`. Incident
  runbook: `docs/29-EFS-INCIDENT-RUNBOOK.md`. Wording rules: `docs/DESIGN-SYSTEM-CONTRACT.md` §7.
- Memory notes: `card-control-corrections-position`, `aws-migration-position`.

## Production state (measured 10/28)
- AWS serves all of production: `360` / `api.360` / `console.360.silvicominc.com` → `44.236.127.194`.
  Release `1533e34`, schema 0524 current, both background job groups held by AWS containers.
- **Railway production api/web/platform-console retired ~17:35Z**: GitHub source disconnected, the three
  addresses return 404, 30 secrets deleted. Still on Railway: `uat` (staging), Expo-Open-OTA + its
  Postgres, driver-dist.
- Card control for Silvicom Inc: **on** since 14:56Z. WEX write access **confirmed** 14:28Z from the AWS
  address (10/10 steps passed; the test card ••7554 was a LIVE card, held for under 1 s). The probe switches
  `EFS_CARD_CONTROL_PROBE_ENABLED` and `EFS_ALLOW_PRODUCTION_PROBE` are back to **false** in SSM.
- Per-function approvals: lock / unlock / deactivate / override_grant **enabled**; **prompts_set denied**
  since 09/23 (card ••6122 has since been restored). One approver: miki@silvicominc.com. 0 real overrides
  ever. No card action has yet run through the app on AWS.
- Merged today and waiting for the next release: #1797 (the job-lease record names its AWS
  holder), #1802 (the 5-minute check marks cards WEX dropped; a refused EFS feed fails its run).

## Next work (needs no owner answer)
- **CCF1**: B1 (the status window title always says "Lock this card"; take it from `capabilityFor(draft)`);
  B2 (the exception checkbox/blocker shows for Active/Inactive, but only lock sends `clearException`; show
  the shared `overrideBlockedMessage` sentence for the others instead).
- **CCF2**: B3 (the write check must use `recentlyUsedRefusal` from `harness/prove.ts`); B4
  (`scripts/efs.mjs:49` defaults to Railway → `https://api.360.silvicominc.com`); B5 (`GET /settings` returns
  `check: {available, reason}` from the probe switches, and the page disables the form); B6 (the
  `writeProbe.ts:102` "staging API" sentence). ⚠ The edit tool refused `routes/writeProbe.ts` once as a
  "safety bypass": ask the owner for an explicit OK before editing it.
- **CCF3**: plain verdict from the judge's `recommendation` code (a shared map), with the engineering detail
  moved under "Technical details — for support" (kept rendered and copyable).
- **CCF4**: wording W1–W8 and the B7 messages (they point at approve/diagnose screens that don't exist).
  Deactivate CAN be undone: 5 production INACTIVE→ACTIVE unlocks succeeded.
- **CCF8**: runbook containment for AWS: the Settings switch, the CLI with the AWS default, and the
  Parameter Store + `aws-production.yml` path (~3 min measured).

## Waiting on the owner (plan §5)
Q-CCF1 Hold vs Lock (rec. **Hold**) · Q-CCF2 Override vs Exception (rec. **Override**, and rename "Override
mileage" to "Correct mileage") · Q-CCF3 a second approver · Q-CCF4 re-prove prompts on a spare idle card ·
Q-CCF5 one supervised real override · Q-CCF6 keep the per-function approvals when the EFS login changes
(rec. yes, and record it) · Q-CCF7 CLI-only approve/diagnose (rec. yes) · Q-CCF8 done (Railway retired) ·
Q-CCF9 notify the other managers about in-app card actions once there is a second approver.

## Owner actions still open
- Ask WEX to remove Railway's address from the allowlist (keep only `44.236.127.194`).
- QA org "FuelGuard EFS QA": click Disable on its `/settings/efs-soap` page (this wipes its sandbox password),
  and turn its card control off. WEX refuses it from AWS, so it fails every few minutes.
- A spare card WEX confirms is unused, for the supervised hold/unlock test on AWS (S5) and the prompts proof.

## Facts the next session will need
- Claude **cannot**: write SSM parameters, set Railway variables, or dispatch some production workflows.
  Hand those to the owner as `!` commands. Claude **can** read SSM (`--with-decryption` for on/off
  flags only), CloudWatch `/silvicom/production`, and run `supabase db query --linked`.
- Settings load only on deploy: change SSM → `gh workflow run aws-production.yml -f sha=<released sha>`.
- The probe routine: both switches true → redeploy → run → both false → redeploy.
- `railway logs` on macOS needs `perl -e 'alarm 60; exec @ARGV' railway logs <deployId>` (there is no `timeout`).
- The PR flow: open the PR, wait for CI to pass, then merge it yourself. Commit messages are one sentence.
  PR bodies use the four template headings.
