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

## 1b. Security and operations findings (plan audit, same day)

**S1 — Railway can still change fuel cards, and holds the secrets to do it.** Measured 10/28: the Railway
`@fleetguard/api` service is online at `fleetguardapi-production.up.railway.app`, serving the same commit
(`1533e34`), with `EFS_CARD_CONTROL_ENABLED=true`, `EFS_SOAP_ENABLED=true`, and `SECRETS_ENCRYPTION_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` and `EFS_SOAP_PASSWORD` set. Railway is the platform whose variables were read
in the 2026-10-21 breach. Its HTTP traffic today is leftover browser tabs (chat, notifications); **no card
routes**. Whether it could actually reach EFS depends on whether WEX's firewall still allows Railway's
egress address. That is not known from here and is not tested, because testing it means sending a request
to WEX from Railway. Nothing about AWS needs Railway to keep card control. Q-CCF8.

**S2 — The incident runbook's containment still points at Railway.** `docs/29-EFS-INCIDENT-RUNBOOK.md`
§2 step 1 runs `node scripts/efs.mjs promote … --suspend`, which calls Railway by default (B4). §2.1 rows 3–4
say "`EFS_CARD_CONTROL_ENABLED=false` on Railway". On AWS the same switch is a Parameter Store write plus
`aws-production.yml` (measured today: change at ~14:20Z, containers restarted 14:22:58Z, ~3 min). The
runbook also omits the fastest owner-only containment that needs no terminal: Settings → Card control →
untick "Let this company change fuel cards" (row 2 of §2.1, done from the screen).

