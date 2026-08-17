# Odometer following and SecureFuel — what the vendor actually gives us

**Researched 2026-08-17.** Sources, in the order they were trusted: the WSDL
(`docs/efs/CardManagementWS.wsdl`), the EFS guide PDF, the committed account captures
(`docs/efs/account-inventory-*.json`), and Miki's operational description of how the product behaves
at the pump. Where they disagree, the account wins — that rule was earned this session, see §5.

---

## 1. How it works, end to end

Miki's account, 2026-08-17, and every part of it is corroborated below:

> The driver is required to enter the exact odometer during fuelling at the pump. SecureFuel compares
> that entry against the reading EFS holds. We pull odometer readings from our GPS — Samsara ELD,
> connected to EFS. When a new card is assigned this is set automatically. We sometimes have to
> override the mileage because GPS was not working properly.

So there are three moving parts, and this product currently models **none** of them:

| Part | Where it lives | Our status |
|---|---|---|
| The prompt that asks the driver | `ODRD` / `ACCRUAL_CHECK` on the policy or card | ✅ read; write path fixed in PR #82 |
| The reading EFS compares against | per **unit**, via `getLastMileage` | ❌ never called |
| The BASELINE when GPS is unstable | `overrideLastMileage` | ❌ never called |
| Whether the card is POSITION-checked | `doesCardPosition` | ❌ never called — and ON for this org (§6a) |
| The card↔GPS identity | `gpsid`, `vin`, `zid` on `WSCardSummary` | ❌ not modelled — and load-bearing (§6a B) |
| **Location checking at the pump** | not scoped anywhere | ❌ **unknown territory (§6a B)** |

---

## 2. The accrual window is `minimum`/`maximum`, not `value`

**This is the correction PR #82 shipped, and it is the single most important fact in this document.**

The WEX portal renders production's prompt as:

```
Policy   Odometer   Accrual Check   M:1 , X:1800
```

`M` is `minimum`, `X` is `maximum`. Both production policies carry exactly that, with `value: "0"`
and `lengthCheck: false`:

```json
{ "infoId": "ODRD", "validationType": "ACCRUAL_CHECK", "matchValue": null, "reportValue": null,
  "numericMatchValue": null, "lengthCheck": false, "minimum": 1, "maximum": 1800, "value": "0" }
```

The guide says the opposite — *"For the accrual check method for odometer or hubometer, this
[`value`] is the accrual value"* (p36, p135, p138) — and says `minimum`/`maximum` are *"only checked
if lengthCheck is true"* (p36, p135). **Neither holds on this account.** Step 9.2 encoded both as
validation rules and thereby refused production's own record; on a `replaceAll` surface that blocked
the entire prompt save, not one field.

**Read the window as: the entry must show at least 1 and at most 1800 miles of travel since the last
reading.** That is a plausibility band — it rejects a copied-down reading (0 accrual) and a typo that
adds a digit. It matches Miki's description and it matches the numbers. ⚠ It is an inference about
the DIRECTION of the check, not a vendor statement; the guide never describes the comparison. It is
safe to *write* the window without settling it, because we reproduce a shape the account already
runs — but any UI sentence explaining it to an operator should be confirmed with WEX first.

**Rule for any odometer write:** set `minimum`/`maximum`, leave `value` at `0`, leave `lengthCheck`
`false`. That is the shape the account carries; anything else is a shape this vendor has never seen,
and accepted-and-ignored is its demonstrated response to those (audit W3).

---

## 3. The four uncalled operations, with exact contracts

### `doesCardPosition(clientId) → boolean`

> *"This is related to customers that use the EFS LLC SecureFuel product. This method will return if
> the customer uses secure fuel. If has secure fuel rules of 1 or 2 and a member type of customer,
> this will return true."* (guide p30)

Account-level, read-only, one call, no parameters beyond the session. **It answers whether any of
this matters for a given org**, and Phase 7's inventory walk — which asks the account twelve
questions — does not ask it. Cheapest possible addition: one more `step()` in `inventory.ts`.

Note the guide mentions *"secure fuel rules of 1 or 2"* and gives no way to read which rule applies.
That is a question for WEX.

### `registerCardPosition(clientId, cardNum, latitude, longitude, unitNum, source) → «status»`

**Found 2026-08-17, after this document's first four sections were written — it is a fourth
operation, and this section used to say "three".** It matters because §6a B established that
SecureFuel checks POSITION: this is the write that puts a position where SecureFuel can check it.

```
clientId   string (32)
cardNum    string (25)
latitude   float (10,6)
longitude  float (10,6)
unitNum    ⚠ WSDL only — see below
source     string (24)    "The data source."
```

> *"Registers the position of a card (latitude/longitude)."* (guide p125)

⚠ **WSDL/guide discrepancy, the sixth of this kind:** the WSDL declares
`parameterOrder="clientId cardNum latitude longitude unitNum source"` — six parameters. The guide's
input table (p125) documents five and **omits `unitNum` entirely**. Trust the WSDL, as Phase 7
established, and treat `unitNum` as required-until-proven-optional.

Two things follow. First, it is the exact structural mirror of `overrideLastMileage`: a non-card
write, keyed on the unit, whose output the guide describes only as *"Successful response indicating
card position was registered else a decline with an error string"* — so §4's argument about the card
ledger applies to it unchanged. Second, we already hold the input. Samsara gives us a GPS fix per
unit; this is the operation that would hand it to EFS. **Nothing in §6's proposed scope covers it**,
and it should not be added there until question 2b is answered — writing positions into a decline
path we cannot yet read the outcome of is the wrong order to build in.

### `getLastMileage(clientId, search) → WSLastMileageArray`

