# McLeod LoadMaster self-hosted integration

Research date: 2026-08-06

## Decision

Use McLeod's **Direct-Hosted Web API** from an agent running inside the carrier network. Do not give
FuelGuard's hosted API a route into the McLeod network, and do not write directly to the LoadMaster database.

This is the supported fit for a self-hosted customer:

1. The on-prem agent calls `https://<private-mcleod-host>/ws` over the LAN/VPN.
2. It authenticates with a dedicated McLeod token and sends `AnywhereCompanyID`.
3. It reads changed movements, maps the McLeod rows to FuelGuard's neutral contract, and POSTs outbound over
   HTTPS to FuelGuard.
4. FuelGuard upserts by McLeod ID. No inbound firewall rule is required.

McLeod documents both Cloud-Hosted and Direct-Hosted forms and says Direct-Hosted uses the API endpoints with
the customer's own private server address. The API itself enforces McLeod authentication, auditing,
permissions, validation, and application logic. McLeod also says SQL statements can be run against the
underlying database, but specifically warns that SQL data changes can cause unexpected behavior or database
corruption. Sources: [McLeod API deployment modes](https://innovationhub.mcleodsoftware.com/McLeodAPI),
[McLeod Web API introduction](https://tms-map.mcleodhosted.com/ws/docs/), and
[McLeod integrations](https://www.mcleodsoftware.com/solutions/integrations/).

## What to request from McLeod Support

Open a customer support request using the following text:

> We are a self-hosted LoadMaster customer implementing a read-only internal integration. Please enable and
> license the Direct-Hosted McLeod Web API on our production and test environments. Please provide or confirm:
> (1) the private API base URL ending in `/ws`; (2) our `AnywhereCompanyID`; (3) the procedure for creating a
> dedicated least-privilege integration user and a revocable McLeod token; (4) permission for
> `GET /movements/search` and `GET /movements/{id}`; (5) the accepted absolute date-time format for
> `changedAfterDate` on our installed version; (6) the configured audit retention and API maximum result size;
> and (7) the supported source for driver home-time/PTO data and our reefer/temperature fields or equipment
> codes. We will not write directly to the database.

Also ask for the API/schema documentation matching the exact installed LoadMaster version. McLeod publicly
documents that movement search is capped at 1,000 results unless its API maximum-result setting is changed,
and that `changedAfterDate` can only look back as far as the configured audit retention. That makes retention a
production correctness requirement, not just a tuning detail. Source:
[GET /movements/search](https://tms-map.mcleodhosted.com/ws/docs/services?operation=getMovementsByAdvancedSearch&role=-1&service=MovementService).

## Access choices

| Choice | Use | Recommendation |
| --- | --- | --- |
| Direct-Hosted `/ws` API | Operational reads and any future writes | **Primary.** Keeps calls private and preserves McLeod permissions, auditing, and validation. |
| Cloud-Hosted Innovation Hub | A future externally routed/certified integration | Not needed for the current self-hosted/internal-server design. Cloud calls require `X-Mcld-Tenant` and `X-Api-Key`. |
| Direct SQL, read-only | A field McLeod confirms is not available through a supported API | Exception only. Use a McLeod-approved view and read-only login against a replica/reporting endpoint if available. |
| Direct SQL writes | Any workflow | Do not use. McLeod explicitly warns of unexpected behavior and corruption risk. |

McLeod's public site confirms that its products can be customer-hosted on premises or in a third-party cloud:
[McLeod solutions](https://www.mcleodsoftware.com/solutions/).

## Authentication and connectivity test

McLeod publishes two Direct-Hosted authentication methods:

- HTTP Basic with a McLeod username/password.
- A bearer/token registered inside LoadMaster or PowerBroker. A token can be created in Sys Admin Smartphone
  Mobile Service, or returned by `POST /users/login` after Basic authentication.

Use a token in production so it can be revoked without retaining a user's password. Source:
[McLeod authentication](https://tms-map.mcleodhosted.com/ws/docs/auth?role=-1).

From the internal machine that will run the agent, IT can test one read (replace all placeholders):

```powershell
curl.exe `
  -H "Authorization: Bearer <MCLEOD_TOKEN>" `
  -H "AnywhereCompanyID: <TMS_OR_TMS2>" `
  -H "Accept: application/json" `
  "https://<private-mcleod-host>/ws/movements/search?changedAfterDate=t-1&recordLength=1&recordOffset=0"
```

Expected outcomes:

- `200` plus JSON: routing, TLS, company ID, token, and read permission work.
- `401`: missing/invalid token.
- `403`: authenticated but the McLeod role lacks the operation.
- TLS/name error: fix the internal certificate chain or DNS; do not disable certificate verification.

The documented search supports filters, sorting, `changedAfterDate`, and pagination with `recordLength` and
`recordOffset`. `GET /movements/{id}` adds assigned tractor, driver, trailer, stops, and orders needed for field
mapping. Sources: [movement search](https://tms-map.mcleodhosted.com/ws/docs/services?operation=getMovementsByAdvancedSearch&role=-1&service=MovementService)
and [movement detail](https://tms-map.mcleodhosted.com/ws/docs/services?operation=getMovement&role=-1&service=MovementService).

## FuelGuard implementation

The implementation lives in [`tools/mcleod-agent`](../tools/mcleod-agent/README.md). It now follows the
published Direct-Hosted contract:

- `Accept: application/json` (McLeod otherwise defaults to XML).
- `Authorization: Bearer <token>` or Basic authentication.
- `AnywhereCompanyID: <company>`.
- `GET /movements/search?changedAfterDate=...&recordLength=...&recordOffset=...` with pages no larger than
  1,000.
- `GET /movements/{id}` for assignment, stop, and order detail.
- A watermark advances only after a complete successful FuelGuard ingest.
- Driver time-off is disabled unless McLeod confirms a supported carrier/version-specific route; the public
  DriverService contract does not publish one.

The official API represents JSON fields using the underlying LoadMaster table names and includes a `__type`
value; null fields are omitted. The agent therefore retains the original McLeod JSON for audit/debug while
mapping only the small stable contract FuelGuard needs. Sources:
[API JSON convention](https://tms-map.mcleodhosted.com/ws/docs/) and
[RowMovement fields](https://tms-map.mcleodhosted.com/ws/docs/types?role=-1&type=com.tms.common.loadmaster.tablerows.RowMovement).

## Internal-server deployment

1. Use a small Windows Server or Linux VM on the McLeod LAN/VPN; avoid installing third-party code on the
   LoadMaster database host unless McLeod approves it.
2. Allow outbound TCP 443 to the private McLeod Web API and the FuelGuard HTTPS hostname. No public inbound
   listener is needed.
3. Install Node.js 18 or newer and copy `tools/mcleod-agent` to a service-owned directory.
4. Store `.env` so only the service identity and administrators can read it. Use a revocable McLeod token and
   the one-time FuelGuard ingest token.
5. Start with `SOURCE=mock`, then switch to `SOURCE=mcleod` after the connectivity request succeeds.
6. Confirm one known reefer movement and one dry movement. Set `MCLEOD_REEFER_EQUIPMENT_TYPES` to the actual
   LoadMaster equipment codes. Verify tractor/trailer IDs match FuelGuard unit numbers.
7. Run every 15-30 minutes with Windows Task Scheduler/cron, or set `INTERVAL_MINUTES`. Alert if the process
   exits non-zero or FuelGuard's `last_synced_at` becomes stale.
8. Keep a lookback overlap or periodically replay a recent window. The FuelGuard ingest is idempotent on the
   McLeod movement ID.

## Direct-SQL fallback guardrails

If McLeod confirms that driver home-time/PTO is unavailable in the licensed API, ask McLeod to supply a
supported read-only view, its join/key definitions, and a dedicated read-only credential. Prefer a reporting
replica if the installation has one. Restrict the account to `SELECT` on named views, restrict network access to
the agent host, set short query timeouts, and never query with `SELECT *` in production.

Do not infer the database engine, port, schema, or tables from third-party examples. McLeod's public
documentation does not publish a universal self-hosted database connection procedure, and those details can
vary by installed version and topology. They must come from the customer's McLeod support case.

## Remaining site-specific inputs

- Exact LoadMaster version and licensed API modules.
- Private `/ws` URL and trusted TLS chain.
- `AnywhereCompanyID`.
- Dedicated integration token and role permissions.
- Audit retention long enough to cover outages.
- Actual reefer equipment/temperature field mapping.
- Whether McLeod exposes home-time/PTO through a supported route or approved read-only view.

