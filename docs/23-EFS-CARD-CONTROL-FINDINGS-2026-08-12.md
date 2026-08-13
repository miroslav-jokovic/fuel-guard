# EFS Card Control — Combined Findings Report

**Date:** 2026-08-12
**Scope:** EFS Card Control only. Transaction and rejection ingest is explicitly **out of scope** (confirmed working).
**Status:** Analysis only. **No code was modified.**

**Sources analysed**

| # | Source | What it gave us |
|---|---|---|
| 1 | `docs/EFS LLC Card Web Service Integration Guide .pdf` — *WEX OTR Card Management Web Service Reference, v12.0, July 2024* (8,253 lines of extracted text) | Field semantics, the Info ID / Limit ID code tables, and the **Overrides appendix (p194)** — the single most important page for issue #2 |
| 2 | `CardManagementWS` WSDL (`https://ws.partner.efsllc.com/axis2/services/CardManagementWS/`) — provided in-session | Authoritative operation and type surface: **131 operations**, RPC/literal |
| 3 | FuelGuard codebase — `apps/api`, `apps/web`, `packages/shared`, `supabase/migrations`, `docs/` | Actual implementation, file:line |
| 4 | Web research — WEX developer materials, fleet card control practice guides (Aug 2026) | Industry baseline for what "enterprise-grade card control" means |

> **Housekeeping:** the WSDL is not yet in the repo. Recommend saving it as `docs/efs/CardManagementWS.wsdl` and pinning the retrieval date — several of the findings below turn on `setCardv2` vs `setCardV2` casing and on v2-only fields, and a checked-in WSDL is the only defence against that drifting silently.
>
> I also left a scratch tarball at `_to_delete/fgpack/fg-src.tar.gz` in your repo (used to stage the source into the analysis sandbox). Safe to delete.

---

## 0. Executive summary

The card-control **write engine is genuinely well built** — better than most integrations of this kind. Ledger-before-dispatch, a mandatory verifying re-read with a second look, an echo-fidelity guard that refuses to send a request that isn't "the getCard response plus exactly these edits," and "we don't know" as a first-class terminal outcome. That machinery should survive everything proposed below intact.

The problems are all **at the edges of that engine**, and they fall into four groups that map exactly onto what you reported:

1. **Prompts** — the *catalog* is complete (all 26 Info IDs, all 7 validation types), but the *reachable surface* is hardcoded to **2 Info IDs × 2 validation types**, there is no "Add prompt" control anywhere in the UI, and `getPromptTypes` is never called. Worse: there is an **active data-loss bug** where a `REPORT_ONLY` prompt gets silently deleted on save, reproducible on the QA card you test with.
2. **Override amount** — not a bug, an unbuilt feature. EFS's "override amount" is not a field; it's the **product-limits recipe on p194** (echo everything except `limits`, then add back a `limits[]` array). We send three header fields and no limits array. The amount has no input, no schema field, and no wire representation — it is lost at layer one, not in serialization.
3. **Full EFS capacity** — of EFS's card-capacity surface we currently **write exactly three things**: `status`, the three override header fields, and a 2-ID prompts array. Product limits, refreshing/velocity limits, `getCreditLimits`, time restrictions, location groups, the blocked-locations list and `handEnter` are all read-only or absent.
4. **UI/UX** — your instinct is right, and the code half-agrees with you already. One drawer with one generic title, shared drafts, a shared version, a shared error channel and one footer serves **five unrelated consequences**. Fourteen concrete confusion defects are enumerated in §5.

Separately, and **more urgent than any of the four**: §6 documents a path by which a write entitlement proven against the **QA** EFS installation silently authorises writes against the **live** account after an endpoint swap, plus a step-up bypass and two probe endpoints that fire real `setCardV2` writes while bypassing every card-control gate. Those are the "don't make a mess on our account" risks.

**Suggested order of work:** §8 P0 (safety + the prompt data-loss bug) → P1 (prompts surface + override amount) → P2 (drawer redesign) → P3 (remaining EFS capacity).

---

## 1. Ground truth: what EFS actually offers

### 1.1 The WSDL surface

`CardManagementWS`, RPC/literal SOAP 1.1, endpoint `https://ws.partner.efsllc.com/axis2/services/CardManagementWS/`, **131 operations**. Card-control-relevant subset:

| Domain | Operations |
|---|---|
| **Card read** | `getCard`, `getCardv2`, `getCardByDriverId`, `getCardDescriptions`, `getCardSummaries`, `getCardSummariesV2`, `getCardsWithNoDriverId` |
| **Card write** | `setCard`, `setCardv2`, `removeCard`, `transferCard`, `setCardPin`, `deleteOverride` |
| **Limits** | `getCardRefreshingLimits`, `setCardRefreshingLimits`, `getPolicyRefreshingLimits`, `setPolicyRefreshingLimits`, `getCreditLimits` |
| **Policy** | `getPolicy`, `setPolicy`, `getPolicyDescriptions`, `createNewPolicy`, `getSitePolicyDescriptions`, `createNewSitePolicy`, `setSitePolicy` |
| **Prompts / catalog** | `getPromptTypes`, `getProducts`, `getProductGroups`, `createInfoLimitCard`, `deleteInfoLimitCard` |
| **Locations** | `getLocationGroups`, `getLocationGroupDescriptions`, `createLocGrp`, `removeLocGrp`, `get/setLocGrpRule`, `get/set/add/removeLocGrpLocs`, `getTransLocationsForCard`, `getTransLocationsForPolicy`, `searchLocation` |
| **Card lifecycle / ordering** | `getAllowedOrderTypes`, `getOrderTypes`, `getOrderStyles`, `getOrderChoices`, `createOrder`, `createAndSubmitOrder`, `updateOrder`, `updateOrderCards`, `getOrder`, `getOrderCards`, `submitOrder`, `stopOrder`, `deleteOrder`, `findOrders`, `replaceLostOrStolenCard`, `reissueDamagedCard`, `issueNewPayrollCard`, `issueNewPersonalizedPayrollCard` |
| **Managed fuel** | `managedFuelAction`, `managedFuelDriverAction` |
| **Ops** | `login`, `logout`, `serverTime`, `getContracts`, `getCarrierInfo`, `getLastMileage`, `overrideLastMileage` |

Key type facts:

- `WSCardv2` = `cardNumber` + `header` + `infos[]` + `limits[]` (`WSCardLimitv2`) + `locationGroups[]` + `locations[]` + `timeRestrictions[]`, all as an **`xsd:sequence`** — element order is part of the contract.
- `WSCardLimitv2` adds `autoRollMap` and `autoRollMax` over v1 (ticket OTR-809). **This is why v2 must be used for both read and write** — reading v1 and writing v2 would delete auto-roll config.
- `WSCardHeader.override` is an **`int`**, not a boolean, despite the guide's prose calling it "0 = false, 1 = true" in the field table. The Overrides appendix is authoritative: **1–9 = number of times the override applies**.
- `WSCreditLimits` carries `transLimit`, `origLimit`, `creditAvailable`, `dailyLimit`, `dailyAvailable`, `totalAvailable`, `maxMoneyCode`, `uom` — the account's real headroom.

### 1.2 The two rules that govern everything

**Rule 1 — `setCard` is a full replace, not a patch.** Guide, Set Card Version 2:

> *"Make sure you echo back all fields from the getCard response, changing the applicable fields. Only remove fields or blank them out if you intend to remove them… For example, if the system gets an `<infos>` record for Driver ID in the getCard response, if the system drops that `<infos>` record in the setCard, the card will no longer have a Driver ID assigned."*

Your codebase already respects this correctly — see §3.1.

**Rule 2 — the Overrides appendix (p194) is the whole answer to issue #2.** Reproduced verbatim in §4.2.

### 1.3 Code tables (complete, for reference)

**Info IDs (26)** — `BDAY BLID CNTN CRDR DLIC DLST DRID EXPT FSTI GLCD HBRD HRRD LCST LICN LSTN NAME ODRD OINV PONB PPIN RTMP SSUB TLOC TRIP TRLR UNIT`

**Validation types (7)** — `ALPHABETIC ALPHA_NUMERIC NUMERIC REPORT_ONLY EXACT_MATCH ACCRUAL_CHECK DYNAMIC` (`DYNAMIC` valid only with `CNTN`, `PPIN`, `DRID`)

**Limit IDs (60)** — `ADD AMDS ANFR AVGS BDSL BRAK CADV CLTH CNG COUP DEF DEFC DELI DSL DSLM ELEC EVCH FAX FURN GAS GASM GASP GROC HARD IDLE JET KERO LABR LMPR LNG MDSL MERC MGAS MRFR NGAS OIL OILC PART PHON PNT PROP RECP REPR REST RFND RFR RFRM SCAN SCLE SHWR SPLT STAX TIRE TOLL TRAL TRPP ULSD WASH WIFI WWFL`

Limit semantics: `limit` is **gallons** for fuel and DEF, **dollars** otherwise; range 0–9999. `hours` = reset window. `minHours` = minimum gap between uses. `autoRollMax` = 0 means *no daily maximum*, **not unlimited**.

---