```
WSLastMileageSearch  { unit: string, code: string }      ← input
WSLastMileage        { unit: string, code: string, mileage: int }   ← each result
code = "ODRD" (odometer) or "HBRD" (hubometer)
```

⚠ **WSDL/guide discrepancy:** the guide says *"Search Array, 1 to many"*, but the WSDL declares the
part as a single `WSLastMileageSearch` and there is **no** `WSLastMileageSearchArray` type. Phase 7
found five discrepancies of exactly this kind by reading the WSDL instead of the guide. Assume one
unit per call until a live probe says otherwise, and budget requests accordingly.

The `<search>` wrapper needs no guessing here, and that is worth noting because the last operation
with criteria did. `efsLocationSearch.ts` had to try shapes against the live binding and remember
which one ADB accepted, since the WSDL was unavailable when it was written; this part is *named*
`search` in the checked-in WSDL, so the shape is read from the vendor rather than discovered from a
fault.

### `overrideLastMileage(clientId, unit, code, mileage) → «empty»`

```
clientId  string
unit      string     the unit #
code      string     "ODRD" | "HBRD"
mileage   int        the mileage to use
```

**The response message has NO PARTS.** `CardManagementEP_overrideLastMileageResponse` is empty in the
WSDL — this operation returns nothing at all, not even a `<result>`.

That is decisive for the design: **landing cannot be judged from the response.** It must be verified
by re-reading `getLastMileage` and comparing. The capability architecture already has the shape for
this — `verify.snapshot` names its OWN read ops (docs/27 §3.3), the case `setCardRefreshingLimits`
was designed around. A `direct` mutation whose snapshot is `getLastMileage` and whose `judge`
compares the returned mileage is exactly right.

---

## 3a. What the WEX portal's own Override Mileage screens show (Miki, 2026-08-17)

Three screenshots of the operation being performed by hand — the task this feature automates. They
settle three things the WSDL cannot, and one of them improves the design.

**The portal's flow is search-then-edit, which is the flow the empty response forces on us anyway.**
*Override Mileage* asks for a unit, `Search` lists *Last Mileage Information*, and only an `Edit`
pencil on the row opens *Edit Mileage* with the current value pre-filled. So the mandatory re-read in
§3 is not our invention working around a vendor limitation — **it is what WEX's own UI does**, and an
operator moving from the portal to this product will find the same three beats.

**There is an `All` mode, and it may collapse the fleet read to one call.** The unit field is
required only for a targeted search; the `All` radio returns every unit's row. Both criteria are
`nillable` in `WSLastMileageSearch`, so the wire equivalent is `<search><unit></unit><code></code></search>`
— empty ELEMENTS, per the rule this binding taught the transaction feeds. If that is accepted, a
fleet-wide drift comparison costs one round trip instead of one per unit, which changes what §6 D can
afford. ⚠ **Inference from the portal, not from the wire.** It is the first thing to probe live, and
it is cheap: `getLastMileage` is read-only.

**⚠ `Code` renders as "odometer", not `ODRD` — a third portal-display-vs-wire-value trap.** The
captured row reads `Carrier ID 139445 · odometer · Unit 688 · Mileage 258536`. The wire value is
`ODRD` (guide p97, p135); "odometer" is a label the portal substitutes, exactly as `M:1, X:1800` is a
rendering of two integers (§6b) and `INFORMATION_POOL` may be a rendering of a validation type (§7
2d). Three instances now, all in this one feature's neighbourhood. **Sending the label instead of the
code would be dispatched into an operation that returns nothing to say it was wrong** — hence
`EFS_MILEAGE_CODES` as a closed set rather than a free string.

Two smaller facts. `Carrier ID` appears in the portal's table but is **not** part of `WSLastMileage`,
which carries `{unit, code, mileage}` only — the portal is joining account context it already has.
And the unit is a bare short number (`688`), consistent with `vehicles.unit_number`; whether EFS's
unit string and ours agree for every truck is the assumption the whole feature rests on, and
`getLastMileage` in `All` mode is what will answer it.

---

## 4. The override is the first non-card write — a cost only if we route it through the card ledger

> ⚠ **Read §5a and §6 before acting on this section.** It originally concluded "its own phase", and
> that estimate was written before anyone measured that `ODRD` never appears on a card. The costs
> below are real but they are CONDITIONAL on routing the write through the card-mutation ledger.

`overrideLastMileage` targets a **unit**. Today:

- `Target` is `card | cardPair | policy | group` — there is **no `unit`** kind
  (`packages/shared/src/efs/types.ts`).
- `planCardMutation` refuses every non-card target with `unsupported_target` / 501, before any
  vendor call (`orchestrator/plan.ts`).
- `efs_card_mutations` is keyed on `efs_card_id`. A unit mutation has no card.
- `docs/27` §5.2 anticipated this in writing: *"cardLedger is the only adapter that exists and it can
  only key a row on a card."* The seam was reserved; nothing has been built in it.

So "add the odometer override" is **not** a small feature. It needs, in order:

1. A `unit` target kind.
2. A second `LedgerAdapter` — and a migration, because the ledger table cannot key a unit row today.
3. The capability triple (contract / behaviour / view) with a `getLastMileage` snapshot.
4. A unit→card resolution story: our mirror links cards to units through the `UNIT` prompt
   (`docs/22` H13 notes 29 production cards lack one), so "which unit" is answerable but not free.

**All four costs above apply only if this goes through the card-mutation ledger.** The alternative —
a plain audited vendor write with `writeAudit` and a `getLastMileage` re-read, outside the capability
registry — carries none of them and is proportionate to one operator correcting a GPS glitch. The
re-read is required either way, because the operation returns nothing (§3).

Decide between the two when building it, against §5a. Do not carry "its own phase" forward as
settled: it was my estimate, made before the card-level measurement, and §6 withdraws it.

---

## 5. The method note, because it cost us once already

