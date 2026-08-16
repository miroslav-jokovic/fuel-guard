# EFS account inventory — Step 7.6

> ## ⛔ THIS DOCUMENT IS NOT YET THE INVENTORY. It is the instrument for producing one.
>
> **Every answer below is UNANSWERED.** Step 7.6 is a live scan of a real EFS account, and the
> session that built the instrument (2026-08-16) had no credentials and no network route to the
> vendor — verified, not assumed: `env | grep -c "^EFS_\|^SUPABASE_"` → 0, and the proxy answers 403
> to `CONNECT` for `*.up.railway.app`.
>
> **Nothing here may be filled in from the WSDL, the integration guide, or reasoning.** The whole
> point of Step 7.6 is what THIS ACCOUNT actually says, and the plan is explicit about what happens
> if the answers differ from what Phases 9–12 assume: *"if it contradicts an assumption there, stop
> and re-scope."* An inventory assembled from the documentation could not contradict anything, which
> is exactly why it would be worthless.
>
> Standing rule 2: **never fabricate a verification.** Paste the command and its actual output.

---

## How to produce it

Run from a machine that can reach the API — historically Miki's Mac; see `docs/35` §1 for why a
remote container cannot. `scripts/efs.mjs` requires a TTY (it prompts for the token with no echoing
fallback), so this cannot be run headless without `--token-from-env`.

```bash
# QA and production are two ORGS in one deployment. The token decides which one you are reading.
# Copy an admin token from the browser console of the org you mean to scan — the CLI prints the
# snippet. Getting this wrong is not theoretical: docs/22 H10 is a drill that suspended the wrong org.

node scripts/efs.mjs inventory > docs/efs/account-inventory-qa.json          # with a QA token
node scripts/efs.mjs inventory > docs/efs/account-inventory-production.json  # with a production token

# Optional, and charged separately — three vendor calls per card, UUIDs only, never card numbers:
node scripts/efs.mjs inventory --cards <efs_cards.id>,<efs_cards.id>

# The unmodelled-field check, which REFUSES rather than reporting a partial answer (Step 7.3):
node scripts/efs.mjs scan
```

Commit both JSON files. `truncated` in each response names anything the 28-request budget left out —
if it is non-empty, raise `MAX_CONTRACTS` / `MAX_POLICIES` and `INVENTORY_REQUEST_BUDGET` in
`apps/api/src/routes/fuelCards/inventory.ts` together, and re-run. **A truncated walk must not be
written up as a complete one.**

---

## The eleven questions, and where each answer comes from

Step 7.6 lists exactly these. Each row names the operation that answers it and the path in the
inventory JSON, so filling this in is transcription rather than interpretation.

| # | Question | Answered by | JSON path | Answer |
|---|---|---|---|---|
| 1 | Which Info IDs does the account **have**? | `getPromptTypes` | `inventory.promptTypes` | ⛔ UNANSWERED |
| 2 | Which Info IDs does it **use**? | `config-scan` over the mirror | scan `fields[]` | ⛔ UNANSWERED |
| 3 | Is **odometer following** configured — on which field, with what accrual value? | `getPolicy` per policy + `getProducts` | `inventory.policies[].policy` | ⛔ UNANSWERED |
| 4 | The account's exact **vocabulary for every writable string field** | `config-scan` | scan `fields[].rawSpellings` | ⛔ UNANSWERED |
| 5 | Which **limit IDs**, with what values? | `getPolicy` per policy; `getProducts` for the codes | `inventory.policies[].policy.limits` | ⛔ UNANSWERED |
| 6 | Are **refreshing limits** set, and where? | `getPolicyRefreshingLimits`; `getCardRefreshingLimits` per sample card | `inventory.policies[].refreshingLimits` | ⛔ UNANSWERED |
| 7 | Real **credit ceilings** | `getCreditLimits` per contract | `inventory.creditLimits[]` | ⛔ UNANSWERED |
| 8 | Are **location groups** in use? | `getCarrierInfo.locationGroups`, then `getLocationGroupDescriptions` | `inventory.carrierInfo`, `inventory.locationGroups` | ⛔ UNANSWERED |
| 9 | Are **time restrictions** in use? | `getPolicy` per policy; sample cards | `inventory.policies[].policy.timeRestrictions` | ⛔ UNANSWERED |
| 10 | What does **each policy** set? | `getPolicyDescriptions` + `getPolicy` | `inventory.policies[]` | ⛔ UNANSWERED |
| 11 | **Production's document shape**, and does it match QA's? | `config-scan` `observedDocumentShape` | scan `recorded.observedDocumentShape` | ⛔ UNANSWERED |
| 12 | Any field **production sends that we do not model** | `config-scan` — **refuses with 422** | `unmodelledFields[]` | ⛔ UNANSWERED |

> **Question 8 gates several others.** `getCarrierInfo.locationGroups` is an account-level capability
> flag, not a list. If it is false, the whole location-group mechanism is off for this carrier and
> every location-group question in Phase 12 is moot. Read it first — it is why it leads the sequence.

> **Question 12 cannot come back "none" by default.** The scan REFUSES on an unmodelled field rather
> than reporting one, so a 422 here is the answer, not a failure. `MODELLED_CARD_FIELDS` covers every
> field the WSDL declares (`efsCardFields.test.ts`), so anything it reports is a field EFS sends
> **undeclared** — which this account has already done twice, with a `status` outside the documented
> enum and an unrecognised `infosrc`.

---

## What to do with the answers

1. **Fill in the table above**, quoting the raw evidence and naming the source operation, per the
   step's Verify.
2. **Compare against Phases 9–12.** The plan: *"This document scopes Phases 9–12 — if it contradicts
   an assumption there, stop and re-scope."* Two assumptions worth checking first, because both are
   already known to be shaky:
   - `EFS_EDITABLE_INFO_IDS` is a list **this codebase chose**. Question 1 is the list the ACCOUNT
     has. Phase 9 is scoped by the difference.
   - `docs/22` H2 records that this account reports `overrideAllLocations: false` on all 35 QA and
     234 production cards, so `override_grant` stays correctly unpromotable. Question 8 is the
     account-level flag behind that.
3. **Then, and only then, remove the banner at the top of this file.**

---

## Provenance rules for whoever fills this in

- **Name the org.** QA `07fe4058-cc72-4a69-b3e9-29b4cf1c6a44`, production `86d6b3ea…`. A scan that
  cannot say which account it read is not evidence for a sentence about production.
- **Name the commit and the timestamp.** `config-scan` reads the mirror, and `unobserved` from a
  fresh complete corpus is a different finding from `unobserved` from a stale partial one — the
  response's `provenance` block carries `cardsWithoutStoredDocument` and the freshness range for
  exactly this reason.
- **No PANs.** Reference cards by `efs_cards.id`, or by masked last four where a human needs to
  recognise one — and on this fleet a last four names a GROUP, not a card (`docs/22` H7: 40 last-4
  groups hold more than one live card). Rule 13.