## 2. Coverage: WSDL vs. implementation

### 2.1 Implemented (8 of 131)

| Operation | Entry point |
|---|---|
| `login` / `logout` | `apps/api/src/lib/efsSoapSession.ts:388`, `:423` (logout **never called by card control** — §6, H-3) |
| `getCardv2` | `apps/api/src/lib/efsCardOps.ts:149` |
| `getCardSummaries` / `getCardSummariesV2` | `efsCardOps.ts:213` |
| `getCardsWithNoDriverId` | `efsCardOps.ts:300` (probe route only) |
| `getPolicy` | `efsCardOps.ts:328`, cached at `efsPolicyCache.ts:69` |
| `searchLocation` | `apps/api/src/lib/efsLocationSearch.ts:91` |
| **`setCardv2`** | `apps/api/src/lib/efsCardWrite.ts:79` — *the only production write* |
| `deleteOverride` | `efsCardWrite.ts:141` — flag-gated `EFS_CARD_DELETE_OVERRIDE_ENABLED`, **default false** |

`setCard` v1 exists only in the staging experiment harness (`efsCardExperiments.ts:78`), unreachable in production.

> **Note on casing:** the operation is `setCardv2` (lowercase v) — `efsCardWrite.ts:58`. The guide writes `setCardV2`; Axis2 answered *"The endpoint reference (EPR) for the Operation not found … WSA Action = setCardV2"*. The WSDL confirms lowercase. Good catch already made — keep the docblock at `efsCardWrite.ts:44-57`.

### 2.2 Not implemented — card-control relevant

`getCard` (v1, deliberate), `setCard` (v1, deliberate), `getCardByDriverId`, `getCardDescriptions`, `removeCard`, `transferCard`, `setCardPin`, `setPolicy`, `getPolicyDescriptions`, `getSitePolicyDescriptions`, `createNewPolicy`, `setSitePolicy`, **`getPromptTypes`**, `getProductGroups`, `getProducts`, **`getCreditLimits`**, **`getCardRefreshingLimits`**, **`setCardRefreshingLimits`**, `getPolicyRefreshingLimits`, `setPolicyRefreshingLimits`, `getLocationGroups`, `getLocationGroupDescriptions`, all eight `LocGrp*` ops, `getTransLocationsForCard`, `getTransLocationsForPolicy`, `createInfoLimitCard`, `deleteInfoLimitCard`, all sixteen ordering / lifecycle ops, `managedFuelAction`, `managedFuelDriverAction`, `getLastMileage`, `overrideLastMileage`, `serverTime`.

Most are documented non-goals at `apps/api/src/routes/fuelCards/control.ts:45-61` — a good practice, keep it. The ones that are *not* documented non-goals and matter are bolded above.

### 2.3 Net write surface today

**Three things.** `status` (Hold / Inactive / Active), the three override header fields (`override`, `overrideAllLocations`, `locationOverride`), and the `infos[]` array restricted to 2 IDs × 2 validation types. Everything else EFS exposes is read-only in our product or absent entirely.

---

## 3. What the write engine gets right (preserve this)

Worth stating explicitly, because several fixes below touch this code and it must not regress.

### 3.1 Echo fidelity

The `setCardv2` request is **not** re-serialized from a typed model. It is rebuilt element-by-element from the original response DOM nodes (`apps/api/src/lib/efsCardEcho.ts:143-163`). Consequence: every `WSCardHeader` field present in the `getCardv2` response is echoed byte-for-byte, **including fields our type system has never heard of** — the five SmartFunds payroll flags survive on the wire even though `wsCardSchema` doesn't model them.

`assertEchoFidelity` (`efsCardEcho.ts:405-429`) then runs on the **exact bytes about to be dispatched**, inside the body callback (`efsCardWrite.ts:91-100`), and throws `echo_unfaithful` before anything reaches the socket. Expectation and reality are computed by two independent routes. This is the only defence against `setCardv2`'s delete-by-omission semantics, and it is correctly built.

### 3.2 Everything else worth keeping

- **Ledger row written before dispatch** (`efsCardControl.ts:218-236`) — a crash leaves evidence, not silence.
- **Always re-read to verify**, plus a second look after a configurable pause to defeat vendor apply lag (`efsCardControl.ts:320-364`).
- **"We don't know" is a terminal outcome** (`sent` / Unverified, `efsCardReconcile.ts:206-231`) rather than being collapsed into success or failure.
- **DB-enforced one-pending-mutation-per-card** (`0179`) — the only guard that cannot race.
- **Fail-closed org cap and in-flight check** (`efsCardControl.ts:469-476`, `:523-530`).
- **Refusals decided against the fresh in-operation document, not the mirror** (`control.ts:260`, `:363`).
- **Writes never retried** (`retry:false`) — correct, since a timed-out `setCardv2` may have landed.
- **Per-intent idempotency keys, re-minted on settle** (`CardControlDrawer.vue:98-101`, `:197`).

### 3.3 Three latent weaknesses in the engine

| # | Finding | Location |
|---|---|---|
| E-1 | **`xsd:sequence` order is not preserved for newly-introduced fields or collections, and the guard structurally cannot detect it.** A field or collection the response didn't carry is appended *after everything else*. `canonicalize` produces a `Map<path, values[]>` and `diffCanonical` iterates the union of keys — **ordering between different element names is never compared**. Concrete trigger: a card with `infoSource=POLICY` returns an empty `infos` array; a `replaceAll` on `infos` lands the whole block after `<limits>`. Given this vendor's documented failure mode is accept-and-silently-ignore, this is exactly the shape that produces another `no_change`. | `efsCardEcho.ts:168-178`, `efsCardCanonical.ts:74-130`, `efsCardEcho.ts:355-364` |
| E-2 | **No whole-orchestration deadline.** `EFS_CARD_WRITE_TIMEOUT_MS` (documented, default 25s) appears outside `env.ts` only in a *comment*. Every vendor call passes the 10s interactive timeout instead. Worst case: 4×10s sockets + 3s second-look + ~4s of 1-rps pacing ≈ **47s of a held HTTP request**, unbounded. | `env.ts:232-236` vs `efsCardControl.ts:198/300/326/356` |
| E-3 | **`serializeElement` drops attributes and trims text on echo**, and the guard is blind to both (it canonicalises through the same trim). EFS is known to send space-padded values on this account. | `efsCardEcho.ts:61-67` |

Also minor: `"flying j exception"` — documented on essentially **every** operation in the guide — has no entry in the fault table (`efsSoapSession.ts:90-109`); it falls through to an untyped `soap_fault`. One-line fix.

---

## 4. The four reported issues — root cause

### 4.1 Issue #1 — "Prompts are not set for adding and switching, we don't have all options"

**The catalog is complete. The reachable surface is not.**

`packages/shared/src/efsCardCatalog.ts` carries all 26 Info IDs (`:177-203`), all 60 Limit IDs (`:221-238`), all 7 validation types (`:138-140`), and correctly records the `DYNAMIC`→`CNTN/PPIN/DRID` restriction (`:144`). I diffed all three against the guide programmatically — zero missing, zero extra.

The loss happens in three places:

| # | Cap | Location |
|---|---|---|
| a | `EFS_EDITABLE_INFO_IDS = ["DRID","UNIT"]` — **24 of 26 Info IDs unreachable** | `efsCardCatalog.ts:214` |
| b | `validationType: z.enum(["EXACT_MATCH","REPORT_ONLY"])` — **5 of 7 rejected at the API boundary** | `packages/shared/src/cardControlContract.ts:314-316` |
| c | UI hardcodes the same two | `apps/web/src/features/fuelCards/CardPromptsPanel.vue:43-46` |
| d | `prompts: z.array(...).max(EFS_EDITABLE_INFO_IDS.length)` — **a card can never carry more than 2 card-level prompts** | `cardControlContract.ts:338-339` |

The notable loss in (b) is **`ACCRUAL_CHECK`** — the odometer/hubometer plausibility check (`ODRD`/`HBRD` with `value` = accrual). That is precisely the anti-theft primitive this product exists for, and `wsCardInfoSchema.value` already reads it (`cardControlContract.ts:80`).

#### "Adding" — the API supports it; the UI cannot reach it

`promptsEdits` at `apps/api/src/services/efsCardEdits.ts:229-241` correctly implements appending a prompt the card lacks, with the full 8-field `WSCardInfo` shape. But `CardControlDrawer.vue:135-142` seeds the editable drafts **only from prompts already on the card**, and `CardPromptsPanel.vue` renders `v-for` over those drafts with exactly one button — "Save prompts" (`:112`).

**There is no "Add prompt" affordance anywhere in the feature.** A card with no `UNIT` record can never be given one from the UI. A card with no card-level prompts at all shows an empty section with a live Save button that submits an empty full-replace.

#### 🔴 "Switching" — an active data-loss bug

This is the most serious functional finding in the report, and it reproduces on the card the team tests with.

The guide: *"`reportValue` string(24) — If a prompt is **Report Only** this is the report value."* For a `REPORT_ONLY` prompt the value lives in `reportValue`, **not** `matchValue`.

The chain:

1. `apps/web/src/pages/FuelCardDetailPage.vue:43-51` builds `cardPrompts` and **omits `reportValue`** — it maps only `infoId`, `validationType`, `matchValue`.
2. So a `REPORT_ONLY UNIT` prompt arrives at the drawer with `matchValue: null`.
3. `CardControlDrawer.vue:225` filters the submission: `prompts: drafts.value.filter(d => (d.matchValue ?? "").trim() !== "")`.
4. `promptsEdits` (`efsCardEdits.ts:210-215`) treats "present before, absent from submission" as a **removal**.
5. `control.ts:363` guards **only `DRID`**. `UNIT` removal passes unchallenged.

**Reproduction** — against the QA card in your own fixture (`apps/api/src/lib/efsCardExperiments.test.ts:26`):

```xml
<infos>
  <infoId>UNIT</infoId>
  <matchValue></matchValue>
  <reportValue>T001</reportValue>
  <validationType>REPORT_ONLY</validationType>
</infos>
```

Open the drawer on this card, **change nothing**, click "Save prompts" → the `UNIT` record is deleted from the card. The confirmation copy (`cardControlModel.ts:462-469`) says only *"Drivers will be prompted for exactly these values"*.

**Two further reportValue bugs in the same code path:**

- Switching `EXACT_MATCH → REPORT_ONLY` writes `matchValue` and never touches `reportValue` (`efsCardEdits.ts:217`) — the switched prompt reports the *old* or blank value.
- New prompts are appended with `reportValue: ""` hardcoded (`efsCardEdits.ts:236`), so **every prompt added as `REPORT_ONLY` is added with an empty report value**. The operator types a value, saves, and the card page shows "Recorded only" with nothing after it (display reads `reportValue` at `cardControlModel.ts:255-259`).

#### `getPromptTypes` — never called

Zero occurrences in the codebase. The op catalog (`efsCardOps.ts:44-55`) lists only four read ops. Consequence: **the account's actual available prompt set is never discovered**, so the hardcoded `["DRID","UNIT"]` can never be validated or widened against reality. This is the operation that should be driving the UI's options list.

#### `infoSource` — read, mirrored, displayed, never checked on write

`infoSource` (POLICY / CARD / BOTH) is parsed (`efsCardXml.ts:286`), mirrored (`efsCardMirror.ts:379`) and displayed (`read.ts:305`), but is **absent from `promptsEdits` and from the prompts handler**.

`mergeEffectiveConfig` correctly knows that `source !== POLICY|BOTH` means policy rows don't apply — but there is no inverse check. **A card with `infoSource = POLICY` accepts a card-level prompt write that will never take effect at the pump, and the write is recorded as `succeeded`** (the echo lands, the field is on the card, the pump ignores it). Your QA fixture card is `infoSource=BOTH`, so this is invisible in test and would only appear in production.

Also unreachable today: `lengthCheck` / `minimum` / `maximum` (echoed for existing records, hardcoded `"false"/"0"/"0"` for new ones — `efsCardEdits.ts:232-235`).

---

### 4.2 Issue #2 — "Override is missing amount, at least on test environment"

**The amount is not missing — it was never built, and the code says so.**

`apps/api/src/routes/fuelCards/control.ts:55-60`, in the router's explicit non-goals block:

> *"No product-limit overrides. That p194 recipe requires DELIBERATELY dropping the limits array — the exact shape of the disaster the echo guard exists to prevent. Phase C, with its own confirmation and step-up."*

Restated as shipped policy in `docs/22-EFS-CARD-CONTROL.md:437-442`.

#### What EFS actually means by "override" (guide p194, verbatim)

There are **four** override recipes, and only one of them involves an amount:

| Recipe | Mechanics |
|---|---|
| **Override All Locations** | `getCard` → echo back → `overrideAllLocations = true`, `override = 1..9` |
| **Override Single Location** | `getCard` → echo back → `locationOverride = <6-digit EFS location ID>`, `overrideAllLocations = false`, `override = 1..9` |
| **Override Product Limits** ← *this is "the amount"* | `getCard` → echo back **everything except the limits** → `overrideAllLocations = true`, `override = 1..9` → **add back a `limits[]` array** with the products and amounts you want. Guide's own example: `<limits><hours>1</hours><limit>1000</limit><limitId>ULSD</limitId><minHours>0</minHours></limits>` |
| **Override Refreshing Limits** | `setCard` as above, **then** call `setCardRefreshingLimits` against a pseudo-card number = the card number **+ the literal suffix `OVER`** (e.g. `7083••••••••••1111OVER`) with the override values |

`deleteOverride(clientId, cardNumber)` clears it.

#### What we send today

`apps/api/src/services/efsCardEdits.ts:93-107` — the entire override grant:

```ts
export function overrideGrantEdits(doc, uses, scope): CardEdit[] {
  const edits = [{ op: "setField", name: "override", value: String(uses) }];
  if (scope.kind === "all") {
    edits.push({ op: "setField", name: "overrideAllLocations", value: "true" });
    if (doc.card.locationOverrideId !== null)
      edits.push({ op: "setField", name: "locationOverride", value: LOCATION_OVERRIDE_NONE });
  } else {
    edits.push({ op: "setField", name: "locationOverride", value: scope.locationId });
    edits.push({ op: "setField", name: "overrideAllLocations", value: "false" });
  }
  return edits;
}
```

**Three header fields. No `limits[]` edit of any kind.** Confirmed by the tests (`efsCardEdits.test.ts:82-118` asserts only those three elements).

#### Where the amount is lost — layer by layer

| Layer | File:line | Amount? |
|---|---|---|
| UI | `CardOverridePanel.vue:63-92` | **No.** Two controls only: uses 1–9, and scope all/one-location |
| Confirm copy | `cardControlModel.ts:426-439` | *"allowed N purchases outside its normal limits"* — names no product, no quantity |
| Client mutation | `useCardControl.ts:150-155` | sends `{expectedVersion, reason, uses, scope}` |
| Wire schema | `cardControlContract.ts:301-306` | `grantOverrideSchema` has **no limits field** |
| Route | `control.ts:274-305` | `buildEdits: doc => overrideGrantEdits(doc, uses, scope)` |
| SOAP XML | `efsCardEdits.ts:93` | limits echoed **unchanged** |

**The amount is lost at layer one — there is no input for it.** This is not a serialization bug.

#### `setCardRefreshingLimits` / the `OVER` convention — completely absent

Zero occurrences in the codebase except as prose in `writeProbe.ts:328,382` (text telling the operator to ask WEX to enable it) and one runbook line. No `"OVER"` suffix constant, no pseudo-card handling.

#### Why it looks worse on test

**There is no test-environment-only branch on the override path.** `EFS_SOAP_ENVIRONMENT` is never branched on for card control (see §6, C-2 — that's a separate problem). The only override-related flag is `EFS_CARD_DELETE_OVERRIDE_ENABLED`, default false, and it affects *clear*, not *grant*.

What differs is **the QA card's own data**. Your QA fixture is `limitSource = POLICY` with **no `<limits>` element at all**. On that card:

- `CardEffectiveConfig.vue:47-52` renders the Product limits section with policy rows only, or the empty state *"No product limits. Spending is bounded only by the account."*
- Granting an override sets `override=N` and touches nothing else.

So on the QA card there is neither a limits array to see nor a limits array to override — the absence is **total** rather than merely unimplemented. That's the whole "at least on test environment."

#### One correction to the stated blocker

The non-goal comment says the p194 recipe *"requires DELIBERATELY dropping the limits array — the exact shape of the disaster the echo guard exists to prevent."* That is over-cautious. Dropping-then-re-adding is precisely a `{op:"replaceAll", name:"limits", records:[...]}` edit, and `assertEchoFidelity` already handles that correctly via `expectedCanonical`'s collection branch (`efsCardEcho.ts:404-430`). The guard verifies *intent*, and `replaceAll` **is** the declared intent. `serializeSetCardRequest` even has a dedicated branch commented *"a collection being introduced for the first time (an override's limits array, p194)"* (`efsCardEcho.ts:172-176`) — the machinery exists and is unused.

The real missing pieces are: the UI field, the schema field, a step-up gate, and a fix for E-1 (sequence ordering) since a card with no existing `<limits>` is exactly the introduce-a-new-collection case.

---

### 4.3 Issue #3 — "Make sure we can use full capacity provided by EFS"

#### Capability-by-capability status