Step 9.2's two bad rules came from the guide's prose, and production's own record — the one that
disproves both — was in `docs/efs/account-inventory-production.json` throughout, in a file the same
branch already read for a different test. Nothing parsed the account's real record through the schema
being written.

**For every field this phase touches: parse the account's captured record through the schema first,
as a test, before writing a single rule about it.** The characterisation is one assertion away and it
is the only thing that can contradict a plausible misreading of the vendor's prose.

---

## 5a. ⚠ `ODRD` NEVER appears on a card — this is read-mostly integration

Measured across every document both accounts have produced — 199 production, 35 QA:

```
Card-level info ids:  DRID  NAME  TRIP  TRLR  UNIT  CNTN  DLIC  DLST
Policy-level:         ODRD / ACCRUAL_CHECK   (policy 1 AND policy 2)
```

**Not one card carries `ODRD`.** Odometer following is a POLICY setting applied fleet-wide and set
automatically when a card is assigned — exactly as Miki described the product behaving.

This kills the card-level accrual editor Step 9.3 specifies. It would be a control for a field
nobody configures per card, on a surface where every extra control is a way to break a pump. The step
was written from the guide's field list without asking where the field actually appears.

**Miki's framing, and it is the right one:** *"we are not building an EFS system, we are just
implementing it into ours — our system should pull the things set for our company by policy and then
use them."* The data agrees. For odometer following we READ the policy's window and DISPLAY it. We do
not write it.

The one exception is §6's E′, and it earns its place for a reason specific to this product rather
than to EFS: **we hold the GPS truth.** Samsara gives us the real odometer; EFS keeps a copy that
goes stale. Correcting that copy is integration work, and it is the task Miki performs by hand today.

---

## 6. Proposed scope

| # | Change | Verify | Cost |
|---|---|---|---|
| # | Change | Verify | Cost |
|---|---|---|---|
| ✅ **A** | `doesCardPosition` added to the account-inventory walk | **BUILT 2026-08-17.** Reads its own part name, kept three-valued end to end, and raised `INVENTORY_REQUEST_BUDGET` 28 → 29 rather than buying the call with policy coverage. Live run on both orgs still owed | one call, hours |
| **B** | Model `gpsid` / `vin` / `zid` from `WSCardSummary`; surface on the card page | A card with a GPS ID shows it; `MODELLED_CARD_FIELDS` parity test still green | small |
| ~~**C**~~ | ~~Card-level accrual editor~~ | **DROPPED — see §5a. `ODRD` is policy-only; no card has ever carried it** | — |
| ✅ **D** | `getLastMileage` as a read — EFS's stored reading beside Samsara's | **BUILT 2026-08-17.** `GET /api/fuel-cards/unit-mileage` returns EFS's reading, ours, the `odometer_offset` calibration and the drift. Live reading for a known unit vs the WEX portal still owed | small |
| ✅ **E′** | `overrideLastMileage`, VERIFIED BY RE-READ | **BUILT 2026-08-17.** `POST` to the same path: read, write, re-read, and the re-read is what the response reports. Four landings, `already_current` among them. Live proof still owed | small–medium |

A, B, D and E′ are read-mostly integration with a single write, which is the right shape.

**§4's architecture cost applies only if E′ is routed through the card-mutation ledger.** It targets a
unit and that ledger keys on a card, so the honest choice is: either accept a plain audited write
(`writeAudit`, re-read verification, no capability triple) or pay for the second `LedgerAdapter`.
The first is proportionate to one operator action correcting a GPS glitch. Decide it when building
E′, not before — but do not let "it needs its own phase" stand unexamined, because that was written
before §5a was measured.

### ✅ Decided 2026-08-17: the plain audited write, and what it costs

Taken on §6's recommendation and verified against the code first — §4's four costs are all real.
`planCardMutation` refuses every non-card target at its first line, `ReadCtx` requires a
`cardNumber`, `Snapshot.doc` is documented card-only, and the ledger keys on `efs_card_id`. (One
correction to §4: `Target` already carries an `account` kind, so `unit` would be the sixth, not the
fifth.)

**What this write does NOT get, recorded here so nobody discovers it later:**

- no `pnpm efs:prove` — the prover is keyed on capabilities, so there is no OEG run and no Step 4.6
  promotion gate;
- no ledger row, so nothing in `mutationView` and no background reconciler second look;
- the audit row and the response are the entire record.

**What makes that acceptable rather than merely cheap** is that landing is judged from a re-read,
now, using the same operation a capability's `verify.snapshot` would have named. The audit row
carries `before`, `after` and the verdict on every outcome including the failures — so the evidence
a ledger would have held sits in `audit_logs` instead of nowhere.

**Two things found while building it that would have been live defects.** `card_write_counters.bucket`
carries a CHECK enumerating the three buckets that existed in 0178; a fourth makes the RPC error,
and because this bucket is fail-closed the symptom is *every* correction answering 503 "the usage
counter is unavailable" — a permanent failure wearing a transient message. Migration **0201** admits
it. And the path had to be a single segment: `/mileage/override` is matched by the `card_override`
rate-limit pattern with its wildcard binding to `mileage`, which would have metered odometer
corrections out of the fuel-override budget and named them as overrides to the operator. The same
wildcard shadows it twice more — `GET /:id` in the router mount and again in the vendor rate-limit
table, where the entry must sit ABOVE `/:id` or inherit its `opensSoap: false` and go uncharged.

**And one gate caught a third.** The two reads went into `efsAccountOps.ts`, which is where every
rule that module states puts them — and took it to 560 lines, past the 500-line budget its own header
brags about keeping `efsCardOps.ts` inside. All three operations now live in `efsSecureFuelOps.ts`,
which is the better home anyway: one feature, one file, with the write declared at the top. The
account module keeps its "read-only, every one" claim and the test that holds it to it.

