# Card control: corrections after the AWS move (CCF)

**Date:** 2026-10-28 · **Status:** plan only, waiting on the owner's answers to §5 · **Area:** fuel / EFS card control
**Builds on:** `docs/28-EFS-EXECUTION-PLAN.md` (the card-control build log), `docs/27-EFS-CAPABILITY-ARCHITECTURE.md`,
`docs/DESIGN-SYSTEM-CONTRACT.md` §7 (writing tone). It changes no decision recorded in those documents
unless a section below says so by name.

## 0. Why this exists

On 2026-10-28 the owner asked for card control (status changes, fuel exceptions/overrides, pump prompts)
to be audited end to end after production moved to AWS on 2026-10-27, "with zero assumptions". Every
finding below was measured in production or read at the line cited, the same day. Nothing in this
document is inferred from a comment or a plan without being checked against code or data.

### 0.1 The state, measured 2026-10-28

| Fact | Value | Source |
|---|---|---|
| Card actions for Silvicom Inc | **on** since 14:56:53Z | `efs_card_control_settings.enabled` |
| EFS write access | **confirmed** 14:28:40Z, 10/10 proofs, from `44.236.127.194` (AWS) | `probe_result` |
| Why it had been off | the EFS username was rotated 10/23 16:54 and 18:27, 10/27 16:02. `upsertEfsSoapCredentials` resets `write_entitlement='unknown', enabled=false` on any identity change, by design | `efsSoapCredentials.ts` (the `changedFields.length > 0` branch), audit `integration.efs_soap.credentials_changed` |
| Deploy-wide kill switch | `EFS_CARD_CONTROL_ENABLED=true` on AWS and Railway | SSM / Railway variables |
| Probe switches | `EFS_CARD_CONTROL_PROBE_ENABLED`, `EFS_ALLOW_PRODUCTION_PROBE` = **false** (were true 14:20–14:31Z for today's check) | SSM |
| Per-action approval (`efs_capability_promotions`) | `card_lock`, `card_unlock`, `card_deactivate` **enabled** 09/23 · `override_grant` **enabled** 09/23 (proof 08/18) · `prompts_set` **denied** 09/23 | table |
| Approvers | **one**: miki@silvicominc.com, all five scopes | `efs_card_control_approvers` |
| People who may be approvers | `rolesThatManage("fuel")` = admin, fleet_manager → 6 admins + 1 fleet manager | `settings.ts` `eligibleRoles`, `memberships` |
| Real (non-proof) card actions ever | 3 lock · 18 unlock · 3 deactivate, **0 failed**, all by miki; **0 overrides, 0 prompt changes** | `efs_card_mutations` where `proof_run_id is null`, `audit_logs` |
| Status changes made in the WEX portal instead | 1,191 since 09/01 | audit `card.status_changed_externally` |
| Cards | 277 live: 138 Active · 41 Hold · 98 Inactive · 0 with an exception | `efs_cards` |

## 1. Findings that change behaviour (bugs and gaps)

**B1 — The status window is always titled "Lock this card".** `CardOperationDrawer.vue:227` takes `ui`
from `operationUi(props.operation)`, which reads `spec.capabilityKey`; the status operation's spec is
fixed at `card_lock` (`cardOperations.ts`, the `id: "status"` row), whose contract title is "Lock this card"
(`packages/shared/src/efs/capabilities/cardLock.contract.ts:46`). Choosing Active or Inactive still shows
that title while the button says "Unlock card" / "Deactivate card" (`cardUnlock.view.ts:32`,
`cardDeactivate.view.ts:39`). The capability actually sent is already resolved by `capabilityFor(draft)`
(`STATUS_CAPABILITY`) — the title just does not read it.

**B2 — On a card with a fuel exception, Active and Inactive ask for a checkbox that cannot help.**
`statusBlocker` (`overrideException.ts`) disables Confirm for ANY target status until "Also remove the
fuel exception" is ticked, and the checkbox renders whenever the card has uses left
(`CardOperationInputs.vue:177`). Only `card_lock` carries `clearException`; unlock and deactivate send
`{}` (`cardOperations.ts:179-181`), and the server refuses both through `assertOverrideDoesNotBlock`
with "Remove the exception first, then try again" (`overrideFreezeGuard.ts`, map
`OVERRIDE_BLOCKED_CAPABILITIES` in `packages/shared/src/efs/overrideFreeze.ts:78`). So the operator is
told to tick a box, ticks it, presses Confirm, and is refused with a different instruction. Prompt changes
on such a card are refused the same way. No card has an exception today, so nobody has hit this yet.

**B3 — The account-wide write check accepts a card that is in use.** The per-action proof refuses any card
used for fuel in the last 30 days (`recentlyUsedRefusal`, `harness/prove.ts:156-176`, added 09/23 by
`0f0fe7e`). The write check (`routes/writeProbe.ts`) has no such rule. Today's check therefore ran on
••7554, a live card (Steven Nathan, unit 741), holding it for under a second.

**B4 — The operator CLI still calls Railway.** `scripts/efs.mjs:49` defaults `API_DEFAULT` to
`https://fleetguardapi-production.up.railway.app`. Since AWS11 (2026-10-27) production is
`https://api.360.silvicominc.com`; every `pnpm efs:*` command (write-check, prove, promote, restore,
sync) would act through Railway unless `--api`/`FG_API` is passed. `scripts/chat-load-test.mjs` has the
same default (out of scope here, noted for the AWS plan).

**B5 — The settings page offers a check the server will refuse.** With the probe switches off (their
normal state), "Run the write check" is enabled; the server answers 403 `probe_disabled` in ~11 ms
(measured 14:07Z today). The page has no way to know: `GET /api/fuel-cards/settings` does not report
whether the check is available.

**B6 — The refusal names the wrong environment.** `writeProbe.ts:102`: "Set
EFS_CARD_CONTROL_PROBE_ENABLED=true on the staging API, run it, then unset it." The check is run on
production (`EFS_ALLOW_PRODUCTION_PROBE`), and the settings live in AWS Parameter Store and only load on a
redeploy. ⚠ The tool that edits files refused this file once today as a "safety bypass" — the owner will
be asked to approve that edit explicitly when it comes up.

**B7 — Nothing in the app can approve, suspend or diagnose, but four messages say an admin can.** The
API has `POST /api/fuel-cards/prove/:capability`, `/promote/:capability` and `/diagnose`
(`routes/prove.ts:112`, `promote.ts:99`, `probe.ts:101`); **no web code calls any of them** (searched
`apps/web/src`, `apps/admin/src`). They are run from `pnpm efs:prove` / `efs:promote`. Messages that point at
a screen that does not exist: `cardOperations.ts:473-474` and `controlRefusal.ts:74,79` ("An admin needs
to prove it on a test card first", "An admin can re-enable it"), `FuelCardsPage.vue:89` ("An admin can
run the card diagnostic"), `writeProbeJudge.ts:62` ("Run the read diagnostic (POST /api/fuel-cards/diagnose)").

## 2. Findings in the operational state

**P1 — Pump prompts are blocked.** The 09/23 proof on ••6122 applied (UNIT prompt changed) and the revert
read timed out: `outcome=denied`, detail "THE CARD IS STILL CHANGED — restore it in the WEX portal".
Measured today: ••6122's UNIT prompt is back to `EXACT_MATCH 669`, so the card is restored. The same day
the harness gained per-attempt deadlines and revert retries (`47f1b21`), `pnpm efs:restore` (`eedf331`)
and the 30-day idle rule (`0f0fe7e`). No prompts proof has run since.

**P2 — Fuel exceptions have never been used for real.** `override_grant` was proven 08/18 with "sent
(unverified)": WEX never echoes an override's scope, so the app can confirm WEX accepted an exception but
not what it allows (documented, `docs/28` §10). Zero production exceptions since.

**P3 — One approver.** Every card action ever taken was by the one approver. If that person is away, no
one can hold a card from Silvicom 360.

**P4 — A new EFS login resets account-wide write access but not the per-action approvals.** After the
10/23 rotation, `write_entitlement` went to `unknown` (re-proven today) while all four promotions stayed
`enabled`. Neither `docs/27` nor `docs/28` records whether that is intended. See Q-CCF6.

**P5 — Proof card candidates, by the field the proof checks** (`efs_cards.last_used_date`): Active 6 never
used + 1 idle ≥30 d; Hold 4 idle ≥30 d; Inactive 98 with no date at all. ⚠ 98 of 98 Inactive cards having
no date suggests the field is simply not filled for inactive cards — it is **not** evidence that they are
unused, and the proof would accept them. A proof card must be one WEX confirms is spare.

## 3. Findings in the wording

Checked against `docs/DESIGN-SYSTEM-CONTRACT.md` §7.1. Fuel industry terms (ULSD, DSL, DEF) are domain
jargon the contract allows; vendor operation names and engineering terms are not. "Licence" is the app's
house spelling (119 files) and stays.

**W1 — Deactivate is described as permanent; it is not.** "Deactivating retires it for good"
(`cardDeactivate.view.ts:35`), "Take a card out of service for good … lifting a hold will not bring it back"
(`packages/shared/src/cardControlLedger.ts:111`), "Retire a card" (`cardControlLedger.ts:102`), "Retire this
card from the fleet?" (`cardDeactivate.view.ts:30`). Measured: **5 production unlocks took a card from
INACTIVE to ACTIVE**, all succeeded (`efs_card_mutations` before/after `status`). The second sentence of
the same message already says "until somebody activates it again" (`:37-38`), so the screen contradicts itself.

**W2 — One status, three names.** The status shows "On hold" (`efsCardCatalog.ts:138`); WEX's portal menu
is Active / Inactive / Hold (quoted in `cardOperations.ts`, status row); the actions say "Lock this card?",
"Lock card", "Card locked", "Locked card", "Lock a card" (`cardLock.view.ts:25-41`,
`cardControlLedger.ts:59`). Q-CCF1.

**W3 — "Exception" and "override" for the same thing.** Menus, drawer and panel say exception ("Grant
exception…", "Remove exception…"); the card page says "Override:" (`FuelCardDetailPage.vue:208`), history
says "Granted override" (`cardControlLedger.ts:62`), the limit picker says "Product/limit override"
(`OverrideLimitPicker.vue:86`), prompts say "Overridden by card" (`cardEffectiveRows.ts:45`), and an
unrelated button says "Override mileage" (`FuelCardsPage.vue:316`, `UnitMileageDrawer.vue:164,253`). WEX
calls it an override. Q-CCF2.

**W4 — The check result page is an engineering report.** It shows the server's verdict verbatim
(`CardControlSettingsPage.vue:285`, `:188`), and the verdicts (`writeProbeJudge.ts:55-157`) contain file
paths, "Phase B", "write_entitlement remains 'confirmed'", "re-run with readOnly=false", "POST
/api/fuel-cards/diagnose", "Watch the mutation ledger". Each step shows its vendor operation name
("getCardSummariesV2 — read entitlement", "zero-edit echo — fidelity against vendor XML") and milliseconds
(`:296-297`), plus "nested:header" (`:312`) and field paths (`:328`). The page also says "use the EFS test
environment first" (`:238`), which the page cannot do and which is now unreachable (WEX allowlisted the AWS
address for the production endpoint only).

**W5 — A blocked prompt action explains itself only on mouse hover.** `FuelCardDetailPage.vue:297-298`
puts the reason in `:title` on a disabled menu item, invisible on a tablet. The contract's pattern (§7.2
item 7) is to name what blocks a disabled button, on screen.

**W6 — Engineering words in operator sentences:** "armed" (`CardOperationInputs.vue:174`,
`cardControlModel.ts:390`, `overrideLimits.ts:110`), "for this deployment" (`cardOperations.ts:468`,
`controlRefusal.ts:44`), "service account" (`cardAvailability.ts:53`, `FuelCardsPage.vue:104`), "every
prompt this product can set" (`cardOperations.ts:253,283,320`), "needs allowRemoveDriverId: true"
(`controlRefusal.ts:31`), the raw scope code in `You are not approved for the "${scope}" action`
(`controlRefusal.ts:86`), "The previous request could not be matched" (`cardOperationFailure.ts:99`).

**W7 — Contradictions and dead ends:** "changes take effect at the pump immediately"
(`CardOperationDrawer.vue:381`) vs "the next time they fuel" (`promptsSet.view.ts:34`); "until you unlock
it" (`cardLock.view.ts:35`) where the control offers "Active", not "Unlock"; "Card actions are paused."
(`cardAvailability.ts:35`) vs "switched off for this deployment" (`cardOperations.ts:468`) for one cause;
"You are not on this company's card-control approver list." (`controlRefusal.ts:84`) does not say who can
add you, where "Ask an admin to add you." (`cardOperations.ts:476`) does.

**W8 — Small:** the change-history date chip prints the raw query value (`CardChangeLog.vue:123`, a
`lint:date-format` blind spot it documents itself); "fuelling" (`controlRefusal.ts:31`) and "authorisation"
(`FuelCardDetailPage.vue:164`) where the app otherwise writes "fueling" (130) and "authoriz-" (166).

## 4. Decisions this plan makes (no owner input needed)

- **D-CCF1 — The window title comes from the capability being sent**, the one `capabilityFor(draft)` already
  resolves. One source for title, button and request.
- **D-CCF2 — The exception checkbox belongs to Hold only.** For Active/Inactive/prompts on a card with uses
  left, the blocker is the shared `overrideBlockedMessage` sentence, read from `OVERRIDE_BLOCKED_CAPABILITIES`
  (already in `packages/shared`), with "Remove exception…" offered beside it. No second list in the web.
- **D-CCF3 — The write check uses the proof's idle-card rule** (`recentlyUsedRefusal`, imported, not
  copied). A check that writes to a real card refuses a card in use, whichever door it comes through.
