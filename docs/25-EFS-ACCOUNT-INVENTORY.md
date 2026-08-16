# EFS account inventory — Step 7.6

> ## ⛔ THIS DOCUMENT IS NOT YET THE INVENTORY. Four of twelve questions are answered, for QA only.
>
> **Status: 🟡 QA partial · ⛔ production nothing.** Miki ran `efs.mjs scan` against QA on
> 2026-08-16, which answers questions 2, 4, 11 and 12 — for QA. The other eight need
> `efs.mjs inventory`, and **every production answer is still missing**, including the half of
> question 11 that makes it a comparison at all.
>
> The instrument was built in a session with no credentials and no route to the vendor — verified,
> not assumed: `env | grep -c "^EFS_\|^SUPABASE_"` → 0, and the proxy answers 403 to `CONNECT` for
> `*.up.railway.app`.
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
| 2 | Which Info IDs does it **use**? | `config-scan` over the mirror | scan `fields[]` | 🟡 **QA: `DRID`, `UNIT`, `NAME` — and only on 7 of 35 cards.** Production ⛔ |
| 3 | Is **odometer following** configured — on which field, with what accrual value? | `getPolicy` per policy + `getProducts` | `inventory.policies[].policy` | ⛔ UNANSWERED |
| 4 | The account's exact **vocabulary for every writable string field** | `config-scan` | scan `fields[].rawSpellings` | 🟡 **QA: recorded below.** Production ⛔ |
| 5 | Which **limit IDs**, with what values? | `getPolicy` per policy; `getProducts` for the codes | `inventory.policies[].policy.limits` | ⛔ UNANSWERED |
| 6 | Are **refreshing limits** set, and where? | `getPolicyRefreshingLimits`; `getCardRefreshingLimits` per sample card | `inventory.policies[].refreshingLimits` | ⛔ UNANSWERED |
| 7 | Real **credit ceilings** | `getCreditLimits` per contract | `inventory.creditLimits[]` | ⛔ UNANSWERED |
| 8 | Are **location groups** in use? | `getCarrierInfo.locationGroups`, then `getLocationGroupDescriptions` | `inventory.carrierInfo`, `inventory.locationGroups` | ⛔ UNANSWERED |
| 9 | Are **time restrictions** in use? | `getPolicy` per policy; sample cards | `inventory.policies[].policy.timeRestrictions` | ⛔ UNANSWERED |
| 10 | What does **each policy** set? | `getPolicyDescriptions` + `getPolicy` | `inventory.policies[]` | ⛔ UNANSWERED |
| 11 | **Production's document shape**, and does it match QA's? | `config-scan` `observedDocumentShape` | scan `recorded.observedDocumentShape` | 🟡 **QA: `nested:header`.** Production ⛔ — this question is a COMPARISON and half of it is missing |
| 12 | Any field **production sends that we do not model** | `config-scan` — **refuses with 422** | `unmodelledFields[]` | 🟡 **QA: NONE — the scan returned 200 over 35 of 35 documents.** Production ⛔ |

> **Question 8 gates several others.** `getCarrierInfo.locationGroups` is an account-level capability
> flag, not a list. If it is false, the whole location-group mechanism is off for this carrier and
> every location-group question in Phase 12 is moot. Read it first — it is why it leads the sequence.

> **Question 12 cannot come back "none" by default.** The scan REFUSES on an unmodelled field rather
> than reporting one, so a 422 here is the answer, not a failure. `MODELLED_CARD_FIELDS` covers every
> field the WSDL declares (`efsCardFields.test.ts`), so anything it reports is a field EFS sends
> **undeclared** — which this account has already done twice, with a `status` outside the documented
> enum and an unrecognised `infosrc`.

---

## QA config scan — 2026-08-16, run by Miki

**Org: QA `07fe4058-cc72-4a69-b3e9-29b4cf1c6a44`. Source: `mirror.last_response_xml_redacted`, 35 of
35 cards carrying a stored document, `cardsWithoutStoredDocument: 0`, synced 01:58:52Z → 17:22:53Z
the same day.** A complete, fresh corpus — so `unobserved` here means "this account does not emit
that value", not "we did not look properly".

This is the CONFIG SCAN, which answers four of the twelve questions. **The other eight need
`efs.mjs inventory`**, which is still unrun.

| Field | Values observed | Coverage |
|---|---|---|
| `infoId` | `DRID` ×7 · `UNIT` ×6 · `NAME` ×5 | 18 records across **7 of 35 cards**; 28 absent |
| `validationType` | `EXACT_MATCH` ×9 · `REPORT_ONLY` ×9 | same 7 cards |
| `status` | `ACTIVE` ×33 · `INACTIVE` ×2 | all 35 |
| `overrideAllLocations` | `false` ×35 | all 35 |

**Document shape: `nested:header`.** Whether production matches is question 11 and is still open —
the question is a comparison, and one side of it does not exist yet.

### Four things this settles, and one it does not

**1. No unmodelled fields on QA.** The scan returned 200, not the 422 it is built to return when a
document carries a field `MODELLED_CARD_FIELDS` does not know (Step 7.3). Across 35 of 35 documents,
QA sends nothing undeclared. **This says nothing about production**, which is the org that has
produced undeclared fields twice.

**2. Three Info IDs in use, on a fifth of the fleet.** `EFS_EDITABLE_INFO_IDS` is a list this
codebase chose; this is what QA actually carries. 28 of 35 cards have **no card-level prompts at
all** — consistent with `infoSource: BOTH` and the prompts living on the policy. Question 1 (what the
account HAS, via `getPromptTypes`) is the other half and is still unrun; the difference between the
two is what scopes Phase 9.

**3. The case mismatch is confirmed as account-wide, not a one-card oddity.** `card_unlock` verdicts
`Active` → `observed_differently_cased` as `ACTIVE`, and `card_lock`'s `Inactive` → `INACTIVE`. This
is why `canonicalEfsStatus` exists and why the list route filters with `ilike` rather than `eq`.

**4. `overrideAllLocations` is `false` on all 35, exactly as `docs/22` H2/H3 recorded.** So
`override_grant` remains correctly unpromotable on QA, and `override_clear` with it.

**And the one it does not settle: `card_lock` is `unobserved`.** Its expected `Hold` appears on no QA
card, because **no QA card is at Hold** — the blocker Step 0.13 recorded, and a fixture Miki has to
create in the WEX portal. The scan cannot manufacture it.

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