## 6c. ⚠ QA answered `false` — the account we prove things on does not have this feature

**First live run of `doesCardPosition`, QA, 2026-08-17.** The operation dialled, parsed and answered
in 1.6s:

```
doesCardPosition  ok  1610ms  ->  securefuel: false
```

Two things follow, and the second one changes how this ships.

**§6 A is proven live.** The answer is `false`, not `null` — so the response really does carry the
value under its own part name, exactly where the WSDL says and nowhere near `<result>`. That was the
one claim a WSDL-derived fixture could not make, and it is now made. The three-valued handling earns
its keep here too: had the parse missed, this would read `null`, and `null` is visibly not an answer
where `false` is.

**QA cannot prove the odometer feature, because QA does not have it.** The account walk confirms it
structurally as well as by the flag — all three QA policies carry `"infos": []`, no prompts of any
kind, where both production policies carry `ODRD` / `ACCRUAL_CHECK` with `M:1, X:1800` (§2).

That breaks the QA-first discipline this product uses everywhere else, and it cannot be fixed by
being careful:

- `getLastMileage` on a QA unit is expected to return nothing, since there is no SecureFuel
  configuration behind it. **Worth one read to confirm** — read-only, one call — because "returns
  nothing" and "returns a reading anyway" are different worlds for the override.
- `overrideLastMileage` has nothing meaningful to correct on QA. A proof run there would exercise
  our code and tell us nothing about the vendor's behaviour, which is the H1 shape: a green run that
  proves the harness rather than the integration.
- So **the first real exercise of E′ is on PRODUCTION**, against a live truck's baseline. That is a
  materially different risk posture from every other capability in this product, and it is the
  argument for the `already_current` short-circuit, the vehicle-ownership check, `EFS_MILEAGE_MAX`
  and the 3/minute cap all being in place BEFORE the first live write rather than after.

### ✅ Production answered `true` — the vendor now says it, 2026-08-17

```
SILVICOM INC  (carrierId 139445)   ->  securefuel: true
```

§6a had SecureFuel as ON for this org on Miki's operational account of it. The vendor now says so
itself, which makes this the first end-to-end confirmation of the premise the whole document rests
on. The `carrierId` is the same **139445** printed on the portal's Override Mileage table (§3a), so
the screenshots, the flag and the walk are all the same account.

The two accounts therefore differ in kind, not in degree:

| | QA | Production |
|---|---|---|
| `doesCardPosition` | **false** | **true** |
| policy prompts | `infos: []` on all 3 | `ODRD` / `ACCRUAL_CHECK`, `M:1 X:1800`, both policies |

**Which settles where E′ can first be exercised, and it is not the account we usually prove things
on.** See the constraint above; it is now a fact rather than an expectation.

⚠ Production's walk also returned two failures on `getPolicyRefreshingLimits`, unrelated to this
feature but worth knowing about because the label was wrong: they were recorded as `rate_limited`
and are in fact the contract refusing a feature it does not carry. `docs/25` Q6 carries the
correction.

⚠ Unrelated, and noted so it is not read as a symptom: `getPolicy(1)` failed this run with a
`transport` error after 96 seconds. `getPolicy` is not new and is not part of this change — the walk
is built to record a failed step and continue, which is what it did.

---

## 6a. Answered by Miki, 2026-08-17 — and one of them renames the whole feature

Asked as the scope items in §6, answered operationally:

| # | Answer | What it changes |
|---|---|---|
| **A** | **SecureFuel IS ON for this organization.** | `doesCardPosition` drops from discovery to confirmation. Still worth calling — an org-level flag we assert rather than assume — but nothing waits on it. |
| **B** | **Samsara is connected to EFS, and SecureFuel uses odometer AND LOCATION.** | ⚠ See below. This is new and it is not a detail. |
| **D** | **EFS compares the driver's entry against the reading from Samsara.** | Confirms the mechanism. `getLastMileage` therefore reads *Samsara's value as EFS received it* — which makes it a divergence check against our own copy, not just a display. |
| **E′** | **The override sets a STARTING mileage, used until Samsara data is stable.** | It is a SEED, not a permanent correction. That changes the UI verb and the audit story: "set baseline until telemetry recovers", not "fix the odometer". |

### ⚠ B: SecureFuel checks POSITION, and that explains the operation's name

`doesCardPosition` is not an oddly-worded "does this customer have SecureFuel". It is literally asking
whether the card is **positioned** — whether GPS location is being checked. SecureFuel verifies two
things at the pump: that the odometer entry is plausible, **and that the truck is actually at the
site**. The card-summary fields we do not model — `gpsid`, `vin`, `zid` — are the identity that makes
both checks possible, and `zid` is described in the guide as *"the ZID for the card, for secure
fuel."*

This raises the value of §6 item B considerably. Those three fields are not cosmetic: they are the
join that decides whether a card participates in SecureFuel at all. A card missing its `gpsid` is a
card whose driver may be declined at the pump for a reason no screen in this product can currently
explain — and `docs/22` H13 already records 29 production cards with no unit prompt, which is the
adjacent failure.

**It also opens a question nobody has asked:** does a location mismatch decline a fuelling, and can we
see that reason anywhere in the transaction data? Location is scoped nowhere in the plan today.

---

## 6b. Cross-check against WEX's public material (Miki, via ChatGPT, 2026-08-17)

An independent pass over EFS eManager, EFS merchant policies and WEX's public SecureFuel pages. It
reaches the same structural conclusion this document does — SecureFuel is a separate authorization
mechanism, not a prompt — and adds two facts. It also makes one recommendation that must NOT be
followed, for a reason worth stating plainly.

### ⚠ `M:1, X:1800` is eManager's DISPLAY, not an EFS wire value

The research recommends preserving `rawEfsValue: "M:1,X:1800"` with an
`interpretationStatus: 'EFS_CONFIRMATION_REQUIRED'`, on the grounds that the SOAP contract was not
available to it — *"upload the WSDL, that's the missing piece."*

We have the WSDL. It is committed at `docs/efs/CardManagementWS.wsdl`, and there is no encoded string
anywhere in this path:

```
WSCardInfo:  minimum: int   maximum: int   value: int   lengthCheck: boolean
```

`M` and `X` are how the portal RENDERS two integer fields that already arrive structured and named,
as §2's captured record shows. So the letter-decoding question is not open — it was answered by the
wire before it was asked. **Do not add a raw-string layer**: it would invent a serialization that
does not exist and couple this product to a UI rendering that WEX can change at will.

The research's *conclusion* (M = minimum, X = maximum) is right. Its *evidence* is the letters; ours
is the WSDL and 199 live documents. Keep the second.

### Genuinely new, and worth acting on

1. **SecureFuel also checks TANK LEVEL / ECM, not only location.** WEX's SecureFuel material describes
   checking the truck's location *and tank level* before authorizing, and reporting proximity and
   tank reconciliation back to the carrier. Miki's §6a B named odometer and location; this is a third
   signal and, more usefully, a reconciliation OUTPUT we have never looked for.
2. **`INFORMATION_POOL` appears as a validation type in eManager** and is **not** among the seven the
   SOAP guide lists (p36). Either the portal offers a validation the API does not document, or it is
   `DYNAMIC` under another name. Same class of portal-vs-API gap as `M:1, X:1800`, and unresolved.

### Already built, so not work

- Policy/card prompt separation with a computed effective configuration — that is
  `cardControlEffectiveConfig.ts`, `CardEffectiveConfig.vue` and `infoSource` (POLICY/CARD/BOTH),
  shipped in Phase 7.
- Hiding the vendor's serialization from the frontend — the API already returns typed integers.

### Declined

Renaming info ids to `ODOMETER` / `DRIVER_ID` / `UNIT_NUMBER`. The vendor's identifiers are the
four-character codes in the guide's own Info IDs table (p168-169), verified one-for-one against
`EFS_INFO_LABELS`, which already supplies the friendly name keyed on the real code. A parallel
vocabulary would be a second mapping to keep correct for no gain.

---

## 6d. First live read — and the number that turns this into a product

**Production, unit 688, 2026-08-17.** One `getLastMileage`, read-only:

```json
{ "unit": "688", "code": "ODRD", "efsMileage": 258536, "knownVehicle": true,
  "ourMileage": 258747.7, "odometerOffset": 0, "drift": 212 }
```

**`258536` is the value on the WEX portal screenshot taken 2026-08-16.** That is the first fact in
this whole integration checked against something a human has seen the vendor display, rather than
against a fixture written from the WSDL by the same person who wrote the parser. It proves the SOAP
path end to end: the `<search>` wrapper read from the WSDL rather than guessed at, the `ODRD` wire
code rather than the portal's "odometer" label, and the single-unit filter §3 could only assume.

### ⚠ `drift` is the operational number, and 1800 is a ceiling

EFS's copy is **212 miles behind** ours. Set that against §2's window — production's policies carry
`minimum: 1, maximum: 1800` — and the shape of the whole feature falls out:

- A driver entering the true odometer today shows an accrual of ~212 against EFS's stored reading.
  Inside the 1–1800 band, so the pump accepts it. **The fleet is working, and now we can say why.**
- A truck whose EFS copy falls more than **1800 miles** behind is a truck whose driver gets DECLINED
  at the pump, for a reason no screen in this product currently explains — and Miki's "we sometimes
  have to override the mileage" (§1) is the manual repair for exactly that state.
- Which means **drift is monitorable and the threshold is knowable in advance.** This stops being an
  integration and becomes a product the moment we read every unit's drift instead of one.

⚠ The 1800 ceiling reading still depends on §7 Q1's unconfirmed DIRECTION. It is safe to MONITOR on
that basis — a list of trucks sorted by drift is useful under any reading of the window — but no UI
sentence should tell an operator *"this truck will be declined"* until WEX confirms it. Sorting by
drift makes no claim; that sentence does.

### The cheap next step, and it is still read-only

`getLastMileage` takes empty criteria as "every unit" — the wire equivalent of the portal's **All**
radio, already covered by the parser and its fixture. So **one call** plausibly returns the whole
fleet's stored readings, which joined against `vehicles.current_odometer` gives fleet-wide drift for
the cost of a single vendor request. It would also settle §7 Q3 in passing.

That is the next thing to build, and it should come BEFORE the override write: knowing which trucks
are drifting is what tells an operator which one to correct, and §6c has already established that the
first override lands on production with no QA rehearsal behind it.

---

## 7. Open questions for WEX

> **A pass over the guide and the WSDL on 2026-08-17 tried to close 1, 2c and 2d without WEX.** It
> closed none of them, which is itself the useful result — each is now known to be unanswerable from
> the material we hold, for a stated reason, rather than merely unanswered. The reasons are recorded
> under each question. 2d is answerable by a live QA probe; 1 and 2c are not answerable by any
> experiment we can run.

1. **Still open, and it is the one that matters.** Which direction is the accrual window checked, and
   in what unit — is `M:1, X:1800` "at least 1 and at most 1800 miles since the last reading"? Miki
   confirms EFS compares the entry against Samsara's reading (§6a D), which settles *what* is
   compared but not *how the window is applied*. No UI sentence should explain it until this is
   answered.

   ⚠ **The guide describes `minimum`/`maximum` THREE different ways, and none of them is an accrual
   window.** `setCard`/`getCard` (p36, p135) say *"The maximum value. Only checked if lengthCheck is
   true."* `getPolicy` (p84) says something else again — *"Max length" / "Min length"*, the length of
   the entered string. And §2's captured production record carries `minimum: 1, maximum: 1800` with
   `lengthCheck: false`, which both descriptions exclude. The most likely explanation is that the
   guide's authors documented these two fields for length checking and **never modelled what
   `ACCRUAL_CHECK` does with them at all**. That kills the last hope of deriving the direction from
   the document: there is no sentence to read carefully, because there is no sentence. Only WEX can
   answer this, and it cannot be probed — confirming the direction would require causing a real
   fuelling at a real pump with a known odometer delta.
2. What are *"secure fuel rules of 1 or 2"*, and how do we read which one applies to an account?
   Sharpened by §6a B: if one rule is odometer-only and the other adds position, this decides what
   the product can honestly tell an operator about why a fuelling was declined.
2b. Does a POSITION mismatch decline a fuelling, and is that reason visible in the transaction data?
2c. Same for TANK LEVEL (§6b): WEX's public material says SecureFuel checks tank level and reports
   tank reconciliation to the carrier. Where does that reconciliation surface, and can we read it?

   ⚠ **Not through this web service — the search is exhausted, and the answer is no.** The string
   `tank` does not appear anywhere in the 200-page guide, and no element in the WSDL is named for
   tank, level or ECM. More decisively, `WSTransaction` — the richest per-fuelling record the service
   returns, 50-odd fields covering fees, taxes, currency conversion and line items — carries no tank
   or ECM field of any kind. So the question is not *"which call returns it"* but *"which WEX product
   does"*: eManager reporting, a SecureFuel-specific feed, or nothing we can subscribe to. **Ask WEX
   for the channel, not for the field.** Until then, treat tank reconciliation as outside this
   integration entirely rather than as an unbuilt part of it.
2d. Is `INFORMATION_POOL` — a validation type eManager offers and the SOAP guide does not list — a
   distinct validation, or `DYNAMIC` under the portal's name?

   ⚠ **Absent from both artifacts, and the guide contradicts itself about the seven.**
   `INFORMATION_POOL` appears nowhere in the guide or the WSDL. Worse for anyone hoping to settle
   this by reading: the guide's own enumeration is inconsistent — `setCard`/`getCard` (p36, p135,
   p138) list **seven** types including `DYNAMIC`, while `getPolicy` (p84) lists **six** and drops
   `DYNAMIC` without comment. And the WSDL constrains nothing: `validationType` is declared
   `nillable="true" type="string"`, a free string with no enumeration, so the API will accept any
   value we send and the vendor's demonstrated response to shapes it has never seen is
   accepted-and-ignored (audit W3).
   **This one IS probeable on QA**, and it is the only one of the three that is: write
   `INFORMATION_POOL` to a prompt on a QA card, read it back, and the three outcomes separate cleanly
   — rejected (not a real type), returned as `INFORMATION_POOL` (a real type the guide omits), or
   returned as something else / dropped (a portal alias, or accepted-and-ignored). Worth one proof
   run; it costs a single card write and settles a question the document cannot.
3. Does `getLastMileage` accept more than one search entry per call, as the guide's *"Search Array,
   1 to many"* implies but the WSDL does not declare?
4. Is `value` ever the accrual on any account, or is the guide's sentence simply wrong?
5. **Does a card-level `<limits>` override apply on a card whose `limitSource` is `POLICY`?**
   *(added 2026-08-17 while verifying Phase 10; **largely answered the same day** — see the box below)*

   > ### ✅ Mostly answered from WEX's own portal documentation, 2026-08-17
   >
   > Three official eManager quick-reference guides were found and read — the Overrides guide is now
   > checked in at `docs/efs/eManager-Overrides-2017-11.pdf`, and the two Card Management /
   > Administrator guides are at the URLs in §8 below. **All three agree**, and they answer this:
   >
   > **The portal's procedure for a PERMANENT card-level product limit begins by changing the limit
   > source.** *"In the gray bar at the top of the screen select 'Limits' > 'Update Limits' · Under
   > 'Limit', select 'Both' · Click on 'Add Limit'."* By parallel construction with the card-setup
   > step *"Under Information, select 'Both'"* — which is unambiguously `infoSource` — that `'Limit'`
   > dropdown is `limitSource`. **So card-level limits ARE gated on the source field, and `POLICY` is
   > the state you have to leave to add one.** That half of the worry was real.
   >
   > **But the OVERRIDE procedure has no such step, and that is the answer.** The override flow is:
   > *Override Card → number of overrides → 'Product / Limit Override' → select product → Amount →
   > 'Complete Override'.* No limit-source screen, no mention of it in the notes, and the flow's own
   > stated use case is *"OVERRIDE FOR AN ADDITIONAL PRODUCT – OR A PRODUCT'S LIMIT HAS BEEN USED"* —
   > i.e. it is designed for exactly the cards whose limit came from a policy. WEX documents the
   > override as working without touching `limitSource`.
   >
   > **So `override_grant` should NOT write `limitSource`, and p194 is complete for the override
   > path.** Writing it would be inventing a step the vendor's own flow does not have, and it would
   > leave a card permanently consulting card-level limits after a temporary exception — the exact
   > harm §1.2 is about, caused by the fix rather than the bug.
   >
   > **What is left of this question** is one confirming sentence rather than a blocker: does the
   > override's card-level `<limits>` array take effect even though `limitSource` reads `POLICY`?
   > Every piece of documentation says yes by omission; nothing says yes explicitly. Downgraded from
   > *gates the phase* to *ask when convenient*.
   >
   > ⚠ **One residue worth knowing.** If the override leaves a card-level `<limits>` array behind
   > after it is consumed, that array is inert while `limitSource` is `POLICY` — but it becomes live
   > the day somebody sets that card's limit source to `Both` in the portal. Harmless now, a landmine
   > later. This is a second reason 10.4 must record what the card's `<limits>` looks like AFTER the
   > override clears, not only whether the original limits came back.

   The guide's limits object states, verbatim: *"Only limits assigned at the CARD level are returned,
   POLICY limits are not returned even if the card source is set to `BOTH`."* So `getCard` reports
   card-level limits **only**, and `limitSource` is what decides which set the pump actually enforces.

   p194's product-limit override recipe writes a **card-level** `<limits>` array and **never mentions
   `limitSource`**. docs/22 H7 records `limitSource` as `POLICY` on **all 35** QA cards, and docs/28
   §1986 shows the same on production's sampled card. So the override this phase builds may write a
   set of limits the account does not consult — and this vendor's demonstrated response to a shape it
   has not seen is accepted-and-ignored (H1, audit W3). The operator would be told an exception was
   granted for 1000 gallons of ULSD while the pump went on enforcing the policy's 250.

   **The SOAP guide and the WSDL are exhausted, and this was checked rather than assumed.**
   `limitSource` occurs exactly four times in the 200-page guide, and **all four are field-table rows**
   giving nothing but the enumeration (twice as *"Policy, Card, or Both"*, twice as *"POLICY, CARD or
   BOTH."*). There is no prose anywhere about precedence — a search for *"most restrictive"*,
   *"takes precedence"*, *"supersede"* and *"in addition to the policy"* returns nothing. The WSDL
   constrains it no further: `<element name="limitSource" nillable="true" type="string"/>`, and the
   file contains **zero** `simpleType`/`enumeration` declarations in total, so it validates nothing.
   The guide gives the override recipe and the source field in different sections and never relates
   them. **The answer came from the portal guides instead** — see the box above.

   **Why the obvious probe is weaker than it looks.** Writing the override and re-reading proves only
   that the ARRAY round-trips, which is a different claim from "the pump enforces it" — and on QA it
   is weaker still, because every QA card is on `policyNumber 1`, whose `getPolicy` returns
   `"policy": null` in both inventories. The enforced limits are invisible through both read paths, so
   a round-trip that succeeds tells us nothing about what a pump would do. Confirming enforcement
   needs either WEX's answer or a real fuelling at a real pump.

   **What to ask WEX, now that it is one question and not two:** does an override's card-level
   `<limits>` array take effect on a card whose `limitSource` reads `POLICY`? The portal guides answer
   it by omission — their override flow never touches the field — so this is a confirmation, not a
   discovery. Ask it alongside Q6.

   **Status: downgraded 2026-08-17 from blocking to confirming.** It no longer blocks 10.3 or 10.5.
6. ⚠ **Does `setCardv2` work at all on a card that is currently in override?** *(added 2026-08-17;
   this is the one the portal research turned up that we did not know to ask, and it outranks Q5)*

   All three eManager guides carry the same sentence, in the notes under BOTH override flows:
   *"When a card is in override no changes can be made to the card (i.e. status, add cash, etc.),
   therefore, it is recommended that (1) one override/swipe be selected."*

   Nothing in the 200-page SOAP guide says this. If it is true of the web service and not merely of
   the portal's screens, then on a card carrying an armed override:

   - **`card_lock` may not apply** — the 2am action for a stolen card, which this codebase has
     deliberately kept free of every kind of friction (no reason required, no step-up, see docs/22
     §B1). "No changes can be made" is a great deal worse than friction.
   - **`prompts_set`, `card_unlock`, `card_deactivate` and the mileage override** are in the same
     position. None of them checks `overrideUses` today.
   - ⚠ **Our live override CLEAR is itself a `setCardv2`** on a card that is by definition in
     override — `overrideClearBehaviour` is commented *"the proven mechanism, and the one that is live
     today"*, and it echo-writes the three header fields. If the vendor's sentence holds for the API,
     that path cannot work, and **`deleteOverride` (guide p27) existing as a dedicated operation with
     no payload is exactly what one would expect if the normal write path were closed.** That would
     also explain why WEX bothered to build it.

   **What is actually known, stated carefully.** H5 (docs/22) is the `card_lock` proof — status
   `HOLD` → `ACTIVE` on a card with **no** override. The echo clear's "proven" claim means
   production-wired and offline-verified, **not** proven live against a card carrying an override; no
   OEG record exists for that. So the vendor's sentence is currently **unrefuted by anything we have
   measured**, and the reading that it describes the portal's UI rather than the API is plausible but
   also unevidenced. *"If there is no button to select under 'Override Card' the card is already in
   override"* is plainly a statement about screens, which is the strongest hint it is a UI rule — but
   it is a hint, not the answer.

   > ### ✅ ANSWERED 2026-08-17 — the freeze is REAL for the web service
   >
   > Probed twice on QA ••••7671 (docs/22 **H16**, transcript `docs/efs/f9-override-freeze-qa.json`).
   >
   > **The first run was invalid and said so:** it sent `Hold` to an account that stores `ACTIVE`, which
   > is H1 exactly, so `landed: false` had two sufficient explanations. The drill was fixed —
   > `matchAccountCasing` so the write carries production's own bytes, plus a CONTROL run — and re-run.
   >
   > **The second run settles it. Two byte-identical writes, opposite outcomes:**
   >
   > | | sent | `overrideUses` in | landed |
   > |---|---|---|---|
   > | control | `<status>HOLD</status>` | 0 | **true** |
   > | test | `<status>HOLD</status>` | 1 | **false** |
   >
   > Same session, same card, same casing. Three readings at 703/5179/11045 ms all read `ACTIVE`,
   > `overrideUses: 1`, `version` unchanged. The override was the only variable.
   >
   > **So: a card carrying an armed override silently ignores a `setCardv2` status change on this
   > account, and the vendor gives no signal — `responseShape: empty`, no fault.** WEX's portal sentence
   > is true of the web service, not just of its screens.
   >
   > ⚠ **But narrower than WEX's wording: the freeze is FIELD-scoped, not card-scoped.** In the same run
   > with an override armed, the echo `clear_override` **landed** and `deleteOverride` **landed**. The
   > override trio stays writable — it must, or no override could be cleared — and `status` does not.
   >
   > **Consequence, and it is a safety one:** no capability checks `overrideUses` today, so `card_lock`
   > — the 2am stolen-card action, deliberately free of all friction — demonstrably does nothing on a
   > card with an exception, and the operator is told only *"EFS accepted the request but the card is
   > unchanged."* `card_unlock`, `card_deactivate`, `prompts_set` and the mileage override are in the
   > same position. The fix is owed and jumps the Phase 10 queue — see docs/28 §10.
   >
   > **Also closed by the same run:** `deleteOverride` is entitled on this account and lands, which
   > answers D1's entitlement half, open since Phase 8.2.

   *(Original note, kept because the reasoning held:)* **This one IS cheaply probeable on QA, and it should be probed before Phase 10 promotes**, because
   two of its three outcomes change the product: grant a 1-use override on a QA card, then attempt a
   `card_lock` to `Hold` through the ordinary capability path and read back. If the status does not
   land, the override freeze is real for the API and `card_lock` needs a precondition that tells the
   operator to clear the override first — plus an override-aware failure message, since today it would
   say only *"EFS accepted the request but the card is unchanged."* Then clear via the echo path and
   via `deleteOverride` and compare which one actually lands.

---

## 8. Primary sources — WEX's own portal documentation

Found 2026-08-17. **These answered two questions the 200-page SOAP guide does not address at all**, and
they are the reason Q5 was downgraded and Q6 exists. Worth checking here BEFORE opening a WEX ticket:
the portal guides describe the same features from the operator's side, and they say things the API
reference omits.

| Document | Where | What it settles |
|---|---|---|
| **eManager Quick Reference Guide — Overrides**, Nov 2017 | ✅ checked in at `docs/efs/eManager-Overrides-2017-11.pdf` · orig. `manage.fleetone.com/common/pdf/overrides.pdf` | The whole override flow, screen by screen. Replacement-not-addition, the DSL+ULSD pairing, the in-override freeze, self-consumption on swipe |
| eManager Quick Reference Guide — Card Management, Nov 2017 | `manage.fleetone.com/common/pdf/card_management.pdf` | Same override notes, **plus "CHANGING A CARD'S PRODUCT LIMIT"** — the *"Under 'Limit', select 'Both'"* step that answers Q5 |
| eManager Quick Reference Guide — Card Management, Apr 2019 | `wexdrive.com/otr/pdf/EFS_eMgrAdmin-Verify4.pdf` (also `emgr.efsllc.com/common/pdf/administrator.pdf`) | Independent corroboration of all of the above, two years later and unchanged |

⚠ **They do not extract through `WebFetch`** — its reader returns "corrupted binary". They extract
perfectly with `pdftotext` (poppler is installed). Download, then extract locally.

### The four sentences worth quoting, verbatim

1. *"Override limit does not 'add' to the existing limit; it is REPLACING the limit as a daily total
   (i.e. if a card has a 100 gallon limit of diesel and the card needs an additional 50 gallons, the
   override would need to be in place for 150 gallons)."*
   — Confirms §1.2's premise from the vendor's own side, and **the operator enters the TOTAL, not the
   increment.** An override UI that reads as "additional gallons" grants LESS than the card already
   allowed.
2. *"When a card is in override no changes can be made to the card (i.e. status, add cash, etc.),
   therefore, it is recommended that (1) one override/swipe be selected."* — Q6.
3. *"When overriding fuel, add product DSL for the desired gallons … and also add product ULSD for
   the desired gallons. This is done because different truck stops use different product codes for
   fuel."* — **p194's ULSD-only example is not a complete operational recipe.** A diesel override
   needs both codes or it declines at half the network.
4. *"Once the card is swiped the number of overrides selected the override will automatically be
   removed."* — The vendor manages the override's lifecycle server-side. It is the strongest available
   indication that restoring the prior limits is WEX's job rather than ours, and it is still not a
   statement that WEX does it.

### Two ambiguities these documents introduce rather than resolve

- **What `hours` means on an override.** The override screen: *"'Hours' represents the number of hours
  allowed between swipes if multiple swipes are selected — the default is 1."* The limits screen:
  *"Enter Hours (i.e. 24 equals daily) when to refresh the limit."* The SOAP field table (p36) matches
  the SECOND: `hours` is *"the hours the limit is good for before resetting"*, and *between* uses is
  `minHours`. Yet p194's example writes `hours: 1, minHours: 0`, and 1 is the override screen's own
  default. One label, two meanings — the family docs/22 keeps recording. **Recommendation: default
  `hours: 1, minHours: 0` exactly as p194 does, and do not label the field with either meaning in the
  UI until this is confirmed.**
- **`autoRollMap` is a days-of-week bitmap.** A 2019 walkthrough of the same screen describes the
  alternative to Hours as *"click Auto Rollover and choose the days of the week that you want the
  limit to refresh"*. That decodes the field: QA policies 2 and 3 carry `autoRollMap: 127` (= all
  seven bits set), and `getCardV2.autoRoll.xml` carries `7`. Our own comment on `autoRollMax` (*"0
  means no daily maximum"*) is unaffected. Nothing writes either field, so this is a reading aid — but
  it is the first explanation of `autoRollMap` this workstream has had.
