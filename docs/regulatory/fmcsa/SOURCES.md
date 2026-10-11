# FMCSA / DataQs / SMS source documents

Official public documents the inspection-challenge engine reads or cites
(`docs/plans/safety-dqf/INSPECTION-CHALLENGE-PLAN.md`). All are U.S. Government works, so we can
redistribute them. Everything was retrieved **2026-10-10**, and the bytes here are the bytes the
URL served that day.

**This folder is a reference copy, not the engine's corpus.** The engine's regulatory corpus is a
versioned, hashed table that its loader fills from these same URLs. This folder lets a reviewer
check what the plan quotes. When FMCSA publishes a new edition, add it here under a new row. Never
overwrite a file in place: an analysis made under the old edition must stay reproducible
(plan §2, D-IC5).

| File | What it is | Edition (as printed / PDF date) | Source URL | sha256 |
|---|---|---|---|---|
| `SMS_AppendixA_ViolationsList.xlsx` | Every violation used in SMS: BASIC, group, severity weight, DSMS flag, "added in" comment | **v3.21, revised May 2026, snapshot 2026-05-15** | https://csa.fmcsa.dot.gov/Documents/SMS_AppendixA_ViolationsList.xlsx | `962edfb555385906238b23f6b8846c643e605b54dbc9ded97a44d68a788892b7` |
| `SMSMethodology.pdf` | SMS methodology: time weights, OOS weight, 30-point cap, adjudicated-citation table 2-1 | **v3.21, revised June 2026** (78 pp) | https://csa.fmcsa.dot.gov/Documents/SMSMethodology.pdf | `d19555e9da03032f75bd9ce689355804484c782a0d53f9853fd9d1c7fda32e7c` |
| `IEP_Attributable_Violations.xlsx` | Violations attributable to an Intermodal Equipment Provider | last updated Jan 2016 | https://csa.fmcsa.dot.gov/Documents/IEP_Attributable_Violations.xlsx | `59566eed5fc69b2ce2fe90ab166419c36df9369c1d5a4ad733feadcfd2023560` |
| `FMCSA-SMS-Approved-Updates-Guide.pdf` | The *proposed* replacement methodology ("compliance categories", severity 1/2). Not in force as of v3.21 | Nov 2024 (10 pp) | https://csa.fmcsa.dot.gov/Documents/FMCSA-SMS-Approved-Updates-Guide.pdf | `408207cadc7be4bc84d4774dab7ff4b63ae96e04cb6ebfafd198e0ca71d79e1f` |
| `Driver_SMSMethodology.pdf` | Driver SMS (DSMS) methodology, FMCSA/state internal use | Sep 2015 (20 pp) | https://csa.fmcsa.dot.gov/Documents/Driver_SMSMethodology.pdf | `d5eb688683079a47a05ec03986f069d61735304664d1989c5ff4126bea595552` |
| `DataQs_Users_Guide_and_Best_Practices_Manual.pdf` | **The DataQs Analyst Guide**: how a state analyst decides an RDR. §4.10 3-year window, §4.11 one appeal, §4.14 sufficiency, §4.15 14-day reply, §4.17 no retroactive codes, §6.8–6.13 inspection RDR types | 2nd ed., Dec 2014 (81 pp), still the edition the Help Center links | https://dataqs.fmcsa.dot.gov/DataQs/Data/Guide/DataQs_Users_Guide_and_Best_Practices_Manual.pdf | `a4c479ceb87b571b510e5bdf4acdbed1201832e75e2e259d6798258828188ca5` |
| `RDRTypeDefinitions.pdf` | Job aid: every RDR type and which agency decides it | Mar 2025 (4 pp) | https://ai.fmcsa.dot.gov/downloadfile.axd/RDRTypeDefinitions_508.pdf | `afbb5bdafc7b10b156aece65ec46c0760454ff4b0205321e7791bc8372dd1e0f` |
| `AdjudicatedCitations2025.pdf` | Job aid: adjudicated-citation RDR fields, outcome codes 0–3, SMS/PSP effect, **"fine paid" = citation results entered** | Jul 2025 (2 pp) | https://ai.fmcsa.dot.gov/downloadfile.axd/AdjudicatedCitations2025_508.pdf | `9506a74f8aa8c1540a7c1ed0ba7326aba0fe8ff9c032ce53c77cdb0d44b89612` |
| `ResolvingaRequestforDataReview.pdf` | Job aid: how an analyst reviews and resolves an RDR | Dec 2023 (2 pp) | https://ai.fmcsa.dot.gov/downloadfile.axd/ResolvingaRequestforDataReview_508.pdf | `3e34b436f9379b421bf46b3004ffd3d5467f9c19de0edfb999069c692c80e807` |
| `ChangingRDRType.pdf` | Job aid: why the RDR type matters, how an analyst changes it | Feb 2025 (2 pp) | https://ai.fmcsa.dot.gov/downloadfile.axd/ChangingRDRType_508.pdf | `e4e57761b5d7e09ddb571075d17aa2124609d785f37eb22891d1cec62c22bc38` |
| `SAFETYNET_InspectionReports.pdf` | Job aid: SAFETYNET inspection reports (the state side of the record) | May 2023 (2 pp) | https://ai.fmcsa.dot.gov/downloadfile.axd/SAFETYNET_InspectionReports_508.pdf | `e8d2e749c93d42ead53374f06f3ffbaa1a5db3ab48b47e4b3cfe310e55a4ef0e` |
| `DataQs_101_Helpful_Hints.pdf` | CVSA 2015 handout for analysts | Jul 2015 (2 pp) | https://ai.fmcsa.dot.gov/DataQuality/Documents/CVSA%202015/Handouts/DataQs_101_Helpful%20Hints.pdf | `97d5c858a8f1d335abdb7dfeddc0de7daf51cc5c987846819d8ea3101267b238` |
| `Registering_for_DataQs_Guide.pdf` | How a user registers, including organisation types and carrier PIN validation | Feb 2024 (14 pp) | https://dataqs.fmcsa.dot.gov/DataQs/Data/Guide/Registering_for_DataQs_Guide.pdf | `295e5797e09b37a25c86fd8e22a8401eef02f7ad526772a0cf0fe05ab38d9efe` |
| `DataQs_Factsheet.pdf` | One-page DataQs overview | Mar 2022 (2 pp) | https://dataqs.fmcsa.dot.gov/DataQs/Data/Factsheets/DataQs_Factsheet.pdf | `b9ce7d03b77cfafb890585d66f9647402f21912b69a8705501bb9ee5cc718eda` |

