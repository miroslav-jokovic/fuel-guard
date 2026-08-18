# Silvicom360 Defensive Driving — Module 1 Planning Specification

**Module:** 01 — Silvicom360 Introduction & Professional Driver Mindset
**Document status:** Planning baseline; not approved for production or release
**Version:** 0.1
**Prepared:** 2026-08-17
**Target product:** FuelGuard Safety Training
**Verified code baseline:** branch `claude/efs-phase-10-write-path`, commit `e1a20a427c482c0576e3f6fd396bb21c6886d1f2`
**Source-program plan:** `Silvicom360_Defensive_Driving_System_Plan.docx`, SHA-256 `33117e5fbb8656fceab3787dd6a01b302c2eab46b010f9a10d4069ac05ee5376`
**Document owner:** Unassigned
**Required approvers:** Safety/program owner, operations representative, FuelGuard engineering owner, legal/compliance reviewer

> This document separates verified facts, inherited proposals, and unresolved company decisions. An item marked **Decision required** is not permission to invent an answer during scripting or implementation.

## 1. Outcome and scope

Module 1 establishes the language, expectations, and observable behaviors used by every later Silvicom360 module. It is the pilot content unit for the training system and the reference production package for narration, graphics, captions, quizzes, versioning, and FuelGuard delivery.

The module is successful only when a driver can:

1. explain what Silvicom360 is and is not;
2. identify the six proposed SILVIC principles in plain language;
3. distinguish a professional, preventive choice from a rushed or assumption-based choice; and
4. accept the company expectation to stop, reassess, communicate, and report when safe operation is uncertain.

### 1.1 Included

- Module 1 learning design, content boundaries, timing, and scene plan.
- Claim-by-claim research and review requirements.
- Assessment blueprint and measurable acceptance criteria.
- Complete production-package definition.
- The minimum generic FuelGuard training foundation needed to assign, deliver, assess, and record Module 1.
- Pilot, release, rollback, and evidence requirements.

### 1.2 Excluded

- Final approved narration script.
- Final brand identity, logo, music license, filmed footage, or edited video.
- Modules 2–10 content.
- Formal trademark clearance or legal opinion.
- ELDT certification, Training Provider Registry registration, or any government credential.
- A road-check scoring instrument; Module 1 may introduce accountability, but behind-the-wheel qualification is a separate work product.

## 2. Verified baseline

### 2.1 Program-plan facts

The source program plan specifies:

- a 10-module core course;
- Module 1 title: **Silvicom360 Introduction & Professional Driver Mindset**;
- target video length: **8–10 minutes**;
- primary outcome: understand program purpose, expectations, and accountability;
- six proposed principles: See Far Ahead, Inspect the Whole Scene, Leave Space, Verify Before Moving, Interact Predictably, and Control Speed & Self;
- original scripts, footage, graphics, assessments, and terminology;
- captions and transcripts;
- a short knowledge check; and
- a separate road observation rather than treating digital completion as proof of driving competence.

These are inherited program proposals, not proof that the curriculum, policy language, name, or mark has been approved.

### 2.2 FuelGuard facts verified in code

| Area | Current fact | Evidence | Planning consequence |
|---|---|---|---|
| Product entitlement | `training` is a valid module key and is labeled “Safety Training.” | `packages/shared/src/entitlements.ts` | Reuse the existing entitlement; do not introduce a second product key. |
| Driver feature control | `training` exists in the driver feature catalog but `released: false`. | `packages/shared/src/featureCatalog.ts` | Build behind the existing unreleased feature. Flip release state only after all gates pass. |
| Tenant provisioning | Migration 0139 granted `training` to organizations that existed when the migration ran; new tenants do not receive it automatically. | `supabase/migrations/0139_backfill_modules_existing_orgs.sql`, `0088_module_entitlements.sql` | Production entitlement must be verified for the target org; migration history is not proof of current live state. |
| Driver identity | The driver app resolves the signed-in driver from the verified JWT; `drivers.user_id` can be null. | `apps/api/src/routes/me.ts`, `supabase/migrations/0003_core_tables.sql` | First release can target linked app users; assigning unlinked drivers requires a separately approved delivery channel. |
| Driver app | React Native/Expo 57 app with Expo Router, feature resolution, persisted React Query cache, and explicit offline/error states. | `apps/driver/package.json`, `apps/driver/app/_layout.tsx`, `apps/driver/DESIGN.md` | The current learner surface belongs in the driver app, not the legacy Vue-only player design. |
| Training UI | No training route or row exists in the driver app’s More screen. | `apps/driver/app/(tabs)/more.tsx`, `apps/driver/app/_layout.tsx` | Add gated training routes and a More entry. |
| Video runtime | `expo-video` is not installed. | `apps/driver/package.json` | Add the Expo-SDK-compatible package and rebuild the native dev client before device testing. |
| Admin web | Safety navigation and role/capability helpers exist, but no training page exists. | `apps/web/src/lib/nav.ts`, `apps/web/src/router/index.ts` | Add a module-gated Safety Training management surface using current Vue design primitives. |
| API | Express auth, org scoping, audit helpers, and `requireModule()` exist; no training router or service exists. | `apps/api/src/app.ts`, `apps/api/src/middleware/requireModule.ts` | All training mutations and grading must use new org-scoped API routes behind existing middleware. |
| Database | Migration history currently reaches `0201`; no general training tables exist. | `supabase/migrations/`, code search on 2026-08-17 | The July plan’s proposed migrations 0079–0081 are obsolete numbers. Reserve the next available numbers at implementation time. |
| Notifications | `training_due` exists as a notification category, but no producer currently creates course-due events. | `packages/shared/src/notificationsContract.ts`, migrations 0089/0093/0154 | Reuse the category only after assignment/reminder events exist. |
| Compliance records | Hazmat training certifications exist and have regulation-specific fields. | migration 0127 and compliance services | Do not write Silvicom360 completion into `hazmat_training`; it is a different record type and legal context. |

