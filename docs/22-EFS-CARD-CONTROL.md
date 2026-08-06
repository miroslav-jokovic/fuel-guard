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