## Read through an API, not stored here

| Source | Why it is not a file | Endpoint (verified 2026-10-10) |
|---|---|---|
| 49 CFR (FMCSRs Parts 350–399, HMR Parts 171–180) | The engine needs the text **as it stood on the inspection date**. The eCFR versioner serves exactly that, and a downloaded copy would only be one date. §393.75 (tires, our most heavily weighted violation) has versions dated 2026-02-19 and 2026-03-23, and its text on 2024-10-01 differs from 2026-10-01. | `https://www.ecfr.gov/api/versioner/v1/full/{YYYY-MM-DD}/title-49.xml?section={n}`. **Requires `Accept-Encoding: gzip`** (returns 406 otherwise). Version list: `/api/versioner/v1/versions/title-49.json?section={n}` |
| FMCSA inspection open data | Refreshed daily, and it is our data, not a reference | data.transportation.gov (Socrata): `fx4q-ay7w` Vehicle Inspection File, `876r-jsdb` Vehicle Inspections and Violations, `wt8s-2hbx` Inspections Per Unit, `qbt8-7vic` Inspections and Citations, `rbkj-cgst` SMS Input – Inspection, `8mt8-2mdr` SMS Input – Violation |

## Could not be retrieved, and why

| Document | State on 2026-10-10 | Who resolves it |
|---|---|---|
| CVSA North American Standard Out-of-Service Criteria (2026 ed., effective 2026-04-01) | Sold by CVSA, with restricted electronic use. It cannot be stored here | Owner, under plan Q-IC3 |
| CVSA Operational Policies (incl. OP 14 "Enhancing Roadside Inspection and Enforcement Data Uniformity"), OP 15, Inspection Bulletins | cvsa.org's public `wp-content/uploads/…` links now return **404** (moved). OP 14 is the duplicate/"stacking" rulebook | Owner downloads them from cvsa.org (member area if needed), Q-IC3 |
| CPDP Submitter Guide (crash preventability) | fmcsa.dot.gov returns 403 to scripted requests. Out of scope for phase 1 anyway (plan §1.3) | Fetch by hand when CPDP is planned |
