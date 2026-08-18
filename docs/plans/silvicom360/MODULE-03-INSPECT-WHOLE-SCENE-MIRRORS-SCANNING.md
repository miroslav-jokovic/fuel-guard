# Silvicom360 Module 3 — Inspect the Whole Scene: Mirrors & Scanning

**Document status:** Planning baseline; not approved for production or release
**Version:** 0.1
**Prepared:** 2026-08-17
**Target product:** FuelGuard Safety Training
**Verified code baseline:** branch `claude/efs-phase-10-write-path`, commit `9531ccd464b70eb07513559915418e18970538df`
**Source-program plan:** `Silvicom360_Defensive_Driving_System_Plan.docx`, SHA-256 `33117e5fbb8656fceab3787dd6a01b302c2eab46b010f9a10d4069ac05ee5376`
**Document owner:** Unassigned

> This document separates verified facts, evidence-based proposals, and unresolved company decisions. A **Decision required** item is not permission to invent an answer during scripting, filming, assessment, observation, or implementation.

## 1. Outcome and scope

Module 3 turns the second proposed Silvicom360 principle, **Inspect the Whole Scene**, into a repeatable observation habit. It teaches a commercial driver to maintain an updated picture of the forward path, sides, rear approaches, adjacent lanes, shoulders, intersections, signals, operating environment, and relevant vehicle condition without fixating on one target or treating a mirror check as proof that an unseen area is clear.

The instructional aim is not “look everywhere at once.” The aim is to:

1. keep the forward roadway as the primary reference;
2. make brief, purposeful checks of relevant side and rear zones;
3. return attention forward between checks;
4. compare what changed rather than merely touching each mirror with the eyes;
5. increase or redirect checks when traffic, roadway, maneuver, or equipment conditions demand it; and
6. treat a disappeared or never-observed road user as **unknown**, not automatically clear.

Digital completion can document knowledge, scenario interpretation, and the ability to describe a scanning process. It cannot prove that the learner consistently performs that process while operating a commercial motor vehicle. On-road behavior remains a separate Silvicom360 Road Check responsibility under an approved observation standard.

### 1.1 Included

- Module 3 learning objectives, content boundaries, timing, storyboard blueprint, and production rules.
- A provisional vocabulary for direct view, indirect view, mirror fields, hidden areas, scan cycles, trigger checks, tracking, stale scene pictures, and fixation.
- Use of forward view, flat mirrors, convex mirrors, and any approved camera-monitor views represented in the launch fleet.
- Interpretation of movement and relative position across successive checks, including overtaking traffic and objects that move into or out of a visible field.
- Routine checks and increased checks for approved special situations without teaching the full maneuver procedure owned by later modules.
- Scenario practice that requires the learner to decide what zone should be sampled next, what changed, and what remains unknown.
- Accessibility design for instruction and assessment whose essential information is spatial, visual, sequential, or time-based.
- FuelGuard packaging, publishing, assignment, analytics, pilot, release, and rollback requirements.
- Conditions for later road-observation or driver-monitoring integration, without assuming such integration is approved or currently available.

### 1.2 Excluded

- A final approved scan cadence, sequence, mnemonic, mirror setup, or company driving policy.
- Mirror installation, hardware calibration, repair, legal inspection, or a complete pre-trip inspection procedure.
- A generic “No-Zone” diagram presented as the measured visibility map for every company vehicle.
- Following-distance calculation, stopping-margin technique, or escape-space selection; those belong to Module 4.
- The full verification sequence for turns, lane changes, merging, or pulling from a stop; those belong to Module 5.
- Backing, GOAL, spotter, and stop-and-check procedures; those belong to Module 6.
- Detailed speed, intersection, and work-zone approach procedures; those belong to Module 7.
- Fatigue, distraction, emotion, rushing, and other human-factor control procedures; those belong to Module 8.
- Detailed adverse-weather or low-visibility procedure; that belongs to Module 9.
- Eye tracking, face tracking, driver-camera capture, biometric inference, or webcam-based proctoring.
- Automatic assignment based on a Samsara score, harsh-event count, crash count, or presumed “inattention” diagnosis.
- A claim that a quiz, watched video, hotspot response, or narrated scan proves on-road competence or crash reduction.
- ELDT, government certification, third-party certification, or a replacement for state CDL testing.

## 2. Verified baseline

### 2.1 Program-plan facts

The source program plan specifies:

- a ten-module core course;
- Module 3 title: **Inspect the Whole Scene: Mirrors & Scanning**;
- target video length: **10–12 minutes**;
- primary outcome: **build a repeatable scan pattern without fixation**;
- the proposed principle definition: continuously process mirrors, lanes, shoulders, intersections, signals, weather, work zones, and vulnerable road users;
- original scripts, footage, graphics, examples, and assessments;
- concise video segments, decision questions, captions, and transcripts; and
- a separate road observation so digital completion is not the only measure of competency.

The source plan does not define:

- an exact mirror-check interval;
- an exact scan order or mnemonic;
- launch vehicle classes, body configurations, trailer configurations, mirror packages, or camera-monitor systems;
- mirror-adjustment and pre-trip boundaries;
- approved blind-area diagrams;
- special-situation check rules;
- assessment method, pass rule, or retake rule;
- road-observation scoring behavior;
- driver-monitoring or eye-tracking use;
- launch languages or accessible alternative; or
- approved company examples, incident priorities, or terminology.

### 2.2 FuelGuard facts verified in code

| Area | Current fact | Evidence | Module 3 consequence |
|---|---|---|---|
| Code baseline | Current branch is `claude/efs-phase-10-write-path` at `9531ccd464b7`; the untracked Silvicom360 plan directory already exists. The branch advanced twice during planning; both intervening commits were inspected. | Git inspection and commit comparison on 2026-08-17 | Re-run the baseline before implementation and preserve work outside this document. |
| Migration line | The latest migration filename currently found is `0201_unit_mileage_write_bucket.sql`. | Sorted migration inspection | Do not reserve a migration number in this plan; allocate from the actual head during implementation. |
| Product entitlement | `training` is an allowed module key labeled “Safety Training.” | `packages/shared/src/entitlements.ts` | Reuse this entitlement; do not introduce a Module 3 entitlement. |
| Driver feature | `training` exists in the feature catalog but is `released: false`. | `packages/shared/src/featureCatalog.ts` | Module 3 cannot make the feature releasable independently of the generic foundation. |
| Training foundation | No general course, lesson, assignment, attempt, quiz, completion, or training-event implementation was found in the database, API, web, or driver app. | Targeted migration and code search on 2026-08-17 | Module 3 depends on the approved Module 1 foundation or a newly approved replacement. |
| Driver app | The learner app is React Native 0.86 / Expo 57; `expo-video` is not installed and no training route or More-menu entry exists. | `apps/driver/package.json`, `apps/driver/app/_layout.tsx`, `apps/driver/app/(tabs)/more.tsx` | Reuse the generic player after it exists; do not build a Module 3-only player. |
| Identity | Driver access resolves through authenticated membership and `drivers.user_id`; the link can be null. | `apps/api/src/routes/me.ts`, migrations `0098`, `0102`, `0116` | In-app assignments are limited to linked users unless another authenticated channel is approved. |
| Authorization | Authentication, organization scoping, `requireModule()`, role gates, audit helpers, and RLS conventions exist. | `apps/api/src/middleware`, route patterns, module migrations | Apply the existing tenant, role, ownership, audit, and replay protections to every training operation. |
| Safety aggregates | `driver_scores` contains weekly Samsara-derived safety score, distance/time exposure, harsh acceleration/braking/turn counts, crash count, speeding duration, and raw provider response. | migration `0054_driver_scores.sql`, parser and sync services | The stored values do not describe mirror use, scan pattern, fixation, blind-area checks, or visual-search competence. |
| Event media | No event-level dashcam, driver-facing video, gaze trace, mirror-use label, near-miss narrative, or collision-review repository was found. | Migration and service search on 2026-08-17 | Do not promise personalized Module 3 scenes or automated scan diagnoses. |
| Notifications | `training_due` is a recognized notification category, but no producer creates course-due events. | notification contract, migrations `0089`, `0093`, `0154`, producer search | Add reminders only after assignment and due-state rules exist. |
| Device permissions | The driver app declares camera use for operational load-stop capture; no training camera use exists. | driver app configuration and capture features | Do not reuse the operational camera permission for gaze, face, eye, or scan monitoring. |
| Maps/location | Location and mapping packages support operational workflows. | `apps/driver/package.json` and navigation features | Module 3 has no justified need for live location; do not collect it for learning or assessment. |
| Compliance records | Hazmat training records implement a separate regulation-specific qualification workflow. | compliance migrations, services, and UI | Never write Silvicom360 Module 3 completion into hazmat certification or driver-qualification evidence. |

