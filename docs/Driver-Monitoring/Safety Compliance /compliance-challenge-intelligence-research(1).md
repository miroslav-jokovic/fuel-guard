# Compliance Challenge Intelligence
## AI-Assisted Roadside Inspection, Citation, DataQs and Regulatory Review System
### Implementation Research & Architecture
**Prepared:** September 4, 2026
**Updated:** September 4, 2026 — FMCSA open-data ingestion and DataQs integration research added

---

## 1. Objective

Build an internal compliance-intelligence module that can ingest roadside inspection reports, tickets/citations, court dispositions, ELD logs, telematics records, photos, maintenance documents, shipping papers and other evidence, then determine whether an inspection violation or related citation has a legitimate factual or regulatory basis for challenge.

The system should not act as an autonomous lawyer and should never guarantee that a ticket or violation will be overturned.

Its purpose is to:

1. identify potentially incorrect inspection violations;
2. identify incorrect or unsupported Out-of-Service (OOS) determinations;
3. detect duplicate or improperly documented violations;
4. identify citations whose adjudication can materially change FMCSA treatment;
5. reconstruct the objective timeline of an inspection;
6. retrieve the exact regulations and inspection criteria applicable on the inspection date;
7. compare the inspector's allegation against objective evidence;
8. identify missing evidence;
9. score challenge viability;
10. generate a cited, human-reviewable DataQs Request for Data Review (RDR) package;
11. track challenge outcomes and learn which evidence and argument patterns are effective;
12. automatically detect newly published FMCSA roadside inspections for the carrier;
13. ingest inspection, unit/VIN, violation and citation records from official DOT/FMSCA open-data feeds;
14. correlate public FMCSA records to internal equipment and driver-assignment history;
15. use the roadside inspection PDF/photo primarily as evidentiary enrichment and cross-checking rather than as the only case trigger.

The core principle is:

> AI can reason and draft, but regulations, evidence, identity, dates, measurements and procedural pathways must be deterministic, versioned and independently verifiable.

---

# 2. Most Important Procedural Distinction

The product must separate the following workflows.

## 2.1 Incorrect Roadside Inspection Violation

A roadside inspection can contain an FMCSA violation even when no traffic citation was issued.

According to the FMCSA DataQs Help Center, an inspection violation may be reviewed when it:

- did not exist;
- was recorded in error;
- was listed multiple times;
- or is missing relevant Intermodal Equipment Provider (IEP) / shipper information.

A defect that was repaired after the inspection is **not** the same as an incorrect violation.

**Recommended system path:**

```text
Inspection violation
      |
      v
Is factual/regulatory record potentially incorrect?
      |
      +-- YES -> DataQs RDR candidate
      |
      +-- NO -> No DataQs challenge recommendation
```

## 2.2 Traffic Citation / Ticket

A state or local citation is adjudicated through the applicable court, administrative tribunal, prosecutor process, or other due-process mechanism.

DataQs is not the court.

**Recommended path:**

```text
Citation
   |
   v
State/local judicial process
   |
   v
Disposition
   |
   v
Certified court documentation
   |
   v
DataQs citation-adjudication RDR
```

## 2.3 Adjudicated Citation

FMCSA's current DataQs documentation states that citation outcomes affect how the associated inspection violation is used.

Current outcomes include:

### Not guilty / dismissed
- Excluded from SMS calculations.
- Excluded from PSP.

### Convicted of a different charge
- SMS severity weight becomes 1.
- PSP reflects conviction of a different charge.

### Convicted of original charge
- Original SMS severity treatment remains.
- Remains on PSP.

This is a major opportunity for the system because it can calculate the operational value of fighting a citation before a fleet commits time or legal expense.

## 2.4 Crash Preventability

Crash Preventability Determination Program (CPDP) requests are another DataQs workflow.

Build CPDP as a separate case type and ruleset.

Do not mix crash-preventability logic with inspection-violation logic.

---

# 3. Product Concept

Recommended product/module name:

```text
ComplianceIntelligence
```

Submodule:

```text
InspectionChallenge
```

High-level architecture:

```text
Roadside Inspection / Citation / Evidence Upload
                    |
                    v
            Document Intake
                    |
                    v
         OCR + Vision Extraction
                    |
                    v
         Structured Case Record
                    |
          +---------+---------+
          |                   |
          v                   v
  Regulation Resolver    Evidence Resolver
          |                   |
          v                   v
   Versioned CFR /       ELD / GPS / ECM /
   CVSA / FMCSA /        Samsara / DVIR /
   PHMSA / State Law     BOL / Photos / Etc.
          |                   |
          +---------+---------+
                    |
                    v
           Deterministic Rules
                    |
                    v
           Timeline Reconstruction
                    |
                    v
           Contradiction Detection
                    |
                    v
           Grounded AI Reasoning
                    |
                    v
             Claim Verifier
                    |
                    v
          Challenge Assessment
                    |
          +---------+----------+
          |                    |
          v                    v
     DataQs RDR            Court/Ticket
        Path                  Path
          |                    |
          +---------+----------+
                    |
                    v
            Human Approval
                    |
                    v
          Submission Tracking
                    |
                    v
            Outcome Learning
```

---

# 4. Why This Should Not Be "Upload PDF -> Ask AI"

A generic LLM can easily:

- use the wrong version of a regulation;
- misread a violation code;
- confuse a citation with an inspection violation;
- invent a CVSA threshold;
- treat an FMCSA FAQ as binding law;
- assume a repaired defect proves an inspector was wrong;
- cite a current rule for a historical inspection;
- hallucinate state law;
- miss contradictory telematics evidence;
- overstate the likelihood of dismissal.

Therefore the AI must be one component of a larger rules and evidence system.

Recommended sequence:

```text
1. Extract
2. Validate
3. Normalize
4. Resolve regulation
5. Resolve rule version
6. Retrieve OOS criteria
7. Retrieve official guidance
8. Retrieve state law if necessary
9. Collect objective evidence
10. Build timeline
11. Run deterministic rules
12. Detect contradictions
13. Run grounded AI reasoning
14. Verify every generated claim
15. Score case
16. Human review
17. Generate filing package
```

---

# 5. Authoritative Source Hierarchy

The product should explicitly label the authority level of every source.

## Tier A — Primary legal authority

### Federal
- Electronic Code of Federal Regulations (eCFR)
- 49 CFR Parts 300-399 — FMCSA / FMCSR
- 49 CFR Parts 100-185 — Hazardous Materials Regulations where applicable

### State
For citations and state-specific CMV rules:
- state statutes;
- state administrative code;
- state traffic code;
- state CMV regulations;
- state adoption or modification of federal regulations;
- applicable court rules.

## Tier B — Official agency interpretation/guidance

- FMCSA Guidance Portal
- FMCSA ELD guidance and FAQs
- PHMSA interpretations
- PHMSA FAQs
- official state agency interpretations

Guidance should be clearly marked as guidance where it lacks the force of law.

## Tier C — CVSA inspection standards

