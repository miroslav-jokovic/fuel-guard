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
| The correction when GPS is wrong | `overrideLastMileage` | ❌ never called |
| Whether SecureFuel is on at all | `doesCardPosition` | ❌ never called |
| The card↔GPS identity | `gpsid`, `vin`, `zid` on `WSCardSummary` | ❌ not modelled |

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

## 3. The three uncalled operations, with exact contracts

### `doesCardPosition(clientId) → boolean`

> *"This is related to customers that use the EFS LLC SecureFuel product. This method will return if
> the customer uses secure fuel. If has secure fuel rules of 1 or 2 and a member type of customer,
> this will return true."* (guide p30)

Account-level, read-only, one call, no parameters beyond the session. **It answers whether any of
this matters for a given org**, and Phase 7's inventory walk — which asks the account twelve
questions — does not ask it. Cheapest possible addition: one more `step()` in `inventory.ts`.

Note the guide mentions *"secure fuel rules of 1 or 2"* and gives no way to read which rule applies.
That is a question for WEX.

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
| **A** | `doesCardPosition` added to the account-inventory walk | The inventory reports it for both orgs; recorded in `docs/25` as a thirteenth question | one call, hours |
| **B** | Model `gpsid` / `vin` / `zid` from `WSCardSummary`; surface on the card page | A card with a GPS ID shows it; `MODELLED_CARD_FIELDS` parity test still green | small |
| ~~**C**~~ | ~~Card-level accrual editor~~ | **DROPPED — see §5a. `ODRD` is policy-only; no card has ever carried it** | — |
| **D** | `getLastMileage` as a read — EFS's stored reading beside Samsara's | The reading for a known unit matches the WEX portal | small |
| **E′** | `overrideLastMileage`, VERIFIED BY RE-READ | The correction Miki does by hand. The op returns nothing (§3), so the re-read is not optional — without it the button reports success whether or not the vendor acted | small–medium |

A, B, D and E′ are read-mostly integration with a single write, which is the right shape.

**§4's architecture cost applies only if E′ is routed through the card-mutation ledger.** It targets a
unit and that ledger keys on a card, so the honest choice is: either accept a plain audited write
(`writeAudit`, re-read verification, no capability triple) or pay for the second `LedgerAdapter`.
The first is proportionate to one operator action correcting a GPS glitch. Decide it when building
E′, not before — but do not let "it needs its own phase" stand unexamined, because that was written
before §5a was measured.

## 7. Open questions for WEX

1. Which direction is the accrual window checked, and in what unit — is `M:1, X:1800` "at least 1 and
   at most 1800 miles since the last reading"?
2. What are *"secure fuel rules of 1 or 2"*, and how do we read which one applies to an account?
3. Does `getLastMileage` accept more than one search entry per call, as the guide's *"Search Array,
   1 to many"* implies but the WSDL does not declare?
4. Is `value` ever the accrual on any account, or is the guide's sentence simply wrong?