### 2.3 Module 1 and Module 2 dependency disposition

`MODULE-01-INTRODUCTION-PROFESSIONAL-MINDSET.md` defines a proposed generic training foundation. `MODULE-02-SEE-FAR-AHEAD-HAZARD-RECOGNITION.md` defines a proposed forward-hazard vocabulary and cue-to-action reasoning process. Both are planning documents; neither proves approval, implementation, or release.

Module 3 may reuse only verified, approved versions of:

- immutable course and content versions;
- assignments, attempts, responses, server-side grading, and event history;
- private media delivery, captions, transcripts, and accessible alternatives;
- driver player and administrator workflows;
- Module 2 terms for observable cues, developing conflicts, hidden areas, and early response; and
- Module 2 scenario-production, source, rights, privacy, and device-legibility controls.

Module 3 must not:

- duplicate the generic platform in Module 3-specific tables or routes;
- treat an unresolved Module 1 or Module 2 decision as approved;
- change Module 2’s forward-looking standard silently;
- release `training` before an end-to-end generic learner and administrator path is verified;
- merge training results into driver performance scores without separate approval; or
- reserve migration numbers from the current `0201` line before implementation begins.

## 3. Facts, proposals, and decisions required

| ID | Topic | Status | Current evidence | Release requirement |
|---|---|---|---|---|
| M3-D01 | Foundation readiness | Decision required | The entitlement and feature seam exist, but the generic training platform does not. | Name the approved Module 1 plan/version and verified software release Module 3 will reuse, or approve a replacement. |
| M3-D02 | Audience and operating profile | Decision required | “Company drivers” is the only supplied audience description. | Name launch terminals, driver roles, CMV classes, body/trailer combinations, route types, tenure mix, and exclusions. |
| M3-D03 | Routine scan cadence | Decision required | FMCSA’s page updated 2026-05-12 says mirrors every 8–10 seconds; its 2015 inadequate-surveillance page says at least every 5–8 seconds. Neither is supplied as company policy. | Safety/operations approve exact wording, contexts, exceptions, and whether a number will be taught at all. Record the source-date conflict. |
| M3-D04 | Scan sequence | Decision required | The source plan requires a repeatable pattern but gives no order. Conditions and equipment can change which zone is most relevant. | Approve a flexible sequence, trigger logic, forward-return rule, and terminology; reject a rigid routine that becomes unsafe in some contexts. |
| M3-D05 | Equipment and visibility profiles | Decision required | No fleet list, seating geometry, mirror package, camera-monitor package, or measured fields of view were supplied. | Create and approve one visibility profile for every launch configuration shown or assessed. |
| M3-D06 | Mirror adjustment boundary | Decision required | Current regulations and CDL material address mirror equipment and adjustment, but the module title does not specify a setup lesson. | Decide whether Module 3 verifies a pre-trip prerequisite, teaches an approved adjustment check, or defers setup to another company procedure. |
| M3-D07 | Blind-area terminology and diagrams | Decision required | Public sources use “blind spots” and “No-Zone”; actual visibility depends on equipment and configuration. | Legal/safety approve original terminology and equipment-specific diagrams; no generic graphic may claim measured coverage without evidence. |
| M3-D08 | Special-situation triggers | Decision required | Public guidance calls for more checks around lane changes, turns, merges, tight maneuvers, and intersections. Later modules own the full procedures. | Approve the trigger list and exact boundary between “increase/redirect observation” and later maneuver instruction. |
| M3-D09 | Footage and view synchronization | Decision required | FuelGuard has no event-video source, and no approved footage package was supplied. | Approve controlled original footage, licensed footage, de-identified company footage, simulation/graphics, or a mix; require synchronized views and rights/privacy evidence. |
| M3-D10 | Digital interaction | Decision required | The current app has no training player, timed video prompt, hotspot, or sequence-comparison engine. | Select standard post-clip questions, controlled pause/reveal, sequential stills, accessible hotspot equivalents, or another validated method. |
| M3-D11 | Accessibility equivalent | Decision required | Essential information is visual, spatial, and sequential. Captions alone do not convey mirror contents or changes. | Approve description, structured text/diagram alternatives, equivalent assessment forms, and independent accessibility review without revealing answers early. |
| M3-D12 | Assessment rule | Reconfirm | No approved bank size, served count, pass threshold, retake, feedback, or correction rule exists. | Approve objective coverage and grading. Response speed, gaze, tap path, and screen interaction must not determine pass/fail by default. |
| M3-D13 | Road-observation method | Decision required | The source plan requires a separate road check but does not define Module 3 observable behaviors or trainer calibration. | Approve observable behaviors, route conditions, equipment profiles, rating anchors, trainer qualifications, inter-rater checks, and recheck rules. |
| M3-D14 | Driver-monitoring and telematics use | Decision required | Current FuelGuard data contains weekly safety aggregates, not mirror/glance events; no gaze or driver-facing video system is integrated. | Approve no integration by default or a separately reviewed human-centered workflow. Automated diagnosis or assignment is prohibited unless validated and approved. |
| M3-D15 | Languages, pilot, and claims | Decision required | No launch languages, reviewer pool, pilot cohort, effect threshold, or learner-facing statistics were supplied. | Approve localization, pilot measures, stop criteria, claims register, and permitted interpretation of results. |

## 4. Learner design

### 4.1 Audience

Provisional audience: company commercial drivers in the approved Module 3 pilot who:

- have an authenticated FuelGuard driver account linked through `drivers.user_id`;
- completed the approved Module 1 and Module 2 prerequisite versions;
- are assigned content matching an approved launch equipment profile;
- receive the same approved language across narration, captions, transcript, prompts, alternatives, and questions; and
- are parked and not operating a vehicle while taking the digital module.

The plan does not assume that every learner:

- drives a tractor-trailer;
- has identical flat, convex, fender, hood, crossover, or digital camera-monitor views;
- uses Samsara or any driver-monitoring technology;
- encounters the same lanes, shoulders, intersections, worksites, or vulnerable road users;
- reads English as a first language;
- has normal color perception, visual acuity, contrast perception, hearing, motor ability, or cognitive processing speed; or
- can demonstrate on-road scanning through a phone interaction.

### 4.2 Prerequisites

Before pilot assignment:

1. The approved Module 1 platform version is implemented and verified.
2. The approved Module 2 terminology and content version are named.
3. M3-D02 through M3-D12 are resolved for the pilot.
4. Each launch vehicle/equipment combination has an approved visibility profile.
5. Every scene has a source, rights/privacy record, equipment profile, synchronized-view proof, observation key, and accessibility alternative.
6. The player and assessment are tested on representative devices, orientations, text sizes, screen readers, connections, and playback recovery states.
7. The company identifies how a learner reports inaccessible, misleading, equipment-inapplicable, or ambiguous content without being scored as noncompliant.
8. Trainers complete the approved Module 3 observation calibration before recording road-check results.

### 4.3 Proposed measurable learning objectives

Subject to M3-D03 through M3-D13, a learner will be able to:

1. **Map:** Given an approved equipment profile, distinguish direct-view zones, flat-mirror fields, convex-mirror fields, camera-monitor fields if present, and areas not confirmed by those views.
2. **Sample:** Given a traffic scene and current forward condition, select a relevant next observation zone and explain why it should be checked without abandoning the forward roadway.
3. **Track:** Across successive views, identify which road user or condition changed position, remained stable, entered view, left view, or became unknown.
4. **Interpret:** Explain the practical limits of the represented mirror type, including that a wider convex view can make objects appear smaller and farther away.
5. **Adapt:** Increase or redirect checks when an approved trigger appears and return to a balanced scan after the trigger passes.
6. **Transfer:** Apply the approved process to at least two unseen scenarios using equipment and route conditions represented in the learner’s approved profile.