- North American Standard Out-of-Service Criteria (OOSC)
- Operational Policy 5
- Operational Policy 14
- Operational Policy 15
- Inspection Bulletins
- inspection procedures

## Tier D — Objective evidence

- ELD export
- ECM / vehicle-motion events
- GPS
- telematics
- dash camera
- fuel receipt
- toll timestamp
- maintenance work order
- DVIR
- BOL
- shipping paper
- permit
- registration
- driver qualification records
- scale ticket
- photographs
- court record
- certified disposition

## Tier E — Secondary research

Blogs, law-firm articles, forums and training materials may help discovery but should never be treated as primary authority in the final compliance recommendation.

---

# 6. Version Everything

This requirement is non-negotiable.

The system must analyze an inspection against regulations and inspection criteria effective **on the inspection date**.

Example:

```text
Inspection date: March 29, 2026
Applicable CVSA OOSC: prior edition

Inspection date: April 2, 2026
Applicable CVSA OOSC: 2026 edition
```

CVSA states that its OOS criteria are updated annually and become effective April 1.

Store:

```text
EffectiveFrom
EffectiveTo
PublishedAt
RetrievedAt
SourceUri
ContentHash
SupersedesId
AuthorityType
Jurisdiction
```

Never overwrite historical rules.

---

# 7. CVSA Licensing Constraint

The current CVSA OOS criteria are a commercial/licensed publication.

CVSA offers paid electronic and physical versions, and its public material indicates restrictions on electronic use/copying.

Therefore:

- do not scrape or redistribute the complete OOSC;
- determine the permitted internal-use/license model before storing full text;
- support licensed/manual ingestion;
- store citations and structured derived rule identifiers where permitted;
- keep the architecture capable of operating with licensed material without exposing that content outside authorized users.

This is an important commercial/legal implementation issue.

---

# 8. Core Case Types

Recommended:

```text
ROADSIDe_INSPECTION
CITATION
ADJUDICATED_CITATION
CRASH_PREVENTABILITY
HAZMAT_INSPECTION
ELD_HOS
VEHICLE_MAINTENANCE
DRIVER_FITNESS
CREDENTIAL
```

A single incident can contain multiple related objects.

```text
Incident
├── Inspection
│   ├── Violation 1
│   ├── Violation 2
│   └── Violation 3
├── Citation A
├── Citation B
└── Court Disposition
```

---

# 9. Document Intake

Accepted document classes:

```text
INSPECTION_REPORT
CITATION
COURT_DISPOSITION
BOL
SHIPPING_PAPER
ELD_OUTPUT
LOGBOOK
DVIR
MAINTENANCE_RECORD
PHOTO
VIDEO_REFERENCE
PERMIT
REGISTRATION
CDL
MEDICAL_STATUS
SCALE_TICKET
OTHER
```

Original uploads must be immutable.

Store:

```text
DocumentId
CaseId
OriginalFilename
MimeType
Sha256
UploadedAt
UploadedBy
StorageUri
PageCount
DocumentType
```

OCR/extracted data must be stored separately.

---

# 10. Inspection Extraction Schema

Example:

```json
{
  "report_number": "",
  "inspection_date": "",
  "inspection_time": "",
  "state": "",
  "agency": "",
  "location": "",
  "inspection_level": "",
  "driver": {},
  "carrier": {},
  "tractor": {},
  "trailers": [],
  "violations": [],
  "citations": [],
  "oos_conditions": [],
  "inspector": {}
}
```

For every extracted field:

```json
{
  "value": "395.8(e)(1)",
  "confidence": 0.98,
  "source_page": 1,
  "bounding_box": [0.31, 0.44, 0.65, 0.49]
}
```

Low-confidence critical fields must enter human review.

Critical fields include:

- inspection number;
- violation code;
- OOS flag;
- citation number;
- date/time;
- driver;
- vehicle;
- inspector description.

---

# 11. Violation Normalization

Entity:

```text
InspectionViolation
-------------------
Id
InspectionId
RawViolationCode
NormalizedViolationCode
CfrPart
CfrSection
CfrSubsection
ViolationDescription
InspectorNarrative
OosFlag
UnitNumber
CitationNumber
Basic
SmsSeverityWeight
SourcePage
ExtractionConfidence
```

The system should preserve both:

```text
RAW_VALUE
NORMALIZED_VALUE
```

Never destroy the inspector's original wording.

---

# 12. SMS / CSA Impact

FMCSA publishes SMS Methodology Appendix A containing the violations used in SMS and their BASIC/severity mapping.

As of June 2026, FMCSA lists SMS Methodology Appendix A version 3.21.

The system should import the official spreadsheet into a versioned table.

Recommended entity:

```text
SmsViolationDefinition
----------------------
Version
ViolationCode
CfrSection
Description
Basic
SeverityWeight
OosEligible
EffectiveFrom
EffectiveTo
```

The system should calculate:

```text
Current CSA impact
Potential impact if removed
Potential impact after dismissed citation
Potential impact if convicted of different charge
```

This lets the safety department prioritize cases.

---

# 13. Challenge Value Is Not the Same as Challenge Strength

Keep two different scores.

## Challenge Viability

How strong is the factual/regulatory case?

## Operational Impact

How valuable would a correction be?

Example:

```text
Challenge viability: 91 / 100
Operational impact: 88 / 100
Priority: P0
```

Another:

```text
Challenge viability: 42 / 100
Operational impact: 96 / 100

Recommendation:
Attorney/compliance review required; do not file automatically.
```

---

# 14. Challenge Reason Taxonomy

Use normalized reasons.

```text
FACTUAL_ERROR
WRONG_REGULATION
WRONG_SUBSECTION
DUPLICATE_VIOLATION
IMPROPER_STACKING_REVIEW
INCORRECT_OOS
INCORRECT_DRIVER
INCORRECT_VEHICLE
INCORRECT_CARRIER
IEP_RESPONSIBILITY
SHIPPER_RESPONSIBILITY
DOCUMENT_WAS_PRESENT
CREDENTIAL_VALID
TIMESTAMP_CONFLICT
LOCATION_CONFLICT
ELD_DATA_CONFLICT
ECM_DATA_CONFLICT
MEASUREMENT_CONFLICT
RULE_EXCEPTION_APPLIES
RULE_NOT_APPLICABLE
INSPECTOR_DESCRIPTION_INSUFFICIENT
CITATION_DISMISSED
CITATION_NOT_GUILTY
CITATION_DIFFERENT_CHARGE
ADMINISTRATIVE_ERROR
MISSING_REQUIRED_FACT
INSUFFICIENT_EVIDENCE
```

---

# 15. CVSA Operational Policy 14

CVSA Operational Policy 14 is highly relevant to this module.

Its stated purpose is to improve uniformity, consistency and thoroughness in documenting roadside inspection violations.

It specifically focuses on correct violation documentation, avoiding erroneous violations and reducing perceived/actual "stacking."

This should become a first-class reference in the inspection-analysis corpus.

Tests should include:

```text
Was the correct code selected?
Was the violation documented clearly?
Does the description support the selected violation?
Was the same condition recorded more than once?
Was OOS status supported?
```

---

# 16. Evidence Resolver

After identifying the violation, the system should automatically know which evidence to seek.

Example:

## HOS / ELD

Retrieve:

```text
ELD RODS
raw ELD events
vehicle-motion events
ECM status
GPS
unassigned driving
driver edits
carrier edits
diagnostic events
malfunction events
fuel transactions
tolls
dispatch events
camera events
```

## Vehicle Maintenance

Retrieve:

```text
pre-trip DVIR
post-trip DVIR
maintenance history
work orders
photos
annual inspection
tire measurements
brake measurements
ABS records
```

## Hazmat

Retrieve:

```text
BOL
shipping paper
UN number
proper shipping name
hazard class
packing group
quantity
packaging type
placard data
photos
special permits
shipper documentation
```

## Driver Fitness / Credentials

Retrieve:

```text
CDL status
endorsements
medical qualification
license expiration
permit
company DQ record
```

---

# 17. Evidence Adapter Interface

Recommended:

```csharp
public interface IEvidenceProvider
{
    Task<IReadOnlyCollection<EvidenceItem>> CollectAsync(
        EvidenceRequest request,
        CancellationToken cancellationToken);
}
```

Providers:

```text
SamsaraEvidenceProvider
EldEvidenceProvider
TmsEvidenceProvider
MaintenanceEvidenceProvider
FuelEvidenceProvider
TollEvidenceProvider
DocumentEvidenceProvider
CameraEvidenceProvider
DriverQualificationEvidenceProvider
```

---

# 18. Evidence Classification

Every evidence item needs:

```text
SOURCE
OBSERVED_AT
RETRIEVED_AT
HASH
RELIABILITY
TEMPORAL_RELEVANCE
VERIFIED
```

Also distinguish:

```text
CONTEMPORANEOUS_EVIDENCE
POST_EVENT_EVIDENCE
HISTORICAL_CONTEXT
HUMAN_STATEMENT
```

A repair after the inspection is post-event evidence.

It should not be interpreted as proof that the condition did not exist during inspection.

---

# 19. Timeline Reconstruction

This should be a flagship feature.

Example:

```text
14:28:03 GPS position stops changing
14:28:08 ECM speed = 0 mph
14:29:12 Driver switches to Off Duty
14:31:55 Fuel authorization approved
14:34:02 Fuel transaction begins
14:38:44 Roadside inspection recorded
14:43:15 Fuel transaction completes
14:46:07 ECM reports vehicle motion
```

Inspector allegation:

```text
Driver was operating while in Off Duty status at 14:38.
```

System finding:

```text
GPS, ECM and fuel records independently indicate the tractor
was stationary at 14:38.
```

That is the type of evidence-based argument this system should surface.

---

# 20. Formal Contradiction Engine

Represent relevant facts as propositions.

```text
P1 = inspector_asserts_vehicle_moving(14:38)
P2 = ecm_speed(14:38) == 0
P3 = gps_delta(14:28..14:46) == stationary
P4 = fuel_session_active(14:38)
```

Then:

```text
FindingType: FACTUAL_CONTRADICTION
Support: P2, P3, P4
Contradicts: P1
```

This can be deterministic.

The LLM only explains the finding.

---

# 21. ELD Analyzer

FMCSA's official ELD guidance describes multiple diagnostics and malfunctions, including:

```text
power
engine synchronization
timing
positioning
data recording
data transfer
missing required data
unidentified driving
```

The ELD analyzer should parse raw events and apply official thresholds deterministically.

Examples from current FMCSA guidance:

- Power compliance malfunction: aggregated in-motion understatement of 30 minutes or more in a 24-hour period.
- Engine synchronization malfunction: required ECM connectivity lost for more than 30 minutes in a 24-hour period.
- Timing compliance malfunction: UTC deviation exceeds 10 minutes.
- Unidentified-driving diagnostic: more than 30 minutes of unidentified driving in a 24-hour period.

These should be machine rules, not LLM memory.

---

# 22. Hazmat Analyzer

Because this fleet handles hazardous materials, Hazmat should be a first-class analyzer.

Sources:

```text
49 CFR Parts 171-180
PHMSA Hazmat FAQs
PHMSA Letters of Interpretation
Hazardous Materials Table
applicable special permits
```

Potential automated findings:

```text
PLACARD_REQUIRED
PLACARD_NOT_REQUIRED
WRONG_PLACARD_CLASS
QUANTITY_THRESHOLD_NOT_MET
WRONG_HAZARD_CLASS
SUBSIDIARY_HAZARD_ISSUE
SHIPPING_PAPER_ELEMENT_PRESENT
SHIPPING_PAPER_ELEMENT_MISSING
INSPECTOR_CITATION_MISMATCH
SPECIAL_PERMIT_APPLIES
```

PHMSA interpretation records should preserve status.

PHMSA currently indicates categories such as:

```text
Current
Use Caution
Historic
```

Do not rely automatically on superseded/historic interpretations.

---

# 23. Vehicle Maintenance Analyzer

Categories:

```text
brakes
tires
lighting
steering
suspension
wheels/rims/hubs
coupling devices
cargo securement
windshield/wipers
fuel system
exhaust
emergency equipment
```

Analysis questions:

```text
Does the report contain required measurements?
Does description match the regulation?
Does it satisfy OOS threshold?
Was correct component/unit identified?
Is there contemporaneous photographic evidence?
Is there independent measurement?
Is the alleged condition contradicted?
```

---

# 24. Violation Element Model

For important violations, create structured legal/regulatory elements.

Example conceptual representation:

```json
{
  "rule": "395.8(e)(1)",
  "version": "...",
  "elements": [
    {
      "id": "driver_subject_to_requirement",
      "required": true
    },
    {
      "id": "record_is_inaccurate_or_false",
      "required": true
    },
    {
      "id": "relevant_record_or_period_identified",
      "required": true
    }
  ]
}
```

Result:

```text
Element A: supported
Element B: contradicted
Element C: supported

Conclusion:
Available evidence does not presently support all required elements.
```

---

# 25. OOS Engine

OOS analysis should be separate from violation-existence analysis.

Possible outcomes:

```text
VIOLATION_SUPPORTED_OOS_SUPPORTED
VIOLATION_SUPPORTED_OOS_NOT_SUPPORTED
VIOLATION_NOT_SUPPORTED
INSUFFICIENT_INFORMATION
```

This matters because sometimes:

```text
There may have been a defect,
but the documented facts may not satisfy an OOS threshold.
```

The system should be capable of recommending a challenge specifically to the OOS designation.

---

# 26. Regulatory Resolver

Recommended lookup sequence when violation code is known:

```text
1. Exact CFR subsection
2. Parent CFR section
3. Official interpretation
4. FMCSA guidance
5. Applicable CVSA policy
6. Applicable CVSA OOS criterion
7. Active inspection bulletin
8. State adoption/modification
```

Use exact retrieval before semantic/vector retrieval.

If inspection says:

```text
393.75(c)
```

do not begin with an embedding search for "tire violation."

Resolve `393.75(c)` directly first.

---

# 27. Regulatory Data Model

Recommended entities:

```text
RegulatorySource
RegulatoryDocument
RegulatoryVersion
RegulatoryProvision
RegulatoryInterpretation
OosCriterion
InspectionPolicy
InspectionBulletin
StateStatute
StateRule
CrossReference
```

Example:

```text
RegulatoryProvision
-------------------
Id
Jurisdiction
Authority
Part
Section
Subsection
Title
Text
EffectiveFrom
EffectiveTo
PublishedAt
RetrievedAt
SourceUri
SourceHash
AuthorityType
```

---

# 28. Corpus Snapshot

Every analysis should capture:

```text
CorpusSnapshotId
```

That snapshot contains the exact regulatory versions used.

If someone asks six months later:

> Why did the system recommend this challenge?

The system can reproduce the analysis.

---

# 29. Grounded AI Contract

Input to the reasoning model:

```json
{
  "case_facts": {},
  "violations": [],
  "regulatory_authorities": [],
  "inspection_policies": [],
  "evidence": [],
  "timeline": [],
  "deterministic_findings": [],
  "missing_evidence": []
}
```

Model rules:

```text
Use only supplied authorities.

Use only supplied evidence.

Do not invent regulations.

Do not invent state law.

Do not invent measurements.

Do not infer an officer's intent.

Distinguish law/regulation from agency guidance.

Distinguish fact from inference.

If evidence is insufficient, return INSUFFICIENT_EVIDENCE.

Do not promise a legal outcome.
```

---

# 30. AI Output Contract

Example:

```json
{
  "recommendation": "STRONG_DATAQS_CANDIDATE",
  "findings": [
    {
      "type": "FACTUAL_CONTRADICTION",
      "claim": "...",
      "evidence_ids": ["E12", "E15"],
      "regulatory_ids": ["R44"],
      "confidence": 0.91
    }
  ],
  "missing_evidence": [],
  "recommended_path": "DATAQS_INSPECTION_VIOLATION",
  "draft_arguments": []
}
```

---

# 31. Claim Verifier

No generated claim should reach the user unless supported.

Every substantive statement needs:

```text
Evidence citation
OR
Regulatory citation
OR
Clearly labeled inference
```

Example:

```text
Claim:
"The tractor remained stationary from 14:28 through 14:46."

Support:
GPS E12
ECM E15

Status:
VERIFIED
```

Unsupported claims should be removed.

---

# 32. Challenge Scoring

Recommended dimensions:

```text
RegulatoryMismatchScore
EvidenceStrengthScore
FactualContradictionScore
OosMismatchScore
ProceduralFitScore
DocumentCompletenessScore
IdentityConfidenceScore
```

Suggested interpretation:

```text
90-100 VERY STRONG
75-89  STRONG
60-74  REVIEW
40-59  WEAK
0-39   DO NOT RECOMMEND
```

Do not hide the component scores.

---

# 33. Example Assessment

```text
Violation:
395.8(e)(1)

Challenge viability: 91
Operational impact: 87

Regulatory mismatch: 82
Evidence strength: 97
Factual contradiction: 96
Procedural fit: 90
Document completeness: 88

Recommendation:
VERY STRONG DATAQS CANDIDATE

Primary reason:
The factual allegation appears inconsistent with independent
ECM, GPS and fuel-transaction evidence.

Missing:
Signed driver statement is useful but not essential.
```

---

# 34. Challenge Priority

Recommended:

```text
P0
- OOS
- high SMS severity
- recent event
- strong challenge

P1
- high severity
- strong evidence

P2
- medium impact
- moderate evidence

P3
- low impact or weak case
```

---

# 35. DataQs Case State Machine

```text
NEW
DOCUMENT_PROCESSING
EXTRACTION_REVIEW
ANALYZING
EVIDENCE_MISSING
READY_FOR_REVIEW
APPROVED_FOR_CHALLENGE
RDR_DRAFTED
RDR_FILED
AWAITING_RESPONSE
MORE_INFO_REQUESTED
GRANTED
PARTIALLY_GRANTED
DENIED
RECONSIDERATION
CLOSED
```

---

# 36. RDR Type Resolver

The system should determine the correct DataQs request type.

Examples:

```text
INSPECTION_VIOLATION_INCORRECT
INSPECTION_VIOLATION_DUPLICATE
MISSING_IEP_SHIPPER_INFORMATION
CITATION_ADJUDICATION
CRASH_PREVENTABILITY
INSPECTION_RECORD_ERROR
```

Using the wrong RDR category wastes time.

---

# 37. Supporting Documentation Engine

FMCSA emphasizes supporting documentation relevant to carrier, driver, vehicle or event data.

The system should generate a checklist.

Example:

```text
Required / recommended:

[x] Inspection report
[x] Citation
[x] ELD export
[x] GPS / ECM timeline
[x] Relevant photograph
[ ] Certified court disposition
[ ] Signed driver statement
```

Cases with essential missing evidence should not be marked ready.

---

# 38. RDR Draft Generator

Draft style should be:

- factual;
- concise;
- respectful;
- evidence-driven;
- regulatory-cited;
- non-emotional.

Example pattern:

```text
We respectfully request review of violation [CODE] recorded on
Inspection [REPORT NUMBER] on [DATE].

The inspection report states [INSPECTOR FACT].

Contemporaneous [EVIDENCE SOURCE] shows [CONTRARY FACT].
Exhibit A contains [DESCRIPTION].
Exhibit B contains [DESCRIPTION].

The applicable [REGULATION / INSPECTION CRITERION] provides [RELEVANT
REQUIREMENT].

Because the contemporaneous evidence does not support [ELEMENT /
CONDITION], we request that the violation / OOS designation be reviewed
and corrected as appropriate.
```

---

# 39. DataQs Packet

Recommended generated packet:

```text
00_Evidence_Index.pdf
01_Inspection_Report.pdf
02_Citation.pdf
03_ELD_Evidence.pdf
04_GPS_ECM_Timeline.pdf
05_Photos.pdf
06_Maintenance_Records.pdf
07_Court_Disposition.pdf
08_Regulatory_Analysis.pdf
09_RDR_Narrative.txt
```

---

# 40. DataQs Integration Boundary

Current research does **not** identify a documented public DataQs API for creating RDRs, uploading evidence, reading case correspondence or retrieving RDR status. FMCSA's current public guidance continues to describe these actions as authenticated DataQs web-application workflows.

FMCSA does, however, explicitly recognize a **Public/Industry** DataQs user role that includes law firms, insurance companies and **third-party service providers**. This establishes that third-party representation is an anticipated use case, but it does **not** establish that those providers receive API credentials or a supported machine-to-machine submission interface.

Current implementation assumption:

```text
Supported public DataQs submission API        -> NOT FOUND
Supported commercial/third-party API         -> NOT FOUND
Third-party representative account model      -> CONFIRMED
FMCSA/State internal partner workflow          -> CONFIRMED, not a commercial API
Direct automated filing                       -> DO NOT DEPEND ON IT
```