- **D-CCF4 — `efs.mjs` defaults to `https://api.360.silvicominc.com`.**
- **D-CCF5 — The server says whether the check can run.** `GET /settings` returns
  `check: { available, reason }` derived from the two probe switches; the page shows the reason and
  disables the form instead of letting it fail. The sentence names Parameter Store and the redeploy.
- **D-CCF6 — Plain verdict first, engineering record second.** The server keeps its verdict text (it is the
  archived record and what the CLI prints). The page leads with a plain sentence chosen from the
  `recommendation` code the judge already returns (`enable_for_pilot_org`, `fix_credentials`, …) — one map in
  `packages/shared`, keyed by that enum. Step names, timings, document shape and field paths move under a
  "Technical details — for support" heading that stays rendered and copyable (the reason textareas replaced
  a closed `<details>`, `CardControlSettingsPage.vue:333-337`, still holds).
- **D-CCF7 — Deactivate is described as what it is:** the card stops working everywhere and stays off until
  someone sets it to Active. Measured reversibility (W1) decides this; the 5 reactivations are the evidence.
- **D-CCF8 — Messages name a real next step.** Where the next step is the CLI (approve, suspend, diagnose),
  the operator sentence says "Ask your Silvicom 360 administrator" and stops — it does not describe a
  screen. Where a screen exists (approver list, Remove exception), it names the screen.
