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

## The WSDL is the contract; the guide only describes it (read 2026-08-11)

`https://ws.partner.efsllc.com/axis2/services/CardManagementWS?wsdl` — reachable from an allowlisted
egress address, and it settles questions the guide cannot. Two facts in it cost us live round trips
before anyone read it.

**Operation names are inconsistent about `v2`, and the guide hides that by writing `V2` everywhere:**

| Operation | Guide writes | Binding declares |
|---|---|---|
| get one card | `getCardV2` | **`getCardv2`** |
| set one card | `setCardV2` | **`setCardv2`** |
| card list | `getCardSummariesV2` | `getCardSummariesV2` |
| transaction feed | `getMCTransExtLocV2` | `getMCTransExtLocV2` |

A wrong name is an Axis2 dispatch failure — *"The endpoint reference (EPR) for the Operation not
found … WSA Action = …"* — which happens **before any operation runs**, so nothing was written.
Loud and safe, but only once you read it as our bug rather than the vendor's.

**A message part is a direct child of `CardManagementEP_<operation>`.** That is why `getTranRejects`
wraps its criteria in `<search>`, and why `searchLocation` does too — `1214be7` found the latter by
laddering shapes against the live binding; the WSDL states it outright. For the write:

```xml
<message name="CardManagementEP_setCardv2">
  <part name="clientId" type="xsd:string"/>
  <part name="card"     type="ns2:WSCardv2"/>   <!-- the WHOLE card, in ONE element -->
</message>
```

So the request is `<clientId>` and `<card>` as siblings — **not** clientId, cardNumber and the card's
fields flattened together, which is what this codebase sent until 2026-08-11. Dispatch failed on the
name first, so the wrong signature was never exercised.

**`WSCardv2` confirms the nested shape** production returns, which the parser was rewritten for in
`3492c50`:

```xml
<complexType name="WSCardv2"><sequence>
  <element name="cardNumber"/>  <element name="header" type="tns:WSCardHeader"/>
  <element maxOccurs="unbounded" minOccurs="0" name="infos"/>
  <element maxOccurs="unbounded" minOccurs="0" name="limits" type="tns:WSCardLimitv2"/>
</sequence></complexType>   <!-- then locationGroups, locations, timeRestrictions -->
```

`<header>` is part of the type, not a quirk of one account. `WSCardInfo` also carries a
`numericMatchValue` this codebase has never heard of — echoed back intact anyway, because the request
is built from the response DOM rather than from our typed view. That choice paying for itself.

**Before adding an operation, read the WSDL.** Not the page number.

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

## Status 2026-08-11 — Phase A live end to end; the access mystery resolved

Every open question above was closed in one overnight session. The findings, in causal order,
because each one masked the next:

1. **WEX's firewall is per-operation-group, and only card management is IP-gated.** Login and the
   transaction feeds pass from any address (the feeds ran for weeks on rotating egress); the
   card-management operations check source IP. This is why the feeds never noticed anything and why
   card calls "flapped" — they succeeded exactly when the rotating pool happened to serve the one
   address WEX had.
2. **Static outbound IPs only apply to deployments created after enabling them**, and they were
   enabled on `@fleetguard/api` while production traffic ran elsewhere. The project runs TWO
   deployments of this same API (`@fleetguard/api` → fleetguardapi-production, `@fleetguard/web` →
   fleetguardweb-production). EFS work is consolidated on `@fleetguard/api` (static IPs
   152.55.176.240 / 162.220.232.252 / 152.55.177.181, allowlisted at WEX; `EFS_SOAP_ENABLED=false`
   on the web service stops its schedulers). ⚠ Interactive EFS calls served from the web origin
   (card-detail getPolicy, the location picker) still dial from pool egress until the frontend's
   `VITE_API_URL` points at fleetguardapi-production.
3. **`searchLocation` needs its criteria wrapped, like `getTranRejects`.** Flat criteria earn
   `ADBException: Unexpected subelement locId`. The guide documents fields, not nesting (p132 vs
   p107 — same omission, both search ops). `lib/efsLocationSearch.ts` resolves the shape against the
   live binding (ladder: search → flat → criteria → request), memoizes the winner per endpoint, and
   logs `searchLocation: EFS accepted the "…" request shape`. Probe now: all five card operations ok.
4. **Migration 0175 was silently skipped by a ledger version collision** — the ledger's 0175 is
   `idle_learned_envelope_writes` (applied under that number before its repo renumbering), so
   `supabase db push` skipped `0175_efs_cards_tolerant_vendor_values.sql` while
   `applied_schema_version()` reported 0175 as current. Applied manually in the SQL editor and
   renumbered to 0176 in the repo. Lesson: the ledger tracks by version string; a renumbered
   migration's old number is burned forever, and "schema current" cannot detect a skipped file whose
   number the ledger already holds.
5. **The roster sweep was erasing mirrored card detail** (`document: {}` upserted over every known
   row each sweep). Fixed in `services/efsCardMirror.ts`: known cards get an update of roster facts
   only.

The mirror now holds all 199 cards. Reads (Phase A) are fully operational. Card ACTIONS remain
deliberately off: `EFS_CARD_CONTROL_ENABLED` defaults false, `write_entitlement` is unconfirmed, and
the Phase B write path (setCardV2 operation, mutation ledger, per-intent routes, action panels) is
not yet built — `lib/efsCardEcho.ts` (the full-document echo with fidelity guard) is the part that
exists. Do not enable writes without walking the Phase B gate in
`docs/plans/EFS-CARD-CONTROL-PLAN.md`, starting with the no-op echo probe against a disposable card
on QA.

## Status 2026-08-11 (later) — Phase B built, gated, and not yet switched on

The write path exists in the repo. It is unreachable in production and stays that way until the
entitlement gate passes: `EFS_CARD_CONTROL_ENABLED` defaults false, every org's
`write_entitlement` is still `unknown`, and `unknown` behaves exactly like `denied` at the gate.

**What was added**

| Piece | Where |
|---|---|
| The gate — six-proof write probe | `apps/api/src/routes/fuelCards/writeProbe.ts` → `POST /api/fuel-cards/write-check` |
| `setCardV2` (retry-free, fidelity-checked on the bytes sent) | `apps/api/src/lib/efsCardWrite.ts` |
| Per-intent edit builders (the p194 recipes) | `apps/api/src/services/efsCardEdits.ts` |
| Plan → apply orchestration | `apps/api/src/services/efsCardControl.ts` |
| Outcome classification + ledger/audit/mirror writes | `apps/api/src/services/efsCardReconcile.ts` |
| Five write routes + history | `apps/api/src/routes/fuelCards/control.ts` |
| Per-user throttles / step-up | `apps/api/src/middleware/{cardWriteLimit,requireFreshAuth}.ts` |
| Mutation ledger / write counters | `supabase/migrations/0177_efs_card_mutations.sql`, `0178_card_write_counters.sql` |
| Drawer, panels, location picker, history, settings page | `apps/web/src/features/fuelCards/*`, `apps/web/src/pages/CardControlSettingsPage.vue` |

**Migration numbering, checked rather than assumed.** The live API's `/api/version` reports the
Supabase ledger's `max(version)` = **0175**, so 0176 (in the repo, applied by hand in the SQL editor
after the collision above) is still absent from the ledger and will be re-applied by the next
`supabase db push` — it is idempotent by construction, dropping every check constraint on the columns
it re-adds. 0177 and 0178 are free.

**Two things a reviewer should look at first**

1. **The one inference in the write path.** `overrideGrantEdits` clears a stale `locationOverride`
   when granting an all-locations exception. The p194 recipes are written for a card with no override
   configured; followed literally on a card that already has one, they produce a document asserting
   both scopes at once, and the operator is told "every location" while the driver is declined
   everywhere but one truck stop. The clearing happens only when the field actually holds an id, is
   recorded in the ledger's `edits` column, and should be confirmed against real vendor behaviour
   during the pilot.
2. **`originalStatus` and drift.** When a status edit is applied, a moved `originalStatus` is recorded
   under `drift.vendorMaintained` rather than counted as unexplained drift — the field's name and the
   guide's note (p35) both suggest EFS maintains it. It is recorded, not discarded: if the pilot shows
   it behaving differently, the evidence is already in the ledger.

**Sequence to switch it on** — do not skip a step.

1. Ask WEX for: entitlement to `setCardV2` on QA and production (name `setCardV2` and
   `setCardRefreshingLimits` explicitly), a DISPOSABLE QA card number, and QA credentials.
2. Decide the approver list. `require_approver` defaults true, so an admin must name at least one
   person before any fleet manager can change a card.
3. `VITE_API_URL` on `@fleetguard/web` → fleetguardapi-production, so the UI that gains write buttons
   talks to the EFS-enabled, statically-addressed service.
4. On STAGING only: `EFS_CARD_CONTROL_PROBE_ENABLED=true`. Run the write check **read-only first** —
   it proves our echo against this account's real card XML and touches nothing. Then, with the
   WEX-confirmed disposable card, run it for real. Archive the redacted result below. Unset the flag.
5. Repeat once on production against a decommissioned card.
6. Only if all six proofs pass: `EFS_CARD_CONTROL_ENABLED=true` on `@fleetguard/api` ONLY, and enable
   `efs_card_control_settings.enabled` for ONE pilot org.
7. First real mutation: lock and unlock a spare card, and verify it at a pump or in the WEX portal.
   Watch the mutation ledger for a week before widening.

**If the gate fails, it fails closed.** A moved `cardVersion` after a no-op echo records
`write_entitlement = 'unknown'` with recommendation `fix_echo`, and card actions stay off — even
though EFS accepted the write. That is the intended behaviour, not a bug to work around.

_(Probe appendix: paste the redacted `write-check` response here after the first QA run.)_

## Who may change a card, and how that is recorded

Two gates, ANDed. Neither substitutes for the other, and neither is configurable from the other side.

**1. The role floor — not configurable.** Writing a card requires `rolesThatManage("fuel")`: admin or
fleet manager. It is re-checked on every mutation, so it cannot be widened by a row in a table.
Naming an ineligible user as an approver is refused with a `422 role_not_eligible` naming the remedy —
change their role, which is a visible act with consequences elsewhere, rather than a quiet grant here.
A dispatcher granting fuel exceptions is precisely the pattern this product exists to DETECT.

**2. The named-approver list — per person, per scope.** On by default (`require_approver`). Scopes are
`lock`, `unlock`, `override`, `prompts`, granted individually, because the arrangement real fleets ask
for is a yard manager who can lock a stolen card at 2am but cannot grant fuel exceptions.

Both are managed at **Settings → Card control** (`GET/PATCH /api/fuel-cards/settings`,
`PUT/DELETE /api/fuel-cards/approvers/:userId`), admin-only and behind step-up re-authentication.
Before this existed, switching a pilot org on meant hand-written SQL — which is not only awkward but
UNAUDITED: a permission change made with a SQL client leaves no trace of who made it.

Card control cannot be switched on until `write_entitlement = 'confirmed'`. The API refuses it with
`409 card_control_not_entitled` rather than letting a settings page say "on" next to a product that
does nothing.

### The audit vocabulary

Every action below writes an `audit_logs` row with the actor, the target and the VALUES on both sides —
the `AUDITED_VALUE_FIELDS` rule from `routes/roster/drivers.ts`, applied to the whole surface. Search
them at Settings → Audit log. Never in `meta`: the card number, the `clientId`, the SOAP password, raw
XML.

| Action | Written when | Carries |
|---|---|---|
| `card.control_enabled` / `card.control_disabled` | the org switch moves | before/after, entitlement at the time |
| `card.approver_policy_changed` | `require_approver` moves | before/after, and the consequence in words |
| `card.approver_granted` | someone is named or their scopes change | target, role, scopes before/after, added, removed |
| `card.approver_revoked` | an approver is removed | target, and the scopes they held when it was taken away |
| `card.locked` / `card.unlocked` | a status change lands | status before/after, reason, expected/result version |
| `card.override_granted` / `card.override_cleared` | an exception moves | uses before/after, scope, location id |
| `card.prompts_changed` | prompts are replaced | prompts before/after, any removed infoIds |
| `card.mutation_failed` | EFS refused | fault code and the vendor's own message |
| `card.mutation_unverified` | the write went out, the outcome is unknown | why it could not be confirmed |
| `card.drift_detected` | something moved that no edit named | the field paths |
| `integration.efs_soap.card_control_probed` | the write check runs | entitlement, verdict, per-step outcomes, card last four |

Every mutation also carries `stepUp` — whether the person re-authenticated — and a required `reason`,
3 to 200 characters, on the ledger row and in the audit meta.

### Phase C stays out of scope

Product-limit overrides (the one p194 recipe that requires deliberately dropping the limits array),
`setCardRefreshingLimits` and the `…OVER` convention, bulk actions, maker-checker, mutation revert,
`handEnter=DISALLOW`, and location-group/blocklist editing. The design accommodates all of them —
`approved_by` and `before_document` already exist on the ledger, and `planCardMutation` /
`applyCardMutation` are already separate functions — so none of them needs a schema change later.

## Root cause 2026-08-12 — the `no_change` failure was status casing (H1, CONFIRMED)

The first live mutation (lock, card ••••7671, 2026-08-12) got `setCardv2`'s void success back and
the card stayed Active — the ledger's `no_change`. Phase 0 ran controlled experiments against the QA
org's card the same day, and the second one closed the case.

### The evidence, verbatim from the experiment run

| Step | Wrote | Account read back | Result |
|---|---|---|---|
| E1 read-only | — | `ACTIVE` (upper-case) | rules out a late-landing of the original write (H2) |
| E2 | `<status>HOLD</status>` — matching the account's casing | `HOLD` | **LANDED in 533ms** (first re-read) |
| revert | `<status>Active</status>` — the guide's spelling | `HOLD`, `HOLD`, `HOLD` at ~0.7s / 4.4s / 10s | void success returned, write **silently ignored** |

Same session, same card, same request shape, same echo — the casing was the only variable. So:
**EFS applies a status write only when its casing matches the account's stored vocabulary; a
mismatched casing is answered with the identical void success and not applied.** This is W2's
"accepted-and-ignored" failure mode measured in the wild, and it is why the guide's documented
spelling (`Active`, `Hold` — p35, p134) can be exactly the string that does nothing on a production
account that stores `ACTIVE` / `HOLD`.

Two numbers worth keeping: apply latency when the write is correct is **~533ms**, comfortably inside
the first verifying re-read plus the `EFS_CARD_VERIFY_RETRY_MS` second look — no tuning needed
(closes P0-2's open question). And a wrong-cased write stays unapplied through at least three reads
over ten seconds — it is not slow, it is dead.

### The fix (shipped with this entry)

`matchStatusCasing(observed, target)` in `packages/shared/src/efsCardCatalog.ts`: every status write
borrows the casing of the status the account just showed us in the SAME operation's fresh read —
upper-case account → upper-case write, lower-case → lower-case, mixed/absent → the guide's spelling
verbatim. Wired through `lockEdits` / `unlockEdits` (which now REQUIRE the observed status — the
compiler forbids the old verbatim path), the lock/unlock routes (`doc.card.status`, never the
mirror), and the write probe's forward write. The probe's revert always wrote the account's own
original string verbatim, which is why it was already H1-safe.

Reads stay tolerant, writes stay literal: `efsStatusEquals` still absorbs any casing on the way in
(migration 0176's verbatim-storage rule is unchanged), so verification recognises `HOLD` as the
`Hold` we asked for. Tripwire tests pin the wire bytes — an `ACTIVE` account must produce
`<status>HOLD</status>` in the dispatched request — in `efsCardEdits.test.ts`,
`efsCardControl.test.ts` and `efsCardCatalog.test.ts`.

### Scope, honestly stated

Proven for the status field on one QA account; adopted as the rule for status writes everywhere.
Other enumerated writables (`handEnter`, validation types) are sent as EFS returned them via the
echo, so they cannot mismatch by construction. Whether the same vocabulary-matching applies to
override/limit fields is untested — those are numeric or boolean-shaped, where casing does not
arise. If a future field write shows accepted-and-ignored symptoms, suspect this first.

## D1 — `deleteOverride` adopted flag-gated, probe pending (2026-08-12)

The override-clear intent has two mechanisms as of this entry:

- **The echo clear (production default).** Three-field `setCardv2` write (`override=0`,
  `overrideAllLocations=false`, `locationOverride=0`) — the p194 recipe inverted, live since
  Phase 2, proven on the QA card.
- **The dedicated op (`EFS_CARD_DELETE_OVERRIDE_ENABLED`, default false).**
  `deleteOverride(clientId, cardNumber)` (guide p27) — no document echo, so no field to drop:
  materially smaller blast radius for the one intent. `lib/efsCardWrite.ts#deleteOverrideOp`,
  retry:false like every write; dispatched through the same plan/apply/ledger machinery via
  `CardMutationIntentSpec.vendorOp`, with `edits: []` recorded honestly and the audit meta naming
  `vendorOp: "deleteOverride" | "setCardv2"` so history distinguishes the mechanisms.

**Verification without edits.** A vendor op has no edit paths for `intentLanded` to compare, so it
carries its own predicate: `overrideClearedLanded` — NO USES REMAIN (`overrideUses` 0-or-null),
which every plausible vendor post-state (0, nil, absent) satisfies while a surviving exception
fails. The three override fields are declared as the op's expected footprint (`movesFields`) and
classified as vendor-maintained in the drift record — visible, never alarmed; anything else moving
is unexplained drift exactly as on the echo path.

**Before the flag turns on** the D1 probe must answer, on the QA card
(`docs/plans/DEVIN-D1-DELETEOVERRIDE-EXPERIMENTS.md`):

1. Entitlement — does this account get `not_allowed` for the op? (Fallback stays; E6 ticket.)
2. Post-state — what EFS actually writes into the trio (recorded from `afterDocument`; the
   predicate above is then checked against reality, not left as a guess).
3. The B4 decision — does `deleteOverride` restore the limits array after a PRODUCT override?
   Yes → B4's clear path is this op and the ledger-reconstruction design in B4.2 is deleted from
   the plan. No → B4.2 stands. (Needs a portal-staged product override; may run later than 1–2.)

Findings land here when the run completes. Until then: flag off, echo clear remains the mechanism,
and nothing user-visible changes.

## Override grant lands and is recorded `failed` — 2026-08-14 (QA, live, RESOLVED by H3 below)

**Observed.** A single-use override granted through the FuelGuard drawer on a QA card. The card page
badge showed `Override: 1 use left`; the toast showed *"EFS refused the change — EFS accepted the
request but the card is unchanged. Check the card in the WEX portal before retrying."*

**Both are our own output, and they disagree.** The badge is written by `updateMirror`, which is fed
from the verifying re-read inside the same operation — so it is EFS's own answer after the write.
The toast is `finalizeFailed`'s no-fault text, reached when `intentLanded` returns false. The write
landed; the judgement condemned it.

**Why this is the dangerous direction.** Re-granting does not overwrite an override, it grants
another one, and the message instructs the operator to retry. `efsCardControl.ts` states the stake
directly: *"the failure mode of a double-submitted override is a driver getting two free tanks."*
The audit trail also records `card.mutation_failed` against a write that succeeded, which is wrong
for compliance independently of the fuel.

**Leading hypothesis, from recorded vendor data rather than the guide.** Every `getCardv2` fixture
captured from this account carries `overrideAllLocations=false` — including
`getCardV2.overridden.xml`, which has an override armed (uses 2, location 115732). **No recorded
response from this vendor has ever carried `true`.** An all-locations grant writes three fields;
`override` demonstrably lands. If EFS stores or returns `false` for `overrideAllLocations`, one
edited path differs and `intentLanded` fails the whole mutation on it — the same shape as the H1
casing incident (2026-08-12), one field further out, and outside `vendorNormalisedOnly`'s tolerance
because `true` vs `false` is not a difference of case and must not become one.

**Not yet confirmed.** The ledger records the answer and no vendor call is needed:
`drift->'unexplained'` on the `override_grant` row names the field that did not land. That read is
Step 3.11's first instruction, ahead of any fix.

**Recorded here rather than fixed** because the fix depends on what the drift says, and because the
tempting fix — widening `intentLanded` — would hide every genuine partial failure on every
capability. Normalisation is a named, tested adapter or it is nothing (standing rule 4).

## H3 — this account does not report override SCOPE at all (2026-08-15, CONFIRMED)

Confirms the hypothesis in the entry above, and goes further than it did. Read from the ledger and
the mirror; no vendor call was needed. (`H1`/`H2` were the two competing hypotheses in the 2026-08-12
casing experiment — `H3` continues that numbering, not the entry count.)

### The evidence

`drift->'unexplained'` — the read Step 3.11 specified — is **null on every failed row**.
`finalizeFailed` does not write the `drift` column; only `finalizeLanded` does. The rows do store
`edits` and `after_document`, the typed view taken from the verifying re-read, so the same fact was
reconstructed from those (`scripts/override-ledger-diagnose.mjs`).

Three `override_grant` rows, all `all`-scope, `uses: 1`:

| Sent | Read back by the verifying `getCardv2` | |
|---|---|---|
| `override = 1` | `overrideUses = 1` | landed, every time |
| `overrideAllLocations = true` | `overrideAllLocations = false` | **never landed, every time** |

No `locationOverride` edit was emitted on any of the three — the field was already null, and
`overrideGrantEdits` only clears it when it holds an id. So `overrideAllLocations` was the **sole**
condemning path, and one field out of two condemned the whole mutation.

Widened to the whole fleet, both orgs, every card ever mirrored — **234 rows**:

| Field | `true` | `false` | null |
|---|---|---|---|
| `overrideAllLocations` | **0** | 234 | 0 |
| `locationOverride` | — | — | **234 (never once populated)** |

The four checked-in fixtures agree, `getCardV2.overridden.xml` included — and that one HAS an
override armed (uses 2, location 115732), which is the case that should have shown a scope.

### The conclusion, and it is broader than the defect

**This vendor does not report card override scope through `getCardv2` on this account.** Not "returns
`false` for an all-locations grant" — *neither scope field is ever observable*. A location-scoped
grant is therefore equally unverifiable; it fails the same judgement for the same reason and has
simply never been exercised live. The two fields are, from a read's point of view, constants.

What we cannot tell from here is WHY: the account may not be entitled to card-level scope, the write
may be ignored, or `getCardv2` may not project the field. Phase 4.4's config scanner is the
instrument that distinguishes those, and this is now one of the questions it exists to answer.

### The fix (shipped with this entry, Step 3.11)

`intentLanded` keeps its strictness and gains the ability to say WHICH edits did not land
(`unlandedEditNames`, plus the after-only twin `unlandedEditNamesFromAfter` for the background
sweep). `overrideGrantBehaviour` maps that list to three outcomes:

- the **count** not landing → `not_landed` → `failed`. The count is what authorises a purchase
  (p194); no tolerance applies to it, and a test proves deleting that line turns an applied-nothing
  grant into `sent`.
- a mismatch confined to `overrideAllLocations` / `locationOverride` → **`indeterminate`**.
- anything else → `not_landed`, unchanged.

`indeterminate` was already routed: the row stays `sent`, the audit says `card.mutation_unverified`,
the operator is told to go and look rather than to retry, and `efsCardUnresolved.ts` skips
indeterminate rows instead of settling them a cycle later. `judge` and `reconcile` are overridden
together for exactly that reason.

**Why not `succeeded`.** It would assert a scope we cannot observe, and the expensive direction is
the one `overrideGrantEdits` already names: the operator told "at every location" while the driver is
declined everywhere but one truck stop. **Why not a tolerance in `intentLanded`.** It would hide
every genuine partial failure on every capability — standing rule 4.

### Scope, honestly stated

Override grants now accumulate on the unresolved list, on purpose, because we genuinely cannot verify
them. That is a real operational cost and it is the honest one. It ends when Phase 4.4 establishes
whether the scope arms — at which point this becomes either a proven adapter (`succeeded`) or a
precondition refusing a grant this account cannot honour.

### Two things this found on the way

- **An operator did double-grant.** QA card ••••7670 carries two `override_grant` rows. The
  misleading message produced exactly the behaviour it was predicted to produce.
- **`docs/30` §6.E is not a sync bug.** Four **distinct** cards (four distinct `card_ref_hmac`) share
  last-4 `7550` in the production org, and only one carries `override_uses = 1`. See the entry below.

## Last-4 is not an identity on this fleet — 2026-08-15 (production, OPEN)

Found while checking whether ••••7550 had been granted twice. It had not; it is not one card.

| Measure | Value |
|---|---|
| `efs_cards` rows, both orgs | 234 |
| Distinct card identities (`card_ref_hmac`) | 234 — **no duplicate mirror rows** |
| Last-4 groups holding more than one card | **50** |
| Rows carrying `sync_error = ambiguous_fuel_card_link` | 140 |
| Rows with `fuel_card_id` null (unlinked) | 182 |
| Rows with `override_uses > 0` | 1 |

Last-4 `7550` alone resolves to four distinct active-fleet cards on different units and drivers, so
the last-4 in a report or a UI row does not identify a card.

> **This paragraph originally speculated that `docs/30` §6.E was the correct state of a card nobody
> had granted anything on, and that the portal's 50-gallon grant was `managedFuelAction`, which
> "does not touch the `override` counter at all". A live re-read disproved both — see H4 below.**
> Kept, struck, rather than deleted: it was written from two timestamps that could not support it,
> which is the mistake worth remembering.

This also enlarges `docs/30` §6.F. That finding reads as one column carrying two meanings, and it is
— but the underlying cause is that fuel-card linking is being asked to resolve an identity that
last-4 cannot express, on 50 groups of cards. A separate `link_status` column fixes the display; it
does not fix the linking. **Both need a numbered step** — see `docs/28` Phase 7 Step 7.5.

## H4 — the portal's quantity-bounded grant DOES drive `override`, and it decrements on use (2026-08-15, CONFIRMED)

Live read of production card ••••7550 / unit 651 / DARRELL SMITH, `POST /:id/refresh`, authorised by
Miki. This closes `docs/30` §6.E and corrects the speculation logged an hour earlier in the entry
above.

### The evidence

| Field | Sync at 2026-08-14 17:12 | Live re-read 2026-08-15 02:02 |
|---|---|---|
| `override_uses` | **1** | **0** |
| `last_used_date` | 2026-08-13 10:33 | **2026-08-14 17:50** |
| `last_transaction` | 1566830255 | 1567449415 |
| `sync_error` | `ambiguous_fuel_card_link` | **null** |

### Three things this settles

**1. §6.E was a stale mirror — the plainest of its four candidates.** The transaction that consumed
the override landed at 17:50, **38 minutes after** the sync that recorded `override_uses = 1`, and
nothing re-read the card for the next nine hours. There was never a live un-revoked exception.

> **The reasoning error, recorded because it is the reusable part.** The stale-mirror candidate was
> ruled out on the grounds that `detail_synced_at` (17:12) post-dated `last_used_date` (08-13 10:33),
> so the sync "must" have seen the post-consumption state. Those two timestamps cannot distinguish
> *"EFS still reports 1"* from *"we read it before the purchase"* — a later transaction invalidates
> the inference entirely, and one arrived. **A mirror row can only ever tell you what EFS said at
> `detail_synced_at`; it can never tell you what EFS says now.** Standing rule 11 is the same idea
> for writes ("a successful response is never evidence of a correct write; only a re-read is"). It
> applies to reads too.

**2. The portal's 50-gallon grant surfaces as `WSCardHeader.override`, and EFS retires it on use.**
Miki granted 50 gallons in the WEX portal on this card; the card carried `override = 1` while armed
and `override = 0` after the purchase. So the quantity-bounded portal mechanism and the card-level
use count are **not** independent, and the counter is decremented by the vendor — we do not have to
clear it. What the counter cannot express is the 50-gallon bound itself, which remains the §6.B
scoping problem and a Phase 4.4 question.

**3. `docs/30` §6.F's mechanism is confirmed, live and by accident.** `sync_error` went from
`ambiguous_fuel_card_link` to null on a manual refresh, because `refreshCardDetail` does not run the
link pass that `syncCards` runs last. One column, two meanings, and the operator sees the alarming
one. Filed: Step 7.5 (display) and Step 7.7 (the linking itself).

### What it opens

**Override state can be up to a full sync cycle wrong, and nothing says so.** `EFS_CARD_SYNC_HOURS`
defaults to 24; this card's badge was wrong for nine hours and the UI presented it with no staleness
signal. For a lock that is tolerable. For an override — the number that says whether a driver can
take another free tank — it is not. Filed as **`docs/28` Step 7.8**.

## H5 — the first capability proof, and what a live run measured (2026-08-15, QA)

The Phase 4 harness run end to end against `ws.partner.efsllc.com`, QA card ••••7671, proof
`40b88b75`. Recorded here because it is the first time this codebase has produced *evidence about a
capability* rather than evidence about a request.

| OEG | Result | Note |
|---|---|---|
| 1 — entitled | **true** | no `not_allowed` from any call |
| 2b — no-op stable | **null** | NOT obtainable, and deliberately not faked — see below |
| 3 — change landed | **true** | apply → `succeeded` through the real orchestrator |
| 4 — vocabulary | **true** | observed `HOLD`; `status` is casing-adaptive, so `Hold` vs `HOLD` is a handled adaptation |
| 5 — revert landed | **true** | card back to `ACTIVE`, proven by re-read |

**Document shape `nested:header`.** Confirms on a live QA card what `docs/22`'s WSDL section says the
type declares, and what the production corpus shows: this account nests, it does not return a flat
card.

### Two things the run measured that no offline test could

**The first verifying re-read MISSED.** The recorded 4562 ms spans the whole capability call —
planning read, write, first re-read, the 3-second `EFS_CARD_VERIFY_RETRY_MS` pause, second re-read.
That arithmetic only works if the first look did not see the change and the second did. So on this
account, at this moment, **apply latency was somewhere above the first read and below ~3 s** — which
is consistent with the 533 ms H1 measured, and is NOT the "9× slower" the raw number suggests. The
column is mislabelled rather than the vendor being slow; **Step 4.7** fixes the measurement.

**OEG-2b cannot be obtained through the capability model.** The gate is "cardVersion unchanged after
a NO-OP dispatch" — a `setCardv2` carrying the echoed document and zero edits. Every capability
produces edits by construction, which is exactly the property that makes `buildEdits` the single
definition of what a write changes. Two reads compared to each other would have satisfied the column
and proven nothing: it would show the card is quiet, not that a no-op write leaves it alone, and
WSCardv2's sequence bugs live in serializer paths a zero-edit request never reaches. Left **null**,
which Step 4.6 treats as "not obtained" and carries as a named residual risk on the promotion.

### The promotion that followed, and why it was allowed

`card_lock` → `enabled`, citing this proof. The interesting part is the vocabulary decision. The
fleet-wide scan reports `status` as **`unobserved`** on QA, because no QA card is in `HOLD` at rest —
and standing rule 14 guarantees none stays there. Step 4.6 as originally written required every
vocabulary field to be `match`, which would have made the safest capability in the product
permanently unpromotable. It was amended before being built: **`unobserved` yields to the proof
run's own observation, and to nothing else.** `mismatch` still blocks unconditionally, because a
mis-spelling means the next write is silently ignored (H1), and no proof makes that safe.

Both residual risks are recorded on the promotion row and in the `card.capability_promoted` audit
entry — "what did we know we did not know when we allowed this" is a question asked after an
incident, not before.

---

## H6 — the credential binding was inert, and closing it measured apply latency properly (2026-08-15 evening, QA, CONFIRMED)

**The gate that never ran.** Migration 0187 bound a confirmed write entitlement to the credential
identity it was confirmed against, and added the column nullable with a grandfather clause. From
2026-08-13 until this run, the only org with card control had `write_entitlement = 'confirmed'` and
`probed_identity_hash` NULL. `efsCardControlAccess.ts` read that null, logged one warning **per
process**, and allowed the write. The guard was therefore switched off on 100% of the orgs it
governed, and the warning designed to make that visible fired once per boot and then went silent.

Two facts made it invisible, and both are worth carrying:

- **`probed_endpoint_host` and `probed_document_shape` were null too.** `writeProbe.ts` writes all
  three in one upsert, so their being null *together* is the evidence that no probe had touched the
  row since 0187 added the columns. The plan inferred the provenance; the trio proves it. When a
  column is written by exactly one code path, its siblings are a free provenance check.
- **The dedup was the disguise.** A refusal that goes quiet after the first request looks identical
  to a system with nothing to report.

**Re-probed 2026-08-15 16:42Z, ten of ten proofs green**, on the QA sandbox
(`ws.partner.efsllc.com`, egress `152.55.176.240`, shape `nested:header`, 35 cards). The card was
returned byte-identical by a zero-edit echo (1662 bytes, `changed: []`), set to HOLD, and reverted to
ACTIVE. `probed_identity_hash` now `a8a624d2…`, and all three provenance columns are populated.

### What it measured that the harness could not

Steps 8 and 10 time ONE dispatch against ONE verifying re-read, which is the interval
`apply_latency_ms` claims to hold:

| | measured |
|---|---|
| apply (ACTIVE → HOLD, step 8) | **854 ms** |
| revert (HOLD → ACTIVE, step 10) | **841 ms** |
| the harness's figure for the same account (proof `40b88b75`) | 4562 ms |

So the vendor applies a status edit in **~850 ms on this account** — bounded above by H1's inference
("above the first read, below ~3 s") and the same order as H1's 533 ms. The 4562 ms in the proof row
is not the vendor being slow; it is `executeCapability` end to end, including the 3-second second
look. **Step 4.7 now has its calibration number**, and it did not need a new experiment — the
entitlement probe had been measuring it correctly the whole time, in a different column.

**The lesson, in the shape this account keeps producing it:** two numbers named for the same thing,
measured across different intervals, one of them nine times the other. Same family as `sync_error`,
`updated_at` and `drift` — one label, two meanings.

---

## H7 — the QA account cannot start Phases 9–12 as it stands (2026-08-15, OPEN)

Step 0.13 asks for 13 QA cards mapped to §0.6's roles "from observed state". The observation was run
against all 35 QA cards in the mirror, every one detail-synced. **Three of the six roles cannot be
filled, because the required starting states do not exist in this account:**

| Role | §0.6 requires | QA actually holds |
|---|---|---|
| Status | one Active, one **Hold** | ACTIVE and INACTIVE only — **no card is at Hold** |
| Prompts | one `infoSource=CARD`, one `POLICY` | **all 35 are `BOTH`** — neither value occurs |
| Override / limits | **two** with limits | **one** (••••7672: DEF 250, RFR 75, ULSD 500) |
| Access controls | one **with** time restrictions | `timeRestrictions` is empty on **all 35** |
| Control | one on the same policy as an experiment card | trivially satisfied — every card is `policyNumber 1` |
| Empty `<infos>` / empty `<limits>` | one each, preserved | plentiful |

`limitSource` and `timeSource` are `POLICY` on all 35, and `locations` is empty on all 35 —
consistent with H3, which found this account does not report override scope at all.

**This is a WEX-portal configuration task, not a code task**, and it is the real reason Phases 9, 10,
11 and 12 cannot start. The plan recorded Step 0.13 as blocked on `EFS_CARD_CONTROL_PROBE_ENABLED`;
that blocker is obsolete — every QA card is already detail-synced and the Step 1.2 ownership guard
landed weeks ago. The actual blocker is that the fixtures the phases need have never been created.

### And last-4 is not an identity in QA either

The production finding (2026-08-15) repeats on the sandbox: **35 QA cards carry only 20 distinct
last-4 values**, and nine groups hold more than one card — `7670`, `7671`, `7672`, `7677`, `7678`,
`7679` are **three cards each**.

That has a direct consequence for the record: **"the proof ran on QA ••••7671" does not name a
card.** Three cards answer to it. The one this account's proofs have been hitting is identifiable
only by its contents — three `<infos>` records (UNIT 990, NAME "Test Driver One", DRID 9900) where
the other two ••••7671 rows carry none.

So Step 0.13's stated output format — "§14, last-4 only" — **cannot express the answer it asks
for**, and neither can any future proof record. The role table must key on `efs_cards.id`, which is
a uuid, is already stored, and carries no PAN. Recorded here rather than fixed in passing, because
changing how every proof names its card is a decision, not a cleanup.

---

## H8 — card identity, measured live: the vendor and the fuel import agree (2026-08-15 night, production, CONFIRMED)

Step 7.7 shipped a tiered linker and could not answer its own decisive question offline: **does the
card number EFS returns equal the number a fuel import wrote into `fuel_cards.card_ref`?** Both are
sealed, so nothing on our side could compare them. The tiers were built to fail safe — exact digit
equality or an 8+ digit suffix, matching NOTHING if the formats disagreed — and `fuel_card_link.method`
was added precisely so one sweep would settle it.

**One sweep settled it.** Manual `efs_card_sync`, production org, 2026-08-15 19:31–19:37Z, 197 cards
read, 0 failed:

| | before | after |
|---|---|---|
| linked (of 197 live) | 54 | **157** |
| linked by `pan_exact` | — | **103** |
| linked by `pan_suffix` / `last4_unit` | — | 0 |
| `ambiguous`, naming their candidates | — | 35 of 35 |
| `no_candidate` | — | 5 |
| rows carrying `sync_error = ambiguous_fuel_card_link` | 139 | **0** |

**The answer is yes, and emphatically.** `pan_exact` fired 103 times — the two systems store the same
19-digit number, so the strongest tier does all the work and the weaker ones never ran. The previous
sweep, on the old last-4 linker, linked **2**.

Three things worth carrying:

- **The fallback tiers are untested in production and should stay.** `last4_unit` fired zero times
  because `pan_exact` reached everything it could, not because it is unnecessary — it is what catches
  a card whose PAN never made it into an import. Its value is conditional, and a zero here is not
  evidence against it.
- **The prediction was close but for a different reason.** Simulating before the build said the unit
  tier would resolve ~100 of 143. It resolved 0, and the PAN tier resolved 103. The COUNT was nearly
  right and the MECHANISM was wrong — which is exactly why `method` is recorded per row rather than
  inferred from a total.
- **The remaining 40 have a ceiling, and it is data, not code.** 29 of them carry no `unit_prompt`,
  so no tier below the PAN can reach them; 5 have no `fuel_cards` counterpart at all. Fuel attribution
  now runs on **80% of the live fleet, up from 27%**, and the rest needs somebody to put a unit on a
  card or import a missing row — each of which the row now names for itself.

**And the `sync_error` overload is gone in the linking direction.** 139 rows displayed
*"Last refresh reported: ambiguous_fuel_card_link"* on a refresh that had succeeded. The linker no
longer writes that column at all, so the count is 0 — Step 7.5's refresh half is still open, but the
half that was mislabelling successful syncs is closed.

---

## H9 — the production promotion refusal, watched (2026-08-15 night, production, CONFIRMED)

Phase 4's exit gate asked for the ALLOW path's mirror image: attempt a promotion on production and
watch the gate refuse. The point was never to get past it — **a refusal is the system working** — it
was to see what an operator is actually told.

**Attempted:** `promote card_lock --proof 40b88b75-9fcf-4a82-9f7f-2353546ae243` against the production
org, citing the QA proof. Admin token, step-up password, both real.

**Refused, HTTP 409:**

```
"code": "promotion_refused"
"refusals": ["No proof run exists for card_lock on this company. Run one before promoting."]
```

**The refusal is completely inert, which is the half worth verifying in the database rather than the
response:** zero promotion rows on production, zero settings rows, zero capability audit rows, and all
five existing promotions still QA-only. The write is unreachable behind `decision.allowed`.

**But it named ONE blocker and production has THREE.** The proof lookup is org-scoped, so the QA proof
is invisible here, and `decidePromotion` returned early — never reaching the document shape (no
settings row at all) or the vocabulary verdict (no config scan for this org). The route's own comment
promises *"Every reason is returned, so one round trip tells them everything they have to fix"*, and
on **the most common starting state — a company that has never been promoted anything — that promise
was false.**

Each of the three has a DIFFERENT fix: run a proof, run a config scan, obtain an observation of
`status`. An operator learning them one at a time runs the proof, re-runs the promotion, and only then
meets the second wall.

**Fixed in the same session.** The proof-dependent checks are skipped when there is no proof — "OEG-1
is not obtained" adds nothing to "there is no proof", and four such lines would bury the refusals that
carry independent fixes — while every org-level check still runs. The same attempt now returns three
refusals. Verified by restoring the early return and watching exactly one test go red.

**Two smaller things the run taught:**

- **A malformed proof id is refused before any evidence is weighed.** The first attempt used a padded
  UUID whose version nibble was `0`; zod rejected it with `invalid_request` and the gate never ran. A
  typo can never be mistaken for a missing proof.
- **The CLI exits non-zero on a refusal**, which is correct — a script chaining promotions must stop
  on a "no" — but it means a refusal and a crash look alike to a shell. The JSON body distinguishes
  them.
