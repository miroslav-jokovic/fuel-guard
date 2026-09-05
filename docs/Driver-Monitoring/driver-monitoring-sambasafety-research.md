# Driver Monitoring / Safety Intelligence Module
## Research, Architecture, and Implementation Plan for a SambaSafety-Like Internal System

**Status:** Implementation design  
**Research date:** September 4, 2026  
**Primary use case:** Internal motor-carrier driver monitoring, with architecture capable of later multi-tenant/commercial expansion  
**Implementation target:** Existing enterprise TMS / safety platform, built and maintained with Claude Code

---

# 1. Executive Summary

The correct way to reproduce the most valuable SambaSafety driver-monitoring capabilities is **not** to build one giant web scraper.

The correct system is a **Driver Safety Intelligence Aggregator** with multiple source adapters:

1. **Official DMV / Employer Notification Service (ENS) feeds** for authoritative license status, convictions, crashes, suspensions, revocations, and MVR changes.
2. **AAMVA / CDLIS employer verification where available** for CDL identity/status verification.
3. **FMCSA sources** for PSP, inspections, crashes, Clearinghouse, and other regulated commercial-driver data.
4. **Court monitoring** for early detection of citations, cases, adjudicated violations, and dispositions before or in addition to MVR reporting.
5. **Telematics / camera data** for leading indicators such as speeding, harsh events, distracted driving, crashes, and unsafe behavior.
6. **Internal carrier data** for claims, incidents, training, disciplinary actions, preventability determinations, and driver qualification records.

The scraper is only one ingestion mechanism inside this system.

The core architecture should therefore be:

```text
                     DRIVER SAFETY INTELLIGENCE

 State ENS/API/SFTP -----------\
 State MVR Pull ----------------\
 AAMVA/CDLIS -------------------\
 FMCSA/PSP ----------------------> Source Adapter Layer
 Clearinghouse -----------------/          |
 Court APIs/Bulk Data ----------/           |
 Court Public Portals ----------/            v
 Telematics --------------------/      Raw Observation Store
 Internal Safety Data ----------/            |
                                             v
                                    Parsing + Normalization
                                             |
                                             v
                                      Identity Resolution
                                             |
                                             v
                                      Event Correlation
                                             |
                                             v
                                  Driver Safety Event Ledger
                                             |
                            +----------------+----------------+
                            |                                 |
                            v                                 v
                       Risk Engine                      Alert Engine
                            |                                 |
                            +----------------+----------------+
                                             v
                                      Safety Dashboard
```

The most important design rule is:

> **Sources are replaceable adapters. Driver safety events are the product.**

A court website may change. A DMV may add an API. A state may move from HTML to SFTP. A vendor may become available. None of those changes should affect the rest of the application.

---

# 2. What SambaSafety Appears to Be Doing

SambaSafety publicly states that its Risk Cloud consolidates information from **more than 3,000 integrated data sources**, including:

- state DMVs;
- FMCSA data;
- telematics and cameras;
- local court records;
- crash and claims data.

Samba specifically describes its local-court layer as containing **court-adjudicated traffic violations, dispositions, and related public records** and says violation codes and data formats are normalized across jurisdictions.

Samba's monitoring terms also describe U.S. MVR monitoring as a combination of **DMV connections and third-party data sources** that trigger an MVR when new activity is detected.

This strongly supports the following architecture hypothesis:

```text
Authoritative state feeds + public/court feeds + commercial data feeds
                              |
                              v
                     Normalized data platform
                              |
                              v
                        Driver identity graph
                              |
                              v
                       Change/event detection
                              |
                              v
                         Risk intelligence
```

It should **not** be assumed that Samba literally scrapes every municipality. Its public material does not establish that. A large commercial platform normally combines direct feeds, public data, state integrations, bulk datasets, and third-party providers.

### Sources

- SambaSafety Risk Cloud: https://sambasafety.com/capabilities/risk-cloud
- SambaSafety Driver Monitoring: https://sambasafety.com/capabilities/driver-monitoring/
- SambaSafety Monitoring Terms: https://sambasafety.com/msa/

---

# 3. Critical Regulatory / Data-Access Findings

## 3.1 FMCSA Employer Notification Services should be the primary MVR-monitoring path

FMCSA describes Employer Notification Services (ENS) as systems that can automatically notify employers when:

- a driver's license status changes;
- a crash is posted;
- a conviction is posted.

FMCSA also states that use of appropriate push-style ENS can satisfy the motor carrier's annual inquiry requirement under 49 CFR 391.25.

FMCSA's current motor-carrier guidance still describes approximately 18 states with ENS implementations and provides historical state-by-state implementation information.

### Why this matters

For any state that provides an authorized ENS or equivalent employer-monitoring program, **use it instead of scraping the DMV website**.

Benefits:

- authoritative records;
- better legal footing;
- fewer false positives;
- predictable data structure;
- push notifications rather than polling;
- less operational fragility;
- may satisfy regulatory record-review obligations.

### Sources

- FMCSA states / ENS overview: https://www.fmcsa.dot.gov/registration/commercial-drivers-license/states
- FMCSA motor-carrier ENS guidance: https://www.fmcsa.dot.gov/registration/commercial-drivers-license/motor-carriers
- FMCSA ENS guidance on annual review: https://www.fmcsa.dot.gov/regulations/federal-register-documents/2015-05645

---

## 3.2 CDLIS is important, but it is not an open national MVR API

AAMVA describes CDLIS as the nationwide system used by state driver licensing agencies to maintain one commercial-driver record and exchange:

- convictions;
- withdrawals;
- disqualifications;
- status/history information.

AAMVA's current private rate catalog also describes **CDLIS Third Party Access for CDLIS Employers Verification**, providing limited employer/prospective-employer access to basic identification data through a third-party inquiry transaction.

This is valuable for identity verification and CDL validation, but it should **not** be treated as a general unrestricted nationwide driver-history API.

### Sources

- AAMVA CDLIS: https://www.aamva.org/technology/systems/driver-licensing-systems/cdlis
- AAMVA Private Rate Schedule (2025/2026 catalog referenced from AAMVA CDLIS page)

---

## 3.3 Driver Privacy Protection Act (DPPA)

18 U.S.C. § 2721 restricts disclosure/use of personal information from state motor-vehicle records, but expressly provides several permissible uses.

For commercial-driver employment, an especially relevant provision is § 2721(b)(9), which allows use by an employer, agent, or insurer to obtain or verify information relating to a CDL holder where required under Chapter 313 of Title 49.

Other permitted-use provisions and state-specific rules may also apply.

