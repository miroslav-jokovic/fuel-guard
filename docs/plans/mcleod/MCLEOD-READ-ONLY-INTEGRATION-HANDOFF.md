# McLeod read-only integration handoff

**Status:** implementation handoff for drivers, tractors, and trailers  
**Sandbox verification:** 2026-08-24  
**Target calculation:** read-only extraction from McLeod into FuelGuard  
**Write policy:** no SQL writes, no DDL, no stored-procedure execution, no direct McLeod mutations

## Purpose

This document consolidates the facts needed to implement the read-only McLeod roster integration without repeatedly reconnecting to the sandbox. It records verified sandbox behavior, the exact roster contract, security requirements, change-detection options, known data-quality findings, and the small set of production-only checks that cannot be replaced by documentation.

The authoritative implementation plan remains `MCLEOD-ROSTER-SYNC-PLAN.md`. This document is the operational handoff and correction log.

## 1. Verified environment facts

### 1.1 Sandbox database

| Fact | Verified result |
|---|---|
| SQL Server | Microsoft SQL Server 2019 Enterprise, version 15.0.2120.1 |
| Server name | `APPNEW` |
| Database | `lme_analytics` |
| Database state | `ONLINE` |
| Recovery model | `SIMPLE` |
| Database read-only flag | Off; the database itself is technically `READ_WRITE` |
| Connection authentication | SQL authentication |
| Current login | `NikiAnalytics` |
| Current database role | `db_datareader` |
| Explicit permission observed | Database `CONNECT`; table reads come from the role |
| Server admin roles | No `sysadmin`, `securityadmin`, or `serveradmin` membership |
| Application data schema | `dbo` |

The database is an isolated sandbox restored from backup, not a live production source. Restore history recorded:

- Backup completion: 2026-08-21 09:43
- Database restore completion: 2026-08-21 09:46
- Source server: `APPNEW`

Production is a separate database named `lme` on the same SQL Server instance. The current login does not have access to production. A production connection and acceptance test are therefore still required before cutover.

### 1.2 Network and encryption

The sandbox was reachable from the inspection environment over TCP 1433 using the documented SQL login. The connection used SQL authentication and `ApplicationIntent=ReadOnly`.

A verified encrypted connection attempt failed because SQL Server presented a non-compliant self-signed fallback certificate. The current direct test therefore connected without encryption. This is acceptable only as a temporary trusted-LAN sandbox test.

Production requirement:

1. Give the agent a DNS name matching a trusted SQL Server certificate and keep encryption enabled, or
2. Explicitly approve a private-LAN non-encrypted connection for the agent after a security review.

The preferred production choice is a trusted certificate and hostname. The agent must not silently downgrade encryption.

## 2. Correct company and roster scope

### 2.1 Company-key correction

`dbo.company.company_id` is the LoadMaster instance/parent code and is `TMS` on all four company rows. The operating-company discriminator used by the roster tables is `dbo.company.id`.

Correct relationship:

```text
dbo.company.id
  -> dbo.driver.company_id
  -> dbo.tractor.company_id
  -> dbo.trailer.company_id
```

The carrier is:

```text
Operating company: TMS
Legal name:        Silvicom, Inc.
```

Correct carrier totals:

- All drivers: 1,463
- All tractors: 646
- All trailers: 404

The agent setting must be the operating company ID:

```text
MCLEOD_COMPANY_ID=TMS
```

The value belongs in configuration, not as a hard-coded production constant.

### 2.2 Active roster predicates

The verified predicates are:

```sql
-- drivers
company_id = @companyId
AND is_active = 'Y'

-- tractors
company_id = @companyId
AND service_status = 'A'
AND outservice_date IS NULL

-- trailers
company_id = @companyId
AND is_active = 'A'
AND outservice_date IS NULL
```

Verified active counts for `TMS`:

- Drivers: 164
- Tractors: 190
- Trailers: 235

Do not use only `termination_date IS NULL` or `outservice_date IS NULL`; those broader predicates overstate the active roster.

### 2.3 Retirement predicates

Retirement is a separate, guarded operation:

- Driver retirement: `is_active <> 'Y' OR is_active IS NULL`
- Tractor retirement: `service_status <> 'A' OR outservice_date IS NOT NULL`
- Trailer retirement: `is_active <> 'A' OR outservice_date IS NOT NULL`

A normal roster sweep must not treat a short/failed result as a mass retirement. Retirement should be explicit, audited, and protected by the existing mass-deactivation guard.

## 3. Exact read-only field contract

The SQL Server agent is the only component that should know McLeod column names. The API receives provider-neutral records.

### 3.1 Link/match mode

The first mode should read only fields required to match existing FuelGuard records.

#### Drivers

- `driver.id`
- `driver.company_id`
- `driver.license_no`
- `driver.license_state`
- `driver.first_name`
- `driver.name_mid_initial`
- `driver.name`

#### Tractors

- `tractor.id`
- `tractor.company_id`
- `tractor.serial_number`

#### Trailers

- `trailer.id`
- `trailer.company_id`
- `trailer.serial_number`

No date of birth, home address, SSN, contact, payroll, or unrelated personnel fields should be read in link mode.

### 3.2 Identity mode

Identity mode may read only the reviewed identity fields.

#### Drivers

- Active status
- Hire/termination dates
- CDL expiry
- Medical-card expiry
- Name components
- Address fields if the business explicitly approves them
- Approved contact source only after semantic confirmation

Do not read or send:

- `social_security_no`
- Race
- Sex
- Spouse/family fields unless a documented carrier-specific mapping is approved
- Payroll or banking fields
- Credentials

#### Tractors

- Unit ID
- VIN/serial number
- Make/model/year
- Plate and plate state
- Registration expiry
- Annual inspection performed date
- Purchase date

#### Trailers

- Unit ID
- VIN/serial number
- Trailer type
- Make/year
- Plate and plate state
- Annual inspection performed date
- Purchase date
- Axle count

## 4. Verified field semantics and quality

### 4.1 Driver fields

- `driver.name` is the surname only, not `LAST, FIRST`.
- Compose full name from `first_name`, `name_mid_initial`, and `name`.
- `driver.status_code` is null for all rows and is not usable.
- `is_active = 'Y'` is the active predicate.
- All 164 active drivers have a CDL number.
- All 164 active drivers have a future `license_date`; it behaves as CDL expiry.
- All 164 active drivers have a future `medical_cert_expire`.
- All 164 active drivers have a future `mvr_date`; it behaves as the next MVR due date, not the last MVR pull.
- `physical_date` matches `medical_cert_expire` for all active drivers and should not be imported as a second fact.
- The active-driver set has no populated `email`, `cell_phone`, or `phone` fields.
- The carrier-specific `name_of_spouse` field contains email-shaped values for all active drivers, but this is a semantic/privacy exception and must not be used without explicit carrier approval. Fourteen active values reach the 28-character storage limit and may be truncated.
- The database contains populated SSNs; the roster agent must never select them.

### 4.2 Tractor fields

- `tractor.id` is the human-recognized unit number.
- `service_status = 'A'` plus no `outservice_date` is the verified active predicate.
- `inspection_date` is the date the annual inspection was performed, not an expiry date.
- Derive an expiry only in FuelGuard if the business rule explicitly approves a one-year interval.
- `tag_expire_date` behaves as a registration/plate expiry date.
- Active tractors have sufficient VIN shape for matching, but retired tractors contain duplicate serial/VIN values.
- Match VIN only against active tractors.
- `fuel_capacity`, dispatch fields, current hub, driver assignments, and telemetry are not blindly overwritten by roster sync.

### 4.3 Trailer fields

- `trailer.id` is the unit number, but FuelGuard reefer trailers use a leading `R` that McLeod does not use.
- Strip one leading `R` for matching only; do not rename the stored FuelGuard unit automatically.
- `trailer_type = 'R'` is the verified reefer signal for this carrier.
- `reefer_id`, `min_temp`, `max_temp`, and `heater_code` are empty for active carrier trailers.
- `inspection_date` is the inspection-performed date.
- `is_active = 'A'` plus no `outservice_date` is the verified active predicate.
- `statuscode` and `disposition_code` are not populated sufficiently to replace the active predicate.

## 5. Change detection and audit behavior

### 5.1 No row-version shortcut

There are no `rowversion`/`timestamp` columns on the roster tables and no general row-modified timestamp suitable for a watermark query.

### 5.2 Change Tracking

SQL Server Change Tracking is enabled:

- 91 tables tracked
- `driver`, `tractor`, and `trailer` tracked
- Column-change tracking enabled on all three
- Retention: 10 days
- Automatic cleanup enabled
- CDC disabled

The current login cannot read Change Tracking:

```text
VIEW CHANGE TRACKING permission denied
```

Production request:

```text
GRANT SELECT on the approved roster columns
GRANT VIEW CHANGE TRACKING on dbo.driver
GRANT VIEW CHANGE TRACKING on dbo.tractor
GRANT VIEW CHANGE TRACKING on dbo.trailer
```

Change Tracking identifies row/column changes but does not identify the user, application, SQL login, or source host.

### 5.3 Full-table hash diff

The current design should use a full-table hash diff over the approved mapped fields:

- It reads only 589 active rows for the verified sandbox predicates.
- It ignores noisy fields such as `event_date`.
- It detects additions, field changes, and disappearance from the active predicate.
- It does not require Change Tracking permission.
- It is the recovery mechanism after a snapshot restore or a synchronization outage longer than CT retention.

Change Tracking can later reduce the number of rows re-read, but it should not be the only recovery method.

### 5.4 McLeod audit log

The database has enabled DML audit triggers on `driver`, `tractor`, and `trailer` for insert/update/delete. The audit tables contain:

- Table name
- Primary-key values
- Changed values
- Change timestamp
- User ID
- Application ID
- Transaction ID
- SQL statement field

In inspected roster audit rows, user/application IDs were populated, but the SQL statement field was empty. Audit-log volume is noisy, especially for drivers, because a system heartbeat field generates approximately hundreds of thousands of audit rows per day.

The audit exclusion table omits several dispatch telemetry/home-time fields. Audit log is therefore useful for history and troubleshooting, but not a complete source of truth for roster synchronization.

### 5.5 SQL Server server-level monitoring

In the sandbox:

- No SQL Server Audit objects were listed.
- No server/database audit specifications were listed.
- No event notifications were listed.
- Query Store is disabled.
- Only standard `system_health` and telemetry Extended Event sessions were visible.
- Default trace status could not be inspected with the current login.

Production may differ. This is one of the reasons the production DBA must confirm monitoring separately.

## 6. FuelGuard agent implementation contract

### 6.1 Boundary

```text
McLeod SQL Server
  -> tools/mcleod-agent only
  -> explicit SELECT allowlist
  -> neutral roster contract
  -> outbound HTTPS ingest
  -> FuelGuard API
```

`apps/api` must not contain a SQL Server client or McLeod column names. The agent is the only vendor-schema boundary.

### 6.2 Connection settings

Required out-of-band configuration:

- SQL server hostname
- SQL port, normally 1433
- Database name
- Dedicated read-only SQL user
- Secret-managed password
- Operating company ID
- Encryption setting
- Certificate server name if the SQL endpoint is an IP
- Statement timeout

Use `ApplicationIntent=ReadOnly` as advisory routing intent. It does not enforce read-only permissions.

### 6.3 Required protections

- Use a dedicated service login, not the shared human analyst login.
- Do not use `db_datareader` in production; it exposes all columns including PII and credentials.
- Prefer approved read-only views or explicit column-level grants.
- Keep SQL queries parameterized and company-scoped.
- Set a statement timeout.
- Keep connection pool size small.
- Use a trusted SQL certificate in production.
- Never use `SELECT *`.
- Never execute stored procedures, DDL, or DML.
- Do not log raw rows, passwords, SSNs, licenses, addresses, or SQL credentials.

### 6.4 Current source-code risks to resolve before production

1. The agent’s identity mode maps `driver.name_of_spouse` to email because of a carrier-specific observed convention. This is sensitive and semantically unsafe without written approval; make it an explicit configuration switch or remove it from the default contract.
2. The agent configuration defaults `trustServerCertificate` to true. Encryption without certificate validation is not sufficient for production. Require a trusted certificate and default certificate trust to false.
3. The example configuration contains the sandbox SQL host/database shape. Keep real credentials out of the repository and secret storage configuration.
4. The sandbox credentials and internal database map require rotation and repository-history review before publication.
5. The roster agent currently supports SQL roster reads, while the movement/time-off path remains separate. Do not assume a roster SQL connection also solves movement or time-off extraction.

## 7. Data that remains production-only

No amount of sandbox documentation can prove these facts about production:

1. The production `lme` database is reachable from the agent host.
2. The production schema matches the sandbox schema.
3. The production database is SQL Server rather than another supported backend.
4. The production database is live or has a known refresh lag.
5. The production login has only the intended column permissions.
6. The production login has `VIEW CHANGE TRACKING` on the three roster tables.
7. The production SQL certificate is trusted and matches the configured hostname.
8. Production Change Tracking retention and cleanup settings match the sandbox.
9. Production audit triggers and exclusions match the sandbox.
10. The carrier approves the exact fields, especially address, date of birth, email convention, and qualification dates.

These require one controlled production acceptance test by the carrier DBA/IT team. They do not require repeated exploratory reconnects after the contract is confirmed.

## 8. Final implementation checklist

Before enabling the integration:

- [ ] Dedicated production read-only login created.
- [ ] Explicit column allowlist approved.
- [ ] No `db_datareader` granted to the production agent.
- [ ] `VIEW CHANGE TRACKING` granted for driver/tractor/trailer if CT optimization is desired.
- [ ] Production SQL certificate and hostname validated.
- [ ] Production database freshness/restore cadence documented.
- [ ] Carrier operating company set to `TMS` through configuration.
- [ ] Active counts reported and approved: 164 drivers, 190 tractors, 235 trailers for sandbox.
- [ ] Driver CDL match report reviewed.
- [ ] Tractor VIN duplicate handling limited to active rows.
- [ ] Trailer leading-`R` matching rule enabled.
- [ ] Identity-mode email convention approved or disabled.
- [ ] `event_date` excluded from all hashes and outbound payloads.
- [ ] Retirement sweep remains separate and mass-deactivation guarded.
- [ ] Dry-run output reviewed for sensitive data.
- [ ] One production smoke query completed by IT.
- [ ] Agent freshness and unmatched-record alerts enabled.

## Final position

The sandbox inspection has answered the implementation questions that can be answered safely from this environment. The read-only roster integration is implementable without the McLeod API, using an on-premises agent and an explicit SQL allowlist.

The remaining blockers are not additional exploratory analysis. They are carrier/DBA approvals and production acceptance facts: production access, least-privilege grants, trusted TLS, refresh cadence, and approval of the final field contract.