No response-time, gaze-direction, head-motion, or tap-path threshold is proposed. Those measures can be affected by device performance, accessibility tools, motor ability, language processing, and the artificial nature of a phone-based task.

### 4.4 Working vocabulary

These definitions are proposed for review and are not company policy until approved:

- **Direct view:** The scene visible without relying on a mirror or camera display.
- **Indirect view:** Information supplied through an approved mirror or camera-monitor field.
- **Mirror field:** The part of the environment visible in a specific mirror from the approved seating and equipment configuration.
- **Hidden area:** A relevant area not currently confirmed by direct view or the represented indirect views. “Not seen” does not mean “empty.”
- **Reference point:** A visible part of the vehicle or stable scene feature used to interpret relative position in a mirror image.
- **Tracked road user:** A person or vehicle whose position is updated across successive observations.
- **Scene picture:** The driver’s current working understanding of what is ahead, beside, behind, approaching, receding, or unknown.
- **Stale picture:** A scene assumption that has not been refreshed after enough time or change to remain reliable.
- **Routine check:** A brief observation used to refresh the scene picture during otherwise stable driving.
- **Trigger check:** An added or redirected observation caused by a changing condition, planned maneuver, intersection, merge, close-clearance situation, traffic movement, vehicle cue, or other approved trigger.
- **Fixation:** Attention held on one object, view, thought, or problem long enough that other relevant changes are not sampled. It can occur on the forward roadway as well as in a mirror, display, or side view.
- **Return forward:** Re-establishing the forward path as the primary reference after a brief side, rear, instrument, or camera-monitor observation.

### 4.5 Proposed process model

The following is a planning model, not approved driver instruction:

1. **Anchor forward:** Confirm the path, traffic flow, and immediate change ahead.
2. **Sample one relevant zone:** Make a brief, purposeful check selected by routine or trigger.
3. **Return forward:** Reconfirm the path rather than remaining in the indirect view.
4. **Compare:** Ask what changed since the last confirmed view.
5. **Refresh another relevant zone:** Continue building the whole-scene picture without forcing a fixed order when conditions demand otherwise.
6. **Treat gaps as unknown:** If an object disappears from a view, maintain uncertainty until an approved observation resolves it.

Safety/operations must decide whether this model becomes learner-facing language, is replaced, or remains an internal storyboard tool. A final pattern must be teachable, observable, compatible with launch equipment, and adaptable to special situations.

### 4.6 Content boundaries with other modules

| Topic encountered in Module 3 | Teach here | Defer |
|---|---|---|
| Forward roadway | Return forward between purposeful checks and keep the scene picture current | Detailed forward hazard prediction remains Module 2 |
| Following traffic | Observe approach, relative movement, and whether a road user becomes unknown | Gap selection and escape-space decisions belong to Module 4 |
| Lane change, merge, turn | Recognize that these are trigger situations requiring additional checks | Full sequence, communication, path verification, and execution belong to Module 5 |
| Backing | Explain that backing needs a different observation method and is not covered by the highway scan cycle | Setup, GOAL, spotter, and stop-and-check discipline belong to Module 6 |
| Intersections and work zones | Sample sides, signals, shoulders, workers, and changing lane patterns as relevant | Complete approach and speed strategy belongs to Module 7 |
| Distraction and fatigue | Recognize fixation, missed updates, and a stale scene picture | Causes, self-assessment, reporting, and control actions belong to Module 8 |
| Weather, darkness, glare | Explain that reduced visibility changes what can be confirmed and may require more deliberate checks | Detailed speed, spacing, lighting, and stop/no-go decisions belong to Module 9 |
| Integrated performance | Demonstrate the Module 3 observation process in focused scenarios | Full multi-principle scenarios belong to Module 10 and the Road Check |

## 5. Evidence and regulatory boundary

### 5.1 Verified source interpretation

| Source | What it supports | What it does not settle |
|---|---|---|
| 49 CFR 383.111 | CMV operators must have knowledge of side/rear-view mirror use, proper mirror adjustment, and visual search including ahead, sides, mirrors, and rear. | It does not prescribe the company’s exact routine cadence, sequence, lesson wording, or digital assessment. |
| 49 CFR 383.113 | CDL applicants must demonstrate proper visual-search methods and observe roadway/vehicle behavior before changing speed or direction; simulation cannot replace required on-street skills testing. | It does not turn Silvicom360 into a CDL test or allow digital completion to prove the on-road skill. |
| 49 CFR 393.80 | Covered buses, trucks, and truck tractors generally require specified rear-vision mirrors, subject to the regulation’s exceptions and referenced standards. | Equipment compliance alone does not prove adjustment, coverage for a specific driver/configuration, or correct use. |
| FMCSA truck/bus tips, updated 2026-05-12 | Public guidance says check mirrors every 8–10 seconds, scan about 15 seconds ahead, and watch blind spots. | It is not supplied as Silvicom company policy and does not resolve different equipment or special situations. |
| FMCSA inadequate-surveillance page, updated 2015-02-11 | Public guidance describes failed-to-look and looked-but-did-not-see errors; it says check mirrors at least every 5–8 seconds, check quickly, and return attention forward. | Its cadence conflicts with the newer FMCSA page. Old percentages and anecdotes must not be presented as current rates. |
| FMCSA 2005 CDL Driver Manual | It describes regular and special-situation checks, quick mirror looks, returning to the road ahead, tracking traffic, mirror adjustment, and convex-mirror distortion. | It is an older training manual, not the current company equipment profile or a substitute for current state material and policy review. |
| NHTSA hazard-perception summary | Computer-based programs can be useful design inputs for visual scanning and attention training. The summary also states limits in transfer evidence. | Much of the cited research concerns young/novice passenger-vehicle drivers, not this company’s experienced CMV population. |
| NHTSA visual-manual distraction guidance/research | Long off-road glances and visually demanding secondary tasks are important design concerns. | Device-task thresholds are not automatically mirror-glance rules, trainer scoring thresholds, or pass/fail criteria for Module 3. |
| W3C WCAG 2.2 and media guidance | Time-based media needs captions and access to important visual information; controls, focus, timing, and alternatives must be accessible. | Captions alone do not describe mirror contents, spatial relationships, or visual change. |

### 5.2 Claim rules

1. Treat current regulations as minimum legal evidence, not the full company standard.
2. Cite the exact section and access/review date for every regulatory claim.
3. Do not say that 49 CFR 393.80 defines a scan method; it defines equipment requirements.
4. Do not say that a fixed cadence is “the law” unless counsel identifies an applicable requirement supporting that statement.
5. Do not silently choose 5–8 or 8–10 seconds. Preserve the source conflict and obtain M3-D03 approval.
6. Do not use a generic blind-area diagram to state exact feet, degrees, lanes, or visibility for company equipment without measurement and approval.
7. Do not imply a flat, convex, hood, fender, crossover, or camera-monitor view has the same geometry or distance cues as another.
8. Do not imply a mirror eliminates a hidden area or that failure to see an object proves it was absent.
9. Do not convert NHTSA device-distraction thresholds into a maximum mirror-glance duration without CMV-specific review and company approval.
10. Do not use LTCCS percentages, dated crash statistics, or historical anecdotes as current incidence rates.
11. Do not imply hazard-perception research in young drivers proves crash reduction, scanning transfer, or effectiveness for the launch CMV cohort.
12. Do not describe Module 3 completion as CDL qualification, ELDT credit, government certification, or observed driving competency.
13. Every learner-facing number, equipment claim, and “required” behavior needs a row in the claim register with source, context, limitation, reviewer, and disposition.

## 6. Content structure and timing

Target runtime: **10–12 minutes**. Planning target: **10 minutes 45 seconds**, excluding optional replay and the post-video knowledge check.