**Implementation consequence:** every DMV-derived request must record its legal/permitted purpose. Do not build generic unrestricted DMV searching.

### Source

- 18 U.S.C. § 2721: https://www.law.cornell.edu/uscode/text/18/2721

---

## 3.4 FCRA / employment-use controls

The FTC explains that employment background reports obtained through a company in the business of compiling background information can trigger FCRA requirements. Employers also have federal nondiscrimination obligations regardless of how they obtained background information.

If this platform is later offered commercially to other employers, the legal analysis becomes significantly more important because the product could potentially function as a consumer reporting agency depending on the service and data flow.

For the internal system, we should still implement:

- source provenance;
- driver consent/authorization records where applicable;
- dispute workflow;
- corrections;
- human review;
- immutable decision audit trail;
- policy-driven adverse-action handling;
- no automatic termination decisions from scraped data.

### Sources

- FTC: https://www.ftc.gov/business-guidance/resources/background-checks-what-employers-need-know
- FTC FCRA: https://www.ftc.gov/legal-library/browse/statutes/fair-credit-reporting-act
- EEOC criminal-record guidance: https://www.eeoc.gov/laws/guidance/enforcement-guidance-consideration-arrest-and-conviction-records-employment-decisions

---

# 4. Recommended Product Boundary

Create a bounded module named something like:

```text
DriverMonitoring
```

or

```text
SafetyIntelligence
```

Recommended internal subdomains:

```text
SafetyIntelligence
├── Enrollment
├── Sources
├── Collection
├── RawEvidence
├── IdentityResolution
├── Normalization
├── EventCorrelation
├── DriverEvents
├── RiskScoring
├── Alerts
├── HumanReview
├── Compliance
└── SourceHealth
```

Do **not** put jurisdiction-specific scraping logic directly into the domain/business layer.

---

# 5. Recommended Technology Architecture

## 5.1 Main application

If the existing TMS backend is C#/.NET modular monolith, keep the authoritative business/domain layer in .NET.

Recommended responsibilities in .NET:

- driver master data;
- source registry;
- monitoring enrollment;
- canonical event schema;
- normalization dictionaries;
- correlation;
- risk engine;
- alert workflow;
- case review;
- compliance/audit;
- APIs/UI.

## 5.2 Scraping / acquisition worker

Use a **separate Python worker** for web acquisition rather than embedding Python scraping deeply into the .NET process.

Recommended stack:

- Python 3.12+
- Scrapling for adaptive HTML extraction / crawling
- Playwright for JavaScript-heavy authorized public portals
- httpx for simple HTTP APIs/downloads
- pydantic for strict source-output contracts
- pytest for adapters
- OpenTelemetry for tracing

### Why separate it

Web scraping has a different failure and dependency profile from the TMS:

- browser binaries;
- JS/runtime issues;
- parser failures;
- site blocking;
- page redesigns;
- long-running fetches;
- jurisdiction-specific changes.

Keeping it isolated prevents a broken court portal from degrading the TMS.

## 5.3 Communication

Recommended approach:

```text
.NET SafetyIntelligence module
            |
            | enqueue CollectionJob
            v
       Durable Queue
            |
            v
   Python Collector Worker
            |
            | RawObservation + artifacts
            v
        Ingestion API
            |
            v
    PostgreSQL / Object Store
```

Use your existing durable job infrastructure if one already exists. Do not introduce Kafka/RabbitMQ merely for this module unless the project already standardizes on it.

For an MVP, a PostgreSQL-backed job table with `FOR UPDATE SKIP LOCKED` is sufficient and keeps the modular monolith operationally simple.

---

# 6. Source Adapter Contract

Every source must implement a common contract.

Conceptually:

```csharp
public interface IDriverMonitoringSource
{
    string SourceKey { get; }
    SourceCapabilities Capabilities { get; }

    Task<CollectionResult> CollectAsync(
        DriverMonitoringSubject subject,
        SourceContext context,
        CancellationToken cancellationToken);
}
```

Python collectors should return an equivalent structured contract:

```json
{
  "schema_version": "1.0",
  "source_key": "IN_MYCASE",
  "source_type": "COURT_PUBLIC_PORTAL",
  "subject_reference": "driver-internal-id",
  "observed_at": "2026-09-04T14:30:00Z",
  "result": "FOUND",
  "records": [],
  "artifacts": [],
  "source_metadata": {},
  "collector_version": "..."
}
```

Required source metadata:

```text
source_key
jurisdiction
source_type
authority_level
access_method
legal_basis / permitted purpose
terms_review_status
robots_policy_status
requires_login
requires_consent
supports_bulk
supports_push
polling_allowed
recommended_cadence
rate_limit
last_verified_at
owner
status
```

---

# 7. Access Method Priority

Every source must use the highest-priority method available.

```text
1. Official push feed / webhook / SFTP
2. Official API
3. Official bulk export
4. Authorized downloadable report
5. Authorized/public HTTP endpoint
6. Authorized/public browser automation
7. Manual collection fallback
```

Do not start with browser automation if an official feed exists.

Do not defeat:

- CAPTCHA;
- MFA;
- login/access controls;
- IP blocks;
- explicit technical restrictions.

Scrapling contains anti-bot capabilities, but those should **not** be used to evade government access controls. Use Scrapling primarily for adaptive parsing, crawling orchestration, sessions, and resilient extraction on sources where automated access is allowed.

---

# 8. Court Monitoring Strategy

Court monitoring provides a different value from MVR monitoring.

## DMV / MVR layer

Answers:

> What is the driver's authoritative driving record/status?

## Court layer

Answers:

> Has a new traffic-related court matter appeared, changed status, or reached disposition?

Court monitoring can potentially identify activity before the finalized conviction is reflected on the driver's MVR.

However, the system must distinguish:

```text
Citation / allegation
Pending case
Charge amended
Dismissed
Deferred
Convicted / guilty
Adjudicated disposition
Appeal / reopened
```

These statuses must never be collapsed into one generic "violation."

---

# 9. Court Source Landscape

The U.S. court environment is fragmented, but underlying software platforms provide useful leverage.

## Tyler Technologies

Tyler states that its court platforms serve courts at state, district, county, and municipal levels and that its Enterprise Justice Portal can expose docket/case information to the public.

Tyler's public-facing solution page shows products such as re:Search in numerous states.

This suggests an adapter-family strategy:

```text
Tyler/Odyssey family
  -> jurisdiction configuration
  -> shared collector/parser primitives
  -> jurisdiction-specific mappings
```

Sources:

- https://www.tylertech.com/solutions/courts-public-safety/courts-justice
- https://www.tylertech.com/products/enterprise-justice/portal
- https://www.tylertech.com/justice-public-facing-solutions

## Journal Technologies

Journal Technologies' eCourt supports municipal and traffic courts and provides public-access solutions and API integrations.

Source:

- https://www.journaltech.com/ecourt

## Catalis

Catalis offers court case-management products with public-access capabilities.

Source:

- https://catalisgov.com/courts-land-records/court-case-management/

### Important conclusion

We should maintain two identifiers:

```text
jurisdiction_id
platform_family
```

Example:

```text
IN_STATE_MYCASE -> TYLER_ODYSSEY
COOK_COUNTY_IL -> TYLER_ODYSSEY / local configuration
DUPAGE_IL -> local portal / verify underlying implementation
```

One shared adapter framework may therefore support many jurisdictions, while still allowing jurisdiction-specific selectors and rules.

---

# 10. Examples Showing Why a Source Registry Is Necessary

## Indiana

Indiana MyCase states that case information comes from courts using the state's Odyssey case-management system and that this represents most courts in Indiana.

Public users can search by party name, with first/middle name and/or date of birth available to narrow results. Indiana also exposes a **bulk-data request process** under Administrative Rule 9(F).

This means Indiana should **not begin as a naive scraper**. The preferred progression is:

```text
1. Evaluate/request bulk data
2. If bulk use is unavailable/inappropriate, use authorized public search
3. Create one statewide Indiana adapter
4. Use scraping/browser automation only within published access rules
```

Sources:

- https://www.in.gov/courts/help/mycase/
- https://www.in.gov/courts/help/mycase/search-tips
- https://www.in.gov/courts/public-records/
- https://www.in.gov/courts/policies/tou-mycase/

## Wisconsin

Wisconsin's CCAP provides statewide public case information through Wisconsin Circuit Court Access (WCCA).

This is attractive because one statewide integration may provide much greater value than separate county collectors.

Source:

- https://www.wicourts.gov/courts/offices/ccap.htm

## Pennsylvania

Pennsylvania's Unified Judicial System portal provides public access to docket information for appellate, common pleas, and magisterial district courts.

Source:

- https://ujsportal.pacourts.us/

## Illinois

Illinois is more fragmented for trial-court public access. Illinois policy allows local jurisdictions flexibility for electronic access.

Cook County offers online case information and traffic lookup. DuPage County offers case lookup but currently presents a robot check before access.

The correct architecture therefore needs separate Illinois circuit/county adapters rather than assuming one statewide traffic-case endpoint.

Sources:

- https://www.illinoiscourts.gov/courts/circuit-court/
- https://www.cookcountyclerkofcourt.org/online-case-information
- https://www.cookcountyclerkofcourt.org/look-traffic-tickets
- https://dupagecircuitclerk.gov/

**Do not automate around DuPage's robot/CAPTCHA check without authorization.** Treat that source as manual, partnership/data-request, or permitted automation only if the clerk provides an acceptable route.

---

# 11. Source Registry Data Model

Create a source registry table rather than hard-coding states.

Example:

```sql
create table monitoring_sources (
    id uuid primary key,
    source_key text unique not null,
    display_name text not null,
    jurisdiction_country char(2) not null,
    jurisdiction_state char(2),
    jurisdiction_county text,
    jurisdiction_city text,
    platform_family text,
    source_type text not null,
    access_method text not null,
    authority_level text not null,
    official_source boolean not null,
    supports_push boolean not null default false,
    supports_bulk boolean not null default false,
    requires_login boolean not null default false,
    requires_consent boolean not null default false,
    automation_status text not null,
    legal_review_status text not null,
    terms_reviewed_at timestamptz,
    robots_reviewed_at timestamptz,
    minimum_poll_interval_seconds integer,
    default_poll_interval_seconds integer,
    source_url text,
    documentation_url text,
    active boolean not null default true,
    created_at timestamptz not null,
    updated_at timestamptz not null
);
```

Possible `automation_status` values:

```text
OFFICIAL_PUSH
OFFICIAL_API
OFFICIAL_BULK
PUBLIC_AUTOMATION_ALLOWED
AUTHORIZED_ACCOUNT_AUTOMATION
MANUAL_ONLY
BLOCKED_PENDING_REVIEW
DISABLED
```

---

# 12. Driver Monitoring Enrollment

Do not automatically query every possible source for every employee.

Create explicit monitoring enrollment.

```text
Driver
  -> MonitoringEnrollment
      -> CDL/MVR sources based on license state
      -> FMCSA sources based on CDL / DOT role
      -> court-watch scope based on configured coverage
      -> telematics source based on assigned device
```

Store:

```text
driver_id
monitoring_start
monitoring_end
employment_status
license_state
license_number_encrypted
license_number_hash
DOB_encrypted
normalized_name
consent_reference
permitted_purpose
monitoring_policy_id
```

Sensitive identifiers should be encrypted at rest and access-controlled.

Use deterministic keyed hashes for lookup/deduplication where raw values do not need to be exposed.

---

# 13. Raw Evidence Must Be Immutable

Never transform scraped records directly into final driver events and discard the source.

Use three layers:

```text
RAW OBSERVATION
    |
    v
NORMALIZED CANDIDATE
    |
    v
VERIFIED DRIVER EVENT
```

## RawObservation

Store:

```text
observation_id
source_id
collection_run_id
subject_id
retrieved_at
request_fingerprint
response_status
content_hash
raw_payload_location
screenshot_location (when appropriate)
parsed_payload
collector_version
```

For HTML/PDF/JSON responses, store the original response or an evidentiary artifact where permitted.

This is essential for:

- debugging parser changes;
- proving what the source showed at a point in time;
- correcting false positives;
- data disputes;
- auditability;
- regression tests.

---

# 14. Canonical Driver Safety Event Schema

The central object should be a normalized event.

```json
{
  "event_id": "uuid",
  "driver_id": "uuid",
  "event_category": "COURT_TRAFFIC",
  "event_type": "SPEEDING",
  "event_status": "ADJUDICATED_CONVICTION",
  "event_date": "2026-08-19",
  "reported_date": "2026-08-21",
  "observed_date": "2026-09-04",
  "jurisdiction": {
    "state": "IN",
    "county": "Lake",
    "court": "..."
  },
  "vehicle_context": "UNKNOWN",
  "commercial_vehicle": null,
  "citation_number": "...",
  "case_number": "...",
  "statute_code": "...",
  "raw_description": "...",
  "normalized_code": "SPD_15_OVER",
  "severity": 60,
  "confidence": 0.99,
  "identity_match_score": 0.99,
  "verification_level": "OFFICIAL_COURT_DISPOSITION",
  "source_ids": ["..."],
  "requires_review": false
}
```

