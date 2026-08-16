# EFS account inventory — Step 7.6

> ## 🟡 PARTIAL. Four of twelve questions answered, for BOTH orgs. The other eight are captured but unread.
>
> **Status: config scan run against QA and production on 2026-08-16** — questions 2, 4, 11 and 12 are
> answered for both, and question 11 is now a real comparison rather than half of one. The account
> inventory ran against both orgs too, into
> `docs/efs/account-inventory-{qa,production}.json`; **those files answer the remaining eight and
> have not yet been read into this document.**
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

# --expect-org REFUSES if the token is not the org you named, before reading anything and before
# writing a byte. Use it every time: on 2026-08-16 three consecutive runs used a QA token, and the
# second wrote QA data into a file called `account-inventory-production.json`. A mislabelled
# inventory is worse than a missing one, because it becomes the record.

node scripts/efs.mjs inventory --expect-org qa         > docs/efs/account-inventory-qa.json
node scripts/efs.mjs inventory --expect-org production > docs/efs/account-inventory-production.json

# ⚠ A PRODUCTION token comes from being signed into the PRODUCTION app. The browser-console snippet
# copies the token for whichever org that tab is signed into — so if you are signed into QA, you get
# a QA token no matter which file you redirect it to. Sign into production first.

# Optional, and charged separately — three vendor calls per card, UUIDs only, never card numbers:
node scripts/efs.mjs inventory --cards <efs_cards.id>,<efs_cards.id>