- **D-CCF9 — Disabled actions say why on screen**, not in a hover title (W5).
- **D-CCF10 — W6–W8 are fixed as wording**, following §7.1, without changing any behaviour.

## 5. Open questions for the owner

| ID | Question | Candidates | Recommendation |
|---|---|---|---|
| **Q-CCF1** | One word for the Hold status and its action | (a) **Hold** everywhere: "Put on hold", "Card on hold", "Take off hold" · (b) **Lock** everywhere, status shown "Locked" · (c) keep both | **(a)**: it is the word on WEX's own portal, where staff made 1,191 status changes since 09/01, and the word the card list already shows |
| **Q-CCF2** | One word for a temporary fuel allowance | (a) **Override** everywhere (WEX's word), and rename "Override mileage" to "Correct mileage" · (b) **Exception** everywhere | **(a)**, for the same reason as Q-CCF1 |
| **Q-CCF3** | Who else becomes an approver, with which scopes | any of the 6 admins + Thomas (fleet manager) | at least one more person with hold + unlock, so a stolen card can be held when miki is away |
| **Q-CCF4** | Re-prove pump prompts? | (a) yes, on a card WEX confirms is spare and idle ≥30 days · (b) leave prompts blocked | (a), if prompt changes from Silvicom 360 are wanted. Needs the card from WEX first (P5) |
| **Q-CCF5** | First real fuel override | (a) one supervised override, checked in the WEX portal before staff use it · (b) let staff start using it | (a): never used in production, and the app cannot read back the scope (P2) |
| **Q-CCF6** | Should a new EFS login also suspend the per-action approvals? | (a) keep as is: the account-wide check re-proves write access, and the approvals describe how WEX behaves per action, which a username does not change · (b) suspend all, re-prove each | (a), and record it in `docs/28` as a decision so it stops being an accident |
| **Q-CCF7** | Screens for approve/suspend/diagnose | (a) none: CLI only, owner-run, rare (twice since August) · (b) build an admin screen | (a); the messages are fixed by D-CCF8 either way |

## 6. Steps

Each step is one PR with its tests; a test claimed in a comment quotes its title (`lint:comment-claims`).
Every fix is proven by reverting it and watching its test fail.

| Step | What | Files | Depends on |
|---|---|---|---|
| **CCF1** | B1 title from resolved capability (D-CCF1); B2 checkbox Hold-only + shared refusal sentence (D-CCF2) | `CardOperationDrawer.vue`, `cardOperations.ts`, `overrideException.ts`, `CardOperationInputs.vue` + tests | — |
| **CCF2** | B3 idle rule in the write check (D-CCF3); B4 CLI default (D-CCF4); B5 `check.available` (D-CCF5); B6 the refusal sentence | `routes/writeProbe.ts`, `routes/settings.ts`, `scripts/efs.mjs`, `CardControlSettingsPage.vue` + tests | owner approves the `writeProbe.ts` edit |
| **CCF3** | W4 plain verdict + technical section (D-CCF6) | `packages/shared` verdict map, `CardControlSettingsPage.vue` + tests | — |
| **CCF4** | W1/W7 deactivate wording (D-CCF7); W5 reasons on screen (D-CCF9); W6–W8 (D-CCF10); B7 messages (D-CCF8) | the files in §1 B7 and §3 | — |
| **CCF5** | Q-CCF1/Q-CCF2 one vocabulary for Hold and override | the files in W2/W3 | Q-CCF1, Q-CCF2 |
| **CCF6** | Operations, not code: add approvers (Q-CCF3); prompts proof (Q-CCF4); first supervised override (Q-CCF5) | — (owner on screen / `pnpm efs:prove` with `FG_API` set until CCF2 lands) | answers |
| **CCF7** | Record Q-CCF6's answer in `docs/28` | `docs/28-EFS-EXECUTION-PLAN.md` | Q-CCF6 |

The prompts proof in CCF6 follows the same switch routine as today's check: both probe switches to `true` in
Parameter Store → `aws-production.yml` on the released sha → `pnpm efs:prove prompts_set` → `pnpm
efs:promote prompts_set` (the owner named in `EFS_PROMOTION_OWNER_USER_ID` may approve their own proof) →
both switches back to `false` → redeploy.

## 7. Not in this plan

- `scripts/chat-load-test.mjs` Railway default — the AWS migration plan's clean-up.
- Time restrictions shown in 24-hour time (`cardEffectiveRows.ts:297,305`): the app has no recorded time
  convention to measure against; raised separately if wanted.
- The QA org ("FuelGuard EFS QA") — its EFS connection is the owner's Disable click (see the AWS migration
  memory of 10/28); unrelated to these corrections.

## Progress log

| Date | Step | Note |
|---|---|---|
| 2026-10-28 | — | Plan written from the 10/28 audit. Card actions on 14:56Z, write access confirmed 14:28Z from AWS. |
