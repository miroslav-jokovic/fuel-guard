# SambaSafety API — recon (step A1)

> **⚠ REFERENCE ONLY (2026-08-26):** the SambaSafety integration was deprecated on cost before any
> of it was built (DQF-EXECUTION-PLAN Phase E, RECRUITING-SYSTEM-PLAN R3/R4 — banners there). This
> recon is kept because it records vendor facts that cost real effort to establish — application
> errors returned with HTTP 200 (§6), the undocumented webhook signature (§3) — and would be the
> starting point for any future MVR build, vendor or in-house.

**Date:** 2026-08-18 · **Source:** `https://developer.sambasafety.com`, which is a **published Postman
collection**, not a Redoc/Stoplight site. It is **public — no login required**. The human page renders
client-side, which is why WebFetch returned an empty document; the machine-readable collection is served
from the portal's own API and is committed to this repo at
[`docs/vendor/sambasafety-postman-collection.json`](../../vendor/sambasafety-postman-collection.json) (1.4 MB, 108 requests).

Re-fetch it with:

```bash
curl -sS "https://developer.sambasafety.com/api/collections/23966849/2sB2j3Ardd?environment=23966849-c3b2181f-9983-4d07-b82b-c344c64df2cf&segregateAuth=true&versionTag=latest" -o docs/vendor/sambasafety-postman-collection.json
```

**There is no OpenAPI/Swagger document behind this portal.** The vendor's marketing refers to an
"OpenAPI 3.0 spec on the Developers Portal"; what the portal actually serves is Postman collection v2.
Treat the collection as the spec, or ask our rep for the OAS file. This is exactly the EFS lesson —
what the vendor says it publishes and what it publishes are two different artifacts.

---

## 1. Hosts

| Environment | Base URL |
|---|---|
| Demo | `https://api-demo.sambasafety.io` |
| Production | `https://api.sambasafety.io` |

## 2. Authentication — verified from the collection

OAuth 2.0 **client credentials**, plus a separate API key header on every call.

```
POST /oauth2/v1/token
Authorization: Basic base64(clientId:clientSecret)
X-Api-Key: <apiKey>
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=client_credentials&scope=API
```

Response: `{ token_type, expires_in (seconds), access_token, scope }`. Every subsequent call sends
`Authorization: Bearer <access_token>` **and** `X-Api-Key` (the collection inherits the API key at
collection level). `POST /oauth2/v1/revoke` revokes.

**Three secrets per environment, not one:** client id, client secret, api key. They go in
`org_integrations.config`/row for `provider='sambasafety'` (service-role only, no client RLS).

## 3. Webhooks — verified

- `POST /reports/v1/subscriptions` — body `{ url, filter?, eventTypes[] }`; returns `subscriptionId`.
- `GET|PUT|DELETE /reports/v1/subscriptions[/:subscriptionId]`.
- Deliveries arrive as `POST` to our URL with header **`X-SambaSafety-Signature`**.
- Payload is HATEOAS, not the report itself:
  ```json
  { "eventId": "…", "data": { "orderId": "…", "links": [ { "rel": "…", "href": "/reports/v1/…", "id": "…", "type": "GET" } ] } }
  ```
  So the flow is **event → follow `links[].href` → fetch the report**. Never trust the event body as data.
- Event types seen in the sample subscription: `motorvehiclereport.received|.error`,
  `transactionalmvr.received|.error`, `intelligentmvr.*`, `activitymvr.*`, `activityhistory.received`,
  `activitydetail.*`, `activityindicator.*`, `activityindicator.v2.received`, `licensediscovery.*`,
  `licensevalidation.*`, `lhorder.received`. Content types on the callbacks additionally show
  `licensestatus`, `qorta.licensehistory`, `qorta.motorvehiclereport`, `qorta.transactionalmvr`,
  `qorta.cdlisreport`.