| Time | Segment | Purpose | Evidence/approval gate |
|---|---|---|---|
| 0:00–0:30 | Cold open: the missing vehicle | Show an overtaking road user visible, then absent from the current mirror view; ask what is known and unknown. | Approved equipment profile and synchronized views. |
| 0:30–1:05 | Objective and boundary | Define the whole-scene goal and state that the module does not teach complete maneuver procedures. | Curriculum-owner approval. |
| 1:05–2:10 | A scene picture, not a checklist touch | Contrast meaningful updates with rote mirror touching or forward fixation. | Approved terminology and examples. |
| 2:10–3:25 | Direct and indirect views | Explain flat/convex/camera views represented in the launch profile and what each can and cannot confirm. | M3-D05–D07. |
| 3:25–4:35 | Brief check and return forward | Demonstrate purposeful sampling and the forward-return principle without inventing a glance-duration rule. | M3-D03–D04. |
| 4:35–5:45 | Track change across checks | Follow an overtaking vehicle or vulnerable road user across successive observations. | Scenario key and synchronized-view proof. |
| 5:45–6:55 | Routine versus trigger checks | Show why maneuvers, intersections, merges, close clearance, traffic changes, and vehicle cues can redirect or increase observation. | M3-D08 and module-boundary review. |
| 6:55–7:55 | Fixation failure modes | Show forward fixation, mirror fixation, and stale assumptions; teach recovery by re-establishing and refreshing the scene picture. | Human-factors/SME review. |
| 7:55–9:10 | Guided scenario | Pause a multi-view scene and ask what zone should be checked next and what remains unknown. | Interaction/accessibility approval. |
| 9:10–10:05 | Unseen transfer scenario | Apply the process to a new route/equipment-matched scene without coaching before response. | Separate transfer form. |
| 10:05–10:45 | Recap | Re-state the approved process, equipment limits, and Road Check connection. | Final script and policy approval. |

Narration planning range: **1,150–1,300 spoken words**, to be verified by a timed table read. Observation pauses, learner prompts, captions, description, translated narration, and accessible alternatives must be timed separately rather than squeezed into the English narration budget.

## 7. Scene-by-scene storyboard blueprint

The storyboard is a design brief, not permission to film or publish. Every scene requires an approved equipment profile, source record, rights/privacy disposition, safety method, observation key, accessible equivalent, and reviewer sign-off.

| Scene | Approx. time | Visual / interaction | Teaching purpose | Required proof |
|---|---:|---|---|---|
| 1 | 0:00–0:20 | Synchronized forward and mirror views show an overtaking vehicle; the next view no longer confirms it. | Establish “not visible” versus “known clear.” | Time sync, object path, no misleading crop. |
| 2 | 0:20–0:30 | Freeze before reveal: “Where could it be now?” | Capture an uncoached prediction. | Hidden-answer boundary and accessible form. |
| 3 | 0:30–1:05 | Title, objectives, and parked-learning notice. | Set scope and prevent use while driving. | Approved wording and player lockout/notice behavior. |
| 4 | 1:05–1:40 | Graphic contrasts a scene picture with a rote checklist that records no change. | Define purposeful observation. | Original graphic and SME review. |
| 5 | 1:40–2:10 | Forward fixation causes a side/rear change to go stale; no crash is staged. | Show that forward fixation can still miss relevant change. | Safe controlled or simulated production. |
| 6 | 2:10–2:50 | Equipment-specific view map: direct, flat, convex, approved camera monitor, and unconfirmed areas. | Teach coverage and limits. | Measured/approved profile; no generic extrapolation. |
| 7 | 2:50–3:25 | Same object shown in flat and convex representations with a vehicle reference point. | Explain why image size and apparent distance must be interpreted carefully. | Optical/equipment accuracy review. |
| 8 | 3:25–4:00 | Parked, staged driver demonstration: forward → purposeful mirror view → forward. | Demonstrate brief check and return without claiming exact eye timing. | No driving distraction during filming; staged disclosure. |
| 9 | 4:00–4:35 | Poor example holds the mirror view or display too long while the forward scene changes. | Define mirror/display fixation. | Controlled composite and timing integrity. |
| 10 | 4:35–5:20 | Successive observations track an overtaking vehicle from rear approach to adjacent/unknown/front. | Teach change tracking rather than isolated snapshots. | Same object/continuity verified. |
| 11 | 5:20–5:45 | Shoulder user or vehicle enters a relevant side zone. | Expand the whole scene beyond adjacent cars. | Privacy, visibility, and route relevance. |
| 12 | 5:45–6:25 | Traffic/road trigger card: merge, intersection, close clearance, lane transition, or signal change. | Increase or redirect checks without teaching the full maneuver. | Cross-module boundary sign-off. |
| 13 | 6:25–6:55 | Mirror reveals a relevant vehicle/equipment cue only if approved for the shown configuration. | Show that mirrors may also refresh vehicle condition. | Equipment and maintenance SME approval. |
| 14 | 6:55–7:55 | Three short failure cases: forward fixation, mirror fixation, and assumed clearance after disappearance. | Diagnose common observation failures. | Each failure has an evidence key and neutral wording. |
| 15 | 7:55–9:10 | Guided multi-view scenario with a controlled pause. | Choose next relevant zone, report change, and preserve unknowns. | Standard and equivalent accessible forms. |
| 16 | 9:10–10:05 | Unseen scenario using a different but approved context. | Measure transfer separately from coached practice. | Form B separation and no content leakage. |
| 17 | 10:05–10:45 | Recap card and Road Check handoff. | Reinforce the approved process and limits of digital completion. | Final policy, accessibility, and learning approval. |

## 8. Script and production standards

### 8.1 Wording

- Use observable language: “the vehicle was visible in the left flat mirror, then was no longer confirmed,” not “the driver knew the lane was clear.”
- Distinguish **saw**, **did not see**, **could not see**, and **did not check**.
- Do not describe an unobserved area as empty.
- Describe relative movement only when successive views support it.
- Avoid blaming, shaming, or diagnosing attention, intent, disability, fatigue, or carelessness from one clip.
- Avoid “always” and “never” unless the approved rule and scope make the statement defensible.
- Do not use a clock-like cadence in narration until M3-D03 is resolved.
- Do not present the planning process model as company policy until approved.
- Identify equipment-specific statements in the script and caption file so they cannot be reused across incompatible profiles.
- State explicitly when a view is staged, simulated, slowed, enlarged, or composited.

### 8.2 Equipment and visibility integrity

For every equipment profile shown:

1. Record vehicle class, body and trailer configuration, relevant dimensions, seat/camera reference, mirror types, camera-monitor system if present, and profile owner.
2. Photograph or diagram each direct and indirect field from the approved reference position.
3. Mark areas that are not confirmed; do not fill them with assumptions.
4. Use a visible vehicle reference point where appropriate for interpreting position.
5. Record whether the image is flat, convex, digitally processed, cropped, magnified, reversed, or otherwise transformed.
6. Validate all graphics against the actual profile with a qualified SME and representative driver.
7. Version the profile independently; equipment or mirror changes invalidate affected scenes until re-reviewed.

No visual may imply that one truck’s field of view applies to all company equipment.

### 8.3 Multi-view and temporal integrity

- Synchronize forward, side, rear, and cab-staged views against the same time base.
- Preserve the actual order of observations. Do not edit views to create a response opportunity that did not exist.
- Do not cut between different runs and present them as one continuous event without a clear simulation label.
- Keep sufficient pre-pause frames for the learner to observe the relevant change.
- Do not crop out a cue, alter apparent distance, or enlarge an object only in the answer reveal.
- If playback speed changes, label it and do not score time-dependent interpretation from that rendition.
- Freeze assessment scenes before narration, arrows, highlights, captions, or description reveal the keyed answer.
- Record checksums for every source and published rendition.

### 8.4 Filming safety and privacy

- Never instruct a driver to perform unnatural eye movements, hold a mirror glance, ignore traffic, create a close pass, or stage a road conflict while operating.
- Use parked demonstrations, controlled facilities, fixed approved cameras, professional operators, animation, simulation, or properly licensed footage.
- Do not mount equipment where it obstructs required views or interferes with controls.
- Do not use an operational driver-facing camera or phone camera for training measurement without a separately approved privacy, labor, consent, retention, access, and validation plan.
- De-identify plates, faces, addresses, customer information, device displays, telematics identifiers, and audio unless their approved use is necessary and documented.
- Record releases and licenses for identifiable people, property, music, maps, interfaces, and footage.
- Preserve source files and editing history so safety and temporal claims can be audited.

### 8.5 Audio, captions, description, and transcript

