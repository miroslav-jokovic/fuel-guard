# /ws audit against <customer-hosted /ws docs> (2026-11-20) — COMPLETE

Base: `<customer-hosted /ws docs>` (all pages fetched with `?role=-1`, HTTP 200, no 429 so far).
URL shapes: services `services?service=<S>&role=-1`; operation detail `services?service=<S>&operation=<op>&role=-1`;
types `types?type=<fqcn>&role=-1` e.g. `types?type=com.tms.common.loadmaster.tablerows.RowStop&role=-1`.

## Batch 1: index, home, auth, types index, DispatchService, TableRowService, ImagingService

- Auth Basic / Bearer|Token / Smartphone Mobile Service / POST /users/login returns token — CONFIRMED (`auth?role=-1`):
  "set an HTTP request header called Authorization to Bearer 0000… or to Token 0000…"; "Call the POST /users/login
  method using HTTP Basic Authentication. This method returns a new token in the body of the response."
  Token lifetime: NOT IN DOCS (auth page: "If your token becomes compromised, you can always delete it and generate a new one.").
- XML default, Accept application/json — CONFIRMED (`home?role=-1`): "XML is our default if this header is unset."
  JSON convention: "The name of the table is the value having the __type name in the JSON object. All other name/value
  pairs not prefixed with __ are from the corresponding database table."
- 73 services — index lists 78 service links (count it: 78). Minor WRONG.
- clearStop: listed, role Users, "Clears the stop with the given dates and creates a service failure record if necessary." CONFIRMED (`services?service=DispatchService&role=-1`).
- `/dispatch/{stopId}/arrive|depart|start|complete` Drivers, LTL only — CONFIRMED: "Currently, this only works for LTL movements. In the future, we will use this method for drivers to report their arrivals on truckload movements as well."
- `/dispatch/split/{stopId}` — path param is actually `{splitBeforeStopId}` (cosmetic).
- DispatchService also has `/dispatch/{stopId}/createServiceFailure|scanDocument|freightPhoto|acceptOffer|declineOffer|beginTrip|endTrip` (Drivers, LTL only).
- TableRowService ops — CONFIRMED plus extra: `GET /{table}/new`, `GET /{table}/unvalidatedsearch`, `GET /{table}/{orderBy}/search`, `POST /{table}/{method}` (static). Quote: "makes sure that auditing, permissions and validation code runs before making changes."
- ImagingService: `POST /images/{rowType}/{rowId}/{documentTypeId}` roles "Users, Drivers, Carriers, Carrier Drivers" — CONFIRMED.
  `/images/multipart/...` and `/images/symphony/...` are role **Symphony MC** — CONFIRMED.
  `GET /images/{rowType}/{rowId}/documentTypes` roles also include Freight Matching, Payment Service.
  `GET /images/{id}`: "If no mimetype is supplied, we'll default it as application/pdf" — CONFIRMED.
- Types index exists (`types?role=-1`): RowStop, RowTractor, RowTrailer, RowDriver, RowDriverStatus, RowCallin, RowAuditLogTx, RowServiceFail, Image, ImageType … Note: there is NO `RowAuditTransaction` type; audit rows are `RowAuditLogTx`.
- No version string on home/index — CONFIRMED (no version text).

CORRECTION batch 1: the index lists **75** services (count of unique `services?service=` links), not 73 — WRONG (minor).

## Batch 2: clearStop detail, Date type, RowStop, RowTractor, RowTrailer, RowDriver, RowDriverStatus, RowCallin, RowAuditLogTx, images ops, TableRow create/update, users/login

### POST /dispatch/clearStop/{stopId} — `services?service=DispatchService&operation=clearStop&role=-1`
- CONFIRMED params: path `stopId` (String); query `arrivalDate` ("arrival date and time at stop", Date), `departureDate`
  ("departure date and time from stop", Date), `delayCode` ("service failure code if one should be created"), `delayComments`,
  `causedByType`, `driverId`, `payeeId`, `userId`, `name`, `terminalId` (all String), `isReportable` (Boolean, default `true`),
  `faultOfCarrierOrDriver` (Boolean, default `false`), `hub` ("hub/odometer reading of the tractor at this stop", Integer).
- No parameter is marked required; no default for arrival/departure → Date page: "Omitted parameters evaluate to null."
- Result: `Response` of type **text/plain** — "a response object containing an HTTP response code and string representing
  success or failure of the web service call". Accept header offered in Try-Out: only `text/plain`. CONFIRMED.
- NOT IN DOCS: whether departure-only is accepted; whether the stop must be the next uncleared stop; behaviour on a second
  call (idempotent vs error); error body format/codes; time zone semantics beyond the Date format. (RowStop has a field
  `prior_uncleared_stops` — suggests McLeod tracks out-of-order clearing, but nothing on the op page.)