### STILL OPEN — the one thing the collection does not state
**The signature algorithm and the signing secret.** The header exists in every webhook example with an
empty value; nothing in the collection says HMAC-SHA256 vs. anything else, what is signed (raw body?
timestamp + body?), or where the shared secret comes from. **Ask our SambaSafety rep before E5 is
written.** Until it is answered, the webhook endpoint must reject every request — a receiver that
cannot verify is a receiver that must not accept.

## 4. Report media types — the finding that removes work

Reports are content-negotiated by `Accept`. Verified media types present in the collection:

```
application/vnd.sambasafety.platform.mvr+pdf      application/vnd.sambasafety.platform.mvr+html
application/vnd.sambasafety.activityhistory+pdf   application/vnd.sambasafety.activityhistory+html
application/vnd.sambasafety.cdlis+pdf             application/vnd.sambasafety.cdlis+html
application/vnd.sambasafety.json / .xml / .html / .pdf
```

**We can ask for the MVR as a PDF.** It files straight into `documents` with
`content_type='application/pdf'` — no HTML-to-PDF conversion, no rasteriser, and the PDF is the artifact
an auditor expects to see. Request `+json` **as well** for the parsed fields we need on
`qualification_records`. Two calls, one order.

## 5. What maps onto our DQF

| Our need | SambaSafety surface |
|---|---|
| Annual MVR (§391.25) | `POST /transactional/v1/mvrorders` → `GET /reports/v1/motorvehiclereports/:reportId` |
| Continuous licence monitoring | `PUT /monitoring/v1/licenseenrollments/:licenseId`, `GET .../people/:personId/licenseenrollments` |
| Driver roster sync | `POST /organization/v1/groups/:groupId/people`, `PUT /organization/v1/people/:personId`, `POST /organization/v1/people/search` |
| Licence record | `POST /organization/v1/people/:personId/licenses`, `GET /organization/v1/licenses/:licenseId/status` |
| CDLIS MVR (the post-June-2025 §391.51(b)(6) question in DQF-PLAN §4) | `POST /orders/v1/reports/cdlis` → `GET /orders/v1/reports/cdlis/:orderId` |
| Ordered-MVR history per driver | `GET /reports/v1/people/:personId/motorvehiclereports` |

**Clearinghouse is NOT in this API.** §382.701 queries are a separate obligation with a separate
provider. DQF-PLAN's market comparison listed it as a competitor feature; SambaSafety does not close it.

## 6. Data-shape constraints that will bite the mapping

From the portal's "Common Design Considerations", verbatim in effect:

- Names **may not contain accented characters** (`á é í ó ú ñ ü`) — only hyphen and apostrophe. Our
  `drivers.full_name` has no such restriction. The enrollment sync needs a transliteration step, and a
  driver whose legal name cannot be sent must fail visibly, not silently.
- Suffix is an enum: `JR SR II III IIII` — no periods, no commas.
- `ssn` accepts 9-digit or last-4, digits only.
- `gender`: `MALE FEMALE NON-BINARY`. `purpose`: `INSURANCE EMPLOYMENT RESELLER_*` — ours is `EMPLOYMENT`.
- Dates are ISO 8601.
- **Application errors return HTTP 200** with an error body. A client that only checks the status code
  will record a failed MVR order as a success. Error codes: `B01 B02 B03 C01 E01 L01 R01 U01 U02`.

## 7. Full endpoint inventory (108 requests, paths relative to the base URL)