### 2.3 Legacy micro-LMS plan disposition

`docs/plans/DRIVER-TRAINING-PLAN.md` is design input, not an implementation baseline. It was written before the current migration line and before the present React Native driver-app structure. Preserve its useful decisions—immutable published versions, server-side grading, private media, resume support, org scoping, and append-only events—but revalidate every file path, migration number, dependency, UI target, retention statement, and delivery channel during implementation.

## 3. Facts, proposals, and decisions required

| ID | Topic | Status | Current evidence | Release requirement |
|---|---|---|---|---|
| M1-D01 | Program name and SILVIC mnemonic | **Decision required** | Proposed in the source plan. A simple web search found no obvious exact-name use, but that is not clearance. | Trademark counsel or qualified reviewer documents the clearance decision before public/external use. |
| M1-D02 | Internal-only positioning | **Supported** | Source plan explicitly describes an internal proprietary program and disclaims third-party affiliation. | Opening and completion copy must not claim government certification, Smith System affiliation, or ELDT status. |
| M1-D03 | Audience | **Decision required** | Source plan mentions company drivers, new hires, annual refreshers, and remedial use. | Name the launch cohort: linked driver-app users only, or an approved alternative channel for unlinked drivers. |
| M1-D04 | Company policy statements | **Unknown** | No Silvicom driving/safety policy was supplied in this workspace. | Program owner provides the current policy source and approves every “company expects/requires” statement. |
| M1-D05 | Pass rule | **Reconfirm** | Source plan recommends 80%; legacy LMS plan records 80% as owner-confirmed in July 2026. | Program owner signs the Module 1 rule sheet. Proposed: 5 served questions, 4 correct to pass. |
| M1-D06 | Watch rule and retakes | **Reconfirm** | Legacy plan proposes 90% watched, rewatch after failure, and full reset after three failures. | Decide whether these global rules apply to Module 1 pilot. Do not hide punitive behavior in implementation. |
| M1-D07 | Languages | **Decision required** | Source plan requests transcripts and translated versions but names no languages. | Identify launch language(s), translator/reviewer, and whether audio, captions, transcript, and quiz all require translation. |
| M1-D08 | Media delivery | **Decision required** | Private Supabase Storage is the legacy proposal; no production cost or device test was supplied. | Complete representative-device and connection test plus monthly egress estimate before rollout. |
| M1-D09 | Training retention | **Decision required** | 49 CFR 380.725’s three-year rule applies to TPR entities; it does not automatically govern this internal course. | Legal/records owner sets retention, deletion, litigation-hold, and employee-separation rules. |
| M1-D10 | Brand tone and narrator | **Decision required** | Source plan calls for an original narrator and professional-driver tone. | Approve voice profile, terminology list, lower thirds, intro/outro, and music policy before filming. |
| M1-D11 | Pilot size and sites | **Decision required** | Source plan only says “small driver group + trainers.” | Name cohort, device mix, connectivity mix, terminals, start/end dates, and success thresholds. |

## 4. Learning design

### 4.1 Audience and prerequisites

**Provisional audience:** Silvicom company CMV drivers assigned the core defensive-driving course through FuelGuard. This must be confirmed by M1-D03.

**Prerequisites:** No Silvicom360 module is required before Module 1. A driver’s CDL, medical, employment, hazmat, or equipment qualification is outside this module and must continue to be controlled by the systems and policies that own those facts.

**Required positioning:** This is employer-specific safety training. It does not replace a CDL, ELDT, medical qualification, endorsement, equipment-specific instruction, hazmat training, or required behind-the-wheel evaluation.

### 4.2 Measurable objectives

By the end of Module 1, the learner will be able to:

1. **Describe scope:** select the accurate statement that Silvicom360 is an internal defensive-driving system supported by digital learning, coaching, assessment, and road observation—not a government or third-party certification.
2. **Recognize the framework:** match each of the six proposed SILVIC principles to its plain-language behavior with at least five of six correct during the pilot comprehension check.
3. **Choose the professional action:** in a realistic time-pressure scenario, choose the option that creates time, verifies conditions, communicates predictably, and avoids proceeding on an assumption.
4. **Apply accountability:** identify the correct response when a driver is unsure, impaired, distracted, rushed, or facing an unsafe condition: stop or slow the work as needed, reassess, follow company escalation/reporting policy, and do not conceal the condition.

The final script must not claim that attitude alone prevents crashes. It must connect “mindset” to decisions another person can observe and coach.

### 4.3 Message architecture

| Message | What the learner should retain | What the script must avoid |
|---|---|---|
| Professionalism is observable | Preparation, attention, space, verification, predictable communication, self-control, and honest reporting. | Praise-only language such as “good drivers care more.” |
| Safety creates time | Early recognition and margin create options before a hazard becomes an emergency. | Unsupported stopping-distance numbers or universal seconds-based rules. |
| The six principles work together | SILVIC is a continuous 360-degree scan-and-decision framework. | Presenting the mnemonic as legally required or already trademark-cleared. |
| Accountability includes speaking up | A professional driver does not proceed merely because a schedule, customer, or peer creates pressure. | Invented company escalation contacts or disciplinary promises. |
| Digital completion is one part | Video and quiz completion document knowledge; road observation and daily behavior address skill. | Calling a completion record proof of safe driving or a license to operate. |

## 5. Regulatory and research boundary

The final script may summarize only claims that are mapped to an approved source and reviewed in context. Module 1 should use principles rather than dense regulatory quotations.

| Topic | Approved source baseline | Permitted use in Module 1 | Constraint |
|---|---|---|---|
| Operating responsibility | 49 CFR 392.2 and applicable state/local rules | State that CMV operation is governed by applicable laws and company policies. | Do not imply this module is a complete regulatory briefing. |
| Fatigue/fitness | 49 CFR 392.3; FMCSA driver resources | Support the expectation not to operate when alertness or ability is impaired. | Company reporting steps remain M1-D04. |
| Vehicle readiness | 49 CFR 392.7 | Support “verify before moving” at an introductory level. | Detailed inspections belong in equipment/policy training. |
| Seat belts | 49 CFR 392.16 | A brief visual may show proper restraint as a baseline professional behavior. | Do not expand Module 1 into a seat-belt compliance lesson. |
| Electronic devices | 49 CFR 392.80 and 392.82 | Support the expectation that training is completed while safely parked, not while driving. | Exact operational exceptions and company device policy require review. |
| Defensive-driving topics | FMCSA CMV Driving Tips and CMV non-regulatory best-practices report | Support visual search, space, speed, hazard awareness, fatigue, backing, and ongoing training as recognized safety topics. | Identify recommendations as guidance, not regulation. |
| ELDT boundary | FMCSA Training Provider Registry and CDL/ELDT guidance | State that applicable entry-level drivers must use a registered provider for ELDT and that this internal module makes no such claim. | Never issue an ELDT certificate from this course without a separate compliant program. |
| Captions/transcript | WCAG 2.2 SC 1.2.2 and 1.2.3 | Require synchronized captions and a complete text alternative/transcript for prerecorded synchronized media. | Captions must include meaningful non-speech audio and must not obscure relevant visuals. |

Every script draft must carry a source register with: claim ID, exact wording, source URL/document, retrieval date, reviewer, disposition, and affected scene. Unsourced numbers, legal conclusions, equipment claims, and company-policy claims are prohibited.

## 6. Content structure and timing

**Target edited-video duration:** 8:45.
**Allowed release window:** 8:00–10:00.
**Narration budget:** approximately 1,050–1,180 spoken words at 125–135 words per minute, leaving room for scenario pauses and on-screen comprehension prompts.
**Assessment time:** 3–5 minutes outside the video.

| Time | Duration | Content block | Learner action | Exit condition |
|---|---:|---|---|---|
| 00:00–00:30 | 0:30 | Cold open: schedule pressure plus an uncertain path | Observe; answer “What would you verify before moving?” | Learner recognizes that the safe decision starts before movement. |
| 00:30–01:15 | 0:45 | What Silvicom360 is and is not | Listen/read | Scope and non-certification boundary stated plainly. |
| 01:15–02:20 | 1:05 | Professional-driver mindset as observable behavior | Compare two choices | Learner sees preparation, margin, verification, communication, and self-control as behaviors. |
| 02:20–04:35 | 2:15 | Six SILVIC principles | Match principle to a quick visual | Each principle receives one definition and one observable example. |
| 04:35–05:45 | 1:10 | Accountability before, during, and after movement | Select when to stop/reassess/report | Company-specific reporting wording remains a placeholder until M1-D04 is resolved. |
| 05:45–07:20 | 1:35 | Two integrated decision scenarios | Pause and choose | Preferred choice and rationale shown without shaming. |
| 07:20–08:10 | 0:50 | How FuelGuard training, assessment, and road observation fit together | Review learning lifecycle | Learner understands what is recorded and what completion does not prove. |
| 08:10–08:45 | 0:35 | Six-principle recap and commitment | Recall three immediate actions | Transition to knowledge check. |

## 7. Scene-by-scene storyboard blueprint

| Scene | Time | Visual plan | Narration/teaching intent | Interaction or text | Evidence/review gate |
|---|---|---|---|---|---|
| 1 | 00:00–00:30 | Parked cab or controlled yard. Driver faces time pressure and an obstructed/uncertain departure path. No unsafe movement is filmed. | A schedule does not remove uncertainty; the professional choice is to create time and verify. | Prompt: “What must be verified before this truck moves?” | Safety lead approves setup and controlled-filming plan. |
| 2 | 00:30–01:15 | Original Silvicom360 title treatment over company-owned equipment; simple diagram showing digital lesson → knowledge check → coaching/road observation. | Define the program and explicitly state the non-ELDT/non-government/non-third-party boundary. | On-screen: “Internal training · Original content · Knowledge + observed behavior.” | Legal/compliance approval of all certification language. |
| 3 | 01:15–02:20 | Split sequence: rushed assumption versus calm pause, mirror/scene check, space, signal, and communication. | Define professional mindset through visible actions, not personality or seniority. | Three labels: “Prepare · Verify · Act predictably.” | Operations confirms examples match actual work. |
| 4 | 02:20–02:42 | Long-view roadway/diagram with developing traffic conflict. | Introduce **See Far Ahead**. | “Identify change early.” | FMCSA guidance source logged; no unsupported distance claim. |
| 5 | 02:42–03:04 | Mirror/camera/side-space montage while stationary or from safely captured footage. | Introduce **Inspect the Whole Scene**. | “Road · mirrors · sides · intersections.” | Fleet/equipment reviewer confirms camera/mirror depiction. |
| 6 | 03:04–03:26 | Diagram of following and lateral space; vehicle cuts in and gap is calmly rebuilt. | Introduce **Leave Space**. | “Create margin · protect it · rebuild it.” | No universal following-time value unless separately approved. |
| 7 | 03:26–03:48 | Turn/lane/backing setup in controlled yard; GOAL shown only as a generic action if terminology is approved. | Introduce **Verify Before Moving**. | “Do not move on an assumption.” | Ensure later Module 6 owns detailed backing procedure. |
| 8 | 03:48–04:10 | Early signal, controlled braking, lane position, appropriate communication. | Introduce **Interact Predictably**. | “Make your next move understandable.” | Company horn/light policy reviewed before examples are final. |
| 9 | 04:10–04:35 | Speed reduction for conditions, phone put away while parked, driver pauses when fatigued/upset. | Introduce **Control Speed & Self**. | “Conditions outside. Condition inside.” | Regulatory and company-policy language reviewed. |
| 10 | 04:35–05:45 | Before/during/after timeline using original graphics and brief real footage. | Accountability means being ready, staying engaged, and reporting/learning after a concern or event. | Placeholder for approved escalation channel. | M1-D04 must be resolved; do not invent contacts or disciplinary rules. |
| 11 | 05:45–06:32 | Scenario A: late departure, customer pressure, questionable clearance/path. | Preferred action combines V, I, and C: stop, verify, communicate, and proceed only when safe. | Multiple-choice pause with one defensible best action. | Operations validates realism and authority to stop. |
| 12 | 06:32–07:20 | Scenario B: traffic compresses after a cut-in while driver is frustrated. | Preferred action combines S, L, I, and C: see change, rebuild space, remain predictable, control reaction. | Decision prompt followed by explanation. | Safety SME approves sequence; footage may not stage roadway risk. |
| 13 | 07:20–08:10 | FuelGuard learner flow mock: assignment, video, quiz, completion record, then separate coaching/road check. | Explain what the system records and that digital completion is not the sole competency measure. | “Knowledge record ≠ road qualification.” | Engineering confirms screens match shipped product before final edit. |
| 14 | 08:10–08:45 | Six original icons resolve into a 360 ring around the vehicle, followed by a parked-driver call to action. | Recap: see, inspect, leave, verify, interact, control. Close with the approved company expectation. | “When unsure: create time, verify, communicate.” | Brand, legal, safety, and operations sign-off. |

## 8. Script and production standards

### 8.1 Voice and wording

- Write directly to the driver using respectful adult language.
- Prefer short active sentences and concrete verbs.
- Describe the preferred behavior and its reason; do not shame, threaten, or imply that incident-free history makes a driver immune to risk.
- Use “crash” or “collision” consistently after safety/legal review; do not alternate terminology casually.
- Do not use third-party slogans, diagrams, proprietary terminology, course structures, or recognizable recreations.
- Do not use “certified,” “qualified,” “approved by DOT,” “Smith equivalent,” or similar wording unless the exact claim has written approval.
- Put critical teaching in narration and captions, not only in a visual.

### 8.2 Visual system

Module 1 establishes the series package. Required components are:

- approved Silvicom360 wordmark/title treatment;
- six original principle icons and one combined 360 framework graphic;
- narrator/instructor lower third;
- section card, decision prompt, preferred-action explanation, and three-point recap card;
- original truck/yard/cab footage or properly licensed material with a recorded license;
- FuelGuard learner-screen capture recorded from the release-candidate build;
- 16:9 master with safe areas that remain legible on a 360-pixel-wide phone;
- no critical text baked into footage when it should be accessible/localizable UI or captions.

### 8.3 Audio, music, and captions

- Record clean narration with consistent loudness and no clipping.
- Music is optional. If used, it must be original or licensed for internal digital training, kept below speech, and logged in the media register.
- Provide human-reviewed WebVTT captions, a plain-text transcript, and a caption-QA checklist.
- Captions must identify speakers and meaningful non-speech audio when needed for understanding.
- Any visual-only teaching point must also be expressed through narration or a text alternative.

### 8.4 Safety and privacy during filming

- Film moving-road material with a dedicated, approved capture setup; the operating driver does not handle production equipment.
- Stage decision points in a yard, simulator, parked cab, diagram, or existing lawful footage rather than creating a hazard.
- Obtain written releases for identifiable people and property as directed by counsel/company policy.
- Remove or blur customer information, shipping papers, license plates, device notifications, credentials, and other confidential data unless specifically approved.
- Log location, vehicle/unit, date, operator, camera placement, release, and asset owner for every retained shot.

## 9. Assessment blueprint

### 9.1 Proposed delivery rule

This rule is not final until M1-D05 and M1-D06 are signed:

- maintain an eight-question bank;
- serve five questions per attempt;
- require four correct answers for an 80% passing score;
- include at least three scenario-based questions in every served set;
- randomize question and option order while preserving the exact served set in the attempt record;
- grade only on the server; and
- show explanations only after submission.

### 9.2 Blueprint

| Objective | Bank count | Served minimum | Item form | Evidence of mastery |
|---|---:|---:|---|---|
| Scope and non-certification boundary | 1 | 1 | Single-select | Selects the accurate description of Silvicom360. |
| Six-principle recognition | 2 | 1 | Matching or single-select | Correctly maps a principle to its behavior. |
| Professional preventive choice | 3 | 2 | Scenario single-select | Chooses the action that creates time, verifies, and preserves options. |
| Accountability and escalation | 2 | 1 | Scenario single-select | Chooses stop/reassess/communicate/report instead of concealment or assumption. |

### 9.3 Item-writing rules

- One best answer must be defensible from the taught content.
- Distractors must be plausible mistakes, not jokes or obviously reckless caricatures.
- Do not test obscure regulatory citations, exact narration phrases, or trivia.
- Do not use “all of the above,” “none of the above,” double negatives, or true/false items.
- Each item record must include objective ID, correct-answer rationale, distractor rationale, source/scene, reviewer, version, and pilot statistics.
- A question missed by a large share of the pilot is reviewed for ambiguity before treating the result as a learner failure.

## 10. Production package and file contract

All release files must use a versioned, immutable release folder. Proposed convention:

`silvicom360/core/v1.0.0/module-01/`

| Artifact | Required filename pattern | Acceptance check |
|---|---|---|
| Approved content brief | `m01-content-brief-v1.0.0.pdf` | All decisions and claims resolved or explicitly excluded. |
| Script | `m01-script-v1.0.0.docx` | Line-by-line content, legal, safety, and operations approval. |
| Storyboard | `m01-storyboard-v1.0.0.pdf` | Every script block mapped to a visual and source. |
| Shot list | `m01-shot-list-v1.0.0.xlsx` | Location, equipment, talent, release, safety control, and status present. |
| Master video | `m01-master-1080p-v1.0.0.mp4` | Playback, audio, color, and full-frame review pass. |
| Mobile rendition | `m01-mobile-v1.0.0.mp4` | Representative devices and constrained network pass. |
| Captions | `m01-en-US-v1.0.0.vtt` | Human-reviewed timing, spelling, speaker and sound labels. |
| Transcript | `m01-en-US-transcript-v1.0.0.txt` | Matches approved narration and conveys visual-only information. |
| Thumbnail | `m01-thumbnail-v1.0.0.png` | Legible at phone size; no unapproved marks. |
| Question bank | `m01-question-bank-v1.0.0.json` or controlled authoring export | Schema validation and independent item review pass. |
| Source register | `m01-source-register-v1.0.0.xlsx` | Every factual/company claim mapped and approved. |
| Media/release register | `m01-media-register-v1.0.0.xlsx` | Ownership/license/release evidence complete. |
| Approval record | `m01-approval-v1.0.0.pdf` | Named approvers, date, checksum/version, dispositions. |

The content system must store release metadata and checksums; it must not rely on filenames alone as proof of version.

## 11. FuelGuard implementation plan

### 11.1 Content hierarchy

Use one generic hierarchy across all ten modules:

- **Product entitlement:** `training`
- **Course:** `Silvicom360 Defensive Driving — Core Course`
- **Published course version:** immutable snapshot such as `1`
- **Training segment (displayed to users as “Module”):** `module_01`
- **Asset set:** video, captions, transcript, thumbnail
- **Assessment:** version-pinned questions for that segment
- **Assignment:** course plus scope; Module 1 pilot uses scope `[module_01]`
- **Attempt:** one learner’s version-pinned work and result

Do not create a Module 1-specific table or hard-code Silvicom360 into generic training services. The first module proves the reusable model.

### 11.2 Planned code surfaces

| Layer | Planned location | Responsibility |
|---|---|---|
| Shared contracts | `packages/shared/src/training.ts` plus barrel export | Zod schemas, enums, request/response types, state-transition inputs, event names. |
| Database | next available `supabase/migrations/` numbers at implementation start | Core training tables, indexes, RLS, storage setup, append-only event guards. |
| RLS tests | `supabase/tests/` matrix discovered by the existing runner | Cross-org isolation, role matrix, driver self-scope, raw PostgREST denial where required. |
| API routes | `apps/api/src/routes/training/` | Admin authoring/publish/assign and driver learner endpoints. |
| API services | `apps/api/src/services/training/` | Publish snapshot, assignment, progress/state machine, server grading, signed media, events. |
| API mount | `apps/api/src/app.ts` | Mount authenticated, module-gated training router; keep route-auth fitness discovery intact. |
| Admin web | `apps/web/src/features/training/` and focused pages in `apps/web/src/pages/` | Course/segment authoring, publish validation, assignment, pilot reporting. |
| Web route/nav | `apps/web/src/router/index.ts`, `apps/web/src/lib/nav.ts` | Add Safety Training behind Safety access and the `training` entitlement. |
| Driver feature | `apps/driver/src/features/training/` | Queries, player state, quiz, completion, offline/error recovery. |
| Driver routes | `apps/driver/app/training/index.tsx`, `apps/driver/app/training/[assignmentId].tsx`, root stack | Training list and learner player. |
| Driver entry | `apps/driver/app/(tabs)/more.tsx` | Show “Safety training” only when resolved feature `training` is enabled. |
| Feature release | `packages/shared/src/featureCatalog.ts` | Keep `released: false` through pilot build; change only in the release step. |

### 11.3 Minimum data model

The implementation migration must define and test at least:

- `training_courses`: org-scoped mutable course container;
- `training_segments`: ordered draft segments with stable `segment_key`;
- `training_questions`: draft item bank with correct answers never exposed to learner payloads;
- `training_videos`: private asset registry and processing status;
- `training_course_versions`: immutable published snapshot of content, rules, assets, and questions;
- `training_assignments`: org-scoped learner, scope, due date, status, and assigning actor;
- `training_attempts`: assignment/version pin, attempt number, status, score, timestamps, attestation if approved;
- `training_segment_progress`: state, watched progress, resume point, and completion;
- `training_quiz_attempts`: exact served item/choice order, answers, grade, timestamps;
- `training_events`: append-only evidence and operational events; and
- optional delivery-meter rows if the storage cost gate requires them.

Required database invariants:

1. every row is tenant-scoped where applicable;
2. an assignment cannot reference a learner outside its organization;
3. a started attempt is pinned to one immutable published version;
4. published snapshot content cannot be updated or deleted through application roles;
5. correct answers are not learner-readable;
6. only one active attempt exists per assignment;
7. state transitions are atomic and replay-safe;
8. events cannot be updated, deleted, or truncated by application paths;
9. media paths begin with the owning org and asset identifiers; and
10. the `training` module gate is enforced in RLS/API/UI, not UI alone.