**S3 — The QA org still has card control on.** "FuelGuard EFS QA": `enabled=true`,
`write_entitlement=confirmed`, one approver (an alias of the owner's address). Its sandbox endpoint is
refused by WEX's firewall from AWS, so it cannot write today, but it is a second org with a live write
switch. The owner's pending Disable click on its EFS connection (AWS memory, 10/28) closes the connection;
its card-control switch should go off with it.

**S4 — The override history on production is one clean proof and one contradiction.** 08/18 20:31 on ••6536:
the count landed, then the revert threw "Another change to…" and the proof was `denied`. The background sweep
later reconciled its two ledger rows to `failed` ("the card still does not carry the requested change").
08/18 23:59 on ••7971: count landed and reverted, `proven`. The location/limit scope of an override is never
readable back from EFS (`sent ACCEPTED as applied`, `harness/prove.ts:319`). This strengthens Q-CCF5.

**S5 — No card action has gone through the app on AWS.** The last real one was an unlock on 10/23 12:24,
on Railway. Today's write check proves WEX accepts writes from the AWS address through the same SOAP client,
but the full path a fleet manager uses (card page → drawer → `/api/fuel-cards/:id/lock` → EFS → ledger →
mirror) has not run on AWS. One supervised hold and unlock on a spare card closes it.

**S6 — Checked and found sound, with the evidence:**
- Every `efs_*` card table has RLS on and no client policy (deny-all). The two with policies are
  `efs_processing_runs` and `efs_transactions` (reads). Measured in `pg_class`/`pg_policies`.
- No card number in 24 h of AWS application logs: CloudWatch filter on `"70830"` and `"cardNumber"` returned
  0 events. Log groups keep 30 days.
- The role gate is checked at action time against `rolesThatManage("fuel")`
  (`efsCardControlAccess.ts:303`), so an approver moved to dispatcher loses card actions immediately, even
  with their approver row still present. Both approver rows today belong to admins.
- No card action is stuck mid-flight: `efs_card_mutations` holds only `succeeded` (69) and `failed` (16). The
  16 failures are 14 on the QA org in August and the 2 override rows of S4.
- Every fuel-card route is classified for the vendor rate limit (`routes/vendorRateLimit.ts`, with a test
  that every route is listed).

**S7 — Card actions taken in Silvicom 360 notify nobody.** Status changes made OUTSIDE the app notify the
fuel managers (`efsCardStatusPoll.ts:298`); changes made in the app write an audit row and a history entry
only. With one approver this is moot. With several, a second manager learns a card was held only by opening
it. Q-CCF9.

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
| **Q-CCF8** | Railway's card-write capability (S1) | (a) now: Railway api `EFS_CARD_CONTROL_ENABLED=false` and `EFS_SOAP_ENABLED=false`, and ask WEX to remove Railway's address from the allowlist · (b) wait for AWS12 to delete the service | **(a) today.** It costs nothing on AWS and closes a write path on the breached platform. Railway variable writes are the owner's (refused to Claude) |
| **Q-CCF9** | Tell the other fuel managers when a card is held, unlocked or deactivated from the app? | (a) yes, through `notify()` with the same entitlement as the external-change notice · (b) no, history only | (a) once there is a second approver (Q-CCF3); (b) until then |

## 6. Steps

Each step is one PR with its tests; a test claimed in a comment quotes its title (`lint:comment-claims`).
Every fix is proven by reverting it and watching its test fail.

| Step | What | Files | Depends on |
|---|---|---|---|
| **CCF0** | Close Railway's write path (S1) and QA's switch (S3). Owner actions: Railway api variables, WEX allowlist message, QA org Disable + card-control off. Claude verifies each by reading back | — | Q-CCF8 |
| **CCF1** | B1 title from resolved capability (D-CCF1); B2 checkbox Hold-only + shared refusal sentence (D-CCF2) | `CardOperationDrawer.vue`, `cardOperations.ts`, `overrideException.ts`, `CardOperationInputs.vue` + tests | — |
| **CCF2** | B3 idle rule in the write check (D-CCF3); B4 CLI default (D-CCF4); B5 `check.available` (D-CCF5); B6 the refusal sentence | `routes/writeProbe.ts`, `routes/settings.ts`, `scripts/efs.mjs`, `CardControlSettingsPage.vue` + tests | owner approves the `writeProbe.ts` edit |
| **CCF3** | W4 plain verdict + technical section (D-CCF6) | `packages/shared` verdict map, `CardControlSettingsPage.vue` + tests | — |
| **CCF4** | W1/W7 deactivate wording (D-CCF7); W5 reasons on screen (D-CCF9); W6–W8 (D-CCF10); B7 messages (D-CCF8) | the files in §1 B7 and §3 | — |
| **CCF5** | Q-CCF1/Q-CCF2 one vocabulary for Hold and override | the files in W2/W3 | Q-CCF1, Q-CCF2 |
| **CCF6** | Operations, not code: add approvers (Q-CCF3); prompts proof (Q-CCF4); first supervised override (Q-CCF5) | — (owner on screen / `pnpm efs:prove` with `FG_API` set until CCF2 lands) | answers |
| **CCF7** | Record Q-CCF6's answer in `docs/28` | `docs/28-EFS-EXECUTION-PLAN.md` | Q-CCF6 |
| **CCF8** | Runbook for AWS (S2): containment names the Settings switch, the CLI with the AWS default, and the Parameter Store + redeploy path with its measured ~3 min; remove "on Railway" | `docs/29-EFS-INCIDENT-RUNBOOK.md` | CCF2 (CLI default) |
| **CCF9** | Q-CCF9's answer, if (a): notify fuel managers of in-app status changes | `efsCardControl` dispatch path + `notify()` + test | Q-CCF9 |

## 6a. Done means (the production-ready checklist)

Each item is a measurement, not a statement. The plan is complete when every line is ticked with its evidence.

- [ ] Railway api cannot change a card: `EFS_CARD_CONTROL_ENABLED=false` read back, or the service deleted (S1)
- [ ] QA org: EFS connection disabled and card control off, read back (S3)
- [ ] Status window title matches the chosen status for all three targets; tested (B1)
- [ ] On a card with uses left, Active/Inactive/prompts show the shared refusal sentence and no checkbox; tested (B2)
- [ ] Write check refuses a card used in the last 30 days; tested (B3)
- [ ] `pnpm efs:*` reaches `api.360.silvicominc.com` with no flag (B4)
- [ ] Settings page shows "check unavailable" with its reason while the probe switches are off; tested (B5, B6)
- [ ] No sentence in §1 B7 or §3 remains; each replacement is in a test or a snapshot (W1–W8)
- [ ] One supervised hold + unlock through the card page on AWS, on a spare card: ledger `succeeded`, mirror status matches, history shows the reason (S5)
- [ ] Second approver added with at least hold + unlock (Q-CCF3)
- [ ] Prompts: re-proven and promoted, or recorded as deliberately off (Q-CCF4)
- [ ] One supervised override, checked in the WEX portal (Q-CCF5, S4)
- [ ] Runbook updated for AWS and its containment step 2 walked once on production by the owner (S2)
- [ ] Q-CCF6 recorded in `docs/28`

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
| 2026-10-28 | — | Plan audited: added §1b (S1 Railway still write-capable with secrets, S2 runbook Railway-only, S3 QA switch on, S4 override history, S5 no in-app action on AWS yet, S6 what was checked sound, S7 no notice of in-app actions), Q-CCF8–9, CCF0/CCF8/CCF9 and the §6a checklist. |
| 2026-10-28 | CCF1 | B1: the drawer title reads `operationUi(spec, draft)`, i.e. the capability `resolveCapability` sends. B2: the checkbox renders only when the ticked row resolves to `card_lock` (`offersClearException`); every other frozen capability gets the API's own `overrideBlockedMessage` sentence from `overrideFreezeBlocker`, which `operationBlocker` now asks for any operation, prompts included. Each fix reverted once: its test failed, bytes restored. Not done: a "Remove exception…" button inside the drawer — the card page's menu already offers it beside the drawer, and the drawer sits at the 500-line budget. |
| 2026-10-28 | CCF3 | W4: `packages/shared/src/efs/writeCheckVerdict.ts` holds one plain sentence per judge `recommendation` (12 codes); `judge()` now returns `WriteCheckRecommendation`, so a new code without a sentence fails typecheck (measured: deleting `no_action` → TS2741). The settings page leads with that sentence (result, toast, "Last check") and keeps the server's verdict, steps, timings, shape, changed fields and documents under "Technical details — for support", still rendered. "Use the EFS test environment first" removed. Reverting the page to the raw verdict failed 12 of 23 wording tests. |
| 2026-10-28 | CCF4 | B7/W6/W7: the nine blocked-by sentences were written three times (`cardOperations.ts` `blockedSentence`, `cardAvailability.ts`, API `controlRefusal.ts`) and had drifted; now one map, `CARD_BLOCKED_SENTENCES` beside `cardBlockedBySchema`, read by all three. CLI-only next steps say "Ask your Silvicom 360 administrator"; screens are named where they exist; the not-approver sentence says who can add you. W1: deactivate titled and described as reversible (`cardDeactivate.view.ts`, ledger scope label/description). W5: disabled card/prompt menu items print their reason, no hover title. W6: "armed" ×4, "this product" ×3, "service account" ×2, the raw scope code, `allowRemoveDriverId: true`, the unmatched-request toast. W7: drawer description and the lock body. W8: date chip via `formatDate`; "authorization", "fueling". Left as is: `writeProbeJudge.ts:62` names `POST /api/fuel-cards/diagnose`, but since CCF3 that text only appears under "Technical details — for support". Hold/Lock and exception/override words wait on Q-CCF1/2 (CCF5). Each fix reverted once and watched fail. |
| 2026-10-28 | CCF2 (B4, B5) | B4: `scripts/efs.mjs` reads its default host from `infra/server/production.env` `API_HOST` (what the AWS deploy serves on) instead of a typed Railway URL, names it in its usage text, and treats an empty `FG_API` as unset; `lint:cli-streams` now fails if the usage line does not name production's `API_HOST` (measured: putting the Railway default back fails it). Verified 10/28: `api.360.silvicominc.com/api/version` answers (commit 800d753, schema 0526), the Railway host returns 404. B5: `GET /api/fuel-cards/settings` returns `check: {available, reason}` from `writeCheckAvailability` (both probe switches; the org's EFS environment is not consulted, so a sandbox org with one switch on is under-offered, by decision); the page disables the form and says the check is off on the server. B3 and B6 are in `routes/writeProbe.ts` and wait on the owner's OK to edit that file. |
| 2026-10-28 | CCF8 | `docs/29` for AWS: the Settings switch is the no-terminal containment (header + §2.1 row 2); rows 3–4 are Parameter Store `/silvicom/production/api/EFS_CARD_CONTROL_ENABLED` / `EFS_SOAP_ENABLED` (both SecureString, measured) + `aws-production.yml` on the running commit (~3 min, measured 10/28), with read-back; `--api` note names the AWS default from CCF2 (lands with #1811); log references point at CloudWatch `/silvicom/production` (one-hour search measured, returned 1 signal); `card_deactivate` added to the capability list. Measured: only `api` can write a card — `web` has `EFS_ROUTES_ENABLED=false` and no `EFS_CARD_CONTROL_ENABLED` (default false). Not done: the owner walking containment step 2 once on production (§6a). |
| 2026-10-28 | — | Owner answered: use the recommendations for Q-CCF1–Q-CCF9; Hold and Override are the words (Q-CCF1 (a), Q-CCF2 (a)); OK given to edit `routes/writeProbe.ts`. |
| 2026-10-28 | CCF2 (B3, B6) | B3: `/write-check` refuses its write half with 409 `card_in_use` when the card EFS just returned was fueled in the last 30 days, by the imported `recentlyUsedRefusal` (sentence generalised to name both callers); checked after step 3 and before step 5, so a refused run sends no write and writes no settings row; read-only runs may use any card. B6: the `probe_disabled` refusal names both switches, Parameter Store and the next deploy, not "the staging API". Reverts measured: dropping the rule fails the in-use case; applying it to read-only fails the read-only case; the old sentence fails the refusal case. |