| Method | Path | Collection location |
|---|---|---|
| `POST` | `/oauth2/v1/token` | Authentication / Obtain a token |
| `POST` | `/oauth2/v1/revoke` | Authentication / Revoke a token |
| `POST` | `/organization/v1/licenses/history` | Risk Assessment / License History Discovery / Place an Order |
| `GET` | `/reports/v1/licensehistory/:orderId` | Risk Assessment / License History Discovery / Check Order Status |
| `POST` | `/orders/v1/licensenumbersearch` | Risk Assessment / License Number Search / Perform a Search |
| `GET` | `/orders/v1/licensereports/verifylicense?page=1&size=50&startOrderDate=2023-01-01&endOrderDate=2023-09-15` | Risk Assessment / License Verification / List all Orders |
| `POST` | `/orders/v1/licensereports/verifylicense` | Risk Assessment / License Verification / Place an Order |
| `GET` | `/orders/v1/licensereports/verifylicense/:orderId` | Risk Assessment / License Verification / Check Order Status |
| `GET` | `/reports/v1/licensereports/verifylicense/:reportId` | Risk Assessment / License Verification / Get a Report |
| `POST` | `/orders/v2/activityreports/indicator` | Risk Assessment / Activity Indicator v2 / Place an Order |
| `GET` | `/orders/v2/activityreports/indicator/:orderId` | Risk Assessment / Activity Indicator v2 / Check Order Status |
| `GET` | `/reports/v2/activityreports/indicator/:reportId` | Risk Assessment / Activity Indicator v2 / Get a Report |
| `POST` | `/orders/v1/activityreports/history` | Risk Assessment / Activity History / Place an Order |
| `GET` | `/orders/v1/activityreports/history/:orderId` | Risk Assessment / Activity History / Check Order Status |
| `GET` | `/reports/v1/activityreports/history/:reportId` | Risk Assessment / Activity History / Get a Report |
| `POST` | `/orders/v1/reports/cdlis` | Risk Assessment / CDLIS v1 / Place Order |
| `GET` | `/orders/v1/reports/cdlis/:orderId` | Risk Assessment / CDLIS v1 / Obtain Order with OrderID |
| `GET` | `/transactional/v1/mvrorders?page=1&size=50` | Risk Assessment / Transactional MVR / List all orders |
| `POST` | `/transactional/v1/mvrorders` | Risk Assessment / Transactional MVR / Place an Order |
| `GET` | `/transactional/v1/mvrorders/:orderId` | Risk Assessment / Transactional MVR / Check Order Status |
| `GET` | `/reports/v1/motorvehiclereports/:reportId` | Risk Assessment / Transactional MVR / Get a Report |
| `GET` | `/orders/v1/licensereports/verifydriver?page=1&size=50&startOrderDate=2023-01-01&endOrderDate=2023-09-15` | Risk Assessment / License Discovery / List all Orders |
| `POST` | `/orders/v1/licensereports/verifydriver` | Risk Assessment / License Discovery / Place an Order |
| `GET` | `/orders/v1/licensereports/verifydriver/:orderId` | Risk Assessment / License Discovery / Check Order Status |
| `GET` | `/reports/v1/licensereports/verifydriver/:reportId` | Risk Assessment / License Discovery / Get a Report |
| `GET` | `/orders/v1/activityreports/indicator?page=1&size=50&startOrderDate=2023-01-01&endOrderDate=2023-09-15` | Risk Assessment / Activity Indicator v1 / List all Orders |
| `POST` | `/orders/v1/activityreports/indicatorquote` | Risk Assessment / Activity Indicator v1 / Place an Order for a Quote |
| `POST` | `/orders/v1/activityreports/indicator` | Risk Assessment / Activity Indicator v1 / Place an Order |
| `GET` | `/orders/v1/activityreports/indicator/:orderId` | Risk Assessment / Activity Indicator v1 / Check Order Status |
| `GET` | `/reports/v1/activityreports/indicator/:reportId` | Risk Assessment / Activity Indicator v1 / Get a Report |
| `GET` | `/orders/v1/mvrreports/activity?page=1&size=50&startOrderDate=2023-01-01&endOrderDate=2023-09-15` | Risk Assessment / Activity MVR / List all Orders |
| `POST` | `/orders/v1/mvrreports/activityquote` | Risk Assessment / Activity MVR / Place an Order for a Quote |
| `POST` | `/orders/v1/mvrreports/activity` | Risk Assessment / Activity MVR / Place an Order |
| `GET` | `/orders/v1/mvrreports/activity/:orderId` | Risk Assessment / Activity MVR / Check Order Status |
| `GET` | `/reports/v1/mvrreports/activity/:reportId` | Risk Assessment / Activity MVR / Get a Report |
| `GET` | `/orders/v1/mvrreports/intelligent?page=1&size=50&startOrderDate=2023-01-01&endOrderDate=2023-09-15` | Risk Assessment / Intelligent MVR / List all Orders |
| `POST` | `/orders/v1/mvrreports/intelligent` | Risk Assessment / Intelligent MVR / Place an Order |
| `GET` | `/orders/v1/mvrreports/intelligent/:orderId` | Risk Assessment / Intelligent MVR / Check Order Status |
| `GET` | `/reports/v1/mvrreports/intelligent/:reportId` | Risk Assessment / Intelligent MVR / Get a Report |
| `GET` | `/orders/v1/activityreports/detail?page=1&size=50&startOrderDate=2023-01-01&endOrderDate=2023-09-15` | Risk Assessment / Activity Detail / List all Orders |
| `POST` | `/orders/v1/activityreports/detailquote` | Risk Assessment / Activity Detail / Place an Order for a Quote |
| `POST` | `/orders/v1/activityreports/detail` | Risk Assessment / Activity Detail / Place an Order |
| `GET` | `/orders/v1/activityreports/detail/:orderId` | Risk Assessment / Activity Detail / Check Order Status |
| `GET` | `/reports/v1/activityreports/detail/:reportId` | Risk Assessment / Activity Detail / Get a Report |
| `GET` | `/organization/v1/groups?page=1&size=50` | License Monitoring / Groups / List all Groups |
| `POST` | `/organization/v1/groups` | License Monitoring / Groups / Create a Group |
| `GET` | `/organization/v1/groups/:groupId` | License Monitoring / Groups / Read a Group |
| `PUT` | `/organization/v1/groups/:groupId` | License Monitoring / Groups / Update a Group |
| `DELETE` | `/organization/v1/groups/:groupId` | License Monitoring / Groups / Delete a Group |
| `PUT` | `/organization/v1/groups/:groupId/people/:personId` | License Monitoring / Groups / Move a Person to a Group |
| `POST` | `/organization/v1/people/:personId/activity` | License Monitoring / People / Activity Data / Add Activity Data |
| `POST` | `/organization/v1/people/activity/search?page=1&size=50` | License Monitoring / People / Activity Data / Search Activity Data |
| `GET` | `/organization/v1/people/activity/:activityId` | License Monitoring / People / Activity Data / Get Activity Data |
| `PUT` | `/organization/v1/people/activity/:activityId` | License Monitoring / People / Activity Data / Update Activity Data |
| `POST` | `/organization/v1/people/activity/:activityId/document` | License Monitoring / People / Activity Data / Attach a Document to the Activity |
| `GET` | `/organization/v1/people/:personId/customfields` | License Monitoring / People / Custom Fields / Read CustomFields for a Person |
| `PATCH` | `/organization/v1/people/:personId/customfields` | License Monitoring / People / Custom Fields / Set CustomFields for a Person |
| `POST` | `/organization/v1/people/search?page=1&size=50` | License Monitoring / People / Search People |
| `GET` | `/organization/v1/groups/:groupId/people?page=1&size=50` | License Monitoring / People / People in a Group |
| `POST` | `/organization/v1/groups/:groupId/people` | License Monitoring / People / Create a Person |
| `GET` | `/organization/v1/people/:personId` | License Monitoring / People / Read a person |
| `PUT` | `/organization/v1/people/:personId` | License Monitoring / People / Update a person |
| `POST` | `/organization/v1/licenses/search?page=1&size=50` | License Monitoring / Licenses / Search Licenses |
| `GET` | `/organization/v1/people/:personId/licenses` | License Monitoring / Licenses / Licenses for a Person |
| `POST` | `/organization/v1/people/:personId/licenses` | License Monitoring / Licenses / Create a License |
| `GET` | `/organization/v1/licenses/:licenseId` | License Monitoring / Licenses / Read a License |
| `PUT` | `/organization/v1/licenses/:licenseId` | License Monitoring / Licenses / Update a License |
| `GET` | `/organization/v1/licenses/:licenseId/status` | License Monitoring / Licenses / Get a License's Status |
| `POST` | `/monitoring/v1/licenseenrollments/search?page=1&size=50` | License Monitoring / Enrollments / Search Enrollments |
| `GET` | `/monitoring/v1/groups/:groupId/licenseenrollments?page=1&size=50` | License Monitoring / Enrollments / Enrollments for a Group |
| `GET` | `/monitoring/v1/people/:personId/licenseenrollments` | License Monitoring / Enrollments / Enrollments for a Person |
| `GET` | `/monitoring/v1/licenseenrollments/:licenseId` | License Monitoring / Enrollments / Get Enrollment for a License |
| `PUT` | `/monitoring/v1/licenseenrollments/:licenseId` | License Monitoring / Enrollments / Set Enrollment for a License |
| `GET` | `/transactional/v1/licenses/:licenseId/mvrorders?page=1&size=50` | License Monitoring / Motor Vehicle Reports / All Orders for a License |
| `GET` | `/reports/v1/people/:personId/motorvehiclereports` | License Monitoring / Motor Vehicle Reports / All MRVs for a Person |
| `POST` | `/transactional/v1/licenses/:licenseId/mvrorders` | License Monitoring / Motor Vehicle Reports / Place an Order for a License |
| `GET` | `/transactional/v1/mvrorders/:orderId` | License Monitoring / Motor Vehicle Reports / Check Order Status |
| `GET` | `/reports/v1/motorvehiclereports/:reportId` | License Monitoring / Motor Vehicle Reports / Get a Report |
| `POST` | `/organization/v1/users/:userId/roles` | User Management / User Roles / Add Roles on a User |
| `GET` | `/organization/v1/users/:userId/roles` | User Management / User Roles / Get Roles on a User |
| `DELETE` | `/organization/v1/users/:userId/roles` | User Management / User Roles / Remove Roles on a User |
| `POST` | `/organization/v1/users/:userId/groups` | User Management / User Groups / Add Groups on a User |
| `GET` | `/organization/v1/users/:userId/groups` | User Management / User Groups / Get Groups on a User |
| `DELETE` | `/organization/v1/users/:userId/groups` | User Management / User Groups / Remove Groups on a User |
| `POST` | `/organization/v1/users` | User Management / User / Add a User |
| `PUT` | `/organization/v1/users/:userId` | User Management / User / Update a User |
| `DELETE` | `/organization/v1/users/:userId` | User Management / User / Delete a User |
| `GET` | `/organization/v1/users/:userId` | User Management / User / Read a User |
| `POST` | `/organization/v1/users/search?page=1&size=50` | User Management / User / Search Users |
| `GET` | `/organization/v1/users?page=1&size=50` | User Management / User / List all Users |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.activitydetail |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.activityhistory |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.activityindicatorv2 |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.activityindicator |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.activitymvr |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.intelligentmvr |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.licensediscovery |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.licensevalidation |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.licensestatus |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.qorta.licensehistory |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.qorta.motorvehiclereport |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.qorta.transactionalmvr |
| `POST` | `/webhook` | Webhooks / Events / vnd.sambasafety.qorta.cdlisreport |
| `POST` | `/reports/v1/subscriptions` | Webhooks / Create a Subscription |
| `PUT` | `/reports/v1/subscriptions/:subscriptionId` | Webhooks / Update a Subscption |
| `GET` | `/reports/v1/subscriptions/•••••••` | Webhooks / List a Subscription |
| `GET` | `/reports/v1/subscriptions` | Webhooks / List all Subscriptions |
| `DELETE` | `/reports/v1/subscriptions/:subscriptionId` | Webhooks / Delete a Subscription |
---