| EFS capability | Read? | Written? | Evidence |
|---|---|---|---|
| Per-product `limits[]` (60 IDs, `limit`/`hours`/`minHours`) | ✅ | ❌ | Parsed `efsCardXml.ts:227-236`; displayed `cardControlModel.ts:264-276`; **no write path anywhere** |
| `autoRollMap` / `autoRollMax` (v2) | ✅ parsed | ❌ | `cardControlContract.ts:96-98` — parsed and typed but **never rendered**; `limitRows` ignores both; the client type drops them (`useEfsCards.ts:70`) |
| Refreshing / velocity limits (day/week/month × count+amount, `refreshingLimitSource`) | ❌ | ❌ | Zero code. `EFS_REFRESHING_SOURCES` at `efsCardCatalog.ts:147` is a **dead constant with no consumer** |
| `getCreditLimits(contractId)` — real account headroom | ❌ | n/a | Zero occurrences of any of its nine field names in the repo |
| Time restrictions (per-day begin/end) | ✅ | ❌ | Parsed `efsCardXml.ts:305`; displayed `cardControlModel.ts:287-295` |
| `locationGroups` | parsed only | ❌ | `efsCardXml.ts:303` parses; `read.ts:304-311` **does not include them in the `effective` payload** — never reach the UI |
| `locations` (blocklist) | parsed only | ❌ | Same — parsed at `:304`, omitted from `effective`. **Invisible to operators** |
| `handEnter` ALLOW/DISALLOW/POLICY | ✅ | ❌ | `efsCardCatalog.ts:126`; read-only at `FuelCardDetailPage.vue:70`. **The single cheapest anti-skimming control in the whole API, and it is one enum write** |
| `limitSource` / `locationSource` / `timeSource` / `infoSource` | ✅ | ❌ | `locationSource` isn't even forwarded to the client (`read.ts:310`) |
| `getPolicy` / `setPolicy` | read only | ❌ | deliberate non-goal |
| `managedFuelAction` (route-locked fueling: planned stop + planned gallons) | ❌ | ❌ | Excluded at `control.ts:52-53`; called "the native primitive" in `docs/22:180-183` |

#### Artificial caps that are ours, not EFS's

Worth naming these explicitly when answering "are we using full capacity" — they are all defensible risk decisions, but they are **our** ceilings:

| Cap | Value | Location |
|---|---|---|
| Editable Info IDs | 2 of 26 | `efsCardCatalog.ts:214` |
| Validation types | 2 of 7 | `cardControlContract.ts:316` |
| Max prompts per card | 2 | `cardControlContract.ts:338-339` |
| Override rate | 5/min, 25/day | `cardWriteLimits.ts:49` |
| Step-up threshold | uses > 3 (EFS allows 9 freely) | `cardWriteLimits.ts:93` |
| Org mutations | 50/hour | `env.ts:250` |
| **Detail sync budget** | **200 cards/sweep, 24h interval** | `env.ts:254,258` |

That last one is a real read-side capacity ceiling: on a fleet >200 cards, **cards beyond the budget silently have no limits/prompts/restrictions data at all**, and their `document` is ≥2 days stale.

#### ⚠️ The "capacity" conflation — worth flagging

`docs/19-CAPACITY-RESOLVER.md` uses "capacity" to mean **the physical tank volume of a truck in gallons**, measured from Samsara fuel-level rise, persisted to `vehicles.sensor_capacity_gal`.

EFS's "capacity" means **spend/volume authorization headroom** — `limits[]` per product, refreshing limits, `getCreditLimits`.

**They share zero code.** I grepped `packages/shared/src/anomalyRules/` for `limitId` / `EFS_LIMIT` / `limits` — no hits.

Two consequences:

1. **The feature the docs promise doesn't exist.** `docs/22-EFS-CARD-CONTROL.md:174` lists *"Per-card gallon/day caps sized to the truck's REAL tank | limits (`ULSD` gallons, `hours`) + `setCardRefreshingLimits`"*. That is the natural join between the two capacity notions, and **neither half is implemented**.
2. **A unit trap sits in the same namespace.** `limitUnit()` returns `"gallons"` for ULSD/DSL/DEF and `formatLimit` renders `"300 gal"`; `resolveCapacity` also produces gallons. Nothing crosses them today, but an EFS `limit` is **capped at 9999 and is per reset window (`hours`)**, whereas tank capacity is a one-shot physical bound. Treating one as the other would silently break both the detection rules and the card write.

**Worth confirming which you meant.** If "full capacity" = *use EFS's full feature set*, the gap list above is the answer. If it = *size card limits to the truck's real tank*, that's the unbuilt bridge in (1) — a different and more interesting piece of work.

---

### 4.4 Issue #4 — "UI/UX on our drawer is a little confusing"

Covered in full in §5. Short version: your diagnosis is right, and the code half-agrees with you already — it abandoned tabs for stacked sections *because* multiplexing was a problem (`CardControlDrawer.vue:57-61`), but kept the thing that actually causes the confusion.

---

## 5. UI/UX findings and the one-button-per-operation redesign

### 5.1 Current IA

**One entry point in the entire product**: a single `Card actions…` button in the detail page header (`FuelCardDetailPage.vue:84`), visible when `canLock || canUnlock || canOverride || canSetPrompts`.

The fuel card **list page has no card actions at all** (`FuelCardsPage.vue:169-177`) — row click only routes to detail. The account-wide overrides panel likewise cannot clear an exception (`ActiveOverridesPanel.vue:60`).

So "lock this stolen card at 2am" is: list → row → detail → `Card actions…` → find the right stacked section → section button → confirm screen → footer confirm. **Six interactions, and the first four give no indication which operation you're heading toward.**

The drawer itself has a **fixed generic title** regardless of intent (`CardControlDrawer.vue:297-302`), three stacked sections each with its own button, and two body-replacing modes (confirmation, step-up).

### 5.2 Where the multiplexing hurts

| Multiplexed | Consequence |
|---|---|
| **`expectedVersion`** — one `common()` for all five intents (`:179`) | a 409 raised by *any* intent resets *all* drafts |
| **Error surface** — one `handleFailure` → global toasts (`:238-279`) | an operator editing prompts gets a red toast about "the card" with no indication which form it belongs to; nothing renders inline |
| **Confirmation surface** — one shared body region (`:311-320`) | header still reads "Card actions"; the pending intent appears only in an h3 inside the body |
| **Partially-filled drafts** | you can grant an exception while a half-edited Driver ID sits unsaved behind the confirm screen; nothing warns, nothing saves it |
| **`reason`** — *doesn't exist in the UI at all* | `dispatch()` never passes it (`:208-229`). The history table renders a `Why` column (`CardMutationHistory.vue:33`) that is **permanently blank**. `docs/22:434-435` still documents reason as *required, 3–200 chars*; `cardControlContract.ts:255-258` made it optional. Doc and UI disagree and the ledger column is dead |
| **Idempotency keys** | ✅ correctly per-intent and re-minted on settle — **do not regress this** |

### 5.3 The fourteen confusion defects

Ordered by how badly they mislead an operator. All confirmed against code.

| # | Defect | Location |
|---|---|---|
| **D1** | 🔴 **A destructive operation is inferred from an empty text box.** Clearing the Driver ID value is the *only* way to remove the DRID prompt; there is no explicit "Remove" control. The API's own comment forbids exactly this — *"Explicit flag AND a fresh sign-in; never a side effect of clearing a text box"* — and the client satisfies the flag mechanically while reproducing the interaction the flag was invented to prevent | `CardPromptsPanel.vue:67-81`, `CardControlDrawer.vue:147-150`, `:225`; `control.ts:363-366` |
| **D2** | **Confirm screen is not a snapshot of the payload.** `confirmation` is a live computed; `dispatch()` re-reads state at send time; and the reseed watcher can fire *while the confirm screen is up* (detail query polls every 60s and on focus). Operator is shown a destructive warning and a no-op is sent — or the tone flips from warning to danger under a stationary cursor | `:158-167`, `:185`, `:208-229`, `:124-145`; `useEfsCards.ts:85,103-112` |
| **D3** | **Background refetch silently wipes in-progress input.** The watcher keys on `props.version` *and `props.prompts` identity*; `props.prompts` is a fresh array each refetch. Pick "One location only", search, select a location; a driver fuels the card; the poll lands; the picker is empty with no message — and scope may have silently reverted to "Any location" | `:124-145`, `:133` |
| **D4** | **409 is surfaced as a red error *and* destroys the context needed to act on it.** Danger tone for a routine concurrency event (contrary to `DESIGN-SYSTEM-CONTRACT.md:548-560`); "the current settings are loaded — review and try again" is false, because D3 wiped the operator's inputs in the same tick; no diff of what moved (compare `drift_detected`, which does name the fields) | `:247-252`; `cardControlModel.ts:509-518` |
| **D5** | **No diff/preview of what will change in EFS.** Only the override confirmation names its values. The prompts confirmation says *"Drivers will be prompted for exactly these values"* **without listing them**, and the write is a full replace. Clear the UNIT value (not DRID) → no danger banner, generic copy, prompt deleted with no on-screen mention | `cardControlModel.ts:465`; `CardControlDrawer.vue:147-150,225` |
| **D6** | **Cannot add a prompt that doesn't already exist.** Drafts seeded only from existing card-level prompts; a card with none renders a heading and a live "Save prompts" button and nothing else — no empty state, no "Add prompt" | `:136-142`; `FuelCardDetailPage.vue:44-46`; `CardPromptsPanel.vue:63-65,111-115` |
| **D7** | **Drawer and the page behind it describe different worlds.** `CardEffectiveConfig` shows card **and** policy prompts with origin badges; the drawer shows card-level only, with no explanation of why a policy prompt can't be edited here | `CardEffectiveConfig.vue:39-46`; `FuelCardDetailPage.vue:44-46` |
| **D8** | **Lock/Deactivate is unreachable on a held card, silently.** A card on Hold that you now want to retire offers only "Unlock card" — no Deactivate, no disabled control, no explanation that you must unlock (re-enabling fuel purchases!) and then deactivate | `CardStatusPanel.vue:39,61,78` |
| **D9** | **Exception residue cannot be cleared.** "Remove exception" renders only when `overrideUses > 0`. The model itself documents cards carrying a scope field with zero uses as "configuration residue" and a state where "uses remain but neither scope field is armed" — neither is clearable from the UI | `CardOverridePanel.vue:49,95`; `cardControlModel.ts:164-197` |
| **D10** | **Step-up is discovered only after the fact.** Nothing on the input surface predicts it: >3 uses needs a fresh sign-in and `CardOverridePanel.vue:38` knows this *in a code comment* while the labels say nothing; unlocking a Fraud card needs step-up but the button looks identical. DRID removal warns in-panel (`CardPromptsPanel.vue:95-98`) — that one is done right; make it the rule | `control.ts:277-285`, `:230-244` |
| **D11** | **"Sent, but not confirmed" has no destination.** A transient toast tells the operator to *"Check the card in the WEX portal before trying again — retrying could apply it twice"* — with **no link** to the portal, no link to the change history, no persistent inline state, and the retry button left live. The drawer stays open showing the same form, reading as "nothing happened" | `cardControlModel.ts:519-525`; `CardControlDrawer.vue:198-200` |
| **D12** | **No dirty-state guard.** `close()` blocks only while a request is in flight; ESC, scrim click and ✕ all discard every draft with no prompt | `:290-293`; `SlideOver.vue:32,70-78` |
| **D13** | **No result state, no audit link, no per-section loading.** Success closes the drawer immediately, so confirmation of *what changed* exists only as a 5-word toast title. No link to the ledger row just written | `:198-200`; `cardControlModel.ts:506-507` |
| **D14** | **Hidden sections give no reason.** Approver scopes are per-operation; `availability()` returns `hidden` and `sections` drops them. A yard manager with `lock` but not `override` sees a drawer titled "Card actions" with one section and nothing saying the others exist or who to ask | `cardControlModel.ts:336-338`; `CardControlDrawer.vue:169-177` |

