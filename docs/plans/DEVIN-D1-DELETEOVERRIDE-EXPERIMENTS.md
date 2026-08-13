# Devin — run the D1 `deleteOverride` experiments on the QA card

Repo: FuelGuard, branch `main`. Companion: `EFS-CARD-CONTROL-FIX-PLAN.md` §D1 (why each step
exists), `docs/22-EFS-CARD-CONTROL.md` §Root cause 2026-08-12 (what Phase 0 already established).
This task is API-only — no dashboard, no WEX portal, no SOAP credentials. Same machinery as your
Phase 0 run; two new experiments on the same endpoint.

## What this run answers (record BOTH explicitly)

1. **Entitlement** — is this account provisioned for the dedicated `deleteOverride` operation
   (guide p27), or does it answer `not_allowed`/`auth`? Either answer is a finding.
2. **Post-state** — after a successful `deleteOverride`, what does EFS actually hold in the three
   override fields (`override`, `overrideAllLocations`, `locationOverride`)? 0? nil? absent?
   The response's `afterDocument` is the evidence; production's landed-verifier is checked against
   this observation, not a guess.

## Hard rules — same as Phase 0, unchanged

1. **Only the QA card ending 7671** (first in DEVIN-EFS-QA-SETUP step 7's list). Never any other
   card; never anything in the production org (`86d6b3ea-…`).
2. **You do not handle WEX credentials, ever.** The API holds them; you only call the API.
3. **Stop and report** on anything the tables below don't cover — an unexpected `writeErrorCode`,
   an HTTP 500, `changedPaths` naming anything outside the override trio (plus volatile fields).
   Do not improvise a next step.
4. When finished — or when stopping early — the card must be left with **no override** and
   **status Active**, and `EFS_CARD_CONTROL_PROBE_ENABLED` must be **unset** (redeploy to apply).
   Neither is optional.
5. Nothing here touches code; do not commit anything.

## Step 0 — Preconditions (verify, don't assume)

Infra reminder from your Phase 0 run: FuelGuard has ONE Railway environment named `production`
hosting both orgs; "QA" is the ORG `07fe4058-…`. That environment is where this runs, against the
QA org's card only.

1. The D1 commit must be deployed: `curl -s "https://fleetguardapi-production.up.railway.app/api/version?cb=$(date +%s)"`
   must show `ok: true` and a `startedAt` NEWER than the commit Miki pushes for D1. If the two new
   experiments answer `invalid_request` on the `experiment` value, the deploy predates them — stop,
   tell Miki.
2. Set `EFS_CARD_CONTROL_PROBE_ENABLED=true` on the API service (`@fleetguard/api`), literal word
   `true`, then REDEPLOY and confirm a new `startedAt`. (You correctly deleted this flag after the
   last run; it needs re-setting.)
3. `EFS_CARD_DELETE_OVERRIDE_ENABLED` must stay UNSET/false throughout — that is the production
   flag, and it only turns on after this run's findings say so. You never touch it.
4. Fresh access token plus step-up token as in DEVIN-PHASE0-EXPERIMENTS step 1 (your QA admin user;
   re-run the mint call whenever a call answers 403 `step_up_required` or the 300-second token expires).

```bash
API=https://fleetguardapi-production.up.railway.app
STEP_UP_TOKEN=$(curl -s "$API/api/auth/step-up" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"password":"<your password>"}' | jq -r .token)
```

The step-up response is `{token, expiresAt}`; use its `token` field below. `TOKEN` is the fresh access
token from the password-grant step in DEVIN-PHASE0-EXPERIMENTS.

```bash
CARD=<the full 7671 card number from DEVIN-EFS-QA-SETUP step 7>
exp() { curl -s "$API/api/fuel-cards/experiment" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "x-step-up-token: $STEP_UP_TOKEN" \
  -H "Content-Type: application/json" -d "$1"; }
```

## Step 1 — Baseline read (always first)

```bash
exp "{\"experiment\":\"read_state\",\"cardNumber\":\"$CARD\"}" | jq .
```

Record verbatim: `status` (casing included — must be ACTIVE; if not, STOP and report — the H1 fix
should have restored it, and a card on HOLD makes nothing below meaningful), `overrideUses`,
`overrideAllLocations`, `locationOverrideId`, `version`.

- If an override is ALREADY active (uses > 0): note it, **skip step 2**, and go straight to
  step 3 — the state we need already exists.

## Step 2 — Grant a 1-use override (D1a)

```bash
exp "{\"experiment\":\"set_override\",\"cardNumber\":\"$CARD\",\"uses\":1,\"confirm\":\"WRITE 7671\"}" | jq .
```

Expect `landed: true` with a reading showing `overrideUses: 1`, `overrideAllLocations: true`.
- `landed: false` with no `writeErrorCode` → the accepted-and-ignored pattern on a numeric field —
  a NEW finding (Phase 0 saw it only on status casing). Save the full JSON, STOP, report.
- `writeErrorCode` present → save it, STOP, report (the grant uses production's own echo recipe;
  a refusal here blocks D1 entirely).

## Step 3 — Delete it with the dedicated op (D1b — the run's centrepiece)

```bash
exp "{\"experiment\":\"delete_override\",\"cardNumber\":\"$CARD\",\"confirm\":\"WRITE 7671\"}" | jq . | tee d1b.json
```

Read the response against this table:

| Observation | Meaning | Next |
|---|---|---|
| `writeErrorCode: "not_allowed"` or `"auth"` | **Account NOT entitled** to the op. Finding #1 answered: NO. | Clear the override yourself with the fallback mechanism: `exp "{\"experiment\":\"clear_override\",\"cardNumber\":\"$CARD\",\"confirm\":\"WRITE 7671\"}"` — expect `landed: true`. Record both JSONs; skip steps 4–5; go to cleanup. The entitlement question joins the E6 WEX ticket. |
| `writeErrorCode: "declined"` | EFS refused with text. | Save `resultText` verbatim; STOP, report. |
| `writeErrorCode: null`, `landed: true` | **Entitled, and it works.** | Record the FIRST reading's `atMsAfterWrite` (apply latency) and go to step 4. |
| `writeErrorCode: null`, `landed: false` | Void success, override still there after 3 looks (~8s) | The accepted-and-ignored pattern on this op. Save everything, STOP, report. |

**Whatever the outcome, keep the full JSON** — especially `readings` (the trio at each look),
`changedPaths` (the op's exact footprint) and `afterDocument` (where 0-vs-nil-vs-absent is
legible). That document IS finding #2.

## Step 4 — The op against a card with NO override (edge behaviour, one call)

Only if step 3 landed. The override is now gone; call it again:

```bash
exp "{\"experiment\":\"delete_override\",\"cardNumber\":\"$CARD\",\"confirm\":\"WRITE 7671\"}" | jq .
```

Record whether a no-op delete is a void success, a decline, or a fault — production will
inevitably hit this case (an operator clearing an already-spent exception), and the answer decides
nothing today but must be in the record.

## Step 5 — Product-override half (SKIP unless Miki says go)

Fix plan D1 step 3 wants to know whether `deleteOverride` restores the limits array after a
p194 PRODUCT override (the B4 decision point). That requires a product override to exist, which
only Miki can set up (WEX portal, QA card). If he has: run `read_state` (record the limits),
`delete_override`, `read_state` again — does the limits array come back by itself? Record yes/no
with both documents. If he hasn't: record "step 5 not run — no product override was staged" and
move on. Do not attempt to create one yourself; there is no endpoint for it, by design.

## Step 6 — Cleanup and report

1. `read_state` one final time: `overrideUses` must be 0/null and `status` Active — say so
   explicitly in the report. If an override survives, run `clear_override` (the fallback echo
   mechanism) and re-read; if it STILL survives, say so PROMINENTLY — Miki clears it in the
   drawer or portal.
2. Unset `EFS_CARD_CONTROL_PROBE_ENABLED`; redeploy; confirm.
3. Report: the two findings stated in one sentence each (entitled: yes/no; post-state: what the
   three fields read after a successful delete, quoting `afterDocument`), the step-3 and step-4
   full JSONs attached, apply latency, step 5's answer or why it didn't run, the card's final
   state, confirmation the flag is unset and no call ever targeted any card but 7671.

Miki then writes the findings into `docs/22-EFS-CARD-CONTROL.md` §D1 and decides
`EFS_CARD_DELETE_OVERRIDE_ENABLED` — the fallback (setCardv2 three-field clear) stays the
production mechanism until that flag turns on, so nothing is waiting on this run except the flag.