- Provide human-reviewed captions for narration, dialogue, and relevant sounds.
- Keep captions away from mirrors, road users, signals, and other assessed regions; move them dynamically when necessary.
- Provide a synchronized transcript that names speakers and describes meaningful non-speech information.
- Provide access to important visual information through the approved description or media alternative.
- Do not let description reveal a hazard, vehicle movement, or keyed scan target before the standard form makes that information available.
- Use an alternate form when equal-timing description cannot preserve the assessment construct.
- Do not use color alone to distinguish fields, object paths, confirmed zones, or unknown areas.
- Support pausing, replay, keyboard/switch access where applicable, screen readers, focus visibility, Dynamic Type, and reduced-motion expectations.

### 8.6 Accessible scanning exercises

A visual mirror exercise is not made equivalent by adding generic alt text or captions. For each assessed item, define:

1. the construct being measured—for example tracking state change, choosing a relevant next zone, or preserving uncertainty;
2. the essential information available before the response;
3. the information intentionally withheld until after the response;
4. a standard visual form;
5. an accessible form that supplies equivalent information in the same logical sequence without naming the correct response;
6. the same objective, difficulty intent, feedback, and scoring rule;
7. independent SME and accessibility review; and
8. pilot comparison for unexplained objective-level performance differences.

Possible equivalents include structured sequential descriptions, tactile/accessible diagrams supplied outside the app under an approved accommodation process, keyboard-navigable zone lists, or narrated spatial states. The team must test the chosen form with representative users; this document does not declare one method equivalent in advance.

## 9. Assessment blueprint

### 9.1 Delivery rule

Proposed default: use standard post-clip or controlled-pause questions that can be represented equivalently without gaze tracking, timed tapping, drag-only interaction, or a camera. Richer interaction is permitted only after M3-D10 and M3-D11 evidence shows that it improves the intended measurement without creating access, device, latency, privacy, or scoring problems.

The exact bank size, served count, pass threshold, feedback timing, retake rule, and correction policy remain subject to M3-D12.

### 9.2 Item blueprint

| Objective | Proposed item form | Example response task | What must not be inferred |
|---|---|---|---|
| Map | Equipment-profile diagram or structured description | Select which view can confirm a named zone and which area remains unconfirmed. | A generic profile applies to every truck. |
| Sample | Situation plus current forward state | Choose the most relevant next observation zone and explain the trigger. | There is only one safe scan order in all conditions. |
| Track | Two or more synchronized observations | Classify an object as approaching, receding, stable, entered, left, or unknown. | Disappearance proves clearance. |
| Interpret | Flat/convex/camera comparison | Identify the supported interpretation and the limitation. | Apparent image size is exact distance. |
| Adapt | Routine scene followed by a trigger | Select how the observation pattern should change, without executing the later-module maneuver. | More frequent checks alone solve the conflict. |
| Fixation | Short failure scenario | Identify what information became stale and the first recovery step. | Attention failure can be diagnosed from a single unexplained event. |
| Transfer | Unseen equipment-matched scenario | Apply map, sample, track, and uncertainty rules without coaching. | Performance on trained clips proves transfer. |

### 9.3 Item-writing rules

- Key each answer to evidence visible or described before the response.
- Include “not enough information” or equivalent when the scene truly leaves an area unresolved.
- Do not reward overconfidence about an unseen zone.
- Keep later-module action details out of the key unless those prerequisites are explicitly approved.
- Do not use trick crops, imperceptible cues, low-resolution plates, color-only signals, or a cue visible only on one untested device.
- Do not grade response speed, cursor path, touch coordinates, eye direction, head movement, or replay count by default.
- Do not ask the learner to memorize one equipment profile and score it as universal knowledge.
- Keep trained practice scenarios separate from unseen transfer scenarios.
- Protect answer keys and rationales from the client until the server accepts the terminal submission.
- Version the scenario, equipment profile, rendition, pause point, prompt, choices, key, rationale, accessible form, and correction history together.
- Remove or correct any item with material SME disagreement, ambiguous visibility, accessibility inequivalence, or rendition-dependent answers.

### 9.4 Road-observation boundary

Digital assessment may show that the learner can describe and interpret the process. The Road Check should separately observe approved behaviors such as:

- establishes and maintains a current forward path reference;
- makes purposeful side/rear checks appropriate to the route and equipment;
- returns attention forward after indirect checks;
- updates the position of relevant traffic rather than making one isolated check;
- increases or redirects checks before approved special situations;
- does not treat a blind or unconfirmed area as clear;
- recognizes and corrects a stale scene picture; and
- uses the approved equipment views without prolonged fixation.

These are planning categories only. M3-D13 must define the route, observation opportunity, rating anchors, what counts as not observed, critical versus coachable behavior, trainer calibration, and recheck process. A trainer must not infer eye direction from head movement alone or use unapproved surveillance data as a substitute for direct observation.

### 9.5 Pilot measurement design

Predeclare:

- objective-level correctness, not only total score;
- standard-form versus accessible-form results;
- equipment-profile applicability failures;
- scenario ambiguity and SME disagreement;
- device/rendition cue visibility;
- start, resume, replay, submit, correction, and terminal-result integrity;
- learner confidence only as a separate research signal, not proof of mastery;
- Road Check behavior results separately from digital scores;
- trained-form performance separately from unseen transfer performance; and
- technical failures separately from incorrect answers.

Do not claim improvement from a pre/post difference without a predeclared design, comparable forms, sufficient sample, missing-data treatment, and reviewer approval. Do not claim crash reduction from Module 3 pilot results.

## 10. Production package and file contract

Proposed controlled package:

```text
silvicom360/module-03/<content-version>/
  manifest.json
  content/
    module-brief.md
    objectives.md
    terminology.md
    script.md
    transcript.md
    description-script.md
  evidence/
    source-register.csv
    claim-register.csv
    approvals.json
    rights-privacy-register.csv
    filming-safety-plan.pdf
  equipment/
    profiles.json
    <profile-id>/visibility-map.svg
    <profile-id>/measurement-notes.md
    <profile-id>/approval.json
  production/
    storyboard.pdf
    shot-list.csv
    view-sync-map.csv
    graphics-register.csv
    timing-sheet.csv
  media/
    master/
    mobile/
    audio-described/
    captions/
    thumbnails/
  assessment/
    item-bank.json
    transfer-form.json
    accessible-forms.json
    answer-key.protected.json
    rationale.md
    correction-history.json
  qa/
    checksums.sha256
    device-rendition-matrix.csv
    accessibility-report.md
    temporal-integrity-report.md
    pilot-report.md
```

Minimum manifest fields:

- module ID and content version;
- prerequisite Module 1 and Module 2 content versions;
- status and publish/withdraw timestamps;
- language and locale;
- audience/equipment profile IDs;
- video and alternative rendition IDs;
- caption, transcript, and description IDs;
- assessment and transfer-form versions;
- source, claim, rights/privacy, and approval register versions;
- checksums and immutable object keys;
- minimum supported app version;
- required feature and entitlement keys;
- correction/supersession metadata; and
- named release and rollback owners.

Any change to a cue, crop, view synchronization, equipment map, pause point, overlay timing, caption position, description timing, answer, rationale, or accessible form requires a new controlled content or assessment version. Published files must not be replaced in place.

## 11. FuelGuard integration plan

### 11.1 Content hierarchy

Reuse the generic hierarchy approved for Module 1:

```text
program → course → module → lesson/media → assessment items
        → assignment → attempt → response → terminal result → event history
```

Module 3 content adds domain metadata, not a separate learning platform:

- equipment profile ID;
- view type (`direct`, `flat_mirror`, `convex_mirror`, approved camera-monitor type);
- represented zones;
- scenario and synchronized-view IDs;
- pause/reveal time;
- standard and accessible form IDs;
- objective and module-boundary tags; and
- source/claim/rights/checksum references.

### 11.2 Reuse versus Module 3 additions

