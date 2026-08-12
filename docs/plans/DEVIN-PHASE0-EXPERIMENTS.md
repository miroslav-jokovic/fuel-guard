# Devin — run the Phase 0 `no_change` experiments (E1–E5) on the QA card

Repo: FuelGuard, branch `main`. Companion docs: `EFS-PHASE0-EXPERIMENTS-RUNBOOK.md` (the science),
`EFS-CARD-CONTROL-FIX-PLAN.md` Phase 0 (why each experiment exists). This task is API-only — no
dashboard, no WEX portal, no SOAP credentials.

## Hard rules

1. **Only the first QA card in DEVIN-EFS-QA-SETUP step 7's list (ends 7671).** Never any other
   card number, never anything in the production org (`86d6b3ea-…`).
2. **Only statuses `Active`, `Hold`, `Inactive` (any casing).** The endpoint refuses anything else;
   do not try to work around that.
3. **You do not handle WEX credentials, ever.** The API holds them; you only call the API.
4. **Stop and report** if any response surprises you — a `changedPaths` naming anything besides
   `/header/status` (plus `/header/originalStatus` in E4), an HTTP 500, a `writeErrorCode` you
   can't map to the runbook's table. Do not improvise a next step.
5. When finished — or when stopping early — **revert the card to Active** (step 6) and **unset
   `EFS_CARD_CONTROL_PROBE_ENABLED`** (step 7). Neither is optional.
6. Work against the QA ORG only (card 7671); never the production org. Nothing here touches code; do not commit anything.

## Step 0 — Preconditions (verify, don't assume)

**Infra note (corrects an earlier version of this doc).** FuelGuard runs ONE Railway environment,
named `production`, that hosts BOTH orgs. "QA" here is an **org** (`07fe4058-…`), not a separate
deployment — the safety comes from the org gates, not from a separate environment. So the single
Railway `production` environment IS where these experiments run, against the QA ORG's card only.
The production ORG (`86d6b3ea-…`) stays untouched: it has no card-control settings row, so every
write gate is shut for it regardless of the deploy-wide flag.

1. **Migrations 0179 and 0180 must be applied.**
   `curl -s "https://<api-host>/api/version?cb=$(date +%s)"` must show `schema.applied` ≥ `0180`,
   `state: current`, `drift: false`, `ok: true`. If it reports `0178`/`behind`/`ok:false` — STOP.
   Migrations auto-apply via the `Apply Supabase migrations` GitHub Action when a `supabase/migrations/**`
   file lands on `main`; if the API is behind, that Action has not run/succeeded for these commits.
   This is Miki's to resolve (push the Phase 0–2 commits, confirm the migrate Action is green) — do
   not attempt to apply migrations yourself.
2. Set `EFS_CARD_CONTROL_PROBE_ENABLED=true` on the **API service** (`@fleetguard/api`). The parser
   accepts only the literal word `true` (`1`/`yes`/`on` silently evaluate to false). Setting a
   variable does NOT always trigger a redeploy — after setting it, redeploy the existing API
   deployment and confirm a new `startedAt` via `/api/version` before continuing. (You correctly
   deleted this flag on your last run per the cleanup rule; it needs re-setting now.)
3. You have your own **admin user on the QA org** (`07fe4058-…`), created via the invite flow per
   DEVIN-EFS-QA-SETUP §3a — your email, your password; ask Miki to send the invite if you don't.
   Miki's account and password are not available to you.

## Step 1 — Get a fresh token (repeat whenever a call answers 403 `step_up_required`)

The experiment endpoint demands a sign-in **fresh within 5 minutes**. A new password-grant login
satisfies it; re-run this before each batch of calls:

```bash
TOKEN=$(curl -s "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_ANON_KEY}" -H "Content-Type: application/json" \
  -d '{"email":"<your QA admin email>","password":"<your password>"}' | jq -r .access_token)
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` are readable from the web service's Railway variables
(`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`). Your password never goes anywhere but Supabase.

```bash
API=https://<api-host>
CARD=<the full card number from DEVIN-EFS-QA-SETUP step 7, first in the list>
exp() { curl -s "$API/api/fuel-cards/experiment" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$1"; }
```

## Step 2 — E1, read-only state (run first, always)

```bash
exp "{\"experiment\":\"read_state\",\"cardNumber\":\"$CARD\"}" | jq .
```

Record verbatim: `status` (THE CASING MATTERS), `version`, `documentShape`.
- `status` already Hold/HOLD → **H2 is confirmed** (the 2026-08-12 write landed late). Revert
  (step 6), still run E2 once for casing evidence, then jump to the report.
- `status` Active/ACTIVE → continue.

## Step 3 — E2…E5, one at a time, reverting to Active between each

Confirm string is literally `WRITE 7671`. After each experiment, run the revert (step 6) **before**
the next one — a card already on Hold makes the next lock prove nothing.

```bash
# E2 — uppercase casing (H1)
exp "{\"experiment\":\"set_status\",\"cardNumber\":\"$CARD\",\"status\":\"HOLD\",\"variant\":\"standard\",\"confirm\":\"WRITE 7671\"}" | jq .
# E3 — qualified rpc/literal wrapper (H5)
exp "{\"experiment\":\"set_status\",\"cardNumber\":\"$CARD\",\"status\":\"Hold\",\"variant\":\"qualified_wrapper\",\"confirm\":\"WRITE 7671\"}" | jq .
# E4 — originalStatus supplied (H3)
exp "{\"experiment\":\"set_status\",\"cardNumber\":\"$CARD\",\"status\":\"Hold\",\"setOriginalStatus\":\"Active\",\"variant\":\"standard\",\"confirm\":\"WRITE 7671\"}" | jq .
# E5 — setCard v1 (provisioning; the endpoint refuses if the card has limits)
exp "{\"experiment\":\"set_status\",\"cardNumber\":\"$CARD\",\"status\":\"Hold\",\"variant\":\"setcard_v1\",\"confirm\":\"WRITE 7671\"}" | jq .
```

**You may stop early:** the first experiment with `"landed": true` is the answer. Run its revert,
then skip the remaining experiments EXCEPT record that you skipped them and why.

Each response's keepers: `landed`, `readings` (status+version at ~0/+3/+8s — a landing at +3s/+8s
is H2 evidence and the latency number the fix plan wants), `writeErrorCode`, `changedPaths`,
`requestXmlRedacted`, `responseXmlRedacted`. Save the full JSON of every call.

## Step 6 — Revert

Use whichever variant most recently landed (or `standard` if none has):

```bash
exp "{\"experiment\":\"set_status\",\"cardNumber\":\"$CARD\",\"status\":\"Active\",\"variant\":\"<variant>\",\"confirm\":\"WRITE 7671\"}" | jq .
```

If NO variant can move the card and E1 showed it stuck on Hold: report it prominently — Miki
restores it in the WEX portal (you don't have portal access, correctly).

## Step 7 — Clean up and report

1. Unset `EFS_CARD_CONTROL_PROBE_ENABLED` on the API service; confirm the redeploy.
2. Report: the runbook's results table filled in; every raw JSON response attached; the E1 casing
   observation; which hypothesis the evidence supports and why, in two sentences; the card's final
   status (must be Active — say so explicitly); confirmation the flag is unset and that no call
   ever targeted any card but 7671.

Miki then writes the root cause into `docs/22-EFS-CARD-CONTROL.md` and the fix plan picks the
matching change (H1→casing map · H2→verify-delay tuning · H3→originalStatus edit · H5→wrapper
change · all-fail→WEX ticket per runbook E6, which also asks about request rates, deleteOverride,
and product-override sandbox behavior).