# The unmodelled-field check, which REFUSES rather than reporting a partial answer (Step 7.3):
node scripts/efs.mjs scan --expect-org production
```

> ⚠️ **Never paste a token where it can be echoed.** The prompt is raw-mode and does not echo, but a
> token pasted into a shell that is NOT at that prompt lands in scrollback and in shell history. If
> one is exposed, sign that session out — an admin token is an hour of full org access.
>
> **Each account-wide command now names the org it resolved from the SERVER before it acts.** On
> 2026-08-16 a run intended for production used a QA token, read QA, and returned output identical to
> the previous QA scan — the mistake was invisible in the result. `docs/22` H10 is the same shape with
> teeth. If the banner does not say `QA / sandbox`, you are on production.
>
> **The redirect works because the CLI keeps its streams apart** — human-facing lines (the token
> prompt, the instructions, progress) go to **stderr**, and only the JSON result goes to **stdout**.
> That was not true until 2026-08-16: the prompt was written to stdout, so this exact documented
> command swallowed it and sat waiting on stdin, indistinguishable from a hang. `pnpm lint:cli-streams`
> is the gate that keeps it true.

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
| 2 | Which Info IDs does it **use**? | `config-scan` over the mirror | scan `fields[]` | ✅ **QA: 3** (`DRID`,`UNIT`,`NAME`) on 7/35. **Production: 8** (`DRID`,`NAME`,`TRIP`,`TRLR`,`UNIT`,`CNTN`,`DLIC`,`DLST`) on 162/199 |
| 3 | Is **odometer following** configured — on which field, with what accrual value? | `getPolicy` per policy + `getProducts` | `inventory.policies[].policy` | ⛔ UNANSWERED |
| 4 | The account's exact **vocabulary for every writable string field** | `config-scan` | scan `fields[].rawSpellings` | ✅ **Both recorded below** |
| 5 | Which **limit IDs**, with what values? | `getPolicy` per policy; `getProducts` for the codes | `inventory.policies[].policy.limits` | ⛔ UNANSWERED |
| 6 | Are **refreshing limits** set, and where? | `getPolicyRefreshingLimits`; `getCardRefreshingLimits` per sample card | `inventory.policies[].refreshingLimits` | ⛔ UNANSWERED |
| 7 | Real **credit ceilings** | `getCreditLimits` per contract | `inventory.creditLimits[]` | ⛔ UNANSWERED |
| 8 | Are **location groups** in use? | `getCarrierInfo.locationGroups`, then `getLocationGroupDescriptions` | `inventory.carrierInfo`, `inventory.locationGroups` | ⛔ UNANSWERED |
| 9 | Are **time restrictions** in use? | `getPolicy` per policy; sample cards | `inventory.policies[].policy.timeRestrictions` | ⛔ UNANSWERED |
| 10 | What does **each policy** set? | `getPolicyDescriptions` + `getPolicy` | `inventory.policies[]` | ⛔ UNANSWERED |
| 11 | **Production's document shape**, and does it match QA's? | `config-scan` `observedDocumentShape` | scan `recorded.observedDocumentShape` | ✅ **`nested:header` on BOTH — they match** |
| 12 | Any field **production sends that we do not model** | `config-scan` — **refuses with 422** | `unmodelledFields[]` | ✅ **NONE on either.** Production returned **200 over 199/199 documents**, 0 unparseable |

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

**And one reading to be careful about, because I got it wrong first: `card_lock: unobserved` is NOT
a statement that card_lock is unproven.**

It is a VOCABULARY observation. The scan reads stored documents and reports which spellings this
account emits; no QA card is currently *sitting* at `Hold`, so the string never appears in the
corpus. That is all it says.

**`card_lock` is proven live and has been since 2026-08-15**: `pnpm efs:prove card_lock` ran green
end to end against QA ••••7671, proof `40b88b75`, OEG-1/3/4/5 true, card restored to ACTIVE (`docs/28`
Phase 4 exit gate). That test *sets* a card to Hold and reverts it — it manufactures the state the
scan cannot see, which is exactly why the two instruments exist side by side.

The genuine gap Step 0.13 records is narrower and is about FIXTURES, not capability: no QA card
*rests* at Hold, so a test that needs to observe one without creating it has nothing to look at.
Phases 9–12 need those resting fixtures made in the WEX portal; `card_lock` itself is not waiting on
them.

---

## Production config scan — 2026-08-16, run by Miki

**Org `86d6b3ea-4361-4f71-877f-e8373615769b`, announced by the CLI as "NOT the known QA org — treat
as production". 199 of 199 cards carrying a stored document, `cardsWithoutStoredDocument: 0`,
`documentsUnparseable: 0`.** Shape `nested:header`.

| Field | Values observed | Coverage |
|---|---|---|
| `infoId` | `DRID` 162 · `NAME` 162 · `TRIP` 162 · `TRLR` 162 · `UNIT` 162 · `CNTN` 161 · `DLIC` 128 · `DLST` 128 | 1227 records across **162 of 199**; 37 absent |
| `validationType` | `REPORT_ONLY` 904 · `EXACT_MATCH` 323 | same 162 cards |
| `status` | `ACTIVE` 129 · `INACTIVE` 38 · **`HOLD` 32** | all 199 |
| `overrideAllLocations` | `false` ×199 | all 199 |

### What production settles that QA could not

**1. Production sends nothing we do not model.** The scan returned **200, not 422**, across 199 of
199 documents with none unparseable. That is Step 7.3's substance answered at fleet scale — and it is
a stronger answer than the `getCardV2.production.xml` fixture the step asks for, which could only
ever cover the fields one card happened to carry.

**2. The document shape matches QA.** `nested:header` on both, so question 11 is answered rather than
half-answered, and the Phase 4 promotion gate's shape comparison has both sides.

**3. `card_lock` is `match` on production — 32 cards are at `HOLD`.** This is the direct answer to
the QA `unobserved` I misreported as a blocker: QA has no card resting at Hold, production has 32.
`Hold` → `HOLD` and `Inactive` → `INACTIVE`, both `observed_differently_cased`, which is exactly what
`canonicalEfsStatus` exists for.

**4. `overrideAllLocations` is `false` on all 199**, at fleet scale, confirming `docs/22` H2/H3.
`override_grant` and `override_clear` stay correctly `unobserved` for `true`, and unpromotable.

### ⚠ Two findings that are NOT answers to the twelve questions

**Production uses EIGHT prompt types; the product may EDIT two.** `EFS_EDITABLE_INFO_IDS` is
`["DRID", "UNIT"]`. On 162 of 199 production cards EFS also carries `NAME`, `TRIP`, `TRLR`, `CNTN`,
and on 128 of them `DLIC` and `DLST` (driver's licence number and state).

**This is a Phase 9 SCOPE fact, not a data-loss risk, and I checked rather than assumed.**
`promptsEdits` passes non-editable records through *"EXACTLY as EFS sent them"* — its docblock names
`ODRD, TRIP, TRLR, NAME, PPIN, CNTN` specifically, and `efsCardEdits.test.ts` →
*"passes non-editable records through untouched"* holds it. So a `replaceAll` on one of those 162
cards preserves the six it cannot edit. What an operator cannot do is CHANGE them here; that stays in
the WEX portal until Phase 9 widens the list. `DLIC`/`DLST` were not in that docblock's list and are
licence data — worth a deliberate decision before they become editable.

**The production corpus is a day old, and that is not a defect.** `newestSyncedAt` is
`2026-08-15T19:37:11Z` — the manual sweep from Step 7.7's linking run.

> **⚠ I first read this as a scheduler that had stopped, and the arithmetic says otherwise.** That
> sweep finished `2026-08-15T19:37:19Z`; the next reading was `2026-08-16T18:07:30Z`. **22h 30m
> against a 24h `EFS_CARD_SYNC_HOURS`** — not overdue, just not yet due. A finding I could have
> checked with a subtraction and did not.

What IS still open is narrower: Step 7.5's *"after one sweep, every production card has
`detail_synced_at`"* needs a sweep running the code that shipped today. One was triggered by hand at
`2026-08-16T18:07:30Z` (job `79a40862`); its stats are the check.

---

## Production account inventory — 2026-08-16, partial reading

**Only the TAIL of `docs/efs/account-inventory-production.json` has been read into this document so
far** (products, location groups, site policies, server time). `ok`, `truncated`, `carrierInfo`,
`promptTypes`, `contracts`, `creditLimits` and `policies` are in the head of that file and are **still
unread** — so questions 1, 3, 5, 6, 7, 8 and 10 stay ⛔ below. Commit the file and they can be read
directly rather than transcribed.

### Q8 (partial) — location groups: 18, and **every one is vendor-managed**

```
grpId 1 "All" · 1276 "Pacific Pride" · 1278 "CANADA" · 1380 "IDLEAIRE" · 2085 "WILCO"
2135 "All Irving Locations" · 2137 "ESSO" · 2138 "PETRO CANADA" · 2165 "All Loves"
2188 "US Locations" · 2254 "CAT SCALES" · 2612 "All Pilot & Flying J" · 2613 "TA & Petro"
2614 "PDCA / B2B" · 3223 "Ambest" · 10342 "ROADSYNC" · 10343 "UCHAIN GROUP" · 10887 "EXXONMOBIL"
```

**All eighteen are `ruleBased: true` and `editable: false`.** That is a Phase 12 scoping fact, not a
detail:

- **Rule-based membership is computed by EFS**, so `getLocGrpLocs` cannot enumerate what is in one.
  Any UI that promises "which stations does this group cover" cannot be built from this account.
- **None is editable**, so creating or amending a group is a WEX-portal action, not something this
  product can offer. Phase 12 is a READ surface on this account unless that changes.

They are recognisable brands and networks (Pilot/Flying J, TA & Petro, Loves, Ambest, ExxonMobil,
Irving, Esso, Petro-Canada), which is consistent with WEX maintaining them centrally rather than per
carrier.

### A site policy really does come back with no policy behind it

```json
{ "sitePolicy": 501, "siteDescription": "PFJ",
  "sitePolicyPolicy": { "contractId": 0, "description": "All Policies", "policyNumber": 0 } },
{ "sitePolicy": 502, "siteDescription": "All TA PETRO", "sitePolicyPolicy": null }
```

`502` carries `sitePolicyPolicy: null` — the nillable case Step 7.1's WSDL-derived fixture predicted
and `efsAccountOps.test.ts` → *"getSitePolicyDescriptions keeps a site policy with no policy behind
it"* asserts. **The fixture was written from the WSDL with no production data available, and
production produced exactly that shape.** One small piece of evidence that the WSDL-derived approach
was not merely convenient.

Note also `policyNumber: 0` with description `All Policies` — a SENTINEL, not a real policy. Step
7.2's walk guards `n < 1 || n > 99` before calling `getPolicy`, so it will not ask EFS about policy 0
and earn the "Invalid policy number" false alarm `/diagnose` has already recorded once.

### `serverTime` confirms the guide's Central-Time note, in production

```
"serverTime": "2026-08-16T13:01:57.000-05:00"   ==  18:01:57Z
```

An explicit `-05:00` offset — Central Time, exactly as p10-11 describes, and the reason
`parseEfsDateTime` exists rather than a bare `new Date()`. Read minutes before our own 18:07:30Z
sweep, so **EFS's clock and ours agree to within minutes**; there is no gross skew to account for.

### ⚠ Seven product groups have no label in this product

`getProducts` returns the account's full catalog. Cross-referencing the `group` values against
`EFS_LIMIT_LABELS` (60 entries):

```
ACCE · CWAS · HOTL · HYDR · PARK · TCHN · TWAS
```

`limitLabel()` falls back to the raw code, so a limit set on any of these renders as `HYDR` rather
than "Hydrogen". Cosmetic today — none of the seven is known to carry a limit on this fleet — and a
Phase 11 input: hydrogen, EV charging and parking are the ones a fleet is most likely to start using.

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