### 5.4 Design-contract breaks

| Break | Code | Contract |
|---|---|---|
| No `size="lg"` though the body hosts three real forms + a 4-column location table in a 28rem panel | `CardControlDrawer.vue:297-302` | `:487` |
| Action buttons live **in the body**, not `#footer`, for all five operations | `CardStatusPanel.vue:76-93`, `CardOverridePanel.vue:94-101`, `CardPromptsPanel.vue:111-115` | `:480` |
| Footer renders empty during step-up; Cancel/Confirm sit in the body | `CardControlDrawer.vue:371`; `StepUpPrompt.vue:71-76` | `:480` |
| `min-h-[26rem]` magic height to fake centring | `CardControlDrawer.vue:311`; `StepUpPrompt.vue:51` | flagged verbatim at `:625` |
| `<section>` without `aria-labelledby` + id'd `h3` | all three panels | `:479`, `:200-215` |
| Body uses `space-y-8`; house spacing is `space-y-6` | `CardControlDrawer.vue:323` | `:479`, `:205` |

### 5.5 Accessibility / state-machine gaps

| # | Gap |
|---|---|
| A1 | **Focus dropped when the body swaps** — the button that opened the confirmation is unmounted, focus falls to `<body>`, keyboard path to confirm is a full Tab cycle. Same on step-up |
| A2 | **Body swaps are not announced** — no `role="alertdialog"`, no `aria-live` on confirmation or result |
| A3 | **Async outcomes announced only via toast**, which competes with a focus restore because the drawer closes in the same tick |
| A4 | **Sections lack `aria-labelledby`** |
| A5 | **Ambiguous repeated field labels** — every prompt row repeats "Value the driver must enter"; the distinguishing name is a sibling `<p>` not in the accessible name. Two rows are indistinguishable to a screen reader |
| A6 | **Disabled with no reason** — "Grant exception" is disabled by `!ready` with no error text |
| A7 | **ESC during step-up loses the pending action silently** — `busy` is false then, and the footer is empty, so ESC is the natural exit |
| A8 | **No dirty guard for ESC / scrim / ✕** |
| A9 | **State machine has no `result` node** — states are `{sections, confirm, stepUp}`; outcomes exit through toasts. Unverified writes have nowhere to live |
| A10 | **No busy affordance beyond one button label swap** during a slow SOAP round-trip |
| A11 | **`max-w-md` while hosting three forms plus a searchable location table** |

### 5.6 Proposed redesign — one trigger, one drawer, one operation

#### 5.6.1 The shared shell (build this first)

Add **`CardOperationDrawer.vue`** as a thin, opinionated wrapper over the existing `SlideOver`. **Reuse, don't invent** — the primitives exist:

| Need | Reuse |
|---|---|
| Drawer chrome, scrim, header, scrolling body, pinned footer | `SlideOver.vue` with `size="lg"` |
| Buttons (`primary`/`secondary`/`danger`/`soft`/`ghost`) | `AppButton` |
| Labelled inputs with hint + error | `AppFormField` + `AppInput` |
| Selects | `AppCombobox` |
| Location lookup | `EfsLocationPicker.vue` (already collapses to a summary once chosen) |
| Read-only diff/inventory tables | `DataTable` (`dense`, `empty-text`) |
| Status pills | `BADGE_BASE` + `toneClass` (`apps/web/src/lib/badges.ts`) |
| Async announcement | `useToastStore` (already `aria-live="assertive"` + `role="alert"`) |
| Step-up | `StepUpPrompt.vue` — move its buttons into the shell footer |
| List-row triggers | `KebabMenu` with `…`-suffixed items |

> There is **no `ConfirmDialog` primitive and no `EmptyState` component** in this codebase. Confirmations must replace the drawer body (contract `:486`); empty states are `DataTable`'s `empty-text` / `#empty`.

**Fixed six-region anatomy, identical for every operation:**

```
HEADER   title       = the operation ("Lock card")   ← never "Card actions"
         description = "•••• 7671 · Unit 118 · Kyle R. · PRODUCTION"
BODY     1 INTENT SUMMARY    one sentence: what this does at the pump, and whether it is reversible
         2 INPUTS           AppFormField stack; disabled controls carry a :hint saying why
         3 WHAT WILL CHANGE dense DataTable — Setting | Now | After — computed from a snapshot
         4 REASON           optional AppInput, 3–200 chars
FOOTER   [Cancel] [<verb> card]        — always; body actions never
```

Plus four body-replacing states owned by the shell so they behave identically everywhere:
`confirm` → `stepUp` → `result` (success / EFS-refused / **unverified**) → `stale` (409: side-by-side "what you had" vs "what EFS now reports", with **Reapply my changes** and **Discard**).

**Shell invariants that fix D1–D14 structurally:**

1. **Snapshot on confirm.** Freeze payload + diff when Confirm is pressed; `dispatch` sends the frozen object. → D2
2. **Pause reseeding while dirty or confirming.** Keep polling; when the incoming version differs and the form is dirty, show a non-destructive banner instead of overwriting. → D3, D4
3. **Dirty guard on ESC / scrim / ✕ / Cancel.** → D12, A7, A8
4. **Result state stays in the drawer**, with a "View change history" link to the ledger row and, for `sent`, the WEX reference — and the retry button *disabled*. Toast supplements, never replaces. → D11, D13, A9
5. **Step-up predicted, not discovered.** Shell asks each operation `stepUpNeeded(inputs)`; when true the footer reads "Confirm password…" and a hint appears next to the offending input. Server refusal remains the authority. → D10
6. **Disabled = explained.** Every disabled footer button gets an `AppFormField :error` naming the missing input or the missing scope. → D14, A6
7. **Environment badge in the header** whenever the resolved endpoint is production. → §6, L-4

#### 5.6.2 Trigger placement

- **Detail page** — replace the single `Card actions…` with an **Actions card** below the facts card: one `AppButton` per permitted operation, grouped *Card status* / *Fuel access* / *At the pump*, each label ending `…`. Operations excluded by scope are omitted, with one muted line naming who to ask.
- **Contextual triggers** where the state lives: `Remove exception…` inline in the override badge; `Edit…` per row in `CardEffectiveConfig`'s prompt / limit / time sections.
- **List page** — add a `KebabMenu` actions column: `Lock card…` / `Unlock card…` / `Grant exception…`, capability-filtered. Today the list is a dead end.
- **Overrides panel** — `Remove exception…` per row: the one place an auditor is already looking.

#### 5.6.3 Operation inventory

**Built today (five intents):**