## 8. Account facts — three answered by the owner, three settled by a read-only script

**Owner input, 2026-08-18 (MJ):** the SambaSafety account has been live for years; the MVR product already
in use is sufficient for DOT purposes. The **Silvicom** group holds the active drivers — other groups exist
and are not ours. The fleet has **no drivers licensed in UT, CA or PA**, so the state access codes the
vendor's error documentation requires for those states are not needed today.

That leaves nothing that needs an email thread before code can be written. `scripts/samba-recon.mjs`
(plan step A5) settles the rest with GETs and search POSTs only — **nothing ordered, nothing billed,
nothing written**:

| Fact | How it is obtained |
|---|---|
| **Which MVR product we actually buy** | Probe each product's list endpoint over a wide date range — `GET /transactional/v1/mvrorders`, `GET /orders/v1/mvrreports/activity`, `GET /orders/v1/mvrreports/intelligent`, `GET /orders/v1/reports/cdlis`. The one returning rows is the answer. Pin the path; the client uses that one and no other. |
| **The Silvicom `groupId`** | `GET /organization/v1/groups?page=1&size=50`, matched by name **once** and stored. Never name-matched at runtime. |
| **Current monitoring footprint** | `POST /monitoring/v1/licenseenrollments/search` — how many licences are enrolled today, which is the baseline for E3. |
| **Existing subscriptions** | `GET /reports/v1/subscriptions` — so E5 does not create a duplicate. |
| Rate limits | Rep, or observed. Non-blocking — the client backs off on 429 regardless. |
| Per-driver monitoring price | Rep. Affects how E3's unenrolment is justified, not whether it is built. |