Commercial DataQs service providers may automate research, evidence assembly and drafting before a human files through DataQs. Public evidence reviewed to date does not justify assuming that commercial vendors have a privileged DataQs submission API. Do not design the product around undocumented private web endpoints or reverse-engineered authentication.

Official references:
- https://dataqs.fmcsa.dot.gov/
- https://dataqs.fmcsa.dot.gov/HelpCenter/Faqs?topic_id=1

## 40.1 Do Not Auto-Submit Initially

For the first production version:

```text
Detect automatically
Ingest automatically
Analyze automatically
Draft automatically
Package automatically
File manually
```

Reasons:

- human attestation;
- compliance/legal significance;
- Login.gov/FMCSA Portal authentication and MFA;
- possible UI changes;
- absence of a documented supported submission API;
- risk of filing a weak or inaccurate case.

The first submission assistant should provide:

```text
COPY RDR NARRATIVE
DOWNLOAD EVIDENCE PACKAGE
OPEN DATAQS
SHOW REQUEST TYPE
SHOW INSPECTION / VIOLATION IDENTIFIERS
TRACK MANUAL SUBMISSION STATUS
```

Submission automation can be evaluated later only if FMCSA documents or authorizes a supported interface.

## 40.2 Official FMCSA Inspection Data Ingestion

A major architecture change is justified by FMCSA's current Open Data / Data Dissemination datasets. The system no longer needs to depend on a driver or safety employee uploading a roadside inspection before a case can exist.

The primary ingestion path should be official FMCSA/DOT machine-readable data.

### Vehicle Inspection File

Dataset ID:

```text
fx4q-ay7w
```

Official catalog:
https://catalog.data.gov/dataset/vehicle-inspection-file

The dataset is sourced from MCMIS inspection data and is available in JSON, XML and CSV formats. The public dataset intentionally excludes driver information because of privacy restrictions. As verified on September 4, 2026, the catalog reports the dataset updated September 3, 2026.

Use it as the inspection-level parent record.

### Inspections Per Unit

Official FMCSA Open Data Program description:
https://www.fmcsa.dot.gov/registration/fmcsa-data-dissemination-program

FMCSA states this file contains vehicle type, make, company number, license plate, license plate state, VIN, CVSA decal and CVSA number, with potentially multiple units per inspection. Use `INSPECTION_ID` / inspection-unit relationships to join equipment to the parent inspection and to violation records.

This dataset is the preferred bridge from public FMCSA inspection activity to the carrier's internal truck/trailer master data.

### Vehicle Inspections and Violations

Dataset ID:

```text
876r-jsdb
```

Official catalog:
https://catalog.data.gov/dataset/vehicle-inspections-and-violations

This dataset contains inspections involving FMCSR/HMR violations and is available in JSON, XML and CSV. As verified on September 4, 2026, the catalog reports the dataset updated September 3, 2026.

Use it as the primary violation-level feed.

### Inspections and Citations

Dataset ID:

```text
qbt8-7vic
```

Official catalog:
https://catalog.data.gov/dataset/inspections-and-citations

This report links inspections with associated citations and is available in JSON, XML and CSV. As verified on September 4, 2026, the catalog reports the dataset updated September 3, 2026.

Use it to distinguish an FMCSA inspection violation from a related court citation/ticket.

### Machine-readable access

The DOT catalog exposes download/query resources through `data.transportation.gov`, including JSON endpoints. Treat these feeds as official external adapters behind our own ingestion interface; do not let Socrata/DOT-specific schemas leak into the ComplianceIntelligence domain model.

## 40.3 Identity Correlation Strategy

Public inspection files omit driver PII, so the system should resolve the driver using internal evidence rather than treating that omission as a blocker.

Recommended correlation:

```text
FMCSA inspection
     |
     +--> inspection date/time
     +--> USDOT
     +--> unit / VIN / plate / equipment identifiers where available
                         |
                         v
                 Internal equipment table
                         |
                         v
             truck/trailer assignment history
                         |
                         v
                 driver at event time
                         |
                         v
               confidence-scored match
```

Potential internal corroboration sources:

```text
TMS assignment history
Samsara vehicle/driver assignment
ELD login / HOS records
GPS / telematics
dispatch/load assignment
DVIR records
fuel transaction timestamps
```

Never silently force a driver match. Store match method, confidence and source evidence. Ambiguous matches require human confirmation.

## 40.4 New Primary Workflow: Automatic Detection First

The original upload-first workflow should become the fallback/enrichment path.

Preferred workflow:

```text
FMCSA Open Data
      |
      v
Carrier/USDOT filter
      |
      v
New inspection detector
      |
      +--> inspection record
      +--> unit/VIN records
      +--> violation records
      +--> citation records
      |
      v
Internal truck/trailer/driver correlation
      |
      v
Create ComplianceIntelligence case
      |
      v
Run preliminary deterministic analysis
      |
      v
Request/attach roadside report + photos + other evidence
      |
      v
Cross-check FMCSA electronic record vs source document
      |
      v
Full challenge assessment
```

The inspection PDF/photo remains important because it can contain narrative, measurements, handwritten details, officer annotations or other evidence absent from the public feed. It should now be treated as **evidentiary enrichment and a source-of-record cross-check**, not necessarily the event that creates the case.

## 40.5 Data Freshness and Reconciliation

FMCSA's Open Data Program currently states that the Inspection Files are **updated daily from a 24-hour-old database** and are not real-time. It also states that three years of historical inspection data are published because of file size. This is materially better than the monthly SMS cycle for early detection, but it still does **not** prove that every individual roadside inspection will be visible to us exactly 24 hours after the roadside event; state reporting and upstream processing can create additional lag.

Implementation must measure actual publication latency:

```text
inspection_occurred_at
first_seen_in_open_data_at
ingested_at
matched_at
source_document_received_at
```

Calculate:

```text
publication_latency
ingestion_latency
identity_match_latency
case_ready_latency
```

Use the public open-data feed for early detection and periodic carrier-authorized FMCSA/SMS/Portal records for reconciliation where available. Never assume the public feed is the sole authoritative source for a carrier-specific dispute record.

## 40.6 FMCSA Data Adapter Boundary

Recommended provider abstractions:

```csharp
public interface IFmcsaInspectionFeed
{
    Task<IReadOnlyCollection<ExternalInspectionRecord>>
        GetChangedInspectionsAsync(
            DateTimeOffset since,
            CancellationToken cancellationToken);
}

public interface IFmcsaViolationFeed
{
    Task<IReadOnlyCollection<ExternalViolationRecord>>
        GetViolationsAsync(
            string externalInspectionId,
            CancellationToken cancellationToken);
}

public interface IFmcsaCitationFeed
{
    Task<IReadOnlyCollection<ExternalCitationRecord>>
        GetCitationsAsync(
            string externalInspectionId,
            CancellationToken cancellationToken);
}
```