| Capability | Reuse from approved foundation | Potential Module 3 extension |
|---|---|---|
| Entitlement and feature gate | `training` module and feature | None. |
| Course/version/assignment/attempt | Generic immutable model | Equipment-profile eligibility and prerequisite validation. |
| Media | Private versioned media and signed delivery | Synchronized view group and rendition metadata. |
| Questions | Server-projected prompt and server-side grading | Zone/state/sequence metadata only if approved interaction requires it. |
| Accessibility | Captions, transcript, focus, screen reader, text sizing | Equivalent spatial/sequential forms and profile-linked descriptions. |
| Events | Generic assignment/player/attempt event trail | Scenario/view version and accessibility-form identifiers; no gaze telemetry. |
| Admin | Generic draft/review/publish/withdraw workflow | Equipment profile, view sync, cue visibility, and accessibility completeness validation. |
| Reporting | Generic completion and objective results | Separate equipment-profile, form-equivalence, ambiguity, and Road Check summaries. |

### 11.3 Interaction options

**Option A — Standard controlled-pause questions:** video or still sequence pauses, then the server supplies a normal question. This is the preferred first-release default because it is easier to secure, test, localize, and represent accessibly.

**Option B — Zone selection or sequence comparison:** the learner selects a view/zone or compares observations. Use only if the interface has keyboard/switch/screen-reader equivalents, large targets, non-color cues, stable rendering, and an alternate form with the same construct.

**Option C — Eye/head tracking or camera monitoring:** out of scope for version 1. It requires new permissions, sensitive data handling, employment/privacy review, validation against actual behavior, bias/accessibility analysis, retention and access rules, and proof that it improves the intended measure. No current FuelGuard seam justifies it.

### 11.4 API and security boundary

The approved implementation must:

- authenticate every route and require organization membership;
- require `training` entitlement and released feature state;
- apply role/capability gates to content review, assignment, publishing, reporting, and corrections;
- resolve the learner’s linked driver server-side rather than accepting an arbitrary driver ID;
- prove organization ownership for course, module, version, assignment, attempt, media, equipment profile, and Road Check record;
- project only learner-visible question fields before submission;
- keep answer keys, rationale controls, draft media, source footage, and private visibility measurements server-side;
- make terminal submission idempotent and safe under retries/concurrency;
- audit publish, withdraw, assign, waive, grade, correct, export, and Road Check mutations;
- enforce RLS and service-boundary checks using the repository’s discovered conventions;
- rate-limit relevant writes and protect signed-media lifetime/revocation;
- prevent cross-tenant, cross-driver, and cross-profile access; and
- emit correction events rather than rewriting historical terminal results silently.

Do not add camera, microphone, location, motion, or photo-library permission for Module 3 unless a separately approved feature requires it and the user-facing purpose matches the actual data use.

### 11.5 Driver application

The learner path should reuse the approved generic player and add only verified Module 3 needs:

1. show assignment, prerequisite, equipment profile, language, and accessibility form;
2. warn the learner to remain parked and not take the module while operating;
3. support private playback, captions, transcript, description/alternative, pause, replay, resume, and recovery;
4. preserve assessment temporal integrity so the answer is not revealed early;
5. render each relevant zone and cue legibly on representative supported phones;
6. provide accessible non-drag/non-hotspot alternatives;
7. save only the minimum required learner events and responses;
8. submit a terminal result through the server; and
9. show completion, retry, support, correction, or withdrawal status without confusing it with a driver-performance score.

No Module 3 screen should open the operational camera, infer gaze, or request live location.

### 11.6 Telematics, driver monitoring, and personalization boundary

Current `driver_scores` rows are weekly provider-derived aggregates. They do not answer:

- whether a driver checked a mirror;
- which mirror or zone was checked;
- whether the check was timely or purposeful;
- whether an object was tracked across views;
- whether a driver fixated;
- whether a blind area was treated as clear; or
- whether the driver performed the approved scan process.

Therefore version 1 must:

- keep automatic Module 3 assignment from driver scores and event counts off;
- keep Module 3 results separate from the performance score;
- avoid labels such as “poor scanner,” “inattentive,” or “unsafe” based on aggregate data;
- avoid joining training and employment-performance data without an approved purpose, access model, retention rule, fairness review, and driver communication; and
- require human review and a separately approved validation plan before any future event-level signal is used.

### 11.7 Analytics

Collect only data necessary for delivery, integrity, accessibility, learning evaluation, and support:

- assignment, start, resume, completion, withdrawal, and terminal result;
- content, scenario, equipment-profile, language, rendition, and accessible-form versions;
- objective/item results and correction history;
- playback failure, buffering, URL expiry, unsupported format, and recovery events;
- support/ambiguity/accessibility flags;
- Road Check result only under the separately approved observation model; and
- pilot cohort/wave identifiers approved for evaluation.

Do not interpret replay count, watch duration, pause count, tap location, answer latency, head position, or weekly Samsara aggregates as proof of scanning competence.

## 12. Execution plan

### Phase M3.0 — Refresh baseline and resolve prerequisites

**Work**

1. Re-read the controlled source plan and verify its hash/version.
2. Refresh branch, commit, migration head, worktree, entitlement, feature, foundation, identity, driver-app, and media evidence.
3. Verify the approved and shipped Module 1 and Module 2 versions.
4. Assign owners and resolve M3-D01 through M3-D15 or remove affected scope explicitly.
5. Obtain audience, fleet/equipment, route, policy, trainer, accessibility, language, and pilot inputs.

**Exit gate:** No missing input can silently change the audience, scan instruction, equipment representation, accessibility method, observation standard, privacy posture, or architecture.

### Phase M3.1 — Equipment and visibility evidence

**Work**

1. Inventory launch vehicle, body, trailer, seat, mirror, and approved camera-monitor configurations.
2. Define the minimum number of profiles needed to avoid false generalization.
3. Measure/document direct and indirect fields using an approved repeatable method.
4. Record mirror type, distortion/processing, reference points, hidden areas, and special limitations.
5. Review each profile with safety, equipment/maintenance, representative drivers, accessibility, production, and legal/privacy owners.
6. Version and approve diagrams before they enter scripts or assessments.

**Exit gate:** Every shown or assessed view maps to an approved equipment profile and no graphic claims unsupported coverage.

### Phase M3.2 — Scan standard and curriculum boundary

**Work**

1. Resolve the 5–8 versus 8–10 second public-source conflict and document the company decision.
2. Approve the routine pattern, forward-return rule, trigger logic, and fixation language.
3. Decide mirror-adjustment/pre-trip scope.
4. Approve original blind-area terminology and diagrams.
5. Build a boundary matrix for Modules 2 and 4–9.
6. Map every learner-facing rule to regulation, current public guidance, company policy, equipment evidence, or SME judgment.

**Exit gate:** Safety/operations and curriculum owners approve a teachable, observable, equipment-compatible standard with explicit limitations.

### Phase M3.3 — Scenario and assessment design

**Work**

1. Draft more scenarios than the module needs so ambiguous or visually weak scenes can be removed.
2. Create observation keys before narration: available information, required comparison, unknown areas, intended response, and prohibited inference.
3. Produce standard and accessible forms together.
4. Separate coached practice from unseen transfer form B.
5. Conduct independent SME keying and equipment-profile review without showing proposed answers.
6. Test cue visibility, sequence, and answer stability across supported devices/renditions.
7. Resolve or remove every disagreement and record the disposition.

**Exit gate:** Only scenarios with defensible keys, profile validity, temporal integrity, accessibility equivalence, and module-boundary compliance remain.

### Phase M3.4 — Script, storyboard, and production proof

**Work**

1. Draft narration within the approved word/time budget.
2. Complete storyboard, shot list, view-sync plan, graphics, captions, transcript, description, and rights/privacy register.
3. Table-read and time narration, pauses, description, and translated versions separately.
4. Build low-fidelity synchronized clips/stills and test on representative devices.
5. Review every line and frame for facts, equipment accuracy, policy, safety, originality, privacy, accessibility, and answer leakage.
6. Freeze a signed production package and checksums.

**Exit gate:** No unresolved factual, policy, equipment, rights, privacy, safety, temporal, or accessibility placeholder remains in the production package.

### Phase M3.5 — FuelGuard implementation and integration

**Work**

1. Reuse the verified generic training foundation; allocate migrations from the then-current head only when a constrained schema change is necessary.
2. Add equipment-profile and synchronized-view metadata only if the approved delivery design needs it.
3. Extend shared validation and server projection for any new item type.
4. Add standard and accessible learner forms with equivalent terminal grading.
5. Add administrator validation for profile, view sync, rendition, checksum, source, rights, and accessibility completeness.
6. Add tenant, driver, role, module, IDOR, replay, concurrency, rate-limit, correction, and withdrawal tests.
7. Prove no camera/location permission or gaze telemetry was added inadvertently.

**Exit gate:** Existing repository gates and Module 3 authorization, grading, rendering, accessibility, privacy, correction, and recovery tests pass with recorded command evidence.

### Phase M3.6 — Production, controlled pilot, and Road Check calibration

**Work**

1. Acquire or film approved assets without creating road risk.
2. Produce standard, mobile, and accessible versions; human-review captions, transcript, and descriptions.
3. Test every assessed view and cue on the device/network/profile matrix.
4. Calibrate trainers against approved behavior anchors and representative route opportunities.
5. Pilot the digital module and Road Check with the named cohort using unseen transfer scenarios.
6. Log ambiguity, equipment mismatch, intervention, accessibility, playback, scoring, and reviewer disagreement without silent coaching.

**Proposed operational gates, subject to M3-D15:**

- 100% of pilot assignments start, resume, submit, and preserve a terminal result without data repair;
- no cross-tenant, cross-driver, cross-profile, answer-key, rights, privacy, or unsafe-production finding;
- no severity-1/2 accessibility, security, data-loss, temporal-integrity, or cue-legibility defect;
- every assessed view is legible on every supported rendition/profile combination;
- at least 90% complete without facilitator intervention;
- at least 80% correctly answer each approved core-objective item after ambiguous items are removed;
- unseen transfer performance is reported separately and meets the threshold approved in M3-D15;
- standard and accessible forms show no unexplained objective-level scoring gap requiring redesign;
- trainer calibration meets the approved agreement threshold before operational Road Checks;
- every failed or abandoned attempt has an explainable event trail; and
- final video remains within 10–12 minutes.

**Exit gate:** The pilot report disposes every issue as fixed, accepted with owner/date, or release-blocking; the named owner authorizes the release wave.

### Phase M3.7 — Release and observation

**Work**

1. Publish immutable Module 3 assets, equipment profiles, scenarios, questions, and accessible forms.
2. Assign only eligible linked drivers with verified prerequisites, language, and equipment profile.
3. Expand in named waves after technical, accessibility, comprehension, transfer, and Road Check signals are reviewed.
4. Keep telematics- or driver-monitoring-triggered assignment off unless M3-D14 is separately approved and tested.
5. Publish a new version for any view, crop, sync, profile, timing, answer, rationale, caption, description, or policy change.
6. Feed approved lessons into Module 4 without silently revising Module 3.

**Exit gate:** The program owner accepts the post-release report and authorizes downstream reuse of the approved package.

## 13. Verification matrix

| Area | Required verification | Pass evidence |
|---|---|---|
| Source and claims | Every factual, numerical, policy, regulatory, equipment, and human-factors statement reviewed in context | Signed claim/source register by line, scene, and reviewer. |
| Equipment applicability | Every visual and question maps to the learner’s approved vehicle/mirror/camera profile | Profile register, measurement notes, SME/driver approval, and version linkage. |
| Visibility integrity | Crops, overlays, image processing, and device rendering preserve the evidence available before response | Device/rendition screenshots, source comparison, and checksum record. |
| Temporal integrity | Multi-view scenes share a verified time base and pause/reveal order | View-sync map and frame-level review record. |
| Scenario validity | Independent reviewers agree on observable state, relevant next zone, change, unknowns, and keyed response | Agreement log; ambiguous scenes removed or corrected. |
| Curriculum boundary | Module 3 does not teach incomplete later-module procedures | Cross-module owner approval. |
| Accessibility | Captions, transcript, description/alternative, focus, screen reader, text scaling, contrast, controls, non-color cues, and equivalent assessment | Accessibility review plus VoiceOver/TalkBack and form-equivalence evidence. |
| Grading | Protected key, exact approved logic, one terminal result, idempotency, concurrency safety, and corrections | Unit/API/integration tests including duplicate and concurrent submission. |
| Tenant/driver/profile isolation | Organization, role, assignment, attempt, media, equipment profile, and cross-ID checks | RLS/API/IDOR matrix. |
| Privacy | No unapproved camera, gaze, face, biometric, location, or driver-monitoring collection | Permission/config inspection, event-schema review, and privacy sign-off. |
| Resume/recovery | App kill, network loss, signed URL expiry, backgrounding, retry, withdrawal, and content correction | Device/server event trail with no false completion or lost response. |
| Road Check | Approved route opportunities, behavior anchors, trainer calibration, not-observed handling, and recheck logic | Calibration and pilot records. |
| Telematics separation | No unapproved score trigger, scan diagnosis, join, dashboard implication, or employment-performance use | Code/config review and integration tests. |
| Transfer | Unseen form remains separate from instruction and is reported separately | Versioned form B and approved predeclared analysis. |
| Records | Content/profile/form versions, responses, results, timestamps, corrections, withdrawals, and retention | Sample audit export accepted by records owner. |
| Release control | Feature/content unavailable before approval; safe withdraw/revoke/rollback | Staging evidence and rollback rehearsal. |

Repository verification must use commands relevant to the actual touched work at implementation time: shared/API/web/driver typechecks and tests, lint, file/function-size checks, boundary checks, route-auth tests, migration checks, RLS/IDOR matrices, driver permission inspection, and device/rendition proof. Record exact commands, counts, versions, and logs.

## 14. Rollout, monitoring, and rollback

### 14.1 Rollout

- Require the approved Module 1 and Module 2 prerequisite versions.
- Start with the M3-D15 pilot cohort and named equipment profiles.
- Do not assign a profile that does not match the driver’s approved equipment context.
- Do not assign unlinked drivers through the app.
- Do not use Module 3 completion as a dispatch block until due dates, exceptions, accommodations, support, and employment-policy consequences are approved.
- Do not auto-assign from driver scores, harsh events, crash counts, or unvalidated driver-monitoring labels in version 1.
- Expand by named terminal/profile/language wave only after review.

### 14.2 Monitoring

Monitor:

- assignment/start/resume/submission/terminal counts;
- playback, buffering, crop, resolution, view-sync, signed URL, and media failures;
- equipment-profile mismatches and unsupported configurations;
- standard versus accessible form use and completion;
- per-objective and unseen-transfer performance;
- item ambiguity, challenge, correction, and support flags;
- trainer calibration and not-observed rates;
- unexpected differences by profile, language, form, device, terminal, or approved cohort attributes;
- correction/withdrawal events and version consistency; and
- later Road Check observations only under the approved evaluation design.

Do not interpret watch duration, mirror-question accuracy, replay count, or weekly Samsara aggregates as proof the driver scans correctly on the road.

### 14.3 Rollback

1. Pause new Module 3 assignments.
2. Withdraw the affected content, equipment profile, scenario, or assessment version.
3. Disable the training feature/module if a broader learner-path stop is required.
4. Revoke affected media sessions according to the approved signed-URL/cache design.
5. Preserve attempts, responses, events, and Road Check records for investigation.
6. Mark invalid items/scenarios/profiles through correction events and re-evaluate affected results under an approved rule.
7. Notify assigned learners, trainers, and administrators of the disposition.
8. Publish a corrected immutable version; never replace a view, profile, crop, sync map, answer, or rationale in place.

## 15. Risks and controls