### Date format — `types?type=com.tms.common.lib.Date&role=-1`
- "the pattern is determined by the `loadmaster.ws.useServerTimezone` vmparam value. When the vmparam is set to `true`,
  the pattern is `yyyyMMddHHmmss` and when it is `false`, the pattern is `yyyyMMddHHmmssZ`. Currently, this vmparam is set to `false`."
  (Currently = on <other-customer /ws>'s install; OURS must be read on our /ws/docs.) `Z` = RFC 822 zone, e.g. `-0500`.
- Response dates: `"create_date":"20160816170100-0500"`.
- Request BODY values also accept shortcuts: `n` now, `t` today, `m`, `w`, `q`, `y`, `me`, `we`, `qe`, `ye`; `t+1`, `t-7`;
  time as `t+1 1330`. "Except n (now), by default shortcut patterns use midnight 0000". So `changedAfterDate=t-1` is
  consistent with docs (the doc says shortcuts apply "Within a request body" — query-param use is NOT stated on this page).
- "Omitted parameters evaluate to null."

### RowStop — `types?type=com.tms.common.loadmaster.tablerows.RowStop&role=-1`
- JSON `__type":"stop"`. Fields include **`eta` (Date,19)**, `eta_distance` (int), `eta_late` (1), `eta_oor` (1),
  `late_eta_colorcode`, `projected_arrival` (Date), `planned_arrival_time` (Date), **`actual_arrival` (Date,19)**,
  **`actual_departure` (Date,19)**, **`sched_arrive_early` / `sched_arrive_late` (Date,19)**, `orig_sched_early/late`,
  `pu_override_arrive_early/late`, **`status` (String,1)**, `operational_status` (4), `appointment_status_id` (4),
  `confirmed`, `appt_required`, `prior_uncleared_stops` (1), `hub` (int), `signed_for_name`, `movement_id` (32),
  `movement_sequence`, `order_id` (8), `order_sequence`, `stop_type` (2), `id` (32), `company_id` (4).
- The plan said "RowStop not yet read — candidate `PUT /stop/update`". Now: `eta` EXISTS on RowStop → the
  TableRowService `PUT /stop/update` candidate is viable on paper. Writability: NOT IN DOCS — type pages list only
  key/name/size/type; no field is marked required, read-only or writable.
- Note "null fields are not included in returned data from the services" — an unset `eta`/`actual_arrival` is ABSENT
  from the JSON, not `null`. Parsers must treat missing key = null (affects U12 key-list discovery from one sample stop!).

### RowTractor — `...tablerows.RowTractor&role=-1` (112 fields)
- `status` (String,2), `service_status` (String,1), `inservice_date`, `outservice_date` (Date,10) — CONFIRMED.
  No `tractor_status` key (so D spec's "`tractor_status` or `status`" → it's `status` on this install).
  Also `driver1_id`, `driver2_id`, `current_stop_id`, `fuel_level`, `current_hub`, `dispatcher`, `fleet_id`, `serial_number`.

### RowTrailer — `...tablerows.RowTrailer&role=-1` (84 fields)
- **WRONG for trailers**: RowTrailer has NO `status` and NO `service_status`. It has `is_active` (1), **`statuscode` (4)**,
  `inservice_date`, `outservice_date`, `disposition_code` (4), `is_hooked`, `tractor_id`, `empty`, `odometer`.

### RowDriver — `...tablerows.RowDriver&role=-1` (159 fields)
- All fields the plan lists CONFIRMED present (is_active, status_code(4), hire_date, termination_date, reason_for_leaving,
  can_rehire, pta_date(Date,19), next_home_date, last_home_date, home_duration, home_location_id, return_home_flag,
  license_no(16), license_state, medical_cert_expire, tractor_id, fleet_manager, payee_id, type_of, team_status,
  tenstreet_id(11), social_security_no(24), avl_as_of_date/avl_drive_hours/avl_hours/avl_onduty_hours).
- **`license_date` (Date,10) EXISTS** — answers D spec MK0 item 5. **`reason_for_leaving` width = 3** (a code, not free text).
- `id` width 8 (driver code ≤ 8 chars). `name` 28, `first_name` 16, `email` 30, `cell_phone` 20, `birth_date`.
- "none marked required" — CONFIRMED (no required marker on any type page).

### RowDriverStatus — `...tablerows.RowDriverStatus&role=-1` (21 fields)
- `id`(32), `equipment_id`(8), `equipment_type_id`(1), **`event_code`(4)**, `event_status`(1), `start_date`, `end_date`,
  `notify_start_date`, `notify_end_date`, `request_date`, `entry_date`, `entered_by`, `remark`(100), `priority`,
  `driver_mgr_id`, `city`, `city_id`, `state`, `zip_code`, `location_id`. (Note: keyed on equipment_id + type, not driver_id.)

### RowCallin — `...tablerows.RowCallin&role=-1` (39 fields)
- **`new_eta` (Date,19)**, `current_stop_id`(32), `movement_id`, `order_id`, `driver_id`, `tractor_id`, `call_date_time`,
  `latitude/longitude`, `miles2consignee`, `next_stop_time_left`, `next_stop_city_*`, `remark`, `temperature`.
  → D spec MK6.1 step 1 ("callin carries a next-stop ETA field") is answered YES on paper: `new_eta` + `current_stop_id`.

### RowAuditLogTx — `types?type=com.tms.common.lib.tablerows.RowAuditLogTx&role=-1`
- `table_name`(30), `primary_key_values`(220), `changed_values`(text), `change_date_time`, `change_date_time_utc`,
  `user_id`, `application_id`, `transaction_id`, `sql_statement`(250), `primary_key_crc`.

### Images
- `POST /images/{rowType}/{rowId}/{documentTypeId}` (`services?service=ImagingService&operation=addImage&role=-1`):
  **rowType is a ONE-LETTER code**: "O - Order, M - Movement, C - Customer, L - Location, P - Payee, D - Driver,
  T - Tractor, E - Trailer, U - User". D spec's `rt ∈ {O, orders, order}` probe → docs say `O`.
  `documentTypeId` "must be one of the values returned in the GET /{rowType}/{rowId}/documentTypes method".
  Optional query `movementId`. Body: "a single image sent in the body of the request", **raw InputStream** with
  Content-Type one of `image/jpeg image/gif image/tiff image/png image/bmp application/pdf` — NOT multipart (multipart
  variant is Symphony MC only). **No file-name parameter.** Result: String — "a String containing the batch ID (if staged
  for later batch pickup) or the ID of the record stored in the database." (So the response does NOT say which one it is.)