Infrastructure adapters may know DOT dataset IDs and query syntax. Domain/application code should only know normalized external inspection, violation, unit and citation contracts.

---

# 41. Court Citation Intelligence

Create a separate subsystem for citations.

Status:

```text
ISSUED
UNDER_REVIEW
ATTORNEY_ASSIGNED
CONTESTED
HEARING_SCHEDULED
DISMISSED
NOT_GUILTY
CONVICTED_ORIGINAL
CONVICTED_DIFFERENT_CHARGE
PLEA
OTHER_DISPOSITION
CERTIFIED_RECORD_RECEIVED
DATAQS_UPDATE_REQUIRED
CLOSED
```

The system should:

1. determine the state/court;
2. retrieve applicable law;
3. identify the relationship to inspection violation;
4. calculate likely SMS/PSP impact of adjudication;
5. prepare factual issue list for attorney/compliance staff;
6. track hearing and disposition;
7. request certified disposition;
8. generate DataQs follow-up.

---

# 42. State Rule Packs

Do not attempt 50 states initially.

Use:

```text
JurisdictionRulePack
```

Example:

```text
US-IL
US-IN
US-OH
US-WI
```

Each should contain:

```text
traffic statutes
CMV-specific provisions
FMCSR adoption details
court-process metadata
citation deadlines
special CDL considerations
```

Prioritize states based on your actual inspection history.

---

# 43. Historical Fleet Analytics

Import prior company inspections.

Calculate:

```text
inspections_by_state
violations_by_code
violations_by_officer_agency
oos_by_category
citations_by_state
successful_DataQs_by_code
successful_DataQs_by_state
common_evidence_types
```

Use these statistics for prioritization, not as legal authority.

---

# 44. Outcome Learning

Store:

```text
CaseId
ViolationCode
State
Agency
ChallengeReason
EvidenceTypes
ViabilityScore
Filed
Outcome
ReviewDuration
AdditionalInfoRequested
CourtOutcome
FinalSmsEffect
```

Long-term value:

```text
Violation 395.x
State: IN
Evidence: ELD + GPS + ECM

13 prior challenges
10 granted
2 denied
1 pending
```

This can improve case prioritization.

It must not override current regulations.

---

# 45. Do Not Fine-Tune First

The best initial system is:

```text
Versioned authoritative corpus
+
deterministic rule engine
+
evidence graph
+
RAG
+
LLM reasoning
+
claim verification
+
human review
```

Do not fine-tune on a small collection of company disputes.

Later, once hundreds or thousands of reviewed outcomes exist, fine-tuning can help:

- document classification;
- extraction;
- case ranking;
- evidence recommendation.

Keep legal/regulatory conclusions grounded in authoritative sources.

---

# 46. Recommended AI Roles

Separate tasks:

```text
DocumentExtractor
DocumentReconciler
ViolationIssueSpotter
EvidenceReasoner
RegulatoryReasoner
NarrativeDrafter
ClaimVerifier
```

Avoid one giant prompt.

---

# 47. Suggested Domain Layout

For a C# modular monolith:

```text
src/
  Modules/
    ComplianceIntelligence/
      Domain/
        Cases/
        Inspections/
        Citations/
        Documents/
        Evidence/
        Regulations/
        Analysis/
        Challenges/
        Outcomes/

      Application/
        Intake/
        Extraction/
        RegulationResolution/
        EvidenceCollection/
        Analysis/
        DataQs/
        CitationReview/

      Infrastructure/
        Persistence/
        Documents/
        RegulatorySources/
        EvidenceProviders/
        AI/

      Api/
```

---

# 48. Core Entities

```text
ComplianceCase
CaseDocument
DocumentExtraction
Inspection
InspectionViolation
Citation
CitationDisposition
EvidenceItem
EvidenceTimelineEvent
RegulatorySource
RegulatoryVersion
RegulatoryProvision
RegulatoryInterpretation
OosCriterion
InspectionPolicy
SmsViolationDefinition
AnalysisRun
AnalysisFinding
ChallengeAssessment
RdrDraft
RdrSubmission
RdrCorrespondence
CaseOutcome
CorpusSnapshot
```

---

# 49. ChallengeAssessment Schema

```text
ChallengeAssessment
-------------------
Id
ViolationId
RegulatoryMismatchScore
EvidenceStrengthScore
FactualContradictionScore
OosMismatchScore
ProceduralFitScore
DocumentCompletenessScore
OverallViabilityScore
OperationalImpactScore
Priority
Recommendation
RecommendedPath
ModelVersion
RuleEngineVersion
CorpusSnapshotId
CreatedAt
```

---

# 50. Auditability

Store for every analysis:

```text
model provider
model name
model version
prompt template version
rule-engine version
corpus snapshot
retrieval IDs
document hashes
evidence hashes
deterministic findings
model output
verified output
human edits
final decision
```

This is essential for compliance software.

---

# 51. AI Provider Abstraction

```csharp
public interface IComplianceReasoningModel
{
    Task<ComplianceReasoningResult> AnalyzeAsync(
        ComplianceReasoningRequest request,
        CancellationToken cancellationToken);
}
```

Domain code must not reference:

```text
OpenAI SDK
Anthropic SDK
Claude-specific messages
provider-specific tool schemas
```

Put provider integrations in Infrastructure.

---

# 52. Deterministic Rule Examples

```text
IF rule.effective_from > inspection.date
THEN RULE_VERSION_MISMATCH
```

```text
IF credential.valid_from <= inspection.date
AND credential.valid_to >= inspection.date
AND violation == EXPIRED_CREDENTIAL
THEN CREDENTIAL_CONFLICT
```

```text
IF citation.disposition IN (DISMISSED, NOT_GUILTY)
AND citation linked to inspection violation
THEN DATAQS_ADJUDICATED_CITATION_CANDIDATE
```

```text
IF two violations normalize to same condition
AND same component
AND same factual basis
THEN DUPLICATE_OR_STACKING_REVIEW
```

```text
IF OOS == true
AND OOSC deterministic conditions not met
THEN OOS_REVIEW_CANDIDATE
```

---

# 53. Missing Evidence Engine

The system must be comfortable returning:

```text
INSUFFICIENT_EVIDENCE
```

Example:

```text
Violation:
Steer tire tread below required minimum.

Inspector measurement:
1/32"

Available evidence:
No contemporaneous photo.
No independent measurement.
Tire replaced after inspection.

Finding:
There is currently insufficient evidence to establish that the
recorded condition was incorrect.

Recommendation:
Do not file DataQs solely because the tire was later replaced.
```

This will save the company from low-quality challenges.

---

# 54. Human Review Gate

Before filing:

```text
[ ] Inspection fields verified
[ ] Violation code verified
[ ] Applicable rule verified
[ ] Applicable OOS version verified
[ ] Evidence verified
[ ] Claims supported
[ ] Correct filing route selected
[ ] Attachments complete
[ ] Narrative approved
```

Only then:

```text
READY_TO_FILE
```

---

# 55. UI Recommendation

Case page:

```text
Overview
Violations
Evidence
Timeline
Regulations
AI Analysis
Challenge
Documents
Outcome
Audit
```

Violation card:

```text
395.8(e)(1)
False RODS

BASIC: HOS
OOS: YES
SMS Severity: [official value]

Challenge viability: 91 / VERY STRONG
Operational impact: 87 / HIGH

Primary finding:
ECM + GPS data conflicts with recorded allegation.

[View Evidence]
[View Regulation]
[View Timeline]
[Generate RDR Draft]
```

---

# 56. Regulation Comparison UI

Use three columns:

```text
INSPECTOR RECORD
        VS
RULE / CRITERION
        VS
OBJECTIVE EVIDENCE
```

This should be the core reviewer experience.

---

# 57. Safety / Legal Guardrails

System must never:

- fabricate evidence;
- alter original inspection documents;
- fabricate driver statements;
- alter ELD history;
- backdate documents;
- invent statutory text;
- invent court outcomes;
- claim guidance is binding law when it is not;
- guarantee dismissal;
- encourage concealment of violations;
- automatically accuse an inspector of misconduct.

Use wording such as:

```text
Potential factual inconsistency
Possible code mismatch
Evidence does not presently support X
Suitable for compliance review
Strong candidate for DataQs review
```

---

# 58. Security

The module will contain sensitive driver and operational data.

Implement:

```text
tenant isolation
RBAC
encryption at rest/in transit
object-storage ACLs
audit logging
retention policies
least privilege
secrets management
access reviews
```

Suggested roles:

```text
SafetyAdmin
ComplianceManager
Reviewer
AttorneyReviewer
ReadOnlyAuditor
```

---

# 59. Reliability

Background jobs:

```text
FmcsaInspectionPollJob
FmcsaInspectionImportJob
FmcsaViolationImportJob
FmcsaCitationImportJob
EquipmentIdentityMatchJob
DriverAssignmentMatchJob
FmcsaReconciliationJob
DocumentExtractionJob
ViolationNormalizationJob
RegulatoryResolutionJob
EvidenceCollectionJob
TimelineConstructionJob
RuleEvaluationJob
AiReasoningJob
ClaimVerificationJob
ChallengeScoringJob
PacketGenerationJob
CorpusUpdateJob
```

All jobs should be:

```text
idempotent
retryable
observable
versioned
```

---

# 60. Analysis Fingerprint

Avoid unnecessary re-analysis.

```text
SHA256(
    document_hashes
  + evidence_hashes
  + corpus_snapshot
  + rule_engine_version
  + prompt_version
)
```

Analysis states:

```text
NOT_STARTED
RUNNING
COMPLETED
FAILED
STALE
```

Mark stale if inputs change.

---

# 61. Testing

## Unit tests

```text
regulation effective-date resolution
violation normalization
SMS severity lookup
OOS threshold logic
court-disposition mapping
duplicate detection
timeline contradiction
challenge scoring
```

## Golden cases

Manually reviewed scenarios:

```text
001 Incorrect ELD violation
002 Correct tire violation - no challenge
003 Dismissed citation
004 Incorrect OOS designation
005 Hazmat placarding threshold issue
006 Duplicate violation
007 Valid credential recorded as expired
```

Every release should reproduce expected findings.

---

# 62. Adversarial Tests

Test:

```text
blurry scan
missing page
wrong driver
wrong truck
duplicate pages
two citations
conflicting timestamps
outdated regulatory citation
altered screenshot
unreliable driver statement
unsupported legal argument
current regulation applied to old inspection
```

The correct response is sometimes:

```text
NEEDS_HUMAN_REVIEW
```

or:

```text
INSUFFICIENT_EVIDENCE
```

---

# 63. Metrics

Track:

```text
FMCSA feed publication latency
FMCSA ingestion success rate
inspection duplicate rate
equipment-match accuracy
driver-match accuracy / manual-confirmation rate
extraction accuracy
violation normalization accuracy
regulatory retrieval precision
rule-version accuracy
citation correctness
unsupported-claim rate
human acceptance rate
DataQs filing rate
grant rate
partial grant rate
denial rate
false-positive recommendation rate
```

Primary AI quality target:

```text
UNSUPPORTED_CLAIM_RATE -> effectively zero
```

---

# 64. Recommended Implementation Phases

## Phase 1 — Foundation

Build:

```text
case model
FMCSA inspection-feed adapter contracts
FMCSA open-data ingestion for carrier USDOT
inspection/unit/violation/citation normalization
internal VIN/equipment/driver correlation
document upload as evidence enrichment
inspection document extraction and source cross-check
violation normalization
regulatory schema
SMS Appendix A import
evidence model
analysis model
audit trail
```

## Phase 2 — First Vertical Slice

Implement one high-value flow:

```text
Inspection
-> HOS / ELD violation
-> official rule
-> ELD evidence
-> timeline
-> deterministic finding
-> grounded AI
-> claim verification
-> challenge score
-> RDR draft
```

Do not build dozens of analyzers yet.

## Phase 3 — Evidence Automation

Integrate:

```text
Samsara
ELD backend
TMS
maintenance
FuelGuard
documents
camera events
driver qualification data
```

## Phase 4 — Additional Analyzers

Priority recommendation:

```text
1. HOS / ELD
2. Driver Fitness / Credentials
3. Vehicle Maintenance
4. Hazmat
```

## Phase 5 — DataQs Workflow

Add:

```text
RDR generation
evidence packet
manual submission assistant
submission tracking
correspondence/email status capture where available
outcome
FMCSA reconciliation
```

## Phase 6 — State Citation Intelligence

Add the highest-volume states first.

## Phase 7 — Outcome Intelligence

Use company challenge history to improve prioritization and evidence suggestions.

---

# 65. First Claude Code Work Package

Give Claude Code this scope:

```text
Build the ComplianceIntelligence domain foundation only.

Do not implement autonomous legal conclusions.
Do not implement DataQs portal automation.
Do not implement all violation categories.
```

Tasks:

1. Create module boundaries.
2. Add core domain entities.
3. Add persistence/migrations.
4. Implement immutable document-storage abstraction.
5. Define inspection extraction DTO/schema.
6. Implement violation normalization interfaces.
7. Define regulatory source/version/provision model.
8. Import official SMS violation mapping from versioned source.
9. Add evidence model and evidence-provider interface.
10. Add timeline model.
11. Add deterministic finding model.
12. Add challenge assessment model.
13. Add corpus snapshot.
14. Add audit event model.
15. Add unit tests.
16. Keep AI provider abstractions in Infrastructure.
17. Do not hardcode rules from model output.
18. Return an architecture report before expanding scope.

---

# 66. Second Claude Code Work Package

Implement one complete vertical slice:

```text
HOS / ELD inspection challenge
```

Flow:

```text
Upload inspection
-> Extract 395.x violation
-> Verify extraction
-> Resolve exact regulation/version
-> Retrieve official ELD guidance
-> Add ELD/ECM/GPS evidence
-> Construct timeline
-> Run deterministic checks
-> Run grounded AI reasoning
-> Verify every claim
-> Score viability
-> Draft RDR narrative
-> Produce evidence index
```

