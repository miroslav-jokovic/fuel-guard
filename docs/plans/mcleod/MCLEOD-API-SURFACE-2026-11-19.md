# McLeod `/ws` API surface — read from McLeod's public docs, 2026-11-19

**What this is.** The operations the McLeod REST API (`/ws`) documents, read on 2026-11-19 from
McLeod's public documentation pages, which the owner located:

- `https://tms-map.mcleodhosted.com/ws/docs/` — a **hosted McLeod customer's** `/ws` docs, publicly
  readable (`?role=-1`). 73 services. ⚠ **Not our install and not our version**: no version string
  appears on any page. Every operation below must be confirmed on OUR `/ws/docs` once it is enabled
  (MK0 discovery, `MCLEOD-API-KIT-PLAN.md`), because our LoadMaster is 22.1.
- `https://innovationhub.mcleodsoftware.com/McLeodAPIdocs` — McLeod's Innovation Hub (Tyk portal).
  The catalogue is public; each product's documentation renders nothing without login.

Every `/ws` docs page serves its own copy at `<host>/ws/docs/`, so OUR copy will be at
`https://<our-mcleod-host>/ws/docs/` once `/ws` is enabled — the authoritative source for MK0.

R = read, W = write. Roles are McLeod's API roles (`Users` = an office web user).

## Authentication (`/ws/docs/auth`)
- HTTP Basic (`Basic base64(user:password)`) or token (`Authorization: Bearer <token>` / `Token <token>`).
- Token from LoadMaster "Sys Admin › Smartphone Mobile Service", or `POST /users/login` with Basic auth
  (returns the token; no roles; `accept` text/plain or application/json). **Token expiry not stated.**
- Headers on every call: `Authorization`, `Accept` (XML default — send `application/json`),
  `AnywhereCompanyID`. Login also shows `X-com.mcleodsoftware.LicensingAgent`.
- `X-Api-Key` / `X-Mcld-Tenant` do not appear on `/ws`; they belong to the Innovation Hub gateway.

## Paging and change reads (`MovementService › getMovementsByAdvancedSearch`)
- `GET /movements/search`: prefixed fields (`origin.`, `destination.`, `driver1`, `tractor`, `trailer1`…),
  `orderBy` (default `movement.id DESC`), `recordLength`, `recordOffset`.
- "Result size is limited to 1000 records unless specifically configured using the
  `-Dloadmaster.api.maxresultsize` vmparam."
- `changedAfterDate` (e.g. `t-1`) + `changedAfterType` (`Add` | `Update`). "Dates are limited to the
  audit setting and days to keep value in the table properties configuration."
- No webhooks / callbacks documented on `/ws`.

## Operations that matter to Silvicom 360

### Stops (truckload)
- **W `POST /dispatch/clearStop/{stopId}`** (Users) — "Clears the stop with the given dates and creates
  a service failure record if necessary." Query: `arrivalDate`, `departureDate` (Date), `hub` (odometer,
  int), service-failure fields `delayCode`, `delayComments`, `causedByType`, `driverId`, `payeeId`,
  `userId`, `name`, `terminalId`, `isReportable` (default true), `faultOfCarrierOrDriver` (default false).
  Response text/plain. **This is the truckload stop write.**
- `POST /dispatch/{stopId}/arrive|depart|start|complete` (Drivers) — docs: "Currently, this only works
  for LTL movements." **Not usable for our truckload loads.**
- `GET /stops/{id}`, `/stops/{id}/referenceNumbers`, `/stops/{id}/stopNotes` (R).
- No stop ETA write found in DispatchService, StopService, MovementService or SymphonyMobileCommService.
  `RowStop` type page not yet read (rate-limited) — candidate: `TableRowService PUT /stop/update`.

### Dispatch / movements
- W `POST /dispatch/assign/{movementId}` (Users): `driver1`, `driver2`, `tractor`, `trailer1..3`,
  `overrideExistingPreassignment`, `overrideLinkedMoves`.
- W `POST /dispatch/cancel|changeEquipment|clearPreassignments|reconsign/{movementId}`,
  `/dispatch/split/{stopId}`, `/dispatch/unsplit/{movementId}`, `/dispatch/moveTrailer`, `/dispatch/locateTractor`.