### 11.4 API boundary

**Admin routes** require authentication, organization, `requireModule("training")`, and a role that can manage Safety. Read-only reporting may include Safety viewers/auditors if approved by the existing capability matrix.

**Driver routes** derive the driver from the verified JWT and never accept an arbitrary driver ID. The assignment ID is ownership-checked against the resolved driver and org before any data or media URL is returned.

Minimum operations:

- create/update draft course and segment;
- upload/attach private media and captions;
- validate and publish an immutable version;
- create Module 1-scoped assignments;
- list the signed-in driver’s assignments;
- start/resume an attempt idempotently;
- mint a short-lived private media URL after entitlement and assignment checks;
- record bounded progress heartbeats;
- start or resume the same open quiz attempt;
- grade atomically on the server;
- complete/fail/reset according to the approved rule sheet;
- write audit/training events for all material transitions; and
- provide pilot metrics without exposing another driver’s answers to unauthorized users.

### 11.5 Driver-app player

Use Expo’s SDK-compatible `expo-video` package only after installation with `expo install`; the current SDK 57 documentation recommends the compatible 57.x package line. A native dependency change requires a rebuilt dev client under the repository’s existing driver workflow.

Required states:

- assignment list: loading, empty, error, offline/cached, due, in progress, completed;
- player: loading URL, ready, playing, paused, buffering, reconnecting, expired URL, media failure;
- progress: not started, watching, ready for quiz, must rewatch, passed;
- quiz: loading, in progress, autosave/recovery if approved, submitting, passed, failed, reset;
- completion: score, version, completion timestamp, and accurate statement of what completion means.

Required behavior:

- block the entry and route when the resolved `training` feature is off;
- pause when the app backgrounds; background time does not count;
- resume from server state after app termination or connection loss;
- provide captions and transcript access;
- honor Dynamic Type, screen reader labels, focus order, contrast, and at least 44-point touch targets;
- do not start or continue playback while the app is being used as an in-motion driving task;
- fail closed on malformed learner data, wrong assignment, revoked assignment, or unpublished content; and
- preserve the existing Driver App design contract and semantic tokens.

### 11.6 Admin authoring and assignment

The first admin surface may be limited to Module 1, but its model must be generic. It must provide:

- draft validation with actionable errors;
- version preview showing the exact content that will be frozen;
- upload status and asset metadata;
- question-bank review without exposing answers on learner routes;
- assignment to a controlled pilot cohort;
- current progress, overdue state, attempts, score, and last activity;
- event history for support/audit;
- archive/revoke rather than destructive deletion; and
- explicit separation between training completion and DQF/hazmat certifications.

### 11.7 Media storage and delivery

Use a private bucket and short-lived signed URLs if Supabase Storage passes the cost, revocation-risk, and device gates. Supabase documents private buckets, bucket-level MIME/size restrictions, signed downloads, and TUS resumable uploads for large or unreliable-network uploads.

Before approval:

1. measure final master and mobile-rendition sizes;
2. estimate monthly delivery for the named pilot and full deployment;
3. confirm signed URLs remain valid until expiry and document the accepted revocation window;
4. test seeking, expiry renewal, captions, cache behavior, and resume on representative iOS and Android devices;
5. test rural/limited connection profiles and interrupted downloads; and
6. decide whether offline caching is allowed, how long it persists, and how a revoked assignment invalidates access.

### 11.8 Privacy, records, and security

- Collect only records needed for assignment, learning evidence, support, and approved analytics.
- Do not place names, emails, or driver IDs in storage object names or application logs when opaque IDs work.
- Do not claim watched-range telemetry proves attention; document it as system activity evidence.
- Define retention through M1-D09 before production data is collected.
- Define who can see individual answers, scores, and attempt history.
- Extend secret scanning, route-auth tests, RLS matrices, IDOR tests, rate limits, and audit coverage.
- Use correction events rather than altering historical completion evidence without a trace.

## 12. Execution plan

### Phase M1.0 — Resolve inputs and freeze the planning baseline

**Work**

1. Assign document and program owners.
2. Resolve or disposition M1-D01 through M1-D11.
3. Obtain current company policies, escalation flow, incident themes, driver demographics/languages, equipment list, and approved operating examples.
4. Confirm the implementation branch, latest migration, live entitlement, target environment, and release window.
5. Record approval of the course hierarchy and Module 1 pilot scope.

**Exit gate:** No unresolved item can silently affect narration, learner rules, retention, audience, or platform architecture. Deferred items are removed from Module 1 or have an approved safe placeholder.

### Phase M1.1 — Content brief and source map

**Work**

1. Convert each learning objective into a scene and assessment mapping.
2. Build the claim/source register.
3. Draft the terminology guide and prohibited-claims list.
4. Conduct 3–5 structured interviews with safety, operations, trainer, and driver representatives; log participants and themes.
5. Select only scenarios verified as representative and safe to film.

**Exit gate:** Safety and operations approve the brief; legal/compliance accepts the source and claims strategy.

### Phase M1.2 — Script, storyboard, and assessment

**Work**

1. Draft script within the word/time budget.
2. Create the complete storyboard, shot list, graphics list, and audio plan.
3. Draft eight assessment items and rationales.
4. Run plain-language, originality, policy, regulatory, accessibility, and production-feasibility reviews.
5. Table-read the script at production pace and record actual duration.

**Exit gate:** Approved script, storyboard, question bank, and signed review record; no unresolved factual or policy placeholders.

### Phase M1.3 — FuelGuard training foundation

**Work**

1. Reserve new migration numbers from the actual branch head.
2. Add shared contracts and pure state-transition tests.
3. Add core schema, RLS, immutable-version/event guards, and discovered matrix tests.
4. Add API admin and learner routes with authentication, org, role, module, ownership, replay, and rate-limit tests.
5. Add admin Module 1 authoring/publish/assignment flow.
6. Add driver routes, feature-gated More entry, player, quiz, and completion states.
7. Install the Expo-compatible video dependency and rebuild the dev client.

**Exit gate:** Repository quality gates pass; cross-org/IDOR/replay tests pass; unreleased feature remains off by default.

### Phase M1.4 — Production and asset QA

**Work**

1. Complete location, equipment, talent, release, and safety checks.
2. Film without creating operational risk.
3. Edit master and mobile renditions; produce original graphics and audio.
4. Create and human-review captions, transcript, thumbnail, and metadata.
5. Validate playback using the release-candidate app build rather than a desktop-only player.

**Exit gate:** Production QA checklist complete; all assets tied to licenses/releases and an approved content version.

### Phase M1.5 — Controlled pilot

**Work**

1. Assign only the named cohort.
2. Include the agreed iOS/Android, device-age, accessibility, terminal, language, and connection mix.
3. Observe completion without coaching the interface unless the support event is logged.
4. Collect comprehension, ambiguity, usability, buffering, resume, accessibility, and support data.
5. Conduct short debriefs with drivers and trainers.

**Proposed pilot gates, subject to M1-D11:**

- 100% of pilot assignments can start, resume, submit, and record a terminal result without data repair;
- no cross-tenant or cross-driver access finding;
- no severity-1/2 security, privacy, data-loss, or accessibility defect;
- at least 90% complete without facilitator intervention;
- at least 80% answer each core-objective item correctly after ambiguous items are removed;
- median reported clarity at least 4/5;
- every failed or abandoned attempt has an explainable event trail; and
- final video remains within the approved 8–10 minute range.

**Exit gate:** Pilot report approved with each issue fixed, accepted with owner/date, or blocking release.

### Phase M1.6 — Release and observation

**Work**

1. Publish immutable course version 1 only after content and technical approval.
2. Verify production entitlement and org feature configuration.
3. Change the catalog `training` feature to released in the same reviewed release that includes working data/API/UI paths.
4. Assign the approved launch cohort in waves.
5. Monitor errors, buffering, abandonment, question performance, support events, and completion integrity.
6. Freeze evidence and create a new version for content changes; never silently replace released assets.

**Exit gate:** Named owner accepts the post-release observation report and authorizes Module 2 planning/production to reuse the package.

## 13. Verification matrix

| Area | Required verification | Pass evidence |
|---|---|---|
| Content accuracy | Line-by-line source, company-policy, safety, operations, and legal review | Signed disposition for every claim and scene. |
| Originality/IP | Similarity review against third-party materials plus asset-license audit | Source/media register and reviewer approval. |
| Learning alignment | Every objective maps to instruction, practice, and assessment | Alignment matrix with no orphan objective/item. |
| Database | Constraints, idempotency, immutable snapshots/events, indexes | Migration tests and schema inspection. |
| Tenant/role isolation | Every role × relevant table/operation; module off/on; cross-org IDs | Discovered RLS matrix and API authorization tests. |
| Grading | Correct answers never in learner payload; exact-set grading; replay safety | Unit/API tests including concurrent submit. |
| Media security | Private objects, bounded URL lifetime, org/path checks | API/storage tests and manual URL-expiry exercise. |
| Resume/recovery | App kill, network loss, URL expiry, backgrounding, retry | Device log and server state show no false progress or loss. |
| Mobile devices | Current supported iOS/Android plus oldest supported/representative device | Signed device matrix with video/caption/quiz results. |
| Accessibility | Captions, transcript, Dynamic Type, screen reader, focus, contrast, touch size | Automated checks where available plus manual VoiceOver/TalkBack record. |
| Performance/cost | Start time, stall rate, rendition size, bandwidth, egress estimate | Pilot measurement report and approved budget. |
| Records | Version, assignment, attempts, score, timestamps, event trail, retention | Sample audit export reviewed by records owner. |
| Release control | Feature off before release, safe behavior when entitlement revoked | Staging proof and rollback rehearsal. |

Repository gates must include the existing project commands relevant to touched work: shared/API/web/driver typechecks and tests, lint, file/function-size checks, boundary checks, route-auth fitness, migration checks, and all discovered RLS matrices. The implementation plan must record exact command results rather than saying “tests passed” without counts/log references.

## 14. Rollout, monitoring, and rollback

### 14.1 Rollout

- Start with the approved pilot group.
- Expand in named waves only after the preceding wave’s errors and support issues are reviewed.
- Do not assign unlinked drivers until an approved authenticated delivery channel exists.
- Do not make completion a dispatch/release blocker until assignment reliability, support coverage, due-date behavior, and exception handling are approved.

### 14.2 Operational monitoring

Monitor:

- assignment created/start/completion counts;
- time to first frame and buffering/stall rate by platform/rendition;
- interrupted sessions and successful resumes;
- quiz pass/fail/reset and per-item ambiguity signals;
- API/storage errors and expired/revoked access attempts;
- support contacts and accessibility issues; and
- version and event consistency.

Completion rate is an operational measure, not evidence that driving behavior improved. Any later safety-outcome evaluation must define the behavior, denominator, time window, comparison method, confounders, and data owner before drawing conclusions.

### 14.3 Rollback

Rollback order:

1. disable the org-level driver feature or revoke the `training` entitlement if access must stop immediately;
2. pause new assignments;
3. revoke affected assignments/media sessions according to the approved design;
4. preserve attempts and events for investigation;
5. publish a corrected version rather than overwriting version 1; and
6. communicate the disposition to assigned learners and administrators.

A rollback must not delete historical evidence or write a false completion status.

## 15. Risks and controls

| Risk | Impact | Control | Owner |
|---|---|---|---|
| Brand is not cleared | Rework or legal exposure | M1-D01 gate before external use or irreversible production spend. | Legal/brand TBD |
| Company policy is invented or stale | Unsafe/inaccurate instruction | Approved policy source and line-by-line owner review. | Safety owner TBD |
| Internal course is mistaken for ELDT/certification | Misrepresentation | Repeated scope boundary in course, certificate/completion copy, and admin UI. | Legal/compliance TBD |
| Legacy LMS plan is implemented literally | Migration, UI, and architecture conflict | Rebase every implementation step on current code and current next migration. | Engineering TBD |
| Training completion leaks into hazmat/DQF records | Incorrect compliance status | Separate general-training schema and explicit integration prohibition. | Engineering/compliance TBD |
| Video fails on field devices/connections | Abandonment and support load | Mobile rendition, device/network pilot, resume, caption, and URL-renewal tests. | Engineering/media TBD |
| Client-visible correct answers | Assessment compromise | Server projection and grading tests. | Engineering TBD |
| Cross-driver or cross-org access | Privacy/security incident | JWT-derived identity, ownership checks, RLS/API/IDOR matrices. | Engineering/security TBD |
| Watch telemetry overstated as attention | False evidence | Describe telemetry honestly; rely on assessment plus coaching/observation. | Program owner TBD |
| Fixed retention is copied from inapplicable regulation | Unlawful or excessive retention | M1-D09 records decision with legal/privacy review. | Records/legal TBD |
| Third-party concepts become copied expression | IP exposure | Clean-room script, original visuals/items, source and similarity reviews. | Content/legal TBD |
| Feature released before system exists | Dead or unsafe driver surface | Keep catalog release false until same-release end-to-end proof. | Engineering/release TBD |

## 16. Required approval record

Before production, capture:

- approved program/module name and permitted trademark notation;
- approved audience and assignment trigger;
- approved learning objectives, script, storyboard, assessment, and rule sheet;
- approved company-policy and escalation wording;
- approved legal/regulatory/certification disclaimer;
- approved language/accessibility scope;
- approved retention, privacy, and access policy;
- approved media ownership/releases and music policy;
- approved technical architecture, cost estimate, and support model;
- approved pilot cohort, gates, and results; and
- final release version, checksums, approvers, dates, and rollback owner.

No blank approval field may be interpreted as approval.

## 17. Source register

### Internal evidence

1. `SILVICOM360 Defensive Driving/Silvicom360_Defensive_Driving_System_Plan.docx` — source program plan, reviewed 2026-08-17.
2. `docs/plans/DRIVER-TRAINING-PLAN.md` — legacy micro-LMS plan; useful design input with stale implementation coordinates.
3. `packages/shared/src/entitlements.ts` — training entitlement vocabulary.
4. `packages/shared/src/featureCatalog.ts` — unreleased driver training feature.
5. `supabase/migrations/0088_module_entitlements.sql`, `0134_driver_app_features.sql`, `0139_backfill_modules_existing_orgs.sql` — entitlement and feature-control model.
6. `apps/api/src/routes/me.ts`, `apps/api/src/middleware/requireModule.ts`, `apps/api/src/app.ts` — driver identity, module gate, and API composition.
7. `apps/driver/package.json`, `apps/driver/app/_layout.tsx`, `apps/driver/app/(tabs)/more.tsx`, `apps/driver/DESIGN.md` — current learner-app platform and design contract.
8. `apps/web/src/router/index.ts`, `apps/web/src/lib/nav.ts`, `docs/DESIGN-SYSTEM-CONTRACT.md` — current admin-web routing/navigation/design conventions.

### External authoritative sources checked 2026-08-17

1. FMCSA Driver Resources: https://www.fmcsa.dot.gov/driver-resources
2. FMCSA CMV Driving Tips overview: https://www.fmcsa.dot.gov/safety/driver-safety/cmv-driving-tips-overview
3. FMCSA CMV non-regulatory best-practices report: https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/FinalReportTask07-02.pdf
4. FMCSA Training Provider Registry: https://tpr.fmcsa.dot.gov/home
5. FMCSA CDL/ELDT driver overview: https://www.fmcsa.dot.gov/registration/commercial-drivers-license/drivers
6. Current eCFR, Title 49, Part 392: https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-392
7. GovInfo annual CFR collection: https://www.govinfo.gov/app/collection/cfr/
8. 49 CFR 380.725 applicability/retention (official annual CFR source located through GovInfo): https://www.govinfo.gov/content/pkg/CFR-2019-title49-vol5/pdf/CFR-2019-title49-vol5.pdf
9. USPTO comprehensive trademark clearance guidance: https://www.uspto.gov/trademarks/search/comprehensive-clearance-search-similar-trademarks
10. W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
11. W3C Understanding Captions (Prerecorded): https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded
12. Expo Video documentation: https://docs.expo.dev/versions/latest/sdk/video/
13. Supabase private storage buckets: https://supabase.com/docs/guides/storage/buckets/fundamentals
14. Supabase resumable uploads: https://supabase.com/docs/guides/storage/uploads/resumable-uploads

## 18. Definition of done for this planning document

This plan becomes **Approved for execution** only when:

1. the verified code baseline is refreshed if implementation starts from another commit;
2. M1-D01 through M1-D11 each has a named decision, owner, and date;
3. source, policy, legal, accessibility, platform, and pilot owners approve their sections;
4. any approved deviation is recorded in a new document version; and
5. implementation work is tracked against the phase exit gates rather than against prose alone.