**UT / CA / PA are handled as a guard, not as configuration.** `orderMvr()` refuses a licence issued in
those states with a named error stating that an access code must be configured first. When the fleet
eventually hires such a driver, the operator gets a clear message instead of a vendor-side failure.

**PII is the binding constraint on the recon run.** An MVR carries SSN, date of birth, licence number and
full violation history — the most sensitive record in the product. Fixtures captured for the client's
tests are scrubbed before they reach the repo, following `redactCardXml` (commit `9a7a125`).

One technical item remains open and is **non-blocking**: the algorithm behind `X-SambaSafety-Signature`.
Every event doc also specifies `Authorization: Basic base64(clientId:clientSecret)` on the callback —
credentials we already hold, verifiable with a constant-time compare. Ask for the signature spec as
hardening.

## 9. Identity mapping — solved by the vendor's own field

`POST /organization/v1/groups/:groupId/people` accepts **`customPersonId`**. Our `drivers.id` goes there,
so SambaSafety stores our key and every webhook can be resolved back to a driver without a join table and
without name-matching. Name-matching a roster is how the duplicate-driver problem in migration `0203`
started; this avoids repeating it.

## 10. Alerting — why the events come from Samba and the notifications come from us

The two systems know different things and neither can answer the other's question:

| Knows | Source |
|---|---|
| Licence suspended / downgraded / reinstated; a new violation posted; an MVR auto-produced by monitoring (with its `reason`) | **Only SambaSafety** |
| Medical card expiring; annual MVR review due; hazmat training anniversary; employment application missing; file not started | **Only us** — Samba has no view of §391.51 completeness |

So SambaSafety is subscribed to as an **event source**, and every event is converted into our own
`notify()` (step C1's `dq_license_status` / `dq_mvr_received`). Using SambaSafety's own email alerts as
the delivery channel would split the notification surface in two: their emails bypass `emit_notification`'s
org entitlement, per-user mutes, quiet hours and dedupe, never reach the driver app's push channel, and
cannot deep-link into the driver's qualification file. One inbox, one mute model, one link.