- R `GET /movements`, `/movements/search`, `/movements/{id}`, `/movements/{id}/route`.

### Orders
- R `GET /orders`, `/orders/search`, `/orders/{id}`, `/orders/{id}/positions`, `/orders/{id}/deliveryReceipt` (PDF).
- W `PUT /orders/create`, `PUT /orders/update`, `PUT /orders/updateRow` ("without some validation and
  without updating corresponding stop and movement data" — do not use), `POST /orders/{id}/copy|duplicate`.

### Images (DocumentPower)
- R `GET /images/{rowType}/{rowId}` (list), `GET /images/{id}` (file, default PDF),
  `GET /images/{rowType}/{rowId}/documentTypes` (the categories allowed for that row).
- **W `POST /images/{rowType}/{rowId}/{documentTypeId}`** (Users, Drivers, Carriers, Carrier Drivers).
  Docs: "Some providers may simply stage the uploaded image and later pick it up with a batch process."
- W `POST /images/multipart/...`, `/images/symphony/...` (Symphony MC role).

### Drivers
- R `GET /drivers`, `/drivers/search`, `/drivers/new`, `/drivers/{id}`, `/{id}/assignments|current|lastStop|preassignments`.
- **W `PUT /drivers/create`** (Users), body `RowDriver`. Flow: `GET /drivers/new` → fill → create.
- **No driver update in DriverService.** Updates go through **`TableRowService PUT /driver/update`**
  ("auditing, permissions and validation" run first).
- `RowDriver` fields (none marked required on the page): `is_active`, `status_code`, `hire_date`,
  `termination_date`, `reason_for_leaving`, `can_rehire`, `pta_date`, `next_home_date`,
  `last_home_date`, `home_duration`, `home_location_id`, `return_home_flag`, `license_no`,
  `license_state`, `medical_cert_expire`, `tractor_id`, `fleet_manager`, `payee_id`, `type_of`,
  `team_status`, `tenstreet_id`, `social_security_no`, `avl_*` hours.
- W `PUT /equipStatus/create` (Drivers) — "Creates a new RowDriverStatus record" (driver status events).

### Tractors / trailers
- R `GET /tractors`, `/tractors/search`, `/tractors/{id}`; same for `/trailers`, plus `/trailers/near`.
- **W `PUT /tractors/update`, `PUT /trailers/update`** (Users), body `RowTractor` / `RowTrailer`.
  No dedicated status call: status is `status`, `service_status`, `inservice_date`, `outservice_date`
  on the row.

### Generic
- `TableRowService`: `GET /{table}/{id}`, `/{table}/search`, `PUT /{table}/create`, `PUT /{table}/update`,
  `DELETE /{table}/{id}`, `POST /{table}/{id}/{method}` (Users). Auditing, permissions, validation enforced.
- `AuditTransactionService GET /auditTransactions/search` (R) — the change audit.
- `CallinService PUT /callins/create|update`.
- `SymphonyMobileCommService` (role Symphony MC, needs Symphony licence): positions, messages, forms,
  `PUT /symphonymcmessages/driverAvailable` (= HOS available hours, **not home time**), driverStatus.

### Money
- **Read only:** `SettlementService`, `DeductionService`, `BillingService`.
- `PayrollService` ("getting/posting generic payroll data"), `WireService` (create advances), `PUT /movements/{id}/otherPay` (driver extra pay).
- **No GL, ledger, AP voucher or fuel service** in the list. Finance reads stay on SQL grants.

## Innovation Hub catalogue (docs behind login)
McLeod API, Symphony (SMCS), Order Creation (ConnectAPI), DocumentPower (Pre-Release), Vehicle
Maintenance (equipment create/update + PM messages), Track and Trace, Dispatch Optimization
(Pre-Release), Order Payables Auditing (Pre-Release), AR Financing (Pre-Release), MPact, Quick-Quote,
Access Control, Location Matching, Qued, Account Management, DFM.

## Still unread on tms-map (read on our own `/ws/docs` at MK0)
`RowStop`, `RowTrailer`, the types index, detail pages of `PUT /tractors/update`, `PUT /orders/create`,
`GET /auditTransactions/search`, `PUT /equipStatus/create`, `POST /symphonymcmessages/position`.