This vertical slice should become the template for every other analyzer.

---

# 67. Recommended First Production Analyzers

## 1. HOS / ELD

High objective-data availability.

## 2. Driver Fitness / Credential

Often deterministic.

## 3. Vehicle Maintenance

Requires strong evidence discipline.

## 4. Hazmat

Very valuable but more complex; requires PHMSA/HMR expertise and careful versioning.

---

# 68. What Not to Build Yet

Avoid initially:

```text
50-state legal engine
automatic court filing
automatic DataQs submission
fine-tuned legal model
unlicensed CVSA corpus ingestion
fully autonomous challenge decisions
```

These increase risk without being necessary for the first useful system.

---

# 69. Primary Official Sources Researched

## FMCSA DataQs

DataQs Help Center:
https://dataqs.fmcsa.dot.gov/HelpCenter/Faqs

DataQs role guidance:
https://dataqs.fmcsa.dot.gov/HelpCenter/Faqs?topic_id=1

Current integration finding:
- no documented public API was identified for RDR creation, evidence upload, case correspondence or status retrieval;
- Public/Industry registration explicitly includes third-party service providers;
- this confirms third-party representation but does not establish privileged API access.

Key current points:
- violation may be reviewed if it did not exist, was recorded in error, was duplicated, or involves missing IEP/shipper information;
- repairing a violation does not make it an incorrect violation;
- adjudicated citations use a separate DataQs route;
- dismissed/not-guilty citation outcomes affect SMS and PSP treatment.


## FMCSA / DOT Open Inspection Data

FMCSA Open Data Program / Data Dissemination Program:
https://www.fmcsa.dot.gov/registration/fmcsa-data-dissemination-program

Current official program guidance:
- Inspection Files are updated daily from a 24-hour-old database and are not real-time;
- three years of historical inspection data are published;
- `INSPECTION_ID` links the Vehicle Inspection File to the related inspection datasets;
- public inspection files exclude driver information due to privacy restrictions;
- Inspections Per Unit includes vehicle type, make, company number, plate/state, VIN, CVSA decal and CVSA number;
- Vehicle Inspections and Violations includes violation code, part/category, unit number, OOS and defect verification;
- Inspections and Citations includes relevant citation code and result.

Vehicle Inspection File:
https://catalog.data.gov/dataset/vehicle-inspection-file

```text
Dataset ID: fx4q-ay7w
Formats: JSON / XML / CSV
Source: MCMIS inspection data
Public driver PII: excluded
Verified catalog update: September 3, 2026
```

Vehicle Inspections and Violations:
https://catalog.data.gov/dataset/vehicle-inspections-and-violations

```text
Dataset ID: 876r-jsdb
Formats: JSON / XML / CSV
Purpose: inspection-level violation ingestion
Verified catalog update: September 3, 2026
```

Inspections and Citations:
https://catalog.data.gov/dataset/inspections-and-citations

```text
Dataset ID: qbt8-7vic
Formats: JSON / XML / CSV
Purpose: inspection-associated citation linkage
Verified catalog update: September 3, 2026
```

Architecture conclusion:
- use these datasets as official machine-readable external feeds;
- filter to the carrier's USDOT number;
- normalize records into internal domain contracts;
- correlate vehicle identifiers with internal equipment/assignment history;
- retain document upload for evidence enrichment and record cross-checking;
- measure actual inspection publication latency before defining alert SLAs.

## FMCSA CSA / SMS

Resources:
https://csa.fmcsa.dot.gov/HelpCenter/Resources.aspx?type=format&vID=5

Current research result:
- SMS Methodology Appendix A version 3.21 listed June 2026;
- contains the SMS violation list and related regulatory sections.

## CVSA OOS Criteria

https://cvsa.org/inspections/out-of-service-criteria/

Current result:
- OOSC updated annually;
- effective April 1;
- 2026 edition became effective April 1, 2026.

## CVSA Operational Policies

https://cvsa.org/inspections/operational-policies/

Current result:
- Operational Policies 5, 14 and 15 are relevant;
- Policy 14 targets inspection-data uniformity and correct violation documentation.

## FMCSA ELD

https://www.fmcsa.dot.gov/regulations/hours-service/elds/eld-malfunctions-and-data-diagnostic-events-faqs

Use for official diagnostic/malfunction logic and thresholds.

## PHMSA Interpretations

https://www.phmsa.dot.gov/regulations/title49/b/2/1

Use for hazmat regulatory interpretation research.

---

# 70. Final Recommended Architecture

The product should ultimately behave like this:

```text
                    COMPLIANCE INTELLIGENCE

                 FMCSA OPEN INSPECTION DATA
                             |
                             v
                  CARRIER / USDOT FILTER
                             |
                             v
              INSPECTION + VIOLATION + CITATION
                             |
                             v
              EQUIPMENT / DRIVER CORRELATION
                             |
                             v
                            CASE
                             |
        +--------------------+--------------------+
        |                    |                    |
        v                    v                    v
   DOCUMENT FACTS      OBJECTIVE EVIDENCE     REGULATIONS
        |                    |                    |
        +--------------------+--------------------+
                             |
                             v
                    RULE / FACT GRAPH
                             |
          +------------------+------------------+
          |                                     |
          v                                     v
 DETERMINISTIC FINDINGS                 GROUNDED AI REVIEW
          |                                     |
          +------------------+------------------+
                             |
                             v
                       CLAIM VERIFIER
                             |
                             v
                    CHALLENGE ASSESSMENT
                             |
              +--------------+--------------+
              |                             |
              v                             v
          DATAQS RDR                    COURT PATH
              |                             |
              +--------------+--------------+
                             |
                             v
                       HUMAN REVIEW
                             |
                             v
                         OUTCOME
                             |
                             v
                    OUTCOME INTELLIGENCE
```

---

# 71. Bottom Line

This feature is technically realistic and potentially extremely valuable. The latest research materially improves feasibility because the product can detect and ingest carrier inspection activity from official FMCSA/DOT open data instead of depending exclusively on manual document uploads.

The most defensible product is **not an AI that says an officer is wrong**.

It is a system that can say:

> The inspection records violation X. The exact regulation applicable on the inspection date requires conditions A, B and C. The inspection documents support A and C, but contemporaneous ELD/ECM/GPS evidence contradicts B. The applicable OOS criterion also appears not to be satisfied. These conclusions are supported by the attached evidence and official authorities. Challenge viability: STRONG. Recommended route: DataQs inspection-violation RDR. Missing evidence: none critical.

That is the level of rigor that can make the module genuinely useful for a fleet safety department.

---

# 72. Important Disclaimer

This module should be described internally and externally as compliance decision support. State citation defenses, criminal matters, serious hazmat enforcement, DUI/controlled-substance matters, fatalities, serious injury matters and complex enforcement proceedings should be escalated to qualified legal counsel.

The system should provide evidence organization and issue spotting for those cases, but not replace legal advice.