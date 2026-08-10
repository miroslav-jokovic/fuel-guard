# 22 — EFS Card Control (WEX OTR Card Management Web Service)

Distilled implementation reference, extracted from `docs/EFS LLC Card Web Service Integration
Guide .pdf` (WEX OTR Card Management Web Service Reference, July 2024, v12.0). Every claim below
carries the guide page it came from — nothing here is assumed. This is the SAME `CardManagementWS`
service our SOAP poller already authenticates against (`efsSoap.ts` — we currently call only
`getMCTransExtLocV2` and `getTranRejects`); card control is additional operations on the same
endpoint and login token.

## Endpoints & auth (guide p8–9)

- QA/test WSDL: `https://ws.partner.efsllc.com/axis2/services/CardManagementWS?wsdl`
- Production WSDL: `https://ws.efsllc.com/axis2/services/CardManagementWS?wsdl`
- Custom `login`/`logout` (not HTTP auth). `login` returns a token (`clientId`) passed as the first
  field of every call; `logout` invalidates it. TLS 1.2+; do NOT pin certificates (rotated without
  notice).
- Error model: failures return a SoapFault; **successful calls may return nothing** ("no news is
  good news", p9). Write paths must treat an empty 200 as success and a fault/`Result -1` as failure.
- ⚠ Entitlements are NOT documented per-operation — whether OUR service account may call the write
  operations must be confirmed against the QA endpoint (or with the WEX rep) before building UI.

## The one invariant that makes or breaks everything (p134, p137)

`setCard` / `setCardV2` are **full-document writes, not patches**:

> "Make sure you echo back all fields from the getCard response, changing the applicable fields.
> Only remove fields or blank them out if you intend to remove them. … if the system drops that
> `<infos>` record in the setCard, the card will no longer have a Driver ID assigned."

Every mutation MUST be implemented as `getCardv2 → mutate in memory → setCardV2` with the complete
echo, and audit-logged with the full before/after documents (same discipline as
`vehicle.capacity_autofix`). A partial write silently strips prompts, limits, and assignments.

## Read operations

| Op | Page | Notes |
|---|---|---|
| `getCard` | 35–37 | Header + card-level infos/limits/location groups/blocked locations/time restrictions. POLICY-level values are NOT returned — call `getPolicy` (p84) to display the effective combination. "Card level always trumps policy." |
| `getCardv2` | 38–40 | Same + card-level refreshing/auto-roll limits (`autoRollMap`, `autoRollMax`). **Use v2** so the echo doesn't drop auto-roll values. |
| `getCardByDriverId` | 41 | Lookup by the DRID prompt value; same output as getCard. |
| `getCardRefreshingLimits` | 43 | Velocity limits: day/week/month × count/amount. |
| `getCardSummaries` / `getCardsWithNoDriverId` | 44–46 | Fleet-wide card inventory / unassigned-card sweep. |

## Write operations

### `setCardV2` (p137–139) — status, policy, prompts, limits, restrictions

Key header fields (exact values):

- `status`: `Active`, `Inactive`, `Hold`, `Deleted` — **this is the card lock/unlock switch.**
- `policyNumber`: 1–99.
- `handEnter`: `ALLOW` / `DISALLOW` / `POLICY` (hand-entered card numbers — DISALLOW kills a whole
  skimming class).
- `infoSource` / `limitSource` / `locationSource` / `timeSource`: `POLICY` / `CARD` / `BOTH`.
- `override` (0–9) + `overrideAllLocations` + `locationOverride` — see Overrides below.

Sub-objects (card level; policy level goes through `setPolicy`, p147):

- **infos** = pump prompts & assignments. `infoId` from the Info IDs table (p168–169): `DRID`
  Driver ID, `UNIT` Unit #, `TRIP` Trip #, `ODRD` Odometer, `TRLR` Trailer #, `PPIN` personal PIN,
  `CNTN` control number, etc. `validationType`: `EXACT_MATCH` (validates at the pump — this is a
  driver/unit **lock**), `REPORT_ONLY` (reporting only), `NUMERIC`/`ALPHABETIC`/`ALPHA_NUMERIC`,
  `ACCRUAL_CHECK` (odometer/hubometer plausibility with `value` = accrual), `DYNAMIC` (only CNTN,
  PPIN, DRID). `matchValue` max 24 chars. **Driver/unit assignment = a DRID/UNIT infos record with
  EXACT_MATCH.**
- **limits** = per-product caps. `limitId` from Limit IDs (p169–170): `ULSD`, `DSL`, `GAS`, `DEF`,
  `DEFC`, `RFR` (reefer), `CADV` (cash advance), `MERC`, etc. `limit` 0–9999 — **gallons for
  fuel/DEF, dollars otherwise**; `hours` = reset window; `minHours` = min time between uses; v2
  adds `autoRollMap`/`autoRollMax` (0 = no daily max).
- **locationGroups** = allowed-network groups (see p17: `createLocGrp` rule-based e.g. `CAN,|AK,FJ`,
  plus `set/add/removeLocGrpLocs` with 6-digit EFS location ids).
- **locations** = **blocklist** ("a list of locations that this card is BLOCKED from using", p139).
- **timeRestrictions**: per-day windows, `day` 1=Sunday…7=Saturday, only time-of-day applies.

### `setCardPin` (p140)
4-digit ATM/IVR PIN; must not equal the card's last 4. `Result -1` = error.

### `setCardRefreshingLimits` (p141)
Velocity: `dayCntLimit`/`dayAmtLimit`, `weekCntLimit`/`weekAmtLimit`, `monCntLimit`/`monAmtLimit`;
`refreshingLimitSource`: `D` policy / `C` card / `B` both.

### Overrides (appendix p194) — one-time exceptions, exact recipes

All are getCard → echo → setCard with:

- **All locations**: `overrideAllLocations=true`, `override` = 1..9 (number of uses).
- **Single location**: `locationOverride` = the 6-digit EFS location id, `overrideAllLocations=false`,
  `override` = 1..9.
- **Product limits**: echo WITHOUT the limits array, `overrideAllLocations=true`, `override`=1..9,
  then add back the limits you want for the override (e.g. `ULSD`/1000).
- **Refreshing limits**: after the setCard override, call `setCardRefreshingLimits` against
  `cardNumber + "OVER"` (e.g. `708…111OVER`) with the override values.

### Lifecycle (p14–21, 127–131, 157)

`createOrder` / `createAndSubmitOrder` (order new cards; shipping methods table p197),
`replaceLostOrStolenCard` (returns an orderId; ship-to fields; rush flag), `reissueDamagedCard`
(payroll 5.5 cards), `transferCard` (moves card data + balances from → to),
`removeCard` — **hard delete in the EFS system** (p128), prefer `status=Inactive`/`Hold`.

### `managedFuelAction` / by Driver (p120–121) — route lockdown

Locks a card to planned fuel stops: per stop `tripNumber`, `tripSeq`, `locationId`, `fuelType`,
`fuelUse` (1 tractor / 2 reefer), `qtyAllowed`, `effDt`/`expDt`. The by-driver variant requires
**exactly one card per Driver ID** or it errors. This is the native primitive for a
"card only works at the planned stop for the planned gallons" feature (pairs with fuel_plans).

## FuelGuard feature mapping (what each product idea uses)

| Feature | Operations | Guardrails |
|---|---|---|
| Card lock / unlock (park-lock, theft response) | `getCardv2` → `setCardV2` status `Hold` ↔ `Active` | full echo; audit before/after; never `Deleted` |
| Enforce driver/unit at pump | infos `DRID`/`UNIT` with `EXACT_MATCH` | 24-char matchValue; card-level trumps policy |
| Per-card gallon/day caps sized to the truck's REAL tank | limits (`ULSD` gallons, `hours`) + `setCardRefreshingLimits` | limit is gallons for fuel, dollars otherwise |
| One-time exception ("let him fuel this once") | Overrides recipes (p194) | override counts down 1–9 uses |
| Kill hand-entry skimming | `handEnter=DISALLOW` | verify station compatibility first |
| Network restriction / station blocklist | location groups + `locations` blocklist | 6-digit EFS location ids via `searchLocation` (p132) |
| Route-locked fueling | `managedFuelAction` | 1 card per Driver ID |

## Rollout order (no assumptions about entitlements)

1. **Entitlement probe on QA** (`ws.partner.efsllc.com`): `login` with our SOAP credentials →
   `getCard` on a test card → no-op `setCard` (echo unchanged). Record which ops fault with
   auth/permission errors.
2. If writes are not enabled, request write entitlements for the service account from the WEX rep
   (name the exact operations above).
3. Build the read layer first (`getCardv2`/`getCardSummaries` → a Cards page mirroring live EFS
   state — replaces assumption-based `fuel_cards` rows with vendor truth).
4. Then mutations, each as getCardv2 → mutate → setCardV2 full-echo + audit row + optimistic-lock
   check (re-read after write).

---

## Entitlement findings — 2026-08-10 (production, live account)

The guide never documents which operations a given service account may call, and §"Rollout order"
above prescribed a QA probe to settle it. The answer arrived earlier than planned, from the Phase A
card sweep hitting production. Recording it here because the entitlement answer is a durable fact.

### What EFS actually allows this account

| Operation | Result | Evidence |
|---|---|---|
| `login` | **allowed** | every call below got far enough to be refused on its own merits |
| `getMCTransExtLocV2` (posted transactions) | **allowed** | `posted_last_success_at` 19:21:35Z, `posted_last_error` null |
| `getTranRejects` (rejected authorizations) | **failing** | `ERROR running command 109491258416` — last success 18:55:26Z |
| `getCardSummariesV2` / `getCardSummaries` | **REFUSED** | `Not Allowed 109491436176`, `Not Allowed 109491388553` |

### The conclusion, and why it is not the obvious one

The guide's error table says `NotAllowed` means "Access blocked by firewall. Contact your account
manager." (p9). That reading is WRONG for this case, and believing it would have sent us to the
network team for a week.

The posted-transaction feed **succeeded at 19:21:35 — after** the card sweeps were refused at 19:10
and 19:14, on the same account, the same endpoint and the same egress addresses. A firewall does not
allowlist one SOAP operation and block another on the same connection. So:

- credentials: fine
- egress allowlisting: fine
- TLS / routing: fine
- **card-management operations: not entitled for this service account**

### What to ask WEX for

Name the operations explicitly. Reads first — they are what Phase A needs and they are refused today:

- `getCardSummaries` and `getCardSummariesV2` (card inventory)
- `getCardv2` (one card's configuration)
- `getPolicy` (policy-level rules; needed because getCard omits them, p36)
- `searchLocation` (location ids for override targeting, p132)

Then the write set, which the Phase B gate needs and which has NOT been probed:

- `setCardV2`, and later `setCardRefreshingLimits`

Quote a reference number from a refusal — EFS formats these faults as `<message> <reference>`, e.g.
`Not Allowed 109491436176`. The reference changes per request; any recent one will do.

### Two things this changes in the plan

1. **The Phase B gate cannot be attempted yet.** It assumed reads were permitted and only writes were
   in doubt. Reads are refused, so all six gate steps are blocked behind the same permission.
2. **Nothing in the read layer is wrong.** The mirror, the routes and the pages are correct and
   waiting on one entitlement. When it lands, the sweep should populate without a code change.

### Separately: the rejected-transaction feed is failing

`rejected_last_error` = `ERROR running command 109491258416`, last success 18:55:26Z. Same
`<message> <reference>` shape, different message from the card refusal — and `getTranRejects` is the
FRAUD signal, polled every 5 minutes. This predates the card work and is not caused by it, but it is
worth raising with WEX in the same conversation.

### CORRECTION — 2026-08-10, after the vendor replied

The conclusion above ("not entitled") is **wrong**, and is left in place only so the reasoning that
produced it stays legible. WEX's answer:

> "You should have access to all of this with your API/Web Service login. Are you also getting Not
> Allowed on these methods? That would be IP." — and separately: "This error means we are blocking
> IPs, so I need to check if we need to add more IPs or if we missed some."

So `Not Allowed` is an **IP allowlist** refusal, not an entitlement one. The service account already
carries the card-management operations. Better news than the diagnosis: nothing has to be bought or
provisioned, an address has to be added.

**Why the evidence pointed the other way, and what it actually implies.** The timing was real: the
posted-transaction feed succeeded at 14:21:35 CT, ten minutes after `getCardSummariesV2` was refused
at 14:10:50 and 14:11:12, and both calls run through the same process, the same credential and the
same egress addresses. A single flat IP allowlist cannot produce that. Both readings cannot be true
at once, so one of these must hold:

1. **WEX allowlists per SERVICE, not per account.** The transaction operations and the card-management
   operations sit behind different hosts or appliances, each with its own allowlist. Our addresses are
   on the transaction one and not the card one. This reconciles every fact and is the most likely
   answer.
2. **The two calls did not leave from the same address.** Worth ruling out rather than assuming: if a
   dedicated worker service is deployed (docs/WORKER-DEPLOYMENT.md) it is a separate Railway service
   with its own egress, and a multi-replica consumer can present more than one address. Both feeds and
   the card sweep go through `dispatchJob`, so they *should* share a process — but "should" is not
   "checked".

**The methodological lesson, recorded because it will recur.** The guide's error table gives
`NotAllowed` exactly one meaning ("Access blocked by firewall", p9). We had strong contrary evidence
and used it to overturn the documentation. The evidence was sound and the inference was still wrong,
because it rested on an unstated assumption — that one allowlist governs the whole endpoint. When
vendor documentation and local evidence disagree, ask the vendor before concluding; the round trip is
cheaper than the wrong remedy.

**Still open:** only `getCardSummariesV2` has ever been attempted. The sweep stops at its first call,
so `getCardv2`, `getPolicy` and `searchLocation` are untested and we cannot yet say whether they are
refused too — which is precisely what WEX asked.