| Risk | Impact | Control | Owner |
|---|---|---|---|
| A public cadence is treated as company policy without review | Inaccurate or unsafe instruction | M3-D03; preserve 5–8 versus 8–10 source conflict and record approval. | Safety/operations TBD |
| A rigid mirror sequence displaces attention from an urgent forward condition | Training-created risk | Flexible trigger model, SME scenario review, Road Check calibration. | Safety/learning TBD |
| A generic visibility diagram is applied to unlike equipment | False clearance and invalid assessment | Versioned equipment profiles and applicability gate. | Equipment/safety TBD |
| Mirror imagery is cropped, delayed, reversed, or composited misleadingly | Incorrect spatial/temporal interpretation | Source comparison, view-sync map, processing disclosure, checksum QA. | Production/QA TBD |
| Convex views are interpreted as exact distance | Poor gap judgment | Equipment-specific explanation and reviewed examples; defer maneuver decisions. | Safety/SME TBD |
| A disappeared vehicle is taught as clear | False certainty | Key “unknown” explicitly; track across observations. | Learning/safety TBD |
| The answer is revealed by narration, captions, description, or overlay | Invalid assessment | Hidden-information map and timestamped reveal audit. | Learning/accessibility TBD |
| Visual-only exercise excludes a learner | Unequal access or invalid scores | Equivalent form designed jointly and pilot-tested. | Accessibility owner TBD |
| Response time, gaze, or head motion becomes a grading shortcut | Invalid, biased, or inaccessible measurement | No timing/gaze grading by default; separate approval and validation required. | Product/privacy TBD |
| Operational camera permission is reused for training surveillance | Privacy and trust harm | Explicit prohibition, permission/config test, privacy review. | Engineering/privacy TBD |
| Telematics aggregate is treated as a mirror-use diagnosis | Unfair targeting and false causality | No automatic integration; separate reviewed decision. | Safety/privacy TBD |
| Module overlaps or contradicts Modules 2, 4, 5, 6, 7, 8, or 9 | Curriculum inconsistency | Cross-module boundary matrix and owner review. | Program owner TBD |
| Old crash statistics are presented as current causal facts | Misleading training/legal exposure | Claim register, date/context limits, remove unnecessary numbers. | Compliance/legal TBD |
| Footage is unlicensed, identifiable, or created through unsafe driving | IP, privacy, or injury exposure | Rights/privacy register, controlled capture, releases, safety plan. | Legal/production TBD |
| Training feature releases before the generic foundation is ready | Broken or insecure learner path | M3-D01 and end-to-end release gate. | Engineering/release TBD |

## 16. Required approval record

Before production, capture:

- approved Module 1 foundation and Module 2 prerequisite versions;
- audience, vehicle/equipment profiles, route environments, and exclusions;
- routine cadence disposition, including the conflicting FMCSA pages;
- scan sequence, forward-return rule, trigger list, fixation language, and module boundaries;
- mirror-adjustment/pre-trip scope;
- visibility-profile method, diagrams, measurement evidence, owners, and versioning;
- blind-area terminology and permitted graphics;
- footage/source mix, synchronized-view method, licenses/releases, privacy treatment, and filming safety plan;
- standard and accessible scenario/assessment forms;
- objectives, script, storyboard, item bank, transfer form, timing, and claims;
- languages, translators, reviewers, and localization QA;
- pass, retake, feedback, correction, retention, and access rules;
- Road Check behaviors, route opportunities, ratings, calibration, recheck, and trainer qualification;
- telematics/driver-monitoring no-use or approved-use disposition;
- technical architecture, device/network/profile matrix, cost, support, and rollback model;
- pilot cohort, predeclared gates, results, and issue dispositions; and
- final immutable version, checksums, approvers, dates, and release/rollback owners.

No blank approval field may be interpreted as approval.

## 17. Source register

### Internal evidence

1. `SILVICOM360 Defensive Driving/Silvicom360_Defensive_Driving_System_Plan.docx` — controlled source program plan, reviewed 2026-08-17; SHA-256 recorded above.
2. `docs/plans/silvicom360/MODULE-01-INTRODUCTION-PROFESSIONAL-MINDSET.md` — proposed generic training foundation and unresolved program-level decisions.
3. `docs/plans/silvicom360/MODULE-02-SEE-FAR-AHEAD-HAZARD-RECOGNITION.md` — proposed forward-hazard vocabulary, scenarios, and dependency boundary.
4. `packages/shared/src/entitlements.ts` and `packages/shared/src/featureCatalog.ts` — `training` entitlement and unreleased driver feature.
5. migrations `0088_module_entitlements.sql`, `0134_driver_app_features.sql`, and `0139_backfill_modules_existing_orgs.sql` — entitlement and feature-control model.
6. `apps/api/src/routes/me.ts`, `apps/api/src/middleware/requireModule.ts`, `apps/api/src/middleware/auth.ts`, and `apps/api/src/app.ts` — driver identity, module authorization, role boundaries, and API composition.
7. `apps/driver/package.json`, `apps/driver/app/_layout.tsx`, `apps/driver/app/(tabs)/more.tsx`, and `apps/driver/DESIGN.md` — current driver platform and design contract.
8. migration `0054_driver_scores.sql`, `packages/shared/src/driverPerformance/parse.ts`, `apps/api/src/services/driverScoreSync.ts`, and `apps/api/src/lib/samsaraDriverPerformance.ts` — weekly Samsara-derived safety aggregates.
9. `packages/shared/src/notificationsContract.ts` and migrations `0089_notifications.sql`, `0093_hazmat_notifications.sql`, and `0154_efs_alert_pipeline.sql` — notification vocabulary and `training_due` seam.
10. Driver camera/capture configuration and features — operational capture permission exists, but no training, gaze, or driver-monitoring use exists.
11. Migration/code search on 2026-08-17 — no generic training implementation and no event-level dashcam, driver-facing video, gaze, mirror-use, or scan-label repository found.

### External authoritative sources checked 2026-08-17

1. Current eCFR, 49 CFR 383.111 — Required knowledge: https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-383/subpart-G/section-383.111
2. Current eCFR, 49 CFR 383.113 — Required skills: https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-383/subpart-G/section-383.113
3. Current eCFR, 49 CFR 393.80 — Rear-vision mirrors: https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-393/subpart-G/section-393.80
4. FMCSA Tips for Truck and Bus Drivers, updated 2026-05-12: https://www.fmcsa.dot.gov/ourroads/tips-truck-and-bus-drivers
5. FMCSA CMV Driving Tips — Inadequate Surveillance, updated 2015-02-11: https://www.fmcsa.dot.gov/safety/driver-safety/cmv-driving-tips-inadequate-surveillance
6. FMCSA CMV Driving Tips overview: https://www.fmcsa.dot.gov/safety/driver-safety/cmv-driving-tips-overview
7. FMCSA 2005 Commercial Driver’s License Manual, especially section 2.4: https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/2005%20CDL%20DRIVER%20MANUAL%20FINAL%20July%202010.pdf
8. FMCSA FAST DASH — Novel Convex Mirrors: https://www.fmcsa.dot.gov/research-and-analysis/technology/fast-dash-safety-technology-evaluation-project-3-novel-convex
9. NHTSA Countermeasures That Work — Hazard Perception Training: https://www.nhtsa.gov/book/countermeasures-that-work/young-drivers/countermeasures/other-strategies-behavior-change
10. NHTSA Visual-Manual Driver Distraction Guidelines: https://www.nhtsa.gov/document/visual-manual-nhtsa-driver-distraction-guidelines-vehicle-electronic-devices
11. FMCSA Driver Distraction in Commercial Vehicle Operations: https://rosap.ntl.bts.gov/view/dot/17715
12. W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
13. W3C Description of Visual Information: https://www.w3.org/WAI/media/av/description/
14. W3C Understanding Captions (Prerecorded): https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded
15. Expo Video documentation: https://docs.expo.dev/versions/latest/sdk/video/
16. Supabase private storage bucket fundamentals: https://supabase.com/docs/guides/storage/buckets/fundamentals
17. Supabase resumable uploads: https://supabase.com/docs/guides/storage/uploads/resumable-uploads

## 18. Definition of done for this planning document

This plan becomes **Approved for execution** only when:

1. the source plan and code baseline are refreshed if work starts from another plan version, branch, commit, migration head, or material worktree state;
2. the approved and shipped Module 1 foundation and Module 2 prerequisite versions are named and verified;
3. M3-D01 through M3-D15 each has a recorded disposition, owner, and date;
4. content, policy, safety, operations, equipment/maintenance, trainers, legal/privacy, accessibility, learning, engineering, production, records, and pilot owners approve their sections;
5. every scene and item has an equipment profile, source, rights/privacy record, synchronized-view proof, evidence key, accessible equivalent, immutable version, and device-legibility proof;
6. the Road Check method is approved and trainer calibration is demonstrated;
7. every learner-facing numerical, regulatory, equipment, and behavioral claim has an approved claim-register disposition;
8. any approved deviation is recorded in a new controlled document version; and
9. implementation, production, pilot, release, monitoring, correction, and rollback are tracked against phase exit gates rather than prose alone.