| # | Operation | Inputs | Diff row(s) | Confirm / step-up |
|---|---|---|---|---|
| 1 | **Lock card** | none (Hold implied) | `Status: Active → Hold` | danger confirm; no step-up |
| 2 | **Deactivate card** | typed last-four | `Status: Hold → Inactive` + "retiring, not pausing" | danger; **available on Active *and* Hold** (fixes D8) |
| 3 | **Unlock card** | none | `Status: Hold → Active` | tone escalates on Fraud; step-up **predicted** when Fraud |
| 4 | **Grant fuel exception** | uses 1–9, scope, location picker, **+ optional product + amount (see below)** | `Exception: none → 3 purchases at Love's #442013`; when one exists, `2 left at any location → 3 at …` | warning naming the numbers; step-up predicted above 3 uses |
| 5 | **Remove fuel exception** | none | `Exception: 2 left at #442013 → none` | shown whenever uses > 0 **or** a scope field is armed (fixes D9) |
| 6 | **Edit pump prompts** | **one prompt at a time**: value + validation type; explicit **"Remove this prompt"** destructive button (fixes D1); plus **"Add prompt…"** (fixes D6) | full before/after table of **all** prompts, removed rows struck and tagged `Removed` (fixes D5) | danger confirm listing every removal by name; step-up predicted on any removal |

**Not built — each gets the same shell when the entitlement lands:**

| # | Operation | Inputs | Notes |
|---|---|---|---|
| 7 | **Set product limits** | product, amount **with the unit spelled out** (gallons for fuel, dollars otherwise), window hours, min hours | `setCardv2` limits array |
| 8 | **Set velocity / refreshing limits** | rolling window, max per window, `autoRollMax` | must state explicitly that **0 = no daily maximum, not unlimited** |
| 9 | **Block / allow locations** | search-and-add, allow/block toggle, current entries | location groups + blocklist |
| 10 | **Hand-enter policy** | ALLOW / DISALLOW radio | danger when moving to ALLOW; **one enum write, kills a skimming class** |
| 11 | **Time restrictions** | day (**1 = Sunday**) + blocked from/to; date part meaningless | `setCardv2` timeRestrictions |
| 12 | **Replace lost / stolen** | reason, new card, carry-over choices | danger, typed last-four, step-up **required**; "the old card can never be reactivated" |
| 13 | **Transfer card** | new driver/unit, effective date | `Driver: Kyle R. → Dana P.`, `Unit: 118 → 204` |
| 14 | **Set PIN** | new PIN + confirm | no value diff — `PIN: •••• → •••• (changed)`; PIN never rendered or logged; step-up **required** |

Every operation reports the same four result states using the existing `outcomeNotice` vocabulary, **rendered inline in the drawer** rather than as a toast alone: `succeeded`, `drift_detected` (naming fields), `failed` (quoting EFS's fault + reference), `sent`/unverified (with WEX-portal instruction, history link, retry disabled).

---

## 6. Enterprise safety — blast radius on the live EFS account

### 6.1 Critical

**C-1 — A QA-proven write entitlement survives a swap to the production endpoint.**
`routes/integrations.ts:376-433` (esp. `:410`) · `services/efsCardControlAccess.ts:69-106`

`POST /api/integrations/efs-soap/enable` lets an org admin rewrite `environment`, `endpoint_url`, `soap_username` and `soap_password` in one call — and **does not touch `efs_card_control_settings`**. So:

1. Probe runs against QA → `write_entitlement = 'confirmed'` (`writeProbe.ts:260-268`)
2. Admin enables card control (`settings.ts:215-224`)
3. Admin re-points `endpoint_url` to the production host
4. `loadCardControlAccess` sees all four ANDed facts still true

Every lock, unlock, override and prompt write now fires at the live account **on the strength of a proof obtained on a different EFS installation**. Your own code says why this matters and then doesn't enforce it — `efsCardXml.ts:342-346`: *"a QA account and a production account are two different EFS installations, and a proof obtained on one only transfers to the other if the documents have the same structure."* `documentShape` **is** recorded in `probe_result` (`writeProbe.ts:247`) and **nothing compares it at mutation time**.

*Fix:* on any change to `endpoint_url` or `environment`, reset `write_entitlement='unknown'` and `enabled=false`, write an audit row, and call `__resetEfsSessions`. Store `probe_result.endpointHost` + `documentShape` and refuse in `loadCardControlAccess` when either differs from what was probed.

**C-2 — `EFS_SOAP_ENVIRONMENT` enforces nothing.**
`env.ts:184` · `efsSoapCredentials.ts:198` · `0091_efs_soap_credentials.sql:29`

A repo-wide grep returns **three hits**: the schema, one assignment, one doc line. It is never used to select or validate an endpoint, never compared against the endpoint host, never consulted by any gate, and **never written to the mutation ledger or audit meta**.

An operator can select `sandbox` in the dropdown while pasting the production endpoint and production credentials. Nothing validates the pair. Every write hits production while every screen, log and probe record says "sandbox" — and forensics can't tell, because `efs_card_mutations` has no environment column.

Defaults are also inconsistent in the *unsafe* direction: env default `"production"` (`env.ts:184`) vs DB column default `'sandbox'` (`0091:29`).

*Fix:* bind `environment` to the endpoint host with a write-time check; carry `environment` + endpoint host into `CardMutationContext`, the ledger row, and the audit meta.

**C-3 — The write probe and experiment endpoints fire real, unmetered `setCardV2` writes at any card number, bypassing every card-control gate.**
`routes/fuelCards/writeProbe.ts:99/114/122/152/177/221` · `writeProbeRealChange.ts:83-115` · `routes/fuelCards/experiments.ts:140/186/197/312/418`

If `EFS_CARD_CONTROL_PROBE_ENABLED=true` is left set on the production API after a run (the endpoints' own error text says "set it, run it, then unset it" — an **operator convention, not a control**), an admin can POST any card number belonging to the org's EFS account. These paths:

- do **not** check `EFS_CARD_CONTROL_ENABLED` (the deploy kill switch)
- do **not** check org opt-in, `write_entitlement`, or approver scopes
- do **not** verify the card is in the org's mirror — the PAN comes straight from the body
- do **not** go through `enforceCardWriteLimit`, the org hourly cap, or the one-pending index
- write **no ledger row** (`experiments.ts:56-59` states this outright)
- and `runRealChangeSteps` **explicitly leaves the card in the changed status if the revert fails** (`writeProbeRealChange.ts:157-160`)

The only barriers are `requireRole("admin")`, `requireFreshAuth()` (defeatable — H-1) and a typed `WRITE <last4>` string. **There is no environment guard whatsoever.**

*Fix:* refuse both routers when the resolved environment/host is production unless a separate `EFS_ALLOW_PRODUCTION_PROBE` is set; require the target card to resolve in `efs_cards` for the caller's org; route through the rate limiter and org cap; consider not mounting them at all when `NODE_ENV==="production"`.

### 6.2 High

| # | Finding | Location |
|---|---|---|
| **H-1** | **Step-up re-authentication is bypassable with a refresh-token grant.** `hasFreshAuth` falls back to JWT `iat`; the file's own comment calls it *"DEPRECATED … defeated by the refresh-token grant, which re-mints access tokens with a current `iat` and no password."* This defeats every conditional step-up on the write path: 9-use overrides, unlocking a **Fraud**-flagged card, and stripping the **DRID** prompt — with `step_up: true` recorded in the ledger as false evidence a human proved identity. *Fix:* delete the `iat` fallback; require `hasStepUpToken` only (the token path already exists) | `middleware/requireFreshAuth.ts:102-108`, acknowledged `:50-56` |
| **H-2** | **No non-production guard on writes.** A developer with production `EFS_SOAP_*` values in a local `.env` and `EFS_CARD_CONTROL_ENABLED=true` writes to the live account from `localhost`. `EFS_SOAP_TLS_INSECURE` and `EFS_SOAP_ALLOW_PRIVATE_ENDPOINT` both get real `NODE_ENV` guards; the write path gets none | `env.ts:369-379`; `efsTls.ts:123`; `ssrfGuard.ts:118` |
| **H-3** | **Credential/certificate rotation does not invalidate live sessions.** `__resetEfsSessions` is documented *"call on credential change, so a rotated password cannot ride a cached session"* — and is **called from nowhere outside tests**. Session key is `${orgId}:${endpointUrl}`: contains neither password nor cert fingerprint. After rotating a leaked password or activating a new cert, every process keeps writing to the live account for up to **20 minutes**. *"Rotated" does not mean "revoked."* Same for `invalidatePolicy`. (Note `invalidateTlsAgents()` **is** correctly wired — `integrations.ts:635`) | `efsSoapSession.ts:301-316`; `efsSoapCredentials.ts:261-293` |
| **H-4** | **No instant deploy-wide kill switch.** `EFS_CARD_CONTROL_ENABLED` is parsed once at boot; flipping it requires a redeploy (minutes on Railway). The only fast lever is disabling orgs one at a time. *Fix:* back it with a DB flag read per `prepare()` with a short TTL, ANDed with the env var | `env.ts:224`; `index.ts:10`; `worker.ts:19` |
| **H-5** | **Redaction misses 10–11 digit PANs in vendor fault text.** Mask is `\b\d{12,25}\b` but input accepts `^[0-9]{10,25}$`. A 10-digit PAN quoted in an EFS fault lands unmasked in `efs_card_mutations.efs_fault_message`, the API response, and `console.error`. The PAN-scanning test inherits the same blind spot | `efsCardXml.ts:406`; `efsCardMirror.ts:489` vs `writeProbe.ts:58`, `probe.ts:48`, `experiments.ts:68` |

### 6.3 Medium

| # | Finding |
|---|---|
| **M-1** | **`Idempotency-Key` is optional**, and the unique index is partial `where idempotency_key is not null`. A client that omits the header gets **no replay protection from the index**. Double-apply is prevented only incidentally, by the in-flight window and the `expectedVersion` 409. *Fix:* require it (400 when absent) |
| **M-2** | **`deleteOverride` mutations that go unverified are never auto-reconciled.** `buildEdits: () => []` (`control.ts:329`) and the sweep skips empty-edit rows (`efsCardUnresolved.ts:150`). The row sits on the Unverified list forever, and nobody learns whether the override was revoked — **the worst-direction unknown, since a live override is free fuel** |
| **M-3** | **`POST /efs-soap/enable` — the most consequential integration change — has no step-up**, while `PATCH /fuel-cards/settings` requires `requireFreshAuth()` for the strictly smaller act of flipping an org toggle |
| **M-4** | **The mutation audit record can't answer "which account, which card" months later.** No environment, no endpoint, no card last-4, no actor IP/UA — only an `efs_cards.id` uuid whose row cascades away with the org. Audit writes are best-effort and the return value is ignored, so a mutation can land with **no audit row at all**. Also: `efs_card_mutations` is not in `RETENTION_FORBIDDEN`, so a future rule could prune it |
| **M-5** | **Per-minute rate limits and the IP limiter are per-process** — three replicas ⇒ effective burst is 30/15/30 per minute, not 10/5/10. Only the daily counter and org hourly cap are globally exact |
| **M-6** | **`efs_soap_credentials.soap_password` is stored in PLAINTEXT** (`0091:31-33`), protected only by "service role, no RLS." This is the credential authorising writes to a live fuel-card account, and `secretBox` already exists and is already used for TLS keys |
| **M-7** | **`.gitleaks.toml` does not exist** anywhere in the tree, despite being referenced |

### 6.4 Low

- **L-1** No maker-checker — `approved_by` exists in `0177` and nothing writes it. The seam is already built (`planCardMutation` / `applyCardMutation`).
- **L-2** No revert path — `before_document` is stored precisely to make revert replayable, and no route consumes it. Recovery from a bad write is manual, in the WEX portal. Note the revert would also be **incomplete**: the five SmartFunds payroll flags are echoed on the wire but absent from `WsCard`, so `before_document` cannot restore them.
- **L-3** `EFS_SOAP_ENVIRONMENT` default is `production` while the DB column default is `sandbox`.
- **L-4** Environment is **invisible at the moment of action** — the drawer shows no environment badge.
- **L-5** `card_status` daily cap fails **open** — deliberate and well-argued (2am theft response must not be blocked), but note it covers **unlock** too.

### 6.5 Worst case in 60 seconds — quantified

A single authenticated fleet_manager with all four approver scopes (or a stolen token belonging to one), against an org with all gates open:

- Per-minute ceilings sum to **25 mutations** (10 status + 5 override + 10 prompts); the org hourly cap doesn't bind inside a minute.
- Vendor pacing (1 rps × 3 calls per mutation) is the real ceiling: **~20 mutations/minute**.
- **Concretely:** lock ~10 distinct cards (trucks stop fuelling immediately), strip Driver ID prompts from ~10 cards (fleet loses pump-level attribution — the product's core signal), grant 5 fuel overrides.
- **Overrides are the money:** 5/min, 25/day, up to **9 uses each** ⇒ **225 unauthorized fuel transactions per user per day.** The >3-uses step-up is the only control between "one free tank" and "nine" — and H-1 shows it is defeated by a token refresh.
- **Multipliers:** per-minute windows are per-process; with *N* replicas both the IP limit and the per-minute caps multiply by *N*. Three colluding approvers ⇒ 75 overrides/day.

### 6.6 What's already solid

Cross-org escalation: **no path found.** Every query chains `.eq("org_id", orgId)`. Approver grants verify membership in *this* org and refuse ineligible roles. All four card-control tables are RLS-enabled with **zero policies**, so PostgREST can't reach them. The `card_write_counters` PK was correctly widened to include `org_id` in `0180`.

PAN handling is good: AES-256-GCM sealing with AAD-bound `(orgId, "efs_card_pan")`, an HKDF-derived org-bound HMAC as the lookup handle (uncorrelatable across tenants), `card_number_sealed` excluded from every read projection, routes keyed on uuid so no PAN in a URL or access log, and the mirror refuses to persist without `SECRETS_ENCRYPTION_KEY`. The only leak is H-5.

TLS key handling is good: sealed with a key-id fingerprint in the envelope for rotation diagnosability, KEK in env never in the DB, stage → test → activate → rollback with partial unique indexes making "two active" unrepresentable.

---

## 7. Industry practice — what "enterprise-grade" means here

Current fleet-card control guidance converges on a consistent control set. Measured against it:

| Practice | Industry baseline | FuelGuard today |
|---|---|---|
| **Per-transaction limit sized to tank capacity** | Standard: tank size × average price, plus a cushion | ❌ Not written. And the natural join to your own measured `sensor_capacity_gal` is the unbuilt bridge in §4.3 |
| **Daily / weekly / monthly caps** | Standard, as hard or soft limits | ❌ `setCardRefreshingLimits` absent |
| **Transaction velocity (count per day)** | Standard | ❌ Same |
| **Driver ID / PIN at the pump** | Standard, plus "never share your PIN" training | ⚠️ Partial — DRID/UNIT only, with the deletion bug in §4.1 |
| **Odometer / hubometer plausibility check** | Standard anti-theft primitive | ❌ `ACCRUAL_CHECK` rejected at the API boundary |
| **Time-of-day / day-of-week windows** | Standard, with a buffer hour either side | ⚠️ Read-only |
| **Location / state / merchant restrictions** | Standard | ⚠️ Parsed but not even forwarded to the UI |
| **Product/fuel-grade restrictions** | Standard | ⚠️ Read-only |
| **Manual/hand entry lockout** | Standard anti-skimming control | ⚠️ Read-only — **one enum write away** |
| **Soft limits + one-time override workflow** | Standard: driver contacts support, support grants a one-time exception | ⚠️ Uses-count only, **no amount** — §4.2 |
| **Real-time alerts on unusual transactions** | Standard | ✅ You have this (out of scope here) |
| **Declined-transaction review to tune controls** | Standard | ✅ Rejections pull works |
| **Documented policy + signed driver acknowledgment** | Standard | Product-side; the training plan exists in `docs/plans/DRIVER-TRAINING-PLAN.md` |
| **Segregated duty for changing card settings** | Emerging expectation | ❌ No maker-checker (L-1) |

**The read:** your *engine* is above industry standard (very few integrations verify their own writes the way yours does). Your *control surface* is materially below it — you currently write three things where the baseline is roughly nine. The good news is that most of the gap is a UI + schema problem sitting on top of an engine that already knows how to write safely.

Two things worth stealing from the baseline that aren't in the EFS API at all:

- **Soft vs. hard limits as a product concept.** EFS gives you the limit; the "driver calls, support grants a one-time exception" workflow is yours to build, and it's exactly what the override-with-amount feature enables end-to-end.
- **Sizing the per-transaction limit from measured tank capacity.** You are one of very few products that actually *measures* tank capacity from telemetry. Wiring `resolveCapacity` → `ULSD` gallons limit is a genuine differentiator, not table stakes.

---

## 8. Prioritized plan

Nothing below has been implemented. Sequenced so that safety lands before surface area, and so the drawer redesign doesn't have to happen twice.

### P0 — Stop the bleeding (days)

| # | Item | Why now |
|---|---|---|
| 0.1 | **Fix the `reportValue` prompt-deletion bug** (§4.1). Carry `reportValue` through detail page → drawer → `promptInputSchema`; write `reportValue` for `REPORT_ONLY` and `matchValue` for `EXACT_MATCH`; make removal an **explicit button**, never an inferred empty box | Active data loss, reproducible on the QA card |
| 0.2 | **C-1**: reset `write_entitlement` + `enabled` on any endpoint/environment change; compare `documentShape` and endpoint host at mutation time | A QA proof currently authorises live writes |
| 0.3 | **C-2**: bind `environment` to the endpoint host; carry environment + host into the ledger and audit meta | Forensics currently cannot answer "which account" |
| 0.4 | **C-3**: environment-guard the probe and experiment routers; require org-resolved cards; route through the rate limiter | Unmetered live writes with no ledger row |
| 0.5 | **H-1**: delete the `iat` fallback in `hasFreshAuth` | Step-up is the only control on 9-use overrides |
| 0.6 | **H-3**: wire `__resetEfsSessions` + `invalidatePolicy` into credential and cert rotation | Rotation ≠ revocation today |
| 0.7 | **H-5**: widen the redaction mask to `\b\d{10,25}\b`; update the test | PAN leak in fault text |
| 0.8 | **`infoSource` guard** (§4.1): refuse or loudly warn on a card-level prompt write when `infoSource === "POLICY"` | We currently report success for a write the pump ignores |

### P1 — Close the reported functional gaps (1–2 weeks)

| # | Item |
|---|---|
| 1.1 | **Call `getPromptTypes(clientId)`**, cache per org, and drive the UI options from it rather than a hardcoded pair |
| 1.2 | **Widen `EFS_EDITABLE_INFO_IDS`** beyond `["DRID","UNIT"]` — at minimum add `ODRD`, `HBRD`, `TRIP`, `TRLR`, `PONB`, `NAME` — and **widen the validation-type enum** to the full 7 with the `DYNAMIC`→`CNTN/PPIN/DRID` constraint enforced. Raise the 2-prompt array cap |
| 1.3 | **"Add prompt" affordance** in the UI (§5.6.3 op 6) |
| 1.4 | **Override with amount** — the p194 product-limits recipe: `limits[]` field on `grantOverrideSchema`, `replaceAll` edit in `overrideGrantEdits`, product + amount inputs with the unit spelled out, confirmation copy naming gallons/dollars via `formatLimit`, step-up gate |
| 1.5 | **Fix E-1 first** (xsd:sequence ordering + teach `diffCanonical` to compare element order), because 1.4 on a card with no existing `<limits>` is exactly the introduce-a-new-collection case |
| 1.6 | **Fix E-2** — wire `EFS_CARD_WRITE_TIMEOUT_MS` as a real whole-orchestration deadline |
| 1.7 | **`handEnter` write** — one enum, biggest security-per-line-of-code in the whole list |
| 1.8 | **Surface what's already parsed**: `locationGroups`, the blocked-locations list, `autoRollMap`/`autoRollMax`, `locationSource` — all currently dropped in `read.ts:304-311` and `limitRows` |
| 1.9 | Add the `flying j` fault-table entry; make `classifySetCardResponse` recognise `errorNumber`/`errorDesc` documents so the vendor's diagnostic isn't discarded |
| 1.10 | **M-1** require `Idempotency-Key`; **M-2** give `deleteOverride` a vendor-op reconciliation branch; **M-3** step-up on `/efs-soap/enable` |

### P2 — The drawer redesign (2–3 weeks)

| # | Item |
|---|---|
| 2.1 | Build `CardOperationDrawer.vue` — the six-region shell with the seven invariants (§5.6.1). Lift the per-intent idempotency keys, the re-mint-on-settle rule, the re-entrancy guard and the card-identity reseed **verbatim** |
| 2.2 | Migrate the five existing intents onto it, one trigger each |
| 2.3 | Add the **"What will change"** diff region (fixes D5, and is the single highest-value UX addition) |
| 2.4 | Add the `result` and `stale` states (fixes D11, D13, A9) — including the "Unverified" landing place with a history link and a disabled retry |
| 2.5 | Actions card on the detail page; kebab actions on the list page; contextual `Edit…` / `Remove exception…` triggers |
| 2.6 | Wire the `reason` field so the `Why` column stops being blank, and reconcile `docs/22:434-435` with `cardControlContract.ts:255-258` |
| 2.7 | Fix the design-contract breaks (§5.4) and the accessibility gaps (§5.5) |
| 2.8 | Environment badge in the drawer header (L-4) |

### P3 — Remaining EFS capacity (scoped after P2)

| # | Item |
|---|---|
| 3.1 | `setCardRefreshingLimits` / `getCardRefreshingLimits` — velocity limits, plus the `OVER`-suffix override recipe |
| 3.2 | `getCreditLimits` — show real account headroom in the UI; it's the number that answers "can we actually do this today" |
| 3.3 | Product-limits editor (op 7) and time restrictions (op 11) |
| 3.4 | Location groups + blocklist editor (op 9) |
| 3.5 | **The capacity bridge**: size `ULSD` gallons limits from measured `sensor_capacity_gal`. Guard the unit trap — an EFS limit is per reset window and capped at 9999; tank capacity is a one-shot physical bound |
| 3.6 | Lifecycle: `replaceLostOrStolenCard`, `reissueDamagedCard`, `transferCard`, `setCardPin` (ops 12–14) |
| 3.7 | **Maker-checker** (L-1) and a **revert path** (L-2) — the seams exist; note revert can't restore the five payroll flags until they're modelled in `WsCard` |
| 3.8 | `managedFuelAction` — route-locked fueling. The most product-differentiating EFS primitive you're not using |

### Cross-cutting

- **Check the WSDL into the repo** (`docs/efs/CardManagementWS.wsdl`) with a retrieval date, and add a CI check that the operation names we call still exist in it.
- **Add `efs_card_mutations` to `RETENTION_FORBIDDEN`** so a future retention rule can't prune the write ledger.
- **Model the five SmartFunds payroll flags in `WsCard`** — they're on the wire already; without them revert is structurally incomplete.
- **Reconsider the 200-card / 24h detail sync budget** before the fleet grows past it (§4.3).

---

## Appendix A — Override recipes (guide p194, verbatim)

```
Override All Locations
  · getCard
  · setCard, echoing back your data from the getCard response
  · overrideAllLocations = True
  · override = 1..9   (1 = one-time override, 9 = nine times)

Override Single Location ID
  · getCard
  · setCard, echoing back
  · locationOverride    = the 6-digit EFS LLC Location Id to open the card up to
  · overrideAllLocations = False
  · override            = 1..9

Override Product Limits            ← the "amount"
  · getCard
  · setCard, echoing back everything EXCEPT the limits
  · overrideAllLocations = True
  · override            = 1..9
  · add back the limits array with the products and limits you want, e.g.
        <limits>
          <hours>1</hours>
          <limit>1000</limit>
          <limitId>ULSD</limitId>
          <minHours>0</minHours>
        </limits>

Override Refreshing Limits         (several calls)
  · getCard
  · setCard, echoing back
  · overrideAllLocations = True
  · override            = 1..9
  · then setCardRefreshingLimits with cardNumber = <card number> + "OVER"
        e.g. 7083••••••••••1111  ->  7083••••••••••1111OVER
  · set the limits to the override values
```

## Appendix B — File index for the findings

| Area | Files |
|---|---|
| SOAP transport / session | `apps/api/src/lib/efsSoapSession.ts`, `soapClient.ts`, `efsTls.ts` |
| Card ops / XML | `efsCardOps.ts`, `efsCardXml.ts`, `efsCardEcho.ts`, `efsCardCanonical.ts`, `efsCardWrite.ts`, `efsPolicyCache.ts`, `efsLocationSearch.ts` |
| Orchestration | `services/efsCardControl.ts`, `efsCardEdits.ts`, `efsCardReconcile.ts`, `efsCardUnresolved.ts`, `efsCardMirror.ts`, `efsCardControlAccess.ts` |
| Routes | `routes/fuelCards/control.ts`, `read.ts`, `settings.ts`, `probe.ts`, `writeProbe.ts`, `writeProbeRealChange.ts`, `experiments.ts`; `routes/integrations.ts` |
| Contracts / catalog | `packages/shared/src/cardControlContract.ts`, `efsCardCatalog.ts`, `cardWriteLimits.ts` |
| UI | `apps/web/src/features/fuelCards/CardControlDrawer.vue`, `CardStatusPanel.vue`, `CardOverridePanel.vue`, `CardPromptsPanel.vue`, `CardEffectiveConfig.vue`, `cardControlModel.ts`, `useCardControl.ts`, `useEfsCards.ts`, `EfsLocationPicker.vue`, `CardMutationHistory.vue`; `pages/FuelCardDetailPage.vue`, `FuelCardsPage.vue`, `CardControlSettingsPage.vue`, `EfsSoapPage.vue` |
| Migrations | `0091`, `0171`, `0173`, `0176`, `0177`, `0178`, `0179`, `0180`, `0181` |
| Security middleware | `middleware/auth.ts`, `requireFreshAuth.ts`, `cardWriteLimit.ts`; `lib/secretBox.ts`, `stepUpToken.ts`, `audit.ts`, `ssrfGuard.ts` |

---

**Sources**

- EFS LLC / WEX — *WEX OTR Card Management Web Service Reference*, v12.0, July 2024 (`docs/EFS LLC Card Web Service Integration Guide .pdf`)
- `CardManagementWS` WSDL, `https://ws.partner.efsllc.com/axis2/services/CardManagementWS/`
- [WEX Developer Portal](https://developer.wexinc.com/)
- [WEX — Over-the-Road Fleet Mobile Apps](https://www.wexinc.com/solutions/over-the-road-fleet-cards/mobile-apps/)
- [P-Fleet — Fuel Card Purchase Controls: Complete Guide](https://www.pfleet.com/blog/fuel-card-purchase-controls-guide)
- [DAT — Securing your fleet: Best practices for fuel card security](https://www.dat.com/resources/fuel-card-security-best-practices)
- [FleetRabbit — Fleet Fuel Card Controls: Set Spending Limits That Prevent Waste (2026)](https://fleetrabbit.com/article/fleet-fuel-card-controls-spending-limits-2026)
- [Oxmaint — Fleet Fuel Card Fraud & Misuse Controls Guide](https://oxmaint.com/industries/fleet-management/fleet-fuel-card-fraud-and-misuse-controls-guide)