- `GET /images/{rowType}/{rowId}/documentTypes`: same rowType codes, optional `movementId`, returns `List<ImageType>`
  xml/json; Try-Out lists header `X-com.mcleodsoftware.LicensingAgent`.
- `GET /images/{rowType}/{rowId}`: returns `List<Image>`.

### TableRowService create/update — `services?service=TableRowService&operation=update&role=-1` (create identical)
- `PUT /{table}/update`, body `row` of generic type `T`, `application/xml` or `application/json`; result `T`. Role Users.
  NO description: full-row vs partial, optimistic concurrency, required `__type` — all NOT IN DOCS. Home page JSON
  convention implies body `{"__type":"<table>", ...}` (e.g. `"__type":"stop"`).
  ⚠ the `{table}` segment is the TABLE name (e.g. `stop`, `driver`, `tractor`) — `/driver/update` is consistent with that.

### POST /users/login — `services?service=UserService&operation=login&role=-1`
- "Logs the user in and returns a token that may be used on subsequent requests for access." "The endpoint has no roles."
  Header params `user-agent`, `accept` ("only text/plain or application/json are valid"). Result text/plain or
  application/json: "a response indicating success or failure and if success, the access token". Token lifetime NOT IN DOCS.
  Try-Out headers include `X-com.mcleodsoftware.LicensingAgent` — CONFIRMED.

Fix to batch 2 quotes: Date page says "Omitted parameters evaluate as null." Shortcuts are written `t1` (tomorrow) and `t-7`,
time as `t1 1330` (no `+`).

## Batch 3: service pages (Driver, Tractor, Trailer, Order, AuditTransaction, EquipStatus, SymphonyMobileComm, Movement, Stop, Callin, User, Settlement, Deduction, Billing, Payroll, Wire), "About null Values", and op details

### About null Values — `types?type=null&role=-1`  ← answers "full row or partial?"
- "The service does not include XML attributes or JSON properties for null values. They are omitted"
- "when sending data to the service, callers may omit fields. In this case, these fields are not nulled out.
  To send a null value, pass the word "NULL" in upper-case." Example: `{"__type":"widget", "id":"1", "is_active":"Y", "descr":"NULL"}`.
  → Partial bodies are documented as safe (omitted ≠ null). Optimistic concurrency: NOT IN DOCS.

### Drivers — `services?service=DriverService&role=-1`
- `PUT /drivers/create` (Users) "Creates a new RowDriver record for the given Driver data." Body RowDriver (xml/json),
  result the created RowDriver with `__returnHomeFlagDescr`, `__sexDescr`, `__teamStatusDescr`, `__typeOfDescr`, child
  `homeLocation`, `fleetManager`, `lanes` (`services?service=DriverService&operation=createDriver&role=-1`). CONFIRMED.
  Required fields / SSN required: NOT IN DOCS.
- `GET /drivers/new` (Users): "Creates a driver object with all configured defaults set. This doesn't create a record in the
  database. Instead, callers … can edit the returned object and then pass it back to the create method". No params. CONFIRMED.
- No update op in DriverService — CONFIRMED. (Also present: `/drivers/rollingStops` [Drivers], `/drivers/userSavedSearch`,
  `/drivers/{id}/picture`, `/drivers/{id}/scorecardReport`, `/drivers/historyReport`.)
- `GET /drivers/search` (`operation=getDriversByAdvancedSearch`): criteria = any driver field "using a prefix of driver or no
  prefix" (doc says "location table" — a copy-paste typo). So the licence filter is **`driver.license_no=`** or `license_no=`;
  D spec's `drivers/search?license_no=<cdl>` is consistent. Operators allowed in values, e.g. `last_home_date=<=t-30`;
  `*` wildcard (`origin.location_id=WARE*` on movements). Default sort `driver.id+ASC`. Same paging/1000-cap/changedAfter text as movements.

### Tractors / trailers
- `PUT /tractors/update` (Users) "Updates a RowTractor record for the given data." Body `tractor` RowTractor xml/json;
  query `includeComments` (Boolean, default false). Result the updated RowTractor + `__statusDescr`, `__serviceStatusDescr`,
  `__currentMovementId`, `__lastPosition`, `__latitude`, `__longitude`, child `driver1`/`driver2`/`dispatcherUser`.
  (`operation=updateTractor`). CONFIRMED.
- `PUT /trailers/update` (Users), body RowTrailer, `includeComments`; result + `__fleetDescr` (from `trailer_group`),
  `__trailerTypeDescr`, `__currentMovementId` (`operation=updateTrailer`). CONFIRMED.
- Also exist (plan omits): `PUT /tractors/create`, `PUT /trailers/create`, `GET /tractors/new`, `GET /trailers/new`.

### Orders — `operation=createOrder`
- `PUT /orders/create` roles **Users, Customers**; body RowOrders; query `autorateOrder` (Boolean); result created RowOrders
  with child `stops` (RowStop), `movements`, `otherCharges`, `freightGroup`… CONFIRMED. `PUT /orders/updateRow` text CONFIRMED:
  "strictly updates the order row without some validation and without updating corresponding stop and movement data."

### AuditTransactionService — `operation=getAuditLogTransactionsByAdvancedSearch`
- `GET /auditTransactions/search` (Users) returns `List<RowAuditLogTx>`. Params `excludeAdd`, `excludeDelete`, `excludeUpdate`
  (boolean, default false) + any `audit_log_tx` field. CONFIRMED exists.
- ⚠ NEW, load-bearing: "Audit transactions are limited to the audit_log_tx table which only retains **one day** of transactions
  based upon purge settings in the McLeod application." `changed_values` matches substrings, e.g. `changed_values=status|A|P`.
  Example criterion `change_date_time=>=10/05/2021 143000` (search-criteria dates in `MM/dd/yyyy HHmmss`, with operator prefix).

### EquipStatusService — `services?service=EquipStatusService&role=-1`
- `PUT /equipStatus/create` — role **Drivers only** (as are ALL EquipStatus ops: `/equipStatus/new`, `/search`, `/{id}`,
  `/approvedDriverStatuses`). Body RowDriverStatus; result "the created RowDriverStatus object" + `__eventCodeDescr`, child
  `driver` (by `equipstatus.equipment_id`), `enteredByUser`, `driverManagerUser`. Table name is **`equipstatus`**.
  ⚠ An office `Users` integration login cannot call it per the role list — a driver-role login (or TableRowService
  `PUT /equipstatus/create` as Users) would be needed.

### SymphonyMobileCommService
- `POST /symphonymcmessages/position` (Symphony MC): "Creates a new RowMcPosition"; body `newPosition` typed **String**
  (xml/json); result text/plain. CONFIRMED role. `PUT /symphonymcmessages/driverAvailable` "Update driver available hours" CONFIRMED.

### Movements — `operation=getMovementsByAdvancedSearch`
- All plan claims CONFIRMED verbatim: prefixes (`origin`/`destination` for stop, `driver1`/`driver2`, `tractor`,
  `trailer1..3`), default `movement.id+DESC`, `recordLength`/`recordOffset`, "Result size is limited to 1000 records unless
  specifically configured using the -Dloadmaster.api.maxresultsize vmparam", changedAfterDate "Dates are limited to the audit
  setting and days to keep value in the table properties configuration", changedAfterType "Allowed values: [Add, Update].
  Any other value will result in an exception." NEW: "If no recordLength parameter is provided the search result maximum value
  in the mobile service control file will be applied." `t-1` = "since the beginning of the previous day".

### Stops — `operation=getStop`
- `GET /stops/{id}` (Users, Drivers) returns RowStop + `__statusDescr`, `__typeDescr`, `__loadUnloadDescr`, `__zoneDescr`,
  `__directions`, `__loadingInstructions`, `__unloadingInstructions`; children `referenceNumbers`, `stopNotes`, `location`.
  ⚠ StopService has NO update/clear op (only reads + reference-number/stop-note deletes and `referenceNumbers/new`).

### Callins — `operation=createNewCallin`
- `PUT /callins/create` roles Users, Carriers, Carrier Drivers; body RowCallin; query `latitude`, `longitude`, `accuracy`,
  `velocity`, `course` (Double), `automated` (Boolean, false). `PUT /callins/update` (Users). CONFIRMED.

### Dispatch assign — `operation=assignEquipment`
- Params exactly as plan: `driver1`, `driver2`, `tractor`, `trailer1..3`, `overrideExistingPreassignment`, `overrideLinkedMoves`
  (both Boolean default false). Result text/plain. CONFIRMED.

### Users
- `POST /users/logout` exists (no roles) "Logs the user out." — useful for login-mode token hygiene.

### Money — WRONG
- Plan: "Read only: SettlementService, DeductionService, BillingService". WRONG:
  SettlementService has `PUT /settlements/create`, `POST /settlements/transfer/{transferBy}/{transferIds}`,
  `POST /settlements/reverseTransfer/...`; DeductionService has `PUT /deductions/create`; BillingService has
  `PUT /billing/update`, `POST /billing/postBills`, `POST /billing/transfer/...`, `POST /billing/unTransfer/{orderId}`,
  `PUT /billing/cashReceipts/create`, `PUT /billing/miscBilling/create`.
- PayrollService description CONFIRMED ("getting/posting generic payroll data") but its only op on this install is
  `GET /payroll/deductCodes`. WireService create is `PUT /wires` (plus `POST /wires/validateWire`), not a `/create` path.
- `PUT /movements/{id}/otherPay` "Creates other pay records tied to the movement record." CONFIRMED.

## Batch 4: Image, ImageType, Response, Boolean, Roles, Metadata, ServiceFailure, Alert, VitalSigns, TableRow get, Innovation Hub

- `Image` type (`types?type=com.tms.ws.loadmaster.imaging.Image&role=-1`): fields `id`, `documentTypeId`, `descr`, `scanDate` (Date),
  `imageCount` (int), `appId`, `companyId`. → `GET /images/{rowType}/{rowId}` gives id + category + scan date + page count (D spec MK4.4 read-switch condition 1 answered on paper).
- `ImageType` type: `id`, `description` only.
- `Response` type: "This type has no fields." (text/plain bodies are free text; no structured error schema).
- `Boolean` type: "true - y, yes, t, true, 1, on; false - anything else"; "Omitted values are interpreted as null when the service
  expects a Boolean and false when the service expects a boolean".
- Roles page (`roles?role=-1`): "For the user to access endpoint, the users web user type m[ust] be on endpoint." Roles = LoadMaster web-user types.
  Customers/Carriers: "This role is not yet active/released." Carrier Drivers: "via a load-specific PIN. Requires Carrier App license."
- **Versioning — NEW**: `GET /metadata` (MetadataService, roles include **Not Logged In**): "Information about the current environment such as
  LME version, current user information, enabled companies, API major/minor version, licensing information". `Metadata` type fields:
  `lmeVersion`, `lmeRevision`, `serviceVersion`, `serviceRevision`, `gitRevision`, `companyId`, `company` (List), `currentUser`,
  `deny` (List), `imagingTable` (List), `mobileService`, `mcControl`, … No version string on the docs pages themselves (CONFIRMED).
- ServiceFailureService: `GET /serviceFailures` (criteria e.g. `driver_id=MBROOKS&minutes_late=>60&status=O`), `/new`, `/{id}`,
  `PUT /serviceFailures/create|update`, `POST /serviceFailures/{id}/approve`, `DELETE /serviceFailures/{id}` — lets the agent
  read back whether clearStop created a service failure.
- AlertService = rapid-alert inbox for a user (pull only). VitalSignsService = dashboards. No webhook/callback/subscription op seen
  in any service read. `RemoteNotificationService` and `SysAdminService` pages return **HTTP 500** (3 tries) — UNREADABLE, so "no webhooks"
  is CONFIRMED only for services read.
- TableRowService `GET /{table}/{id}`: params `table`, `id` (path); result `T`; no description.
- Innovation Hub `https://innovationhub.mcleodsoftware.com/apis/`: 16 catalogue entries — MPact, Symphony, Quick-Quote, Order Creation,
  Access Control, Track and Trace, Vehicle Maintenance, Location Matching, McLeod API, Qued, Account Management, Digital Freight Matching,
  DocumentPower, Dispatch Optimization, Order Payables Auditing, Accounts Receivable Financing; 4 marked "Pre-Release". CONFIRMED.
  `/apis/678aa66d002efa0001046043/documentation/` (McLeod API) renders only the Tyk shell — CONFIRMED "renders nothing without login".
  Symphony card: "The posting of driver-captured images into LoadMaster (requires DocumentPower 3rd Party image retrieval)".

---------------------------------------------------------------------------------------------------------------------------

# VERDICT TABLE — MCLEOD-API-SURFACE-2026-11-19.md

Base `B = `<customer-hosted /ws docs>`

| # | Claim | Verdict | URL | Quote / note |
|---|---|---|---|---|
| 1 | Docs public with `?role=-1`, no version string on pages | CONFIRMED | `B?role=-1` | no version text; but `GET /metadata` exposes versions (NEW) |
| 2 | 73 services | **WRONG** (75) | `B?role=-1` | 75 unique `services?service=` links |
| 3 | Basic or Bearer/Token auth; token from Smartphone Mobile Service or `POST /users/login` | CONFIRMED | `B auth?role=-1` | "Bearer 0000… or to Token 0000…"; "This method returns a new token in the body of the response." |
| 4 | login: no roles; accept text/plain or json | CONFIRMED | `B services?service=UserService&operation=login&role=-1` | "only text/plain or application/json are valid"; "The endpoint has no roles." |
| 5 | Token expiry not stated | CONFIRMED (NOT IN DOCS) | auth page | only "you can always delete it and generate a new one" |
| 6 | Headers Authorization, Accept (XML default), AnywhereCompanyID; login shows X-com.mcleodsoftware.LicensingAgent | CONFIRMED | home + login op | "XML is our default if this header is unset." AnywhereCompanyID in every Try-Out; LicensingAgent also on documentTypes op |
| 7 | X-Api-Key / X-Mcld-Tenant not on /ws | CONFIRMED (absent from all pages read) | — | — |
| 8 | movements/search prefixes, orderBy default movement.id DESC, recordLength/Offset | CONFIRMED | `B services?service=MovementService&operation=getMovementsByAdvancedSearch&role=-1` | "a default sort of movement.id+DESC" |
| 9 | 1000 cap / -Dloadmaster.api.maxresultsize | CONFIRMED | same | verbatim |
| 10 | changedAfterDate (t-1) + changedAfterType Add/Update, limited by audit days-to-keep | CONFIRMED | same | "Allowed values: [Add, Update]. Any other value will result in an exception." |
| 11 | No webhooks on /ws | CONFIRMED for every service read; RemoteNotificationService/SysAdminService UNREADABLE (500) | — | — |
| 12 | clearStop: Users; text; all params & defaults; response text/plain | CONFIRMED | `B services?service=DispatchService&operation=clearStop&role=-1` | see batch 2 |
| 13 | /dispatch/{stopId}/arrive|depart|start|complete Drivers, LTL only | CONFIRMED | DispatchService page | "Currently, this only works for LTL movements." |
| 14 | GET /stops/{id}, /referenceNumbers, /stopNotes | CONFIRMED | StopService page | — |
| 15 | No stop ETA write in Dispatch/Stop/Movement/SMCS | CONFIRMED (no op) — but RowStop HAS `eta` and RowCallin HAS `new_eta` (NEW) | RowStop / RowCallin types | — |
| 16 | dispatch/assign params | CONFIRMED | `...operation=assignEquipment` | — |
| 17 | dispatch cancel/changeEquipment/clearPreassignments/reconsign/split/unsplit/moveTrailer/locateTractor | CONFIRMED (split path param is `{splitBeforeStopId}`) | DispatchService | — |
| 18 | movements GET list/search/{id}/route | CONFIRMED | MovementService | — |
| 19 | orders reads incl. positions, deliveryReceipt (PDF) | CONFIRMED | OrderService | "Retrieves a delivery receipt, in PDF format" |
| 20 | orders create/update/updateRow/copy/duplicate; updateRow quote | CONFIRMED (create/update roles Users, **Customers**) | OrderService | verbatim |
| 21 | Images reads + documentTypes | CONFIRMED | ImagingService | — |
| 22 | POST /images/{rowType}/{rowId}/{documentTypeId} roles Users, Drivers, Carriers, Carrier Drivers; staging quote | CONFIRMED | `...operation=addImage` | verbatim |
| 23 | multipart / symphony upload = Symphony MC | CONFIRMED | ImagingService | — |
| 24 | Drivers reads incl. /new, /{id}/assignments|current|lastStop|preassignments | CONFIRMED | DriverService | — |
| 25 | PUT /drivers/create (Users), body RowDriver, flow new→create | CONFIRMED | `...operation=createDriver`, `...operation=newDriver` | "callers … can edit the returned object and then pass it back to the create method" |
| 26 | No driver update in DriverService; use TableRowService PUT /driver/update | CONFIRMED (path is generic `PUT /{table}/update`) | DriverService, TableRowService | — |
| 27 | RowDriver field list; none marked required | CONFIRMED (all listed fields present; no required markers) | `B types?type=com.tms.common.loadmaster.tablerows.RowDriver&role=-1` | — |
| 28 | PUT /equipStatus/create (Drivers) creates RowDriverStatus | CONFIRMED — and NOTE every EquipStatus op is Drivers-only | EquipStatusService | "Creates a new RowDriverStatus record for the given data." |
| 29 | Tractors/trailers reads + /trailers/near | CONFIRMED | TractorService/TrailerService | — |
| 30 | PUT /tractors/update, /trailers/update (Users), body RowTractor/RowTrailer | CONFIRMED | `...operation=updateTractor` / `updateTrailer` | — |
| 31 | Status = `status`, `service_status`, `inservice_date`, `outservice_date` on the row | CONFIRMED for RowTractor; **WRONG for RowTrailer** (no `status`/`service_status`; has `is_active`, `statuscode`, `disposition_code`, in/outservice_date) | RowTractor / RowTrailer types | — |
| 32 | TableRowService ops; auditing/permissions/validation | CONFIRMED (+ `/new`, `/unvalidatedsearch`, `/{orderBy}/search`, static `POST /{table}/{method}`) | TableRowService | "makes sure that auditing, permissions and validation code runs before making changes" |
| 33 | AuditTransactionService GET /auditTransactions/search (R) | CONFIRMED — role Users; **retains ONE day** | `...operation=getAuditLogTransactionsByAdvancedSearch` | "only retains one day of transactions based upon purge settings" |
| 34 | CallinService PUT /callins/create|update | CONFIRMED | CallinService | — |
| 35 | SMCS role Symphony MC; driverAvailable = available hours | CONFIRMED ("Update driver available hours") | SymphonyMobileCommService | — |
| 36 | "Read only: SettlementService, DeductionService, BillingService" | **WRONG** | those service pages | settlements create/transfer/reverseTransfer; deductions create; billing update/postBills/transfer/unTransfer/cashReceipts/miscBilling create |
| 37 | PayrollService "getting/posting generic payroll data" | CONFIRMED description; only op is GET /payroll/deductCodes | PayrollService | — |
| 38 | WireService (create advances) | CONFIRMED-ish: create is `PUT /wires` (+ `POST /wires/validateWire`) | WireService | "Creates a new unposted wire record." |
| 39 | PUT /movements/{id}/otherPay | CONFIRMED | MovementService | — |
| 40 | No GL/ledger/AP voucher/fuel service | CONFIRMED (none among 75) | index | — |
| 41 | Innovation Hub catalogue list; docs need login | CONFIRMED (16 entries, 4 Pre-Release) | `https://innovationhub.mcleodsoftware.com/apis/` | — |
| 42 | "Still unread": RowStop, RowTrailer, types index, tractors/update, orders/create, auditTransactions/search, equipStatus/create, symphonymcmessages/position | ALL NOW READ | — | see batches 2–3 |

# VERDICT — /ws claims in the four specs (api-kit-specs/*)

| Spec claim | Verdict | Note |
|---|---|---|
| A §6.1 `clearStop?arrivalDate=&departureDate=` one call both dates | CONFIRMED params exist | departure-only acceptance NOT IN DOCS (A:547, C U10) |
| C: auth / headers / paging / 1000 cap / changedAfter / no webhooks | CONFIRMED | see table above |
| C §3.2 login answer "string or {token}" | CONFIRMED plausible: result text/plain OR application/json "the access token" | json shape NOT IN DOCS |
| C E9 / U9–U11 clearStop: date format, TZ, arrival-only, already-cleared, required SF fields | Date format ANSWERED (`yyyyMMddHHmmssZ` when `loadmaster.ws.useServerTimezone=false`, else `yyyyMMddHHmmss`; <other-customer /ws> = false); rest NOT IN DOCS | no param is marked required; `delayCode` only "if one should be created" |
| C step 5 / U12 RowStop key list from one `GET /stops/{id}` | RISK | null fields are OMITTED — a sample stop will lack unset keys; use the type page list instead: `actual_arrival`, `actual_departure`, `status`, `eta` |
| C step 8 version via `Server` header / docs string | WRONG approach | use `GET /metadata` → `lmeVersion`/`lmeRevision`/`serviceVersion`/`serviceRevision`/`gitRevision` |
| C allowlist `/dispatch/clearStop/[A-Za-z0-9]+` | OK on paper | stop id String(32) |
| C audit check after apply via `/auditTransactions/search` | CONFIRMED op; ⚠ one-day retention | must run same day |
| C E6 "audit days to keep" | consistent | movements doc: changedAfter limited by "audit setting and days to keep value in the table properties" (distinct from audit_log_tx 1-day purge) |
| D MK4.1 rowType spelling `{O, orders, order}` | ANSWERED: `O` | "O - Order, M - Movement, … D - Driver, T - Tractor, E - Trailer" |
| D MK4 step 4 body raw vs multipart | ANSWERED: raw body, Content-Type one of jpeg/gif/tiff/png/bmp/pdf; multipart is Symphony MC only | no filename param; optional `movementId` query |
| D "POST response returned an image id" | PARTLY: result String = "batch ID (if staged …) or the ID of the record stored" | cannot tell which from the response |
| D MK4.4 image list fields (id, category, date) | ANSWERED: `id`, `documentTypeId`, `descr`, `scanDate`, `imageCount` | — |
| D `RowDriver` has `license_date`; `reason_for_leaving` width | ANSWERED: yes (Date,10); width **3** | — |
| D `drivers/search` licence param | ANSWERED: `driver.license_no` or `license_no` | — |
| D drivers/create required fields; SSN required | NOT IN DOCS | — |
| D-MK5-0b update mode (partial vs full) | ANSWERED on paper: omitted fields "are not nulled out"; send `"NULL"` to null | types?type=null page |
| D MK5.3 RowTractor sub-status key | ANSWERED: `status` (2) + `service_status` (1); no `tractor_status` | — |
| D MK5.3 RowTrailer active key | ANSWERED: `is_active` (1) and `statuscode` (4) | — |
| D MK6.1 callin carries next-stop ETA | ANSWERED: RowCallin `new_eta` + `current_stop_id` | effect on stop.eta NOT IN DOCS |
| D MK6.1 `PUT /stop/update` with `eta` | `eta` exists on RowStop; TableRowService update exists; writability NOT IN DOCS | table name `stop` (`__type":"stop"`) |
| D home time `PUT /equipStatus/create` | CONFIRMED op; **role Drivers only** | Users integration login likely 403; alt: TableRowService `PUT /equipstatus/create` |
| D RowDriverStatus 90-day read "TableRowService table" | ANSWERED: table `equipstatus`; or `GET /equipStatus/search` (Drivers) | keyed `equipment_id`+`equipment_type_id`, codes in `event_code` |
| D §finance "settlements read-only" | **WRONG** (see #36) | — |
| D ≤1000 rows per call | CONFIRMED | — |

# New facts the plan must use
1. Date params: `yyyyMMddHHmmssZ` (e.g. `20261120143000-0600`) when vmparam `loadmaster.ws.useServerTimezone=false`; `yyyyMMddHHmmss` (server TZ) when true. Read OUR Date page. Response dates same form (`"20160816170100-0500"`). Shortcuts `n`, `t`, `t-1`, `t1 1330` documented for request bodies. Search-criteria values take operators: `last_home_date=<=t-30`, `minutes_late=>60`, `change_date_time=>=10/05/2021 143000`, wildcard `WARE*`.
2. Nulls: responses OMIT null fields; requests: omitted = unchanged, `"NULL"` = set null. JSON rows carry `"__type":"<table>"` (`stop`, `driver`, …); `__xxxDescr` keys are decorations.
3. Booleans: `Y`/`yes`/`t`/`true`/`1`/`on` = true.
4. RowStop keys: `actual_arrival`, `actual_departure`, `eta`, `projected_arrival`, `planned_arrival_time`, `sched_arrive_early`, `sched_arrive_late`, `status`(1), `operational_status`, `prior_uncleared_stops`, `movement_sequence`, `order_id`, `stop_type`, `hub`. `GET /stops/{id}` adds `__statusDescr`, `__typeDescr`.
5. Images: rowType = one letter (`O` order, `M` movement, `D` driver, `T` tractor, `E` trailer, `P` payee, `C`, `L`, `U`). Upload = raw body with image/pdf Content-Type; optional `movementId`; response String = batch ID or record ID. List returns `Image{id, documentTypeId, descr, scanDate, imageCount}`; types return `ImageType{id, description}`.
6. Trailers: `is_active`, `statuscode`, `disposition_code` — not `status`. Tractors: `status`, `service_status`.
7. RowDriver: `license_date` exists; `reason_for_leaving` is a 3-char code; `id` ≤ 8; `social_security_no` (24) present.
8. EquipStatusService is Drivers-role only; table is `equipstatus`; fields `equipment_id`, `equipment_type_id`, `event_code`, `start_date`, `end_date`, `remark`(100).
9. RowCallin `new_eta` + `current_stop_id`; callins/create query `latitude`, `longitude`, `accuracy`, `velocity`, `course`, `automated`.
10. `auditTransactions/search` → `RowAuditLogTx{table_name, primary_key_values, changed_values, change_date_time(_utc), user_id, transaction_id}`; filters `excludeAdd/Delete/Update`; **audit_log_tx keeps one day**.
11. Without `recordLength` the cap is "the search result maximum value in the mobile service control file".
12. Version: `GET /metadata` (callable not logged in) → `lmeVersion`, `lmeRevision`, `serviceVersion`, `serviceRevision`, `gitRevision`, enabled companies.
13. ServiceFailureService (`GET /serviceFailures?...`) can read back a clearStop-created service failure; `POST /users/logout` exists.
14. Errors: only "HTTP 401" on missing auth and "a response object containing an HTTP response code and string" (text/plain). `Response` type has no fields. No error schema documented.

# Still unreadable / not in docs
- UNREADABLE (HTTP 500, retried): `B services?service=RemoteNotificationService&role=-1`, `B services?service=SysAdminService&role=-1`.
- NOT IN DOCS: token lifetime; clearStop departure-only / next-stop requirement / second-call behaviour / error codes; TableRowService optimistic concurrency; per-field writability; drivers/create required fields & SSN; login JSON shape; error body schema; whether `t-1` shortcuts are valid in query params (Date page says "request body"; movement page uses `changedAfterDate=t-1` in a query, so yes in practice for that param).
- Not fetched (not needed): other 50+ service pages; Innovation Hub per-product docs (login-gated).