---

# 15. Event Taxonomy

At minimum:

```text
LICENSE
  ACTIVE
  EXPIRED
  SUSPENDED
  REVOKED
  CANCELLED
  DISQUALIFIED
  DOWNGRADED

CDL
  CDL_STATUS_CHANGE
  ENDORSEMENT_CHANGE
  HAZMAT_ENDORSEMENT_CHANGE
  MEDICAL_CERTIFICATION_CHANGE

COURT_TRAFFIC
  SPEEDING
  RECKLESS_DRIVING
  FOLLOWING_TOO_CLOSE
  IMPROPER_LANE_USE
  RED_LIGHT
  STOP_SIGN
  PHONE_USE
  SEATBELT
  DUI_DWI
  DRUG_RELATED_DRIVING
  DRIVING_WHILE_SUSPENDED
  FAILURE_TO_APPEAR
  OTHER_MOVING_VIOLATION

COURT_STATUS
  CITATION_FILED
  CASE_OPENED
  HEARING_SCHEDULED
  DISMISSED
  DEFERRED
  CONVICTED
  AMENDED
  APPEALED
  CLOSED

FMCSA
  ROADSIDE_INSPECTION
  DRIVER_OOS
  VEHICLE_OOS
  CRASH
  VIOLATION

CLEARINGHOUSE
  QUERY_STATUS_CHANGE
  PROHIBITED_STATUS
  RTD_STATUS

TELEMATICS
  SPEEDING_EVENT
  HARSH_BRAKING
  HARSH_ACCELERATION
  HARSH_TURN
  PHONE_DISTRACTION
  SEATBELT_EVENT
  FOLLOWING_DISTANCE
  CAMERA_EVENT
  CRASH_DETECTED

INTERNAL
  CLAIM
  PREVENTABLE_ACCIDENT
  SAFETY_COMPLAINT
  TRAINING_ASSIGNED
  TRAINING_COMPLETED
  POLICY_VIOLATION
```

---

# 16. Identity Resolution: One of the Hardest Parts

A national driver-monitoring platform fails if it associates a court record with the wrong person.

Never match on name alone.

Recommended evidence weights:

| Match signal | Strength |
|---|---:|
| Exact DL number + issuing state | Extremely strong |
| Exact name + exact DOB | Very strong |
| Exact name + DOB + known address/city | Very strong |
| Exact name + DOB + middle name | Very strong |
| Exact name + citation number already known internally | Extremely strong |
| Name + approximate age only | Weak |
| Name only | Unacceptable for automatic association |

Recommended outcome thresholds:

```text
>= 0.98  AUTO-LINK if source quality is high
0.90-0.979 HUMAN REVIEW
< 0.90    DO NOT LINK
```

The exact scoring model should be calibrated with real data; these values are initial operating policy, not scientific constants.

## Important

Do not use protected/sensitive characteristics as risk-scoring inputs.

Identity data exists only to ensure the record belongs to the correct driver.

---

# 17. Event Correlation / Deduplication

The same event may arrive through several paths:

```text
Court citation
   -> court disposition
   -> state MVR conviction
   -> ENS notification
```

The system must correlate these into **one safety incident with multiple evidence records**, not four violations.

Use a correlation key composed from available fields:

```text
(driver_id,
 jurisdiction,
 event_date +/- tolerance,
 statute/normalized offense,
 citation_number,
 case_number)
```

Maintain:

```text
SafetyEvent
SafetyEventEvidence[]
```

Example:

```text
SafetyEvent: Speeding 15+ mph
  Evidence 1: Indiana MyCase
  Evidence 2: Indiana MVR
  Evidence 3: ENS change notification
```

Authority precedence:

```text
Official DMV/MVR/ENS
    > official court disposition
    > official court docket/citation
    > federal regulated source
    > internal report
    > third-party/public derived source
```

The precedence depends on event type; for a court disposition, an official court disposition is authoritative for what the court decided, while DMV is authoritative for what has posted to the license record.

---

# 18. Pending vs. Adjudicated Records

This is non-negotiable.

Create separate classifications:

```text
PENDING / ALLEGED
CONFIRMED / ADJUDICATED
OFFICIAL_MVR_POSTED
```

A new citation should generate something like:

```text
Informational Alert:
"New traffic court activity detected — verification pending."
```

A final disposition can generate:

```text
Safety Alert:
"Speeding conviction posted by court."
```

A license suspension from an authoritative DMV/ENS can generate:

```text
Critical Compliance Alert:
"Driver license status: SUSPENDED. Driver must be removed from dispatch eligibility pending safety review."
```

The system should not automatically fire/discipline drivers based solely on a scraped pending case.

---

# 19. Risk Scoring

Do **not** start by trying to clone Samba's exact score.

Build a transparent internal policy engine.

Example event severity model:

```text
0-19   informational
20-39  low
40-59  moderate
60-79  high
80-100 critical
```

Example weights (illustrative; safety/legal team must approve):

```text
License suspended                 100
CDL disqualified                  100
DUI conviction                     95
Reckless driving conviction        85
Driving while suspended            90
Speeding 15+ mph                   70
Phone use conviction               65
Driver OOS                         75
Preventable crash                  80
Recent camera phone event          25
Harsh braking                      10
```

Then derive rolling metrics:

```text
30-day risk
90-day risk
12-month risk
36-month violation history
trend direction
repeat-category multiplier
```

Keep:

- **raw event severity** separate from
- **driver risk score** separate from
- **employment/dispatch eligibility**.

Those are different concepts.

---

# 20. Compliance Gate vs Risk Score

Build an explicit compliance gate.

```text
DriverDispatchEligibility
  ELIGIBLE
  REVIEW_REQUIRED
  NOT_ELIGIBLE
```

Examples of hard compliance conditions may include:

```text
license suspended
license revoked
CDL disqualified
required medical qualification unavailable/invalid
Clearinghouse prohibited status where applicable
```

Do not infer hard disqualification from a generic score.

The safety/risk score should help prioritize review; authoritative compliance status determines whether the driver is legally qualified.

---

# 21. Collection Scheduling

Do not poll every source every few minutes.

Recommended policy:

## Push sources

No polling except heartbeat/health verification.

## Official MVR pull sources

Use the source's legal/business rules and required cadence.

## Court sources

Suggested starting strategy:

```text
High-value statewide court source:       1 x daily
High-value local/county source:           1 x daily
Low-volume jurisdiction:                  every 2-7 days
Newly discovered pending case:            1 x daily until disposition
Closed/adjudicated case:                  stop frequent polling
```

A driver does not need every U.S. jurisdiction queried every day.

Use **coverage-based scheduling**:

```text
Tier 1: states/jurisdictions where our fleet operates heavily
Tier 2: interstate corridors with meaningful activity
Tier 3: remainder, only when cost-effective or via bulk feed
```

If future commercial coverage requires nationwide monitoring, negotiate bulk/statewide data access rather than multiplying browser requests.

---

# 22. Adaptive Scraping Design

For permitted public/authorized web collection:

```text
HTTP first
   |
   +-- HTML contains data? -> parse with Scrapling
   |
   +-- JS required? -> Playwright/Dynamic session
   |
   +-- official XHR/JSON endpoint observed and permitted?
                    -> use stable HTTP client if terms permit
```

## Scrapling

Scrapling is useful because it provides:

- adaptive element relocation when page structures change;
- HTTP and browser fetchers;
- spider framework;
- sessions;
- concurrency;
- pause/resume;
- adaptive crawl speed.

Source:

- https://scrapling.readthedocs.io/en/latest/
- https://github.com/D4Vinci/Scrapling

## Playwright

Use Playwright when JS rendering or legitimate interactive navigation is required.

Playwright supports Chromium, Firefox, and WebKit and provides tracing/debugging capabilities that are valuable for production collectors.

Source:

- https://playwright.dev/python/

### Selector strategy

Prefer in this order:

```text
1. semantic labels / accessibility roles
2. stable field names / IDs
3. data attributes
4. normalized table headings
5. CSS classes
6. positional selectors only as last resort
```

Adaptive selectors are a recovery mechanism, not an excuse for weak extraction contracts.

---

# 23. Scraper/Collector Folder Structure

Recommended Python worker structure:

```text
collector/
├── pyproject.toml
├── src/
│   └── driver_monitoring_collector/
│       ├── core/
│       │   ├── contracts.py
│       │   ├── runner.py
│       │   ├── http.py
│       │   ├── browser.py
│       │   ├── evidence.py
│       │   ├── hashing.py
│       │   └── telemetry.py
│       ├── adapters/
│       │   ├── court/
│       │   │   ├── indiana_mycase/
│       │   │   ├── wisconsin_wcca/
│       │   │   ├── pennsylvania_ujs/
│       │   │   ├── cook_county_il/
│       │   │   └── ...
│       │   ├── dmv/
│       │   ├── fmcsa/
│       │   └── file_feed/
│       ├── platform_families/
│       │   ├── tyler_odyssey/
│       │   ├── journal_ecourt/
│       │   └── generic_table_portal/
│       └── workers/
│           └── collection_worker.py
└── tests/
    ├── fixtures/
    ├── contract/
    └── adapters/
```

Each adapter must have saved HTML/JSON/PDF fixtures so parsing can be tested without hitting government websites during CI.

---

# 24. .NET Module Structure

Recommended modular-monolith structure:

```text
Modules/
└── SafetyIntelligence/
    ├── Domain/
    │   ├── Drivers/
    │   ├── Monitoring/
    │   ├── Events/
    │   ├── Risk/
    │   └── Alerts/
    ├── Application/
    │   ├── Enrollment/
    │   ├── Ingestion/
    │   ├── Normalization/
    │   ├── Correlation/
    │   ├── Review/
    │   └── Queries/
    ├── Infrastructure/
    │   ├── Persistence/
    │   ├── Sources/
    │   ├── Queue/
    │   └── Storage/
    ├── Contracts/
    └── Api/
```

Keep scraping implementation outside this folder; only source contracts and ingestion live here.

---

# 25. Collection Job State Machine

```text
QUEUED
  -> RUNNING
      -> SUCCEEDED
      -> NO_RESULT
      -> RETRYABLE_FAILURE
      -> BLOCKED
      -> PERMANENT_FAILURE
```

Possible failure categories:

```text
DNS
TIMEOUT
RATE_LIMIT
SOURCE_5XX
AUTH_EXPIRED
CAPTCHA_OR_ROBOT_CHECK
SELECTOR_CHANGED
PARSE_CONTRACT_FAILED
SOURCE_TERMS_CHANGED
DRIVER_NOT_FOUND
AMBIGUOUS_IDENTITY
```

`CAPTCHA_OR_ROBOT_CHECK` must not trigger bypass attempts. It should automatically disable that automated route and open a source-health review.

---

# 26. Source Health Monitoring

A monitoring platform is dangerous if it silently stops monitoring.

For every source maintain:

```text
last_success
last_attempt
success_rate_24h
success_rate_7d
median_latency
records_found
schema_failures
content_structure_hash
last_known_good_fixture
collector_version
blocked_status
```

Alert operations when:

```text
No successful run > expected interval
Success rate falls below threshold
Result volume suddenly goes to zero
Page fingerprint changes materially
Parser contract validation fails
Authentication expires
```

A blank result must be distinguishable from a failed collector.

This is critical.

---

# 27. Change Detection

Avoid generating alerts every time the same page is downloaded.

Calculate a canonical fingerprint over normalized record content.

Example:

```text
record_fingerprint = SHA256(
    source_key |
    normalized_case_number |
    normalized_status |
    normalized_charge |
    event_date |
    disposition
)
```

Store observation history:

```text
first_seen_at
last_seen_at
first_changed_at
last_changed_at
```

Only emit a candidate event when:

```text
new record appears
OR
material field changes
OR
case/disposition status changes
```

---

# 28. Source Provenance

Every fact shown in the UI must be traceable.

Example UI:

```text
Speeding 82/65
Status: Convicted
Confidence: Verified
Sources:
  - Indiana MyCase, observed Sep 4 2026
  - Indiana MVR, posted Sep 7 2026
```

Store source URLs/reference numbers where permitted.

Never show the safety team a number with no explanation of where it came from.

---

# 29. Human Review Queue

Create a review queue for:

- ambiguous identity matches;
- pending court matters;
- conflicting sources;
- unusual statute normalization;
- possible sealed/removed records;
- source data corrected after previous ingestion;
- severe events before employment action.

Suggested workflow:

```text
NEW
-> ASSIGNED
-> VERIFIED
-> REJECTED_FALSE_MATCH
-> NEEDS_DRIVER_CONFIRMATION
-> RESOLVED
```

Reviewers should see raw evidence and comparison data but only the minimum sensitive information needed.

---

# 30. Driver Dispute / Correction Workflow

Build this from day one.

```text
Driver disputes event
      |
      v
Freeze automated downstream adverse action
      |
      v
Review source evidence
      |
      +-> source incorrect -> mark disputed/corrected
      |
      +-> identity mismatch -> unlink + record correction
      |
      +-> source correct -> confirm
```

Do not delete history. Create correction records and preserve auditability.

---

# 31. Recommended Initial Data Sources

## Tier A — implement first

### 1. State ENS / employer MVR sources

Reason: authoritative compliance layer.

### 2. AAMVA/CDLIS employer verification investigation

Reason: commercial-driver identity/credential validation.

### 3. FMCSA PSP

Important limitation: PSP's new free monitoring service described by FMCSA is for drivers themselves. PSP remains useful for pre-employment/history workflows, not as a substitute for employer ENS.

Source: https://www.psp.fmcsa.dot.gov/

### 4. FMCSA Clearinghouse

Employer queries require appropriate registration/consent and query plans. Build this as a regulated integration, not a scraper.

Sources:

- https://clearinghouse.fmcsa.dot.gov/Learn/Employer
- https://clearinghouse.fmcsa.dot.gov/Query/Plan

### 5. Indiana MyCase

High-value statewide court source; most Indiana courts use Odyssey. Investigate bulk data before browser automation.

### 6. Wisconsin WCCA

Statewide public court information.

### 7. Pennsylvania UJS

Statewide public docket access.

### 8. Illinois priority circuits

Start with Cook County and the Illinois counties most frequently appearing in the fleet's tickets/cases. Do not attempt CAPTCHA bypass on sources such as DuPage.

---

# 32. How to Prioritize Nationwide Court Coverage

Do **not** blindly implement states alphabetically.

Run analytics on existing company data:

```text
last 3-5 years of:
  driver violations
  citations
  accidents
  roadside inspections
  routes
  domiciles
  driver license states
```

Rank jurisdictions by:

```text
historical incident count
+ current driver license population
+ fleet traffic exposure
+ availability of statewide data
+ implementation cost
```

A statewide Indiana adapter may be worth more than dozens of individual low-volume municipal scrapers.

Build coverage in descending ROI.

---

# 33. Recommended Nationwide Source Discovery Process

For each state:

1. Identify official ENS/employer driver-monitoring service.
2. Identify official MVR access method and employer requirements.
3. Identify statewide judiciary portal.
4. Determine whether traffic matters are present.
5. Determine whether the state court system is centralized or county/municipality based.
6. Identify platform family (Tyler, Journal, Catalis, custom, etc.).
7. Search for official bulk-data/API/data-license programs.
8. Review terms of use and automated-access restrictions.
9. Document query keys available:
   - DL number;
   - DOB;
   - full name;
   - case/citation number.
10. Record source freshness and disposition availability.
11. Create fixture and adapter only after access review is approved.

Maintain this as configuration/data, not a spreadsheet that becomes stale outside the application.

---

# 34. Data Security

This module will contain highly sensitive employee information.

Minimum controls:

```text
Encryption at rest
TLS in transit
Field-level encryption for DL number/DOB where appropriate
RBAC
Audit logging
Secrets manager
No credentials in repository
No raw driver PII in application logs
Retention policies
Separate object-storage bucket/container for evidence
Signed URLs for temporary evidence access
Database row/tenant boundaries if commercialized
```

Suggested roles:

```text
SAFETY_ADMIN
SAFETY_REVIEWER
COMPLIANCE_MANAGER
READ_ONLY_AUDITOR
SYSTEM_COLLECTOR
```

---

# 35. Observability

Instrument:

```text
collection jobs
source latency
source failures
parser failures
identity ambiguity
candidate event generation
verified event generation
alerts
human review SLA
```

OpenTelemetry trace example:

```text
monitor.driver
  -> enqueue.source_job
     -> collector.fetch
        -> collector.parse
           -> ingestion.validate
              -> identity.resolve
                 -> event.correlate
                    -> risk.recalculate
                       -> alert.evaluate
```

This lets us determine whether "no alert" means "nothing happened" or "the collector failed."

---

# 36. Testing Strategy

## Unit tests

- normalization;
- identity scoring;
- correlation;
- risk rules;
- event state changes.

## Parser fixture tests

Each adapter should contain sanitized saved responses.

Tests must verify:

```text
known page -> expected normalized output
changed fixture -> parser failure is explicit
no results page -> true NO_RESULT
blocked page -> BLOCKED, not NO_RESULT
```

## Contract tests

Collector output must validate against one canonical schema.

## Live canary tests

For permitted sources, run small canary checks separately from production driver monitoring.

Do not use real employee identifiers in ordinary CI.

---

# 37. Why AI/LLM Should Not Parse Everything

Do not make an LLM the primary parser.

Preferred:

```text
structured DOM/JSON parser
        |
        v
known mapping
        |
        v
canonical event
```

LLM use can be limited to:

- assisting developers to create new adapter mappings;
- suggesting mapping for unfamiliar free-text violation descriptions;
- summarizing a verified event for a safety manager;
- triaging unknown formats for human review.

Never let an LLM invent missing court facts or determine identity matches without deterministic evidence.

---

# 38. Database Entities

Recommended core entities:

```text
DriverMonitoringEnrollment
MonitoringSource
SourceCredentialReference
SourceSubscription
CollectionJob
CollectionRun
RawObservation
RawArtifact
CandidateDriverEvent
DriverEvent
DriverEventEvidence
IdentityMatchDecision
ViolationCodeMapping
RiskPolicy
RiskPolicyRule
DriverRiskSnapshot
SafetyAlert
ReviewCase
DisputeCase
SourceHealthSnapshot
SourceChangeIncident
AuditLog
```

---

# 39. API Surface

Suggested internal endpoints:

```text
POST   /safety-monitoring/drivers/{driverId}/enroll
DELETE /safety-monitoring/drivers/{driverId}/enroll
GET    /safety-monitoring/drivers/{driverId}/status
GET    /safety-monitoring/drivers/{driverId}/events
GET    /safety-monitoring/drivers/{driverId}/risk
GET    /safety-monitoring/alerts
POST   /safety-monitoring/alerts/{id}/acknowledge
GET    /safety-monitoring/review-cases
POST   /safety-monitoring/review-cases/{id}/decision
GET    /safety-monitoring/sources
GET    /safety-monitoring/sources/{sourceKey}/health
```

Ingestion endpoint should be internal/service-authenticated only:

```text
POST /internal/safety-monitoring/observations
```

---

# 40. UI Recommendations

## Driver profile

Show:

```text
Current Qualification Status
Current License Status
Monitoring Coverage
Latest MVR/ENS activity
Court Activity
FMCSA Events
Telematics Events
Risk Trend
Open Alerts
Training / Intervention History
```

## Alert center

Filters:

```text
Critical compliance
New MVR activity
New court activity
Pending verification
Telematics risk
Repeat behavior
Source/data issue
```

## Source coverage dashboard

Essential for operations:

```text
State / Jurisdiction
Source
Method
Coverage
Last Success
Health
Drivers Monitored
Last Event
```

---

# 41. Implementation Phases

## Phase 0 — Discovery and compliance registry

Build first:

- source registry;
- permitted-purpose model;
- monitoring enrollment;
- canonical event schema;
- raw observation schema;
- source-health model.

Do not write 50 scrapers first.

## Phase 1 — Authoritative core

Implement:

- state ENS/MVR integrations for highest driver-license-state concentration;
- CDLIS employer-verification investigation/integration if approved;
- Clearinghouse workflow;
- PSP pre-employment/history integration;
- generic ingestion pipeline;
- alerts and compliance gate.

## Phase 2 — Court Watch MVP

Implement three high-value statewide/centralized sources first:

- Indiana MyCase;
- Wisconsin WCCA;
- Pennsylvania UJS.

Then Illinois high-volume counties.

Build:

- court event schema;
- identity resolution;
- pending vs adjudicated states;
- review queue;
- evidence storage.

## Phase 3 — Platform families

Abstract repeated implementations:

- Tyler/Odyssey;
- other major court software families;
- generic server-rendered court portal;
- generic JS portal.

## Phase 4 — Nationwide expansion

Add states/jurisdictions using data-driven priority.

Negotiate bulk/API access whenever browser volume becomes significant.

## Phase 5 — Unified risk intelligence

Add:

- Samsara/telematics;
- camera events;
- claims;
- internal safety incidents;
- training/interventions;
- risk trends.

---

# 42. Claude Code Implementation Rules

Give Claude Code the following constraints when it begins implementation:

1. **Audit the existing repository before creating anything.** Reuse existing modules, queueing, observability, auth, database conventions, and error types.
2. **Do not introduce a microservice unless isolation is operationally justified.** The Python collector worker is an integration boundary; the Safety Intelligence domain remains part of the modular monolith.
3. **Do not implement real jurisdiction scraping until the source has an approved SourceRegistry entry.**
4. **Every collector must return the canonical CollectionResult contract.**
5. **Raw evidence must be persisted before normalization.**
6. **No parser may directly mutate DriverRisk.** All changes flow through CandidateEvent -> verification/correlation -> DriverEvent -> risk recalculation.
7. **Never treat a fetch failure as a no-result response.**
8. **Never match a driver using name alone.**
9. **Never bypass CAPTCHA/MFA/access controls.**
10. **Every risk/eligibility change must be explainable and auditable.**
11. **Every jurisdiction adapter requires fixture-based tests.**
12. **Do not use AI-generated guesses to fill missing source fields.**
13. **Keep provider-specific code out of domain entities.**
14. **Encrypt or tokenize sensitive driver identifiers.**
15. **Use idempotency keys on ingestion and event creation.**
16. **Add migrations and tests in the same change as new domain objects.**
17. **Do not create generic abstractions before at least two real implementations prove the common shape.**
18. **Document every source's access method, authority, cadence, limitations, and legal review status in code/configuration.**

---

# 43. First Claude Code Work Package

Do not ask Claude to "build SambaSafety."

Give it a bounded first task:

```text
Audit the repository and design/implement the foundational SafetyIntelligence
module only.

Do not implement production scrapers yet.

Required deliverables:
- repository architecture audit
- module integration plan
- SourceRegistry domain model
- DriverMonitoringEnrollment
- CollectionJob / CollectionRun
- RawObservation / RawArtifact
- CandidateDriverEvent
- DriverEvent / DriverEventEvidence
- SourceHealthSnapshot
- canonical contracts
- migrations
- unit tests
- internal ingestion API
- documentation

Reuse all existing project conventions.
Do not duplicate infrastructure.
Report conflicts or missing prerequisites instead of inventing them.
```

After that foundation is reviewed, implement **one source end-to-end**.

Recommended first court source: **Indiana MyCase**, but investigate/request its bulk-data mechanism before implementing web automation.

---

# 44. Second Claude Code Work Package — One Vertical Slice

After the foundation exists:

```text
Implement a complete Indiana court-monitoring vertical slice.

Before coding:
1. verify current Indiana MyCase terms/access rules;
2. investigate Indiana bulk-data access;
3. document approved acquisition method;
4. create/update SourceRegistry entry.

Then implement:
- collection adapter
- fixtures
- parsing
- identity matching
- candidate event generation
- correlation
- human review path
- source health
- tests
- dashboard/API visibility

Do not implement anti-bot bypass.
Do not broaden to other states during this work package.
```

This gives us a real production pattern before creating a nationwide framework.

---

# 45. Recommended Decision: Scrapling vs Playwright

Use **both**, but for different responsibilities.

### Scrapling

Use for:

- ordinary HTTP retrieval;
- resilient/adaptive extraction;
- spiders/crawls;
- session reuse;
- parser layer;
- moderate-scale permitted collection.

### Playwright

Use when:

- pages require JavaScript;
- legitimate interactive navigation is necessary;
- DOM state only appears after user-like interaction;
- debugging requires traces/screenshots.

### Do not use

Do not use stealth/anti-bot tooling as a mechanism to defeat explicit government access restrictions.

If a portal actively blocks automation, the source state becomes:

```text
BLOCKED_PENDING_ACCESS_METHOD
```

Then pursue:

```text
bulk data
API
authorized account
formal data request
manual process
```

---

# 46. What Not to Build

Do not build:

- one giant scraper process;
- one scraper per municipality with duplicated code;
- hard-coded state logic inside risk scoring;
- automatic employee discipline based on scraped allegations;
- name-only identity matching;
- collectors that overwrite previous evidence;
- silent retry loops that hide broken sources;
- CAPTCHA bypass;
- credential sharing in code/config files;
- LLM-only parsing;
- a "national database" populated with every public record regardless of monitoring purpose.

---

# 47. Expected Difficulty

| Area | Difficulty |
|---|---:|
| Core event/alert model | 3/10 |
| Source registry and ingestion | 4/10 |
| A few centralized court portals | 5/10 |
| Identity resolution | 7/10 |
| Violation normalization | 7/10 |
| State MVR/ENS enrollment/integrations | 7-9/10 |
| Nationwide court coverage | 9/10 |
| Full SambaSafety-equivalent ecosystem | 10/10 |

The hardest part is **data partnerships and authoritative nationwide coverage**, not HTML extraction.

---

# 48. Practical Target for Our Fleet

We do not need to reproduce every SambaSafety commercial capability immediately.

A high-value internal version can provide:

```text
Authoritative license/CDL status
Suspension/revocation/disqualification alerts
MVR conviction changes
HazMat endorsement / medical qualification changes where available
FMCSA inspection and crash data
Clearinghouse workflow
Court case early warning
Court dispositions
Telematics/camera risk
Internal accidents and claims
Driver risk timeline
Configurable alerts
Compliance eligibility
```

That would capture a very large part of the operational value of driver-monitoring platforms while keeping the system explainable and under company control.

---

# 49. Final Architecture Recommendation

Build the module as:

```text
                    Existing TMS / Safety Platform

                  +-----------------------------+
                  |   SafetyIntelligence Module |
                  +-----------------------------+
                    |       |       |       |
                    v       v       v       v
                Events   Risk    Alerts   Review
                    ^
                    |
               Normalization
                    ^
                    |
               Correlation
                    ^
                    |
             Raw Observation API
                    ^
                    |
       +------------+-------------+
       |                          |
 Official Feed Adapters     Collector Worker
 API/SFTP/Webhook             Python
       |                   Scrapling/Playwright
       |                          |
 DMV/ENS/CDLIS/FMCSA          Court Sources
```

Use **official data whenever possible** and **scraping as a controlled fallback/supplement**.

This gives us the ability to continuously improve coverage without coupling the entire system to fragile web pages.

---

# 50. Research References

## SambaSafety

1. Risk Cloud — https://sambasafety.com/capabilities/risk-cloud
2. Driver Monitoring — https://sambasafety.com/capabilities/driver-monitoring/
3. Fleet Safety Analytics — https://sambasafety.com/capabilities/fleet-safety-analytics/
4. Legal / monitoring terms — https://sambasafety.com/msa/

## FMCSA / Federal

5. FMCSA States / Employer Notification Services — https://www.fmcsa.dot.gov/registration/commercial-drivers-license/states
6. FMCSA Motor Carriers / ENS — https://www.fmcsa.dot.gov/registration/commercial-drivers-license/motor-carriers
7. FMCSA ENS regulatory guidance — https://www.fmcsa.dot.gov/regulations/federal-register-documents/2015-05645
8. FMCSA ENS state information — https://www.fmcsa.dot.gov/registration/commercial-drivers-license/employee-notification-services-state
9. PSP — https://www.psp.fmcsa.dot.gov/
10. Clearinghouse Employer Learning Center — https://clearinghouse.fmcsa.dot.gov/Learn/Employer
11. Clearinghouse Query Plans — https://clearinghouse.fmcsa.dot.gov/Query/Plan

## AAMVA

12. CDLIS — https://www.aamva.org/technology/systems/driver-licensing-systems/cdlis
13. State-to-State / SPEXS — https://www.aamva.org/technology/systems/driver-licensing-systems/state-to-state-verification-service-%28s2s%29

## Privacy / Employment

14. Driver Privacy Protection Act, 18 U.S.C. §2721 — https://www.law.cornell.edu/uscode/text/18/2721
15. FTC Background Checks — https://www.ftc.gov/business-guidance/resources/background-checks-what-employers-need-know
16. FTC FCRA — https://www.ftc.gov/legal-library/browse/statutes/fair-credit-reporting-act
17. EEOC Arrest/Conviction Guidance — https://www.eeoc.gov/laws/guidance/enforcement-guidance-consideration-arrest-and-conviction-records-employment-decisions

## Court Platforms / Examples

18. Tyler Courts & Justice — https://www.tylertech.com/solutions/courts-public-safety/courts-justice
19. Tyler Enterprise Justice Portal — https://www.tylertech.com/products/enterprise-justice/portal
20. Tyler public-facing justice solutions — https://www.tylertech.com/justice-public-facing-solutions
21. Journal Technologies eCourt — https://www.journaltech.com/ecourt
22. Catalis Court Case Management — https://catalisgov.com/courts-land-records/court-case-management/
23. Indiana MyCase — https://www.in.gov/courts/help/mycase/
24. Indiana MyCase Search Tips — https://www.in.gov/courts/help/mycase/search-tips
25. Indiana Public Records / Bulk Data — https://www.in.gov/courts/public-records/
26. Indiana MyCase Terms — https://www.in.gov/courts/policies/tou-mycase/
27. Wisconsin CCAP — https://www.wicourts.gov/courts/offices/ccap.htm
28. Pennsylvania UJS Portal — https://ujsportal.pacourts.us/
29. Illinois Circuit Courts — https://www.illinoiscourts.gov/courts/circuit-court/
30. Cook County Online Case Information — https://www.cookcountyclerkofcourt.org/online-case-information
31. Cook County Traffic Lookup — https://www.cookcountyclerkofcourt.org/look-traffic-tickets
32. DuPage Circuit Clerk — https://dupagecircuitclerk.gov/

## Scraping / Automation

33. Scrapling Documentation — https://scrapling.readthedocs.io/en/latest/
34. Scrapling GitHub — https://github.com/D4Vinci/Scrapling
35. Playwright Python — https://playwright.dev/python/

---

# 51. Research Caveats

- Court portals, access rules, terms, APIs, fees, and program names change. Every source must be re-verified immediately before production implementation.
- FMCSA's state ENS list includes historical implementation material and may not represent every current state program or every later program change. The source registry must use current state-specific verification.
- This document is a technical and product architecture plan, not legal advice. Employment, privacy, consumer-reporting, state court-data, and DMV-access rules should receive counsel/compliance review before commercial deployment or automated adverse-action use.
- Public availability does not automatically mean unrestricted automated collection is permitted.

---

# 52. Bottom Line

**Build a safety intelligence platform, not a scraper.**

The winning design is:

```text
Official ENS/MVR + FMCSA/CDLIS + Court Watch + Telematics
                         |
                         v
                canonical driver events
                         |
                         v
              risk + compliance + alerts
```

For web collection, use a **small isolated Python collector service with Scrapling + Playwright**, governed by a source registry and legal/access status. Keep the domain model, event correlation, risk engine, alerts, and compliance decisions inside the existing modular application.

The first engineering milestone should be the **source-neutral ingestion/event foundation**, followed by one complete court-source vertical slice. Once that works reliably, nationwide expansion becomes a controlled adapter program rather than an unmanageable scraping project.
