# Silvicom360 Module 5 — Verify Before Moving: Turns, Lane Changes & Merging

**Document status:** Planning baseline; not approved for production or release
**Version:** 0.1
**Prepared:** 2026-08-17
**Target product:** FuelGuard Safety Training
**Verified code baseline:** branch `main`, commit `91d05f11d6de32e7ea5517bfed081b74bf731f20`
**Source-program plan:** `Silvicom360_Defensive_Driving_System_Plan.docx`, SHA-256 `33117e5fbb8656fceab3787dd6a01b302c2eab46b010f9a10d4069ac05ee5376`
**Document owner:** Unassigned

> This document separates verified facts, evidence-based proposals, and unresolved company decisions. A **Decision required** item is not permission to invent an answer during scripting, filming, assessment, observation, or implementation.

## 1. Outcome and scope

Module 5 turns the fourth proposed Silvicom360 principle, **Verify Before Moving**, into a deliberate maneuver habit. It teaches a commercial driver to build a current picture of the intended path, communicate the intended movement, verify relevant direct and indirect views again before changing position or direction, move only while the path remains acceptable, and monitor the entire vehicle’s path until the maneuver is complete.

The instructional aim is not “look once, then go.” The aim is to:

1. prepare early enough that a maneuver is optional rather than forced;
2. identify the full vehicle path, including trailer offtracking and tail swing where applicable;
3. communicate intent under the approved company and jurisdiction rule;
4. re-verify the relevant zones after signaling and immediately before movement;
5. hold, defer, reroute, or safely discontinue a maneuver when the picture is incomplete or changes;
6. move smoothly while continuing to monitor the path; and
7. confirm clearance, lane position, signal state, and restored space after completion.

A signal communicates intent; it does not establish that another road user saw the signal, will yield, or that the path is clear. A mirror, camera, or warning system extends awareness only within its verified capability. An area that is not currently confirmed remains **unknown**, not automatically empty.

Digital completion can document knowledge, sequencing, scene interpretation, and the ability to choose a safe hold-or-move decision. It cannot prove that the learner performs turns, lane changes, merges, or pull-outs safely in a commercial motor vehicle. Live performance remains a separate Silvicom360 Road Check responsibility under an approved observation standard.

### 1.1 Included

- Module 5 learning objectives, boundaries, timing, proposed storyboard, production rules, and implementation plan.
- A provisional vocabulary for intended path, swept path, offtracking, tail swing, verification zone, stale observation, gap, closing rate, hold, abort, commitment point, and completion check.
- Forward turns, lane changes, freeway/limited-access merges, entering traffic, pulling away from a curb or roadside stop, and missed-turn/exit decisions.
- Pre-maneuver planning, communication, current path verification, smooth execution, continued monitoring, and post-maneuver confirmation.
- Direct-view, flat-mirror, convex-mirror, and approved camera-monitor or warning-system information represented in the launch fleet.
- Equipment-specific recognition of areas that cannot be confirmed by the represented views.
- Vehicle-specific swept-path effects, including front swing, trailer offtracking, and rear/tail swing when applicable.
- Vulnerable-road-user checks relevant to turns and lateral movement.
- Scenario practice requiring the learner to decide whether to move, wait, cancel, reroute, or gather more information.
- Accessibility design for instruction and assessment whose essential information is visual, spatial, sequential, or time-sensitive.
- FuelGuard packaging, publishing, assignment, analytics, pilot, release, and rollback requirements.
- Conditions for any later use of maneuver-related telematics or driver-assistance events, without assuming such data exists or is approved.

### 1.2 Excluded

- A final company maneuver sequence, signal-distance rule, gap-acceptance rule, lane-choice policy, or state-law interpretation.
- Backing, GOAL, backing spotters, dock approach, and backing stop-and-check procedures; those belong to Module 6.
- Emergency evasive steering, off-road recovery, collision avoidance, or skid recovery.
- A complete mirror-adjustment or routine scanning lesson; that belongs to Module 3.
- Following-distance and space-cushion calculation; that belongs to Module 4.
- A complete intersection, curve, ramp-speed, downgrade, or work-zone procedure; that belongs to Module 7.
- Fatigue, distraction, emotion, rushing, and route-pressure controls; those belong to Module 8.
- Complete adverse-weather and low-visibility maneuver rules; those belong to Module 9.
- A generic shoulder check copied from passenger-car instruction without equipment, seating, forward-attention, and company review.
- A generic “No-Zone” diagram presented as the measured visibility map for every company vehicle.
- Treating turn-signal activation, a camera image, a blind-area alert, or an absence of warning as proof that a path is clear.
- Teaching that merging traffic always has or never has right-of-way; the applicable law and traffic control must be verified for launch jurisdictions.
- Teaching a fixed signal distance, fixed merge gap, or universal turn path without an approved jurisdiction and vehicle profile.
- Staging unsafe cut-offs, squeezes, right-hook conflicts, forced merges, or emergency lane changes for footage.
- Automatic assignment, discipline, or competence claims based on weekly Samsara safety aggregates.
- A claim that a quiz, watched video, ordered sequence, or narrated response proves on-road competence or crash reduction.
- ELDT, government certification, third-party certification, or a replacement for state CDL testing.

## 2. Verified baseline

### 2.1 Program-plan facts

The source program plan specifies:

- a ten-module core course;
- Module 5 title: **Verify Before Moving: Turns, Lane Changes & Merging**;
- target video length: **10–12 minutes**;
- primary outcome: **use deliberate verification before high-risk movements**;
- the proposed principle definition: before turns, lane changes, backing, merging, or pulling from a stop, verify the path and blind areas rather than assuming they are clear;
- original scripts, footage, graphics, examples, and assessments;
- concise video segments, decision questions, captions, and transcripts;
- a separate road observation so digital completion is not the only measure of competency;
- a Road Check maneuver category whose examples include turns, merges, lane changes, backing setup, and GOAL behavior; and
- a Road Check communication category whose examples include early signaling and predictable braking.

Unlike Module 4, the source plan does **not** provide a Module 5 scene-by-scene storyboard. The storyboard in Section 7 of this document is a proposed design derived from the approved title, principle, outcome, broader program requirements, authoritative sources, and current technical constraints. It is not source-plan fact.

The source plan does not define:

- the exact verification sequence or mnemonic;
- which maneuver types and operating environments belong in the first release;
- launch vehicle classes, lengths, articulation, trailer types, mirror packages, camera systems, warning systems, or seating geometry;
- signal timing, signal distance, lane-selection rules, merge right-of-way wording, or launch jurisdictions;
- the exact direct/mirror/camera observations required for each maneuver profile;
- gap-acceptance or closing-rate thresholds;
- turn setup, offtracking, tail-swing, and vulnerable-road-user standards;
- abort, hold, missed-turn, missed-exit, or reroute rules;
- assessment method, pass rule, retake rule, or Road Check scoring anchors;
- footage source, synchronization, calibration, or perspective controls;
- launch languages or accessible alternative; or
- approved company incidents, claims, statistics, and terminology.

Backing appears in the principle definition and Road Check examples, but the curriculum assigns backing and GOAL discipline to Module 6. Module 5 should state that backing requires verification, then defer the complete method so the two modules do not publish conflicting procedures.

### 2.2 FuelGuard facts verified in code

| Area                      | Current fact                                                                                                                                                                             | Evidence                                                                                                       | Module 5 consequence                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code baseline             | Current branch is `main` at `91d05f11d6de`; the Silvicom360 plan directory is untracked.                                                                                                 | Git status and history on 2026-08-17                                                                           | Re-run the baseline before implementation and preserve work outside this document.                                                                          |
| Migration line            | The latest migration filename currently found is `0201_unit_mileage_write_bucket.sql`.                                                                                                   | Sorted migration inspection                                                                                    | Do not reserve a migration number in this plan; allocate from the actual head during implementation.                                                        |
| Product entitlement       | `training` is an allowed module key labeled “Safety Training.”                                                                                                                           | `packages/shared/src/entitlements.ts`                                                                          | Reuse this entitlement; do not introduce a Module 5 entitlement.                                                                                            |
| Driver feature            | `training` exists in the feature catalog but is `released: false`.                                                                                                                       | `packages/shared/src/featureCatalog.ts`                                                                        | Module 5 cannot make the feature releasable independently of the generic foundation.                                                                        |
| Training foundation       | No general course, lesson, assignment, attempt, quiz, completion, or training-event implementation was found in the database, API, web, or driver app.                                   | Targeted migration and code search on 2026-08-17                                                               | Module 5 depends on the approved Module 1 foundation or a newly approved replacement.                                                                       |
| Driver app                | The learner app is React Native 0.86 / Expo 57; `expo-video` is not installed and no training route exists.                                                                              | `apps/driver/package.json` and driver navigation inspection                                                    | Reuse the generic player after it exists; do not build a Module 5-only player.                                                                              |
| Identity                  | Driver access resolves through authenticated membership and `drivers.user_id`; the driver-user link can be null.                                                                         | `supabase/migrations/0003_core_tables.sql`, migrations `0098`, `0102`, `0116`, and `apps/api/src/routes/me.ts` | In-app assignments are limited to linked users unless another authenticated channel is approved.                                                            |
| Authorization             | Authentication, organization scoping, `requireModule()`, role gates, audit helpers, and RLS conventions exist.                                                                           | API middleware, route patterns, and module migrations                                                          | Apply existing tenant, role, ownership, audit, and replay protections to every training operation.                                                          |
| Safety aggregates         | `driver_scores` contains weekly Samsara-derived safety score, distance/time exposure, harsh acceleration/braking/turn counts, crash count, speeding duration, and raw provider response. | `supabase/migrations/0054_driver_scores.sql` and related sync/parser code                                      | Stored fields do not establish turn-signal use, mirror checks, verified path, lane-change gap, merge behavior, offtracking, or vulnerable-road-user checks. |
| Maneuver events and media | No event-level lane-change, merge, turn, blind-area warning, dashcam clip, near-miss narrative, or maneuver-verification repository was found.                                           | Repository search on 2026-08-17                                                                                | Do not promise personalized Module 5 scenes, event-triggered assignments, or automated diagnoses.                                                           |
| Notifications             | `training_due` is a recognized notification category, but no producer creates course-due events.                                                                                         | notification contract, migrations `0089`, `0093`, `0154`, and producer search                                  | Add reminders only after assignment and due-state rules exist.                                                                                              |
| Device permissions        | The driver app declares camera use for operational load-stop capture; no training camera use exists.                                                                                     | driver app configuration and capture features                                                                  | Do not reuse the operational camera permission to observe head turns, mirrors, signals, or learner maneuvers.                                               |
| Maps/location             | Location and mapping packages support operational workflows.                                                                                                                             | `apps/driver/package.json` and navigation features                                                             | Module 5 has no justified need for live learner location, route, heading, speed, or lane capture during digital training.                                   |
| Compliance records        | Hazmat and ELDT-related qualification records are separate compliance-domain records.                                                                                                    | compliance migrations, contracts, services, and UI                                                             | Never write Silvicom360 Module 5 completion into hazmat certification, ELDT, CDL test, or driver-qualification evidence.                                    |

### 2.3 Prior-module dependency disposition

Modules 1–4 are planning documents; none proves approval, implementation, or release. Module 5 may reuse only verified, approved versions of:

- immutable course and content versions;
- assignments, attempts, responses, server-side grading, and event history;
- private media delivery, captions, transcripts, and accessible alternatives;
- driver player and administrator workflows;
- Module 2 terms for observable cues, developing conflicts, and early response;
- Module 3 terms for direct/indirect view, mirror fields, tracking, unknown areas, and trigger checks; and
- Module 4 terms for following interval, lateral space, closing rate, potential maneuvering option, and restored margin.

Module 5 must not:

- duplicate the generic platform in Module 5-specific tables or routes;
- treat an unresolved prior-module term or policy as approved;
- treat Module 4’s potential maneuvering option as a verified path;
- define a mirror sequence that conflicts with the approved Module 3 equipment profile;
- release `training` before an end-to-end generic learner and administrator path is verified;
- merge training results into driver performance scores without separate approval; or
- reserve migration numbers from the current `0201` line before implementation begins.

## 3. Facts, proposals, and decisions required

| ID     | Topic                                           | Status            | Current evidence                                                                                                                                                   | Release requirement                                                                                                                                     |
| ------ | ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M5-D01 | Foundation readiness                            | Decision required | The entitlement and feature seam exist, but the generic training platform does not.                                                                                | Name the approved Module 1 plan/version and verified software release Module 5 will reuse, or approve a replacement.                                    |
| M5-D02 | Audience and operating profile                  | Decision required | “Company drivers” is the only supplied audience description.                                                                                                       | Name launch terminals, roles, jurisdictions, CMV classes, body/trailer combinations, articulation, mirror/camera packages, route types, and exclusions. |
| M5-D03 | Initial maneuver scope                          | Decision required | The source names turns, lane changes, and merging; the principle also names pulling from a stop and backing.                                                       | Approve exact first-release maneuver families, environments, and Module 6 backing boundary.                                                             |
| M5-D04 | Verification standard and sequence              | Decision required | Regulations require visual search, signaling, gap choice, turn positioning, and observation before changing speed/direction; the source gives no company sequence. | Safety/operations approve the pre-check, signal, recheck, movement, monitoring, completion, and hold/abort rules.                                       |
| M5-D05 | View and equipment profiles                     | Decision required | No fleet visibility map, seating geometry, mirror layout, camera-monitor system, or sensor capability was supplied.                                                | Approve one evidence-based view/verification profile for every launch configuration shown, assessed, or observed.                                       |
| M5-D06 | Signal rule                                     | Decision required | Federal CDL requirements address signaling, while actual timing/distance and some hazard-flasher rules depend on jurisdiction and situation.                       | Legal/safety approve exact signal timing, duration, cancellation, equipment-failure, and misleading-signal wording for every launch profile.            |
| M5-D07 | Lane-change gap and execution                   | Decision required | 49 CFR 383.113 requires choosing a safe gap and proper observation, but no universal seconds or distance is supplied.                                              | Approve gap factors, relative-speed logic, lane restrictions, recheck points, movement rate, and completion criteria.                                   |
| M5-D08 | Merge and enter-traffic standard                | Decision required | Vehicle acceleration/load, ramp design, traffic control, gap, and jurisdiction affect the maneuver.                                                                | Approve ramp/entering procedure, right-of-way wording, hold/reroute boundary, and prohibited forced-merge behavior.                                     |
| M5-D09 | Turn setup and swept-path standard              | Decision required | Large vehicles can offtrack and swing; actual path depends on configuration and geometry.                                                                          | Fleet engineering/safety approve setup, lane choice, speed boundary, offtracking/tail-swing diagrams, clearance rules, and prohibited generic paths.    |
| M5-D10 | Vulnerable-road-user verification               | Decision required | Current FMCSA material highlights turn risks for bicyclists and pedestrians; no company zone/sequence is supplied.                                                 | Approve VRU zones, repeated-check points, stop/hold rule, door-side and curb-side distinctions, and scenario coverage.                                  |
| M5-D11 | Pulling from a stop                             | Decision required | The principle includes pulling from a stop; the source gives no curb, shoulder, yard, dock, or traffic-entry distinction.                                          | Approve included contexts, signal/check sequence, forward-path rule, and boundary with backing/yard procedures.                                         |
| M5-D12 | Hold, abort, missed route, and commitment point | Decision required | Older FMCSA guidance says not to make a sudden correction after missing a turn or exit. No company abort/commitment standard exists.                               | Approve when to wait, cancel, reroute, continue, or complete; define who may coach this and how route pressure is handled.                              |
| M5-D13 | Driver-assistance systems                       | Decision required | No fleet list or integrated blind-area/lane-change warning data exists in FuelGuard; system capabilities and limits vary.                                          | Approve equipment-specific wording, alert response, malfunction rule, and statement that absence of an alert is not independent verification.           |
| M5-D14 | Footage and simulation                          | Decision required | FuelGuard has no approved event footage; multi-view synchronization and path geometry are essential.                                                               | Approve controlled footage, licensed/de-identified footage, simulation/graphics, metadata, rights/privacy, and validation requirements.                 |
| M5-D15 | Digital interaction and accessibility           | Decision required | The app has no training player, synchronized multi-view interaction, hotspot, or sequence engine. Essential information is visual, spatial, and temporal.          | Approve minimum interaction, accessible equivalent, replay/pause behavior, and device requirements.                                                     |
| M5-D16 | Assessment rule                                 | Decision required | No bank size, served count, pass threshold, retake, feedback, or correction rule exists.                                                                           | Approve objective coverage, grading, remediation, answer-key review, and prohibition on response-time/gaze scoring.                                     |
| M5-D17 | Road Check and telematics                       | Decision required | The source requires field observation, but current FuelGuard data has no maneuver events and no observation workflow.                                              | Approve observable behaviors, safe route conditions, trainer calibration, critical fails, recheck/appeal, and no-integration default.                   |
| M5-D18 | Languages, pilot, and claims                    | Decision required | No launch languages, pilot cohort, effect threshold, localization reviewers, or learner-facing statistics were supplied.                                           | Approve localization, pilot measures, stop criteria, claims register, and permitted interpretation of results.                                          |

## 4. Learner design

### 4.1 Audience

Provisional audience: company commercial drivers in the approved Module 5 pilot who:

- have an authenticated FuelGuard driver account linked through `drivers.user_id`;
- completed the approved prerequisite module versions;
- are assigned content matching an approved vehicle, visibility, maneuver, route, and jurisdiction profile;
- receive consistent language across narration, captions, transcript, prompts, alternatives, and questions; and
- are parked and not operating a vehicle while taking the digital module.

The plan does not assume that every learner:

- drives a tractor-trailer or the same vehicle length and articulation;
- has identical flat, convex, hood, fender, crossover, or digital camera-monitor views;
- has blind-area, lane-change, or side-object warning technology;
- uses routes with the same lane rules, ramp design, turn geometry, shoulders, bicycle facilities, or pedestrian traffic;
- reads English as a first language;
- has normal color perception, visual acuity, contrast perception, hearing, motor ability, or cognitive processing speed; or
- can demonstrate a live maneuver through a phone interaction.

### 4.2 Prerequisites

Before pilot assignment:

1. The approved generic training foundation is implemented and verified.
2. Approved Module 2–4 terminology and content versions are named.
3. M5-D02 through M5-D17 are resolved for the pilot.
4. A current legal review is complete for every launch jurisdiction represented in instruction or assessment.
5. Every represented vehicle configuration has an approved visibility and swept-path profile.
6. Every scenario has a source, rights/privacy record, vehicle/road/jurisdiction profile, synchronization record, observation key, answer rationale, and accessible alternative.
7. The player and assessment are tested on representative devices, orientations, text sizes, screen readers, connection states, and playback recovery states.
8. Learners can report inaccessible, misleading, equipment-inapplicable, or jurisdiction-inapplicable content without being scored as noncompliant.
9. Trainers complete approved Module 5 Road Check calibration before recording results.

### 4.3 Proposed measurable learning objectives

Subject to M5-D04 through M5-D17, a learner will be able to:

1. **Map:** Given an approved vehicle profile and planned maneuver, identify the forward, side, rear, swept-path, and unknown zones that matter before and during movement.
2. **Sequence:** Arrange the approved preparation, communication, re-verification, movement, monitoring, and completion steps without treating a signal or one glance as clearance.
3. **Track:** Across successive views, identify which road user entered, left, remained in, or became unknown within a relevant zone.
4. **Decide:** Choose move, hold, cancel, reroute, or gather-more-information based only on the current facts supplied.
5. **Anticipate:** Identify offtracking, tail-swing, front-swing, acceleration, and closing-rate effects relevant to the represented vehicle and maneuver.
6. **Protect:** Select a response that preserves space for pedestrians, bicyclists, motorcyclists, adjacent traffic, fixed objects, and the full vehicle path.
7. **Transfer:** Apply the approved process to at least two unseen scenarios across different approved maneuver families.

No digital response-time, gaze-direction, head-motion, swiping path, or device-tilt threshold is proposed. Those measures do not demonstrate safe CMV maneuver performance.

### 4.4 Working vocabulary

These definitions are proposed for review and are not company policy until approved:

- **Intended movement:** The planned turn, lane change, merge, pull-out, crossing, or other change in vehicle position or direction.
- **Intended path:** The roadway area the vehicle is expected to occupy if the movement proceeds as planned.
- **Swept path:** The complete area occupied by every part of the vehicle as it moves, not only the tractor or steering axle path.
- **Offtracking:** The tendency of rear wheels or trailing units to follow a path inside the path of the front wheels during a turn.
- **Tail swing:** Outward movement of the vehicle body or rear overhang on the side opposite the direction of a turn, where applicable.
- **Front swing:** Movement of the front or front corner outside its prior footprint as steering begins.
- **Verification zone:** A direct-view, mirror, camera-monitor, or other approved area that must be current for the represented maneuver.
- **Unknown area:** A relevant zone that has not been confirmed, is no longer current, or cannot be resolved with the approved views. Unknown is not clear.
- **Stale observation:** Information that was accurate earlier but is no longer reliable because time, speed, occlusion, traffic, or the vehicle’s own movement changed the scene.
- **Gap:** Space in traffic considered for entry or lateral movement. Its suitability depends on size, closing rate, vehicle performance, conditions, law, and the entire maneuver duration.
- **Closing rate:** How quickly separation is decreasing between the host vehicle and another road user.
- **Pre-check:** The initial observation used to determine whether a maneuver is reasonable to prepare and communicate.
- **Re-verification:** A fresh check after communication and immediately before movement because road users may have moved or reacted.
- **Hold:** Keep the vehicle in its current controlled position because the path, gap, or legal condition is not acceptable.
- **Cancel/defer:** Do not begin the planned movement; maintain or recover a safe current path and reassess later.
- **Commitment point:** A maneuver-specific point beyond which abrupt reversal may create more risk than controlled completion. It must be defined by approved company procedure, not improvised in the module.
- **Completion check:** Confirmation that the entire vehicle cleared the conflict area, occupies the intended lane/path, the signal state is correct, and appropriate space has been restored.
- **Driver-assistance alert:** Equipment-generated information or warning. It may supplement awareness but does not by itself verify the path.

### 4.5 Proposed process model

The following is a planning model, not approved driver instruction:

1. **Prepare:** Know the intended movement early, establish controllable speed/space, and identify the full vehicle path.
2. **Pre-check:** Sample the relevant forward, side, rear, and swept-path zones using the approved equipment profile.
3. **Communicate:** Signal under the approved company and jurisdiction rule without assuming a response.
4. **Re-verify:** Refresh every critical zone after signaling and immediately before changing position or direction.
5. **Move or hold:** Proceed smoothly only if the path and gap remain acceptable; otherwise wait, cancel, or reroute under the approved rule.
6. **Monitor:** Continue purposeful checks throughout the movement, including trailer/rear path and changing traffic.
7. **Complete:** Confirm clearance, lane/path position, signal cancellation, and restored space.

Safety/operations must decide whether this seven-step model becomes learner-facing language, is replaced, or remains an internal design tool. It must not become a rigid eyes-off-road checklist. The approved sequence must define which checks matter by maneuver and equipment profile.

### 4.6 Maneuver-specific verification matrix

This matrix identifies proposed design questions; it is not an approved operating procedure.

| Maneuver            | Before signaling/preparation                                                                            | Immediately before movement                                                                 | During movement                                                                   | Completion                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Lane change         | Need/reason, forward traffic, lane legality, following space, adjacent/rear traffic                     | Recheck adjacent lane, overtaking/closing traffic, relevant unknown areas, and gap          | Continue tracking front/side/rear and move smoothly while lane remains acceptable | Entire vehicle in lane, signal state correct, spacing restored |
| Merge/enter traffic | Ramp/path, traffic control, acceleration capability, traffic pattern, candidate gap                     | Recheck lead/follow vehicles, closing rate, lane ending, and alternate/hold option          | Match approved speed strategy, track gap changes, avoid forced entry              | Entire vehicle established in legal lane with usable space     |
| Right turn          | Lane/setup, curb/edge, crosswalk, sidewalk/bicycle area, opposing/adjacent traffic, swept path          | Recheck vulnerable users and right-side/forward zones after signaling and before roll/steer | Monitor curb-side path, offtracking, tail/front swing, cross traffic, and trailer | Entire vehicle clears conflict area and occupies approved lane |
| Left turn           | Lane/setup, intersection control, opposing traffic, crosswalks, swept path, turn lane status            | Recheck opposing traffic, vulnerable users, receiving lane/path, and signal phase           | Monitor front path, offtracking/tail swing, cross traffic, and receiving lane     | Entire vehicle clears intersection and occupies approved lane  |
| Pull from stop      | Legal stop position, forward path, mirrors/direct view, traffic, pedestrians, cyclists, equipment state | Recheck approaching traffic and near-side areas after signal                                | Pull straight/smoothly under approved procedure while tracking sides/rear         | Established in traffic, signal cancelled, spacing restored     |

The final matrix must be rewritten for each approved vehicle and jurisdiction profile. If the required information cannot be obtained, the correct learning response is hold, cancel, or obtain more information—not assume.

### 4.7 Content boundaries with other modules

| Topic encountered in Module 5 | Teach here                                                                                     | Defer                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Developing conflict           | Use early recognition to avoid a forced maneuver                                               | Full hazard-search method remains Module 2                                        |
| Mirrors and scanning          | Select maneuver-relevant views and refresh them before/during movement                         | Routine scan cadence, mirror limits, and equipment map remain Module 3            |
| Space                         | Preserve a suitable gap and restore spacing after completion                                   | Following-interval and general space-management standard remain Module 4          |
| Backing                       | State that verification is mandatory and the forward-maneuver sequence does not govern backing | Setup, GOAL, spotter, and backing procedure belong to Module 6                    |
| Turns/intersections/ramps     | Verify and monitor the path for the maneuver                                                   | Full speed, intersection, curve, ramp, and work-zone strategy belongs to Module 7 |
| Rushing or missed route       | Hold/reroute instead of making a sudden correction                                             | Human-factor and route-pressure controls belong to Module 8                       |
| Weather/visibility            | Recognize that reduced confirmation can require a hold or different plan                       | Complete adverse-condition rules belong to Module 9                               |
| Integrated performance        | Apply the focused verification process                                                         | Full-system scenarios belong to Module 10 and the Road Check                      |

## 5. Evidence and regulatory boundary

### 5.1 Verified source interpretation

49 CFR 383.111 requires CDL knowledge of vehicle controls and mirrors, basic turns and offtracking, visual search, signaling intent and presence, space management, safe traffic gaps, and the relationship between cargo and vehicle control. This supports Module 5’s topic set but does not prescribe a single company maneuver sequence.

49 CFR 383.113 requires demonstrated on-road ability to use proper visual search, signal when changing direction, choose a safe gap for lane changes/passing/crossing/entering traffic, position correctly for turns, and observe the road and other vehicles before changing speed or direction. It also states that simulation cannot substitute for required on-street CDL skills. Module 5 digital practice therefore cannot be represented as an on-road skills test.

49 CFR 392.2 requires CMVs to follow the laws, ordinances, and regulations of the jurisdiction in which they operate, subject to a higher applicable FMCSA standard. Because launch jurisdictions were not supplied, this plan cannot approve signal distance, lane use, merge right-of-way, shoulder use, turn-lane selection, intersection movement, or hazard-flasher rules.

49 CFR 392.7 requires the driver to be satisfied that specified equipment—including lighting devices, horn, and rear-vision mirrors—is in good working order and to use it as needed. Sections 393.9 and 393.11 address operability and required lamp/reflector equipment. Module 5 may treat functioning, unobscured signal and observation equipment as a prerequisite, but it is not a complete inspection lesson.

FMCSA’s current truck-and-bus tips, updated May 12, 2026, advise checking blind areas, making wide turns carefully, and signaling/braking early. The page is general outreach, not a complete fleet-specific maneuver procedure.

FMCSA’s 2015 inadequate-surveillance and unfamiliar-roadway pages provide useful scenario context: check relevant views before lane changes, turns, and merges; do not make a sudden route correction; signal intent and scan before changing lanes. Their crash percentages, event narratives, cadence statements, and “No-Zone” claims are dated and must not be imported into learner content without claim review.

The FMCSA-hosted 2005 CDL Testing System manual, July 2014 version, provides a detailed national reference for special mirror checks, signaling, lane changes, merges, turn offtracking, entering traffic, missed-route avoidance, and on-road test behavior. It is not a substitute for current launch-state manuals, current company policy, manufacturer guidance, or vehicle-specific swept-path evidence.

NHTSA describes blind-area and lane-change warning technology as alerts intended to identify certain adjacent-lane conflicts. That technology description does not establish that a particular FuelGuard fleet vehicle has the system, that every object is detected, or that an absence of warning verifies the path.

### 5.2 Legal and standards interpretation rules

1. Federal CDL knowledge and skill requirements are not a universal numerical maneuver procedure.
2. Legal/compliance must review every launch state or other jurisdiction for current signaling, lane-use, merge, intersection, shoulder, move-over, and vehicle-specific rules.
3. Current state CDL manuals and company policies must be compared with the older national model manual before scripting.
4. A signal communicates intent but does not transfer responsibility for verifying and safely executing the movement.
5. Right-of-way wording must identify the jurisdiction, roadway control, and exact scenario; do not teach “the merging vehicle always yields” as a national rule.
6. A manufacturer or provider alert cannot replace the company’s approved observation procedure unless law, equipment evidence, and safety review explicitly say otherwise.
7. Simulation and digital assessment support knowledge and judgment practice; they do not replace the required on-road skills evidence described in 49 CFR 383.113.
8. Nothing in Module 5 authorizes operation contrary to law, posted control, manufacturer instructions, fleet limits, or the company safety manual.

### 5.3 Claim rules

Every numerical, legal, equipment, crash, visibility, or maneuver claim must have a claim-register entry containing:

- exact proposed wording;
- source title, publisher, URL, publication/update date, and access date;
- source context, population, vehicle type, and jurisdiction;
- assumptions, units, geometry, speed, load, equipment, and environmental conditions;
- whether it is regulation, agency guidance, state manual, company policy, manufacturer limitation, study result, or illustrative example;
- approved learner-facing paraphrase;
- reviewer, approval date, and expiration/recheck date; and
- every scene, graphic, caption, transcript, assessment item, Road Check anchor, and localization in which it appears.

Prohibited without specific approval:

- “one look is enough”;
- “if the signal is on, the other driver must let you in”;
- “no warning means the lane is clear”;
- “the camera eliminates the blind spot”;
- “always shoulder-check” without a vehicle/equipment/forward-attention review;
- “always take this turn path” without a vehicle/jurisdiction profile;
- “the merging vehicle always has/does not have right-of-way”;
- a fixed signal distance or gap presented as universal law;
- a generic “No-Zone” diagram labeled as the measured launch vehicle;
- a crash percentage from an older source presented as current fleet risk;
- “never abort” or “always abort” without an approved commitment-point rule; or
- any claim that Module 5 completion proves safe live maneuver performance.

## 6. Content structure and timing

Proposed narrated runtime: **11:20**, within the source plan’s 10–12 minute target. Decision interactions pause playback and do not count toward narrated runtime.

| Segment                             |        Time | Purpose                                                                              | Required decision/evidence                    |
| ----------------------------------- | ----------: | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| 1. Verification is current evidence |   0:00–0:50 | Contrast assumed clearance with a changing scene                                     | Approved scenario; no unsafe incident staging |
| 2. Full vehicle path                |   0:50–1:45 | Introduce intended path, swept path, offtracking, tail/front swing                   | Fleet-profile diagrams                        |
| 3. Prepare and pre-check            |   1:45–2:35 | Establish early setup and relevant verification zones                                | M5-D04–D05                                    |
| 4. Signal, then re-verify           |   2:35–3:30 | Show why signaling is communication, not clearance                                   | M5-D06 and jurisdiction review                |
| 5. Lane change                      |   3:30–4:45 | Apply gap, closing-rate, stale-observation, hold, movement, and completion logic     | M5-D07                                        |
| 6. Merge/enter traffic              |   4:45–5:55 | Apply acceleration, traffic-control, candidate-gap, and no-forced-entry logic        | M5-D08                                        |
| 7. Right turn and vulnerable users  |   5:55–7:15 | Verify curb-side, crosswalk, offtracking, and changing occupancy                     | M5-D09–D10                                    |
| 8. Left turn and receiving path     |   7:15–8:15 | Verify opposing traffic, crosswalks, receiving lane, and swept path                  | M5-D09–D10                                    |
| 9. Pulling out and missed route     |   8:15–9:10 | Apply pull-from-stop and reroute/hold behavior                                       | M5-D11–D12                                    |
| 10. Assistance systems and unknowns |   9:10–9:55 | Explain equipment support and limits                                                 | M5-D13                                        |
| 11. Decision scenario               |  9:55–10:45 | Choose move, hold, cancel, reroute, or gather information                            | M5-D14–D17                                    |
| 12. Transfer and recap              | 10:45–11:20 | Apply prepare/check/communicate/recheck/move/monitor/complete logic to a new profile | Final wording approval                        |

If the approved script exceeds 12 minutes, remove repetition or move enrichment outside the core. Do not speed narration, remove accessibility content, or delete legal/equipment qualifiers to meet runtime.

## 7. Proposed scene-by-scene storyboard blueprint

> The source program plan provides no Module 5 storyboard. Every scene below is a proposal requiring the applicable decision and approval records.

| Scene | Approx. time | Proposed visual and action                                                              | Teaching purpose                                                 | Interaction/accessibility                                  | Approval dependency         |
| ----- | -----------: | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------- |
| 1     |    0:00–0:25 | Multi-view scene pauses before a lane change; adjacent lane appears clear in one view   | Ask what is confirmed and what remains unknown                   | Structured view-state list                                 | Footage/equipment profile   |
| 2     |    0:25–0:50 | Scene advances and an overtaking vehicle enters the relevant zone                       | Show that clearance expires as traffic changes                   | Sequential description                                     | Observation key             |
| 3     |    0:50–1:15 | Top-down vehicle outline shows front-wheel path and full swept path                     | Distinguish intended line from full vehicle occupancy            | Tactile-friendly/structured text alternative               | Fleet geometry review       |
| 4     |    1:15–1:45 | Approved vehicle examples compare offtracking and tail/front swing                      | Prevent one generic turn diagram from representing every vehicle | Alternative comparison table                               | M5-D02/D09                  |
| 5     |    1:45–2:10 | Driver identifies maneuver early and establishes position/space                         | Show that preparation precedes urgency                           | Description names lane, traffic, and path                  | Module 4 alignment          |
| 6     |    2:10–2:35 | Verification-zone graphic highlights only maneuver-relevant views                       | Teach purposeful checks rather than a ritual eye pattern         | Ordered zone list                                          | M5-D04–D05                  |
| 7     |    2:35–3:00 | Signal activates; nearby traffic changes speed or position                              | Establish that communication can change the scene                | Captions and description include signal and traffic change | M5-D06                      |
| 8     |    3:00–3:30 | Re-verification identifies the new condition; driver holds                              | Reinforce that signaling does not authorize movement             | Move/hold prompt                                           | Legal/safety review         |
| 9     |    3:30–4:00 | Lane-change scene provides front, side, and rear views with candidate gap               | Identify gap and closing-rate facts                              | Structured timeline/view table                             | Multi-view synchronization  |
| 10    |    4:00–4:25 | A previously observed vehicle becomes hidden/unknown                                    | Ask whether the maneuver may start                               | Equivalent text scenario                                   | M5-D07                      |
| 11    |    4:25–4:45 | Approved smooth lane change with continued monitoring and completion check              | Show movement is monitored until entire vehicle clears           | Description tracks trailer and signal                      | Road Check alignment        |
| 12    |    4:45–5:15 | On-ramp/entering-traffic diagram states vehicle acceleration and traffic control        | Identify the facts needed for a merge decision                   | Alternative fact table                                     | M5-D08/D10                  |
| 13    |    5:15–5:40 | Candidate gap closes; driver uses approved hold/defer/alternate response                | Reject forced entry                                              | Decision rationale                                         | Jurisdiction/profile review |
| 14    |    5:40–5:55 | Successful approved merge ends with restored space                                      | Connect Module 4 margin to maneuver completion                   | Description and completion checklist                       | M4/M5 alignment             |
| 15    |    5:55–6:25 | Right-turn setup shows curb, crosswalk, bicycle/pedestrian zones, and trailer path      | Map conflict zones before movement                               | Structured zone table; no color-only cues                  | M5-D09–D10                  |
| 16    |    6:25–6:50 | Vulnerable road user becomes occluded after initial check                               | Show why a prior observation becomes stale                       | Hold/more-information prompt                               | Safety/accessibility review |
| 17    |    6:50–7:15 | Controlled right turn monitors the inside path and tail/front swing                     | Show full-path monitoring without unsafe squeeze footage         | Description tracks all relevant vehicle parts              | Fleet geometry validation   |
| 18    |    7:15–7:45 | Left-turn scene shows opposing traffic, crosswalk, and receiving lane                   | Identify receiving-path and offtracking constraints              | Equivalent ordered facts                                   | Jurisdiction/vehicle review |
| 19    |    7:45–8:15 | Signal phase or receiving path changes before commitment                                | Choose hold versus approved controlled completion                | Non-timed decision                                         | M5-D12                      |
| 20    |    8:15–8:40 | Vehicle prepares to pull from a roadside stop                                           | Apply pre-check, signal, recheck, and smooth pull-out            | Structured alternative                                     | M5-D11                      |
| 21    |    8:40–9:10 | Route cue arrives too late for a safe exit or turn                                      | Choose continue/reroute instead of sudden correction             | Decision prompt and rationale                              | M5-D12/M8 boundary          |
| 22    |    9:10–9:35 | Approved blind-area/lane-change warning display appears in an equipment-specific mockup | Explain what the alert does and does not establish               | Text equivalent names alert and system limit               | M5-D13/manufacturer review  |
| 23    |    9:35–9:55 | Same profile has no alert while a zone is unconfirmed                                   | Reject absence-of-alert as proof                                 | Short decision item                                        | System-limit approval       |
| 24    |   9:55–10:25 | Mixed multi-view scenario contains one stale view and one changing conflict             | Choose move, hold, cancel, reroute, or gather information        | Equivalent fact timeline                                   | Assessment validation       |
| 25    |  10:25–10:45 | Answer reveal traces each required fact and rejected option                             | Explain reasoning, not slogan recall                             | Full text rationale                                        | Legal/safety approval       |
| 26    |  10:45–11:10 | Unseen transfer scenario uses a different approved maneuver/profile                     | Demonstrate transfer                                             | Accessible equivalent                                      | Profile/item validation     |
| 27    |  11:10–11:20 | Recap card: prepare, communicate, verify, move/hold, monitor, complete                  | Close with approved behavior and transition to backing module    | Narration/captions/transcript align                        | Final editorial approval    |

Scene numbering is editorial, not a direction to create 27 separate video files. The final production may combine scenes while preserving each verification and accessibility requirement.

## 8. Script and production standards

### 8.1 Wording

- Use observable language: “the motorcycle is no longer visible in the approved views,” not “the motorcycle disappeared.”
- Say which zone, vehicle part, traffic control, and time point are relevant.
- Distinguish pre-check from re-verification and continued monitoring.
- Use “unknown” when the evidence does not establish occupancy.
- Say “signal communicates intent”; do not say it creates right-of-way or clearance.
- State vehicle, trailer, equipment, roadway, jurisdiction, traffic-control, and condition assumptions before prescribing a maneuver.
- Do not assign motive to another road user or imply that a professional driver can force compliance.
- Avoid “blind spot eliminated,” “all clear,” and other absolute terms unless the exact evidence supports them.
- Use “hold,” “defer,” “cancel,” or “reroute” precisely; do not present hesitation as failure when the required information is unavailable.
- Do not encourage narration, checklist reading, phone use, or interaction while driving.

### 8.2 Vehicle, view, and path integrity

Every depicted maneuver must record:

- vehicle class, length, wheelbase, body, trailer count/type, articulation, rear overhang, and relevant load state;
- seating/camera position and represented direct-view fields;
- mirror types, adjustment basis, and approved visible fields;
- camera-monitor and warning-system make/model/configuration if shown;
- turn geometry, lane widths/markings, curb/shoulder/crosswalk/bicycle-facility geometry, and traffic control;
- speed and relative-motion basis when those affect the answer;
- measured, simulated, or illustrative status of the swept path; and
- the qualified reviewer who validated the answer key.

Do not overlay a generic offtracking path on footage from a different configuration. Do not claim that a camera or mirror sees an area beyond the approved equipment profile. If geometry is illustrative, label it and avoid exact-clearance assessment.

### 8.3 Multi-view and temporal integrity

- Synchronize forward, left, right, rear, and equipment-display views against a documented common time base.
- Record frame rate, timestamp source, alignment tolerance, crop, lens correction, and playback rate.
- Do not use a later frame in one view as if it were simultaneous with an earlier frame in another.
- Preserve relevant road users across cuts or label a reconstruction clearly.
- Do not use editing, zoom, highlight, or slow motion to create knowledge the driver would not have at the decision point.
- Separate learner observation frames from answer-reveal overlays.
- Have a second reviewer reproduce every current/stale/unknown classification from the source media.

### 8.4 Filming safety and privacy

- Prefer controlled closed-course footage, validated simulation/animation, licensed footage, or properly de-identified operational footage.
- No participant may create an unsafe cut-off, forced merge, right-side squeeze, pedestrian/cyclist conflict, missed-exit correction, or emergency lane change for the camera.
- No driver may operate while directing, reading prompts, adjusting recording equipment, or interacting with the lesson.
- Mount recording equipment legally without obstructing vision or interfering with mirrors, controls, airbags, or required equipment.
- Blur or protect faces, plates, addresses, customer sites, device screens, proprietary cargo, and incident identifiers as required.
- Maintain talent, location, vehicle, music, font, map, simulation, footage, and incident-use rights.
- Real incident footage requires documented legal, privacy, labor, dignity, and educational-necessity review.

### 8.5 Audio, captions, description, and transcript

- Provide synchronized captions for narration and meaningful audio, including horn or warning tones when those are instructional facts.
- Provide a transcript containing spoken content, important on-screen labels, view changes, signal/alert state, movement, lane occupancy, timing, and answer rationales.
- Provide audio description or an equivalent structured alternative for relevant road-user position, relative motion, occlusion, swept path, and clearance.
- Do not rely on color, flashing, sound, arrows, or spatial position alone.
- Keep description from masking meaningful traffic or warning sounds.
- Name left/right relative to the represented driver/vehicle and remain consistent.
- Verify caption/description synchronization at every supported playback rate.

### 8.6 Accessible maneuver exercises

Every visual or multi-view exercise must provide an equivalent that preserves the decision construct:

- a timestamped state table for road-user movement and view changes;
- a lane/zone occupancy table for direct, mirror, camera, and unknown areas;
- an ordered text path for tractor/trailer offtracking and tail/front swing;
- labeled stills with meaningful reading order;
- patterns/text in addition to color and animation;
- replay, pause, and review without grade penalty;
- keyboard and screen-reader support where applicable; and
- no score based on rapid tapping, precise dragging, eye movement, head movement, or spoken narration speed.

The accessible version must not reveal the correct answer earlier than the visual version. Accessibility QA must test real items and feedback, not only the transcript.

## 9. Assessment blueprint

### 9.1 Delivery rule

Use short post-scene questions after the learner has received all facts needed to answer. Controlled pause points may be used only if visual and accessible versions preserve the same evidence. The learner must never be asked to interact while driving, and response latency must not contribute to pass/fail.

### 9.2 Item blueprint

| Objective                  | Item form                         | Minimum bank | Served target | Required evidence                                              |
| -------------------------- | --------------------------------- | -----------: | ------------: | -------------------------------------------------------------- |
| Map verification zones     | Equipment-profile zone selection  |            5 |             1 | Each zone/view is approved and profile-specific                |
| Sequence the process       | Ordered steps with rationale      |            5 |             1 | Order matches approved maneuver standard                       |
| Track change/staleness     | Successive-view comparison        |            6 |           1–2 | Frames/timestamps are synchronized and reproducible            |
| Choose move/hold/cancel    | Scenario decision                 |            8 |             2 | Legal, vehicle, path, gap, and current-view facts are explicit |
| Anticipate swept path      | Turn-path/offtracking scenario    |            6 |             1 | Geometry is measured/validated or clearly qualitative          |
| Protect vulnerable users   | Right/left turn scenario          |            6 |             1 | Relevant zones and occlusion are represented fairly            |
| Interpret assistance alert | Equipment-specific limit question |            4 |             1 | Manufacturer/fleet capability statement is approved            |
| Transfer                   | Unseen maneuver/profile scenario  |            5 |             1 | No unstated jurisdiction or equipment assumption is required   |

Minimum bank counts are planning targets, not release authorization. Final served count, pass threshold, attempt limit, feedback timing, remediation, and version-transition policy remain part of M5-D16.

### 9.3 Item-writing rules

- Supply every fact required to decide; do not expect assumptions about an unseen lane, mirror, camera, signal phase, law, vehicle, or road user.
- Identify the vehicle/equipment and jurisdiction profile whenever it affects the answer.
- Use “best next action” or “may the movement begin now?” when later actions depend on new information.
- Reward hold, cancel, reroute, or more-information responses when a critical zone is unknown.
- Do not treat signal activation or lack of an equipment alert as clearance.
- Do not reward a sudden move to save a missed turn or exit.
- Do not infer exact clearance from uncalibrated video.
- Use plausible distractors tied to a specific misconception, not joke answers.
- Explain why every rejected option fails at that moment.
- Keep quiz results separate from Road Check status and discipline.
- Validate each localized item independently; translation can change legal, spatial, temporal, and modal meaning.

### 9.4 Road-observation boundary

The Road Check may evaluate approved observable behaviors such as whether the driver:

- prepares early and positions the vehicle under the applicable maneuver profile;
- uses the approved signal and communication behavior;
- samples maneuver-relevant zones before and after signaling;
- treats an unconfirmed or changing area as a reason to hold or reassess;
- selects an acceptable gap under the approved profile;
- moves smoothly without forcing another road user to take evasive action;
- monitors the full vehicle/swept path during turns and lateral movement;
- protects vulnerable-road-user zones;
- completes in the approved lane/path, cancels the signal, and restores space; and
- reroutes rather than making an unsafe sudden correction.

It must not:

- require a trainer to infer an invisible mental state from one glance or head movement;
- manufacture a conflict, unsafe gap, forced merge, vulnerable-user exposure, or missed exit;
- direct a driver to execute a maneuver that is illegal or unsuitable for the vehicle/route;
- score against an inapplicable mirror, camera, warning-system, or jurisdiction profile;
- treat an uneventful maneuver as proof that every required check occurred;
- require the trainer to stare at a checklist or device while driving; or
- convert a digital pass automatically into an on-road pass.

Before use, define safe route prerequisites, trainer position, allowed observation aids, maneuver opportunities, rating anchors, critical-fail behaviors, no-opportunity handling, inter-rater agreement, remediation, recheck, appeal, retention, and escalation.

### 9.5 Pilot measurement design

Measure separately:

- assignment, start, completion, and technical-failure rates;
- item difficulty and discrimination by objective and maneuver family;
- accessibility defects and alternative-format equivalence;
- learner reports of ambiguous, vehicle-inapplicable, or jurisdiction-inapplicable content;
- pre/post change on unseen knowledge and judgment items;
- delayed retention on unseen items if approved;
- Road Check opportunity rate, rater agreement, and observable-behavior distribution; and
- operational signals only as exploratory, de-identified analysis under a preapproved protocol.

Do not interpret changes in weekly safety score, harsh-turn count, crash count, or speeding duration as Module 5 causation. A valid effectiveness study requires a defined population, maneuver exposure, comparison method, confounder plan, missing-data rule, statistical analysis, privacy review, and claims boundary.

## 10. Production package and file contract

Proposed package:

```text
silvicom360/
  course-manifest.json
  module-05/
    module-manifest.json
    decisions/
      decision-register.md
      approval-record.md
      jurisdiction-review.md
      fleet-profile-review.md
      maneuver-standard.md
    evidence/
      source-register.csv
      claim-register.csv
      vehicle-view-register.csv
      swept-path-register.csv
      scene-synchronization-register.csv
      footage-register.csv
      rights-register.csv
      privacy-review.md
      accessibility-review.md
    script/
      module-05-script.md
      pronunciation-and-terms.md
    storyboard/
      module-05-storyboard.pdf
      scene-register.csv
    media/
      module-05-master.mp4
      module-05-description.mp4
      captions-en-US.vtt
      transcript-en-US.html
      poster.webp
      scenes/
    interactions/
      interaction-bank.json
      accessible-alternatives.json
    assessment/
      question-bank.json
      scoring-policy.json
      rationale-register.md
      item-validation-report.md
    road-check/
      observation-standard.md
      trainer-guide.md
      calibration-cases/
    qa/
      editorial-checklist.md
      technical-review.md
      legal-review.md
      accessibility-results.md
      device-results.md
      security-results.md
      pilot-report.md
```

Every immutable content version should include at minimum:

- stable course, module, lesson, asset, interaction, assessment, and profile identifiers;
- semantic content version and build identifier;
- locale and fallback locale;
- source, claim, jurisdiction, equipment, and approval record versions;
- applicable vehicle, visibility, driver-assistance, route, maneuver, and jurisdiction profile identifiers;
- title, outcome, prerequisites, estimated duration, and release state;
- ordered assets with cryptographic hashes, MIME types, byte sizes, and duration where applicable;
- captions, transcript, description/alternative relationships, and language tags;
- question-bank version, scoring-policy version, and server-known correct responses;
- minimum supported app/API versions;
- effective and retirement timestamps;
- migration/reassignment behavior for learners in progress;
- privacy classification and retention category; and
- rollback target.

A changed maneuver standard, signal rule, state interpretation, vehicle/view profile, swept-path model, script, media asset, translation, or answer key creates a new immutable content version or applicability-profile version. Replacing approved bytes or rules under an existing version is prohibited.

## 11. FuelGuard integration plan

### 11.1 Content hierarchy

Reuse the generic hierarchy proposed in Module 1:

```text
Course
  └── Course Version
        └── Module 05 Version
              ├── Lessons / ordered assets
              ├── Interactions
              ├── Assessment bank + scoring policy
              ├── Accessibility variants
              ├── Applicability profiles
              └── Approval + source metadata

Assignment
  └── Attempt
        ├── Playback / interaction events
        ├── Responses
        └── Completion result

Road Check
  └── Separate observation event and status
```

Module 5 digital completion and Road Check status must remain separate facts. An administrator view may display both only with clear labels and independent version/status histories.

### 11.2 Reuse versus Module 5 additions

Reuse after verification:

- course/module/version/asset entities;
- assignment, attempt, response, completion, due-date, notification, and audit entities;
- private media storage and signed delivery;
- server-side scoring and idempotent event ingestion;
- locale/accessibility-variant selection;
- administrator publishing and assignment controls; and
- generic analytics and export controls.

Module 5 may require generic, reusable metadata—not special-purpose tables—for:

- vehicle/equipment/visibility applicability;
- jurisdiction and maneuver applicability;
- scene synchronization and evidence provenance;
- accessible interaction linkage; and
- Road Check standard version.

Do not add fields such as `module_5_lane_change_score`, `verified_blind_spot`, or `turn_passed`. If a reusable structured need emerges, design it across the course and document authorization, privacy, versioning, interpretation, and retention.

### 11.3 Interaction options

Preferred minimum-release interaction: standard post-scene questions supported by synchronized stills or a structured fact table. This reduces cross-device timing error and makes accessible equivalence tractable.

Optional later enhancement: synchronized multi-view playback with controlled pause/reveal. It requires:

- a common validated time base;
- deterministic view selection and pause behavior;
- accessible state-table equivalent;
- replay without grade penalty;
- no answer inference from network/device latency; and
- analytics that distinguish asset failure from learner response.

Hotspot-only lane diagrams, gaze tracking, head-turn detection, camera proctoring, augmented reality, and reaction-time scoring are outside the initial plan.

### 11.4 API and security boundary

At minimum:

- authenticate the user and resolve current organization membership;
- require the existing `training` entitlement;
- enforce role and ownership checks server-side;
- ensure a learner can access only their own active assignment and exact immutable content/profile version;
- use non-public media delivery with short-lived authorization;
- never send answer keys to the client before grading;
- make event and submission operations idempotent and replay-safe;
- validate ordering, content/profile version, locale, timestamps, and payload size;
- audit publication, assignment, override, attempt reset, result change, Road Check entry, and export;
- apply RLS and organization scoping to all tenant data;
- define retention/deletion for raw interaction events separately from durable completion evidence; and
- reject client-declared vehicle profile, jurisdiction, location, camera observation, maneuver result, or score as trusted evidence without server validation.

### 11.5 Driver application

The eventual learner path should:

1. appear only when `training` is entitled, released, and assigned;
2. require a linked authenticated driver or another explicitly approved identity path;
3. show module version, estimated time, due state, prerequisites, applicability profile, and parked-use warning;
4. support captions, transcript, description/alternative selection, playback controls, text scaling, and recovery;
5. expose a clear mismatch-report path for vehicle, equipment, route, jurisdiction, language, or accessibility;
6. save durable progress without treating buffering, backgrounding, or muted auto-play as watched content;
7. present questions only when required assets and accessible facts are available;
8. grade through the server and show approved corrective feedback;
9. distinguish digital completion, assignment status, and Road Check status; and
10. collect no live location, lane position, camera, microphone, accelerometer, heading, speed, or telematics data merely to complete Module 5.

### 11.6 Telematics and driver-assistance boundary

Current FuelGuard code provides weekly safety aggregates, not event-level lane-change, merge, turn, signal, blind-area, camera, or maneuver-verification data. A harsh-turn count does not show whether a driver checked a path, and a crash count does not identify the correct coaching module.

Default launch behavior:

- assign through approved role/cohort/workflow rules, not inferred maneuver behavior;
- do not display a personal “verification” or “blind-spot” score;
- do not use raw provider payloads as a training-decision API;
- do not represent driver-assistance alerts in content unless the learner’s fleet profile is approved;
- do not expose one driver’s events or scores to another driver;
- do not merge answers into the operational driver score; and
- do not auto-discipline, auto-certify, or auto-fail a Road Check from training/telematics data.

Any later event-triggered workflow requires provider-contract review, field-level validation, synchronized context, false-positive/negative analysis, equipment mapping, human review, notice, appeal, access control, retention, labor/privacy review, and effectiveness evaluation. A provider label or absence of an alert is not ground truth.

### 11.7 Analytics

Permitted minimum analytics, subject to the generic event schema:

- assignment opened, module started, asset started/completed;
- caption/transcript/alternative selected;
- interaction shown and response submitted;
- assessment started/submitted/passed/not passed;
- module completed;
- playback/accessibility/technical error; and
- profile mismatch or content issue reported.

Each event should include server-resolved organization, assignment, immutable content version, locale, applicability profile, and actor context. Do not collect exact GPS, speed, heading, camera image, microphone input, gaze, head movement, steering, signal, brake, or lane trace for digital-module analytics.

Use analytics to improve delivery and item quality, not to infer attention, honesty, disability, intent, or live-driving competence.

## 12. Execution plan

### Phase M5.0 — Refresh baseline and resolve prerequisites

**Work**

- Re-run repository status, branch, commit, migration head, entitlement, feature flag, training-domain, player, notification, identity, telematics, and maneuver-event searches.
- Compare approved Module 1–4 versions and implementation state with this plan.
- Assign document, safety, operations, fleet engineering, legal, accessibility, product, security, production, and Road Check owners.
- Resolve M5-D01 and define the authoritative decision-register workflow.

**Exit evidence**

- dated baseline record;
- dependency matrix with implemented/approved/not-ready state; and
- named owner/approver list.

### Phase M5.1 — Fleet, view, route, and jurisdiction evidence

**Work**

- Inventory launch vehicle/trailer configurations, dimensions, articulation, mirror/camera packages, warning systems, routes, maneuver environments, and jurisdictions.
- Build verified visibility and swept-path profiles for each launch configuration.
- Review current applicable regulations, state manuals, company policy, manufacturer instructions, and fleet procedures.
- Establish source, claim, jurisdiction, vehicle-view, system-limit, and path-geometry registers.

**Exit evidence**

- approved audience/applicability profiles;
- signed jurisdiction review;
- validated vehicle-view and swept-path profiles; and
- traceable source/claim records.

### Phase M5.2 — Maneuver standard and module boundaries

**Work**

- Resolve M5-D03 through M5-D13.
- Define approved sequences for each included maneuver and profile.
- Define signal, gap, vulnerable-user, hold/abort, commitment, completion, and missed-route rules.
- Reconcile vocabulary and behavior with Modules 2–4 and boundaries with Modules 6–9.
- Define assistance-system limitations and malfunction behavior.

**Exit evidence**

- signed Module 5 maneuver standard;
- maneuver/profile verification matrix;
- vocabulary and curriculum-boundary matrix; and
- approved observable behavior list.

### Phase M5.3 — Scenario and assessment design

**Work**

- Create a scenario matrix across vehicle profiles, maneuver families, road users, visibility changes, gap changes, road controls, and correct decisions.
- Specify synchronized facts, decision frames, and answer keys before production.
- Build item specifications, accessible equivalents, rationales, and validation plan.
- Define Road Check routes/opportunities, safe observation, no-opportunity handling, and calibration cases.

**Exit evidence**

- approved scenario matrix;
- item specifications and accessible alternatives;
- reproducible scene observation keys; and
- Road Check draft ready for calibration.

### Phase M5.4 — Script, storyboard, and production proof

**Work**

- Draft an original script and storyboard using only approved claims, profiles, and procedures.
- Conduct instructional, safety, fleet, legal, editorial, accessibility, privacy, and field-review passes.
- Produce one synchronized lane-change sample and one vehicle-specific turn-path sample.
- Validate temporal alignment, view fidelity, swept path, mobile legibility, and accessible equivalence before full production.

**Exit evidence**

- locked script/storyboard version;
- signed review log;
- synchronization/path validation report; and
- approved production sample.

### Phase M5.5 — FuelGuard implementation and integration

**Work**

- Implement or reuse the approved generic foundation; do not invent Module 5-only architecture.
- Add approved generic applicability, evidence, and accessibility links if needed.
- Package private media, captions, transcripts, alternatives, interactions, and assessment bank.
- Implement driver and administrator paths behind the existing unreleased `training` feature.
- Verify tenant isolation, authorization, answer-key protection, idempotency, audit, retention, and analytics.

**Exit evidence**

- reviewed migrations allocated from then-current head;
- passing automated and manual tests;
- security/accessibility QA; and
- staging evidence for the entire learner/admin flow.

### Phase M5.6 — Production, controlled pilot, and Road Check calibration

**Work**

- Produce final media under approved safety, synchronization, privacy, and geometry controls.
- Run content, caption, transcript, description, localization, device, and recovery QA.
- Train and calibrate Road Check observers without manufacturing hazardous maneuver conditions.
- Pilot with the approved cohort and collect predefined measures.
- Review ambiguity, profile mismatch, accessibility defects, item statistics, observation opportunity, and rater agreement.

**Stop conditions**

- a learner could interpret signaling or an assistance system as proof of clearance;
- a view is not synchronized or represents an inapplicable equipment profile;
- a turn-path or clearance diagram is technically wrong or unvalidated;
- a scene rewards a forced, illegal, abrupt, or unverified maneuver;
- vulnerable-road-user or unknown-area handling is unsafe or ambiguous;
- an accessible alternative changes the construct or reveals the answer;
- critical authorization, tenant, answer-key, privacy, or media-rights failure;
- Road Check raters cannot reach the approved agreement threshold; or
- production creates an unsafe road condition.

**Exit evidence**

- signed pilot report;
- resolved critical findings;
- calibrated observers; and
- release/hold decision.

### Phase M5.7 — Release and observation

**Work**

- Release by approved organization/cohort/profile behind the `training` feature.
- Monitor technical, accessibility, content, assignment, mismatch, and support signals.
- Keep Road Check status separate and monitor rater drift.
- Revalidate sources and content when jurisdictions, fleet configurations, equipment, or company procedures change.
- Roll back affected immutable content/profile versions when a stop condition is met.

**Exit evidence**

- release log and exact version/profile mapping;
- monitoring dashboard/runbook;
- rollback rehearsal or verified mechanism; and
- scheduled content/source review owner and date.

## 13. Verification matrix

| Area                  | Required verification                                                                          | Minimum evidence                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Source fidelity       | Title, principle, outcome, timing, and absence of source storyboard are represented accurately | Source comparison checklist and hash                    |
| Claims                | Every legal, equipment, visibility, geometry, statistic, and maneuver claim is traceable       | Approved source/claim registers                         |
| Jurisdiction          | Content is valid for every launch jurisdiction                                                 | Dated legal/compliance matrix                           |
| Fleet applicability   | Views and paths match represented vehicles/trailers/systems                                    | Fleet engineering profile sign-off                      |
| Scene synchronization | Multi-view facts are simultaneous within approved tolerance                                    | Time-base and second-review report                      |
| Swept path            | Offtracking/tail/front-swing depictions are validated                                          | Geometry/simulation evidence and reviewer sign-off      |
| Instruction           | Objectives, practice, feedback, and assessment align                                           | Design traceability matrix                              |
| Accessibility         | Spatial, temporal, and multi-view evidence has an equivalent                                   | WCAG review and assistive-technology tests              |
| Assessment            | Items are unambiguous, profile-correct, and server-graded                                      | Item review, pilot statistics, answer-key security test |
| Road Check            | Behaviors are observable, routes safe, and raters calibrated                                   | Calibration cases and agreement report                  |
| Identity              | Only valid linked users or approved alternative identities participate                         | Positive/negative identity tests                        |
| Authorization         | Tenant, role, ownership, assignment, and entitlement rules hold                                | API/RLS tests                                           |
| Media                 | Private delivery, expiry, rights, and recovery work                                            | Signed-URL and device/network tests                     |
| Versioning            | Changed policy/profile/content creates a new immutable version                                 | Publish/migration/rollback tests                        |
| Privacy               | No unjustified sensor/location/camera/maneuver data is collected                               | Data-flow and retention review                          |
| Analytics             | Events are minimal, idempotent, scoped, and interpretable                                      | Contract tests and export review                        |
| Telematics boundary   | Weekly aggregates cannot trigger unsupported maneuver diagnosis                                | Assignment-rule and UI review                           |
| Operations            | Support, correction, hold, rollback, and source-review paths work                              | Runbook exercise                                        |

## 14. Rollout, monitoring, and rollback

### 14.1 Rollout

1. Internal content, fleet, legal, and technical review using no learner records.
2. Accessibility and device QA on the release candidate.
3. Small controlled pilot limited to approved vehicle/jurisdiction profiles.
4. Review against predefined stop/go criteria.
5. Limited production cohort with enhanced support and monitoring.
6. Broader rollout only after critical issues are resolved and approvers sign the release record.

Do not expose the feature globally merely because `training` is an entitlement key. Entitlement, feature release, content approval, assignment, identity, applicability profile, and locale availability are separate gates.

### 14.2 Monitoring

Monitor:

- assignment delivery and linked-driver failures;
- playback, buffering, completion, resume, caption, transcript, description, and alternative failures;
- multi-view synchronization and asset-version reports;
- item nonresponse, unexpected distractor selection, retries, and answer disputes;
- vehicle/equipment/jurisdiction/maneuver-profile mismatch reports;
- accessibility defects by platform and assistive technology;
- support reports alleging unsafe, illegal, forced, or misleading maneuver guidance;
- assistance-system limitation or manufacturer-update issues;
- Road Check no-opportunity rates, disagreement, and rater drift;
- content/version mismatch across narration, graphics, captions, transcript, assessment, localization, and Road Check; and
- authorization, cross-tenant, signed-media, answer-key, audit, and privacy alerts.

Module completion and pass rates are delivery/learning-process measures, not proof of live-driving safety.

### 14.3 Rollback

Rollback triggers include:

- incorrect or expired jurisdiction/company maneuver guidance;
- wrong vehicle, visibility, assistance-system, or swept-path profile;
- unsynchronized views or misleading edit/perspective;
- advice that could promote a forced, illegal, abrupt, unverified, or retaliatory maneuver;
- failure to protect a represented vulnerable-road-user zone;
- profile/jurisdiction assignment error;
- critical accessibility failure;
- cross-tenant exposure or answer-key leakage;
- corrupted content/version mapping; or
- evidence that assessment rewards a materially unsafe response.

Rollback should disable new assignments and access to the affected version/profile, preserve auditable history, display an approved status, identify impacted assignments/completions, and support reassignment to a corrected immutable version. Never rewrite prior responses or results silently.

## 15. Risks and controls

| Risk                                   | Why it matters                                                                  | Required control                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| One-glance verification                | Traffic and road users move after a check                                       | Pre-check/re-verification/monitoring standard and temporal scenarios                     |
| Signal treated as permission           | Other road users may not see or yield                                           | Explicit communication-not-clearance wording and assessment                              |
| Generic blind-area diagram             | Visibility varies by vehicle, seating, mirrors, cameras, and configuration      | Approved equipment-specific view profiles                                                |
| Passenger-car shoulder-check import    | A generic technique may be unsuitable for some CMVs or divert forward attention | Fleet/safety review and profile-specific observation rule                                |
| Wrong swept path                       | Offtracking and swing vary by configuration and geometry                        | Qualified validation and profile-specific diagrams                                       |
| Vulnerable-user occlusion              | Pedestrians/cyclists can enter or remain hidden during a turn                   | Repeated current checks, hold rule, VRU scenarios                                        |
| Forced merge or missed-exit correction | Schedule/route pressure can prompt abrupt movement                              | Hold/reroute standard and Module 8 boundary                                              |
| Right-of-way generalization            | Laws and controls vary                                                          | Jurisdiction profiles and legal review                                                   |
| Assistance-system overtrust            | Alerts have coverage/limit/error boundaries                                     | Manufacturer/fleet evidence and no-alert-is-not-clear rule                               |
| Multi-view desynchronization           | Learner may be shown impossible simultaneous evidence                           | Common time base, tolerance, second-person reproduction                                  |
| Unsafe production                      | Authentic maneuver conflict footage can endanger participants                   | Closed course, validated simulation, licensed/de-identified footage, no staged conflicts |
| Visual-only assessment                 | Spatial/motion evidence may be inaccessible                                     | State tables, ordered descriptions, non-color cues, assistive-technology testing         |
| False digital competence               | Quiz success does not prove live maneuver behavior                              | Separate Road Check and explicit status labeling                                         |
| Invalid telematics inference           | Weekly aggregates do not show verification or maneuver context                  | No automated diagnosis/assignment; validation/human review if later added                |
| Platform duplication                   | Module-specific infrastructure fragments training                               | Reuse approved generic foundation                                                        |
| Stale content                          | Laws, fleet, systems, and procedures change                                     | Named owner, dated registers, revalidation triggers, rollback                            |
| Cross-tenant or answer leakage         | Training/assessment data is tenant-sensitive                                    | Auth, RLS, role/ownership tests, private media, server scoring, audit                    |

## 16. Required approval record

No production or release approval may be inferred from silence. Record name, role, version, date, decision, conditions, and expiration/review date for:

| Approval                                                           | Required owner                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Module purpose, audience, prerequisites, and first-release scope   | Program owner + operations                                        |
| Verification sequence and maneuver standards                       | Safety + operations                                               |
| Vehicle visibility, swept path, and assistance-system profiles     | Fleet engineering/qualified technical reviewer + safety           |
| Signal, gap, merge, lane, turn, shoulder, and route-law wording    | Legal/compliance + safety                                         |
| Vulnerable-road-user content and hold rules                        | Safety + operations + legal/compliance                            |
| Learning objectives, proposed storyboard, practice, and assessment | Instructional design + safety                                     |
| Road Check behavior, route, opportunity handling, and scoring      | Safety + operations + trainer lead                                |
| Footage, rights, privacy, and production safety                    | Legal/privacy + safety + production owner                         |
| Accessibility design and evidence                                  | Accessibility owner                                               |
| Localization                                                       | Qualified language reviewer + safety/legal reviewer as applicable |
| FuelGuard architecture, security, and privacy                      | Product + engineering + security/privacy                          |
| Pilot design and claims                                            | Program owner + analytics/legal as applicable                     |
| Final release                                                      | Named business, safety, product, and legal approvers              |

The release record must point to exact immutable content, assessment, applicability-profile, Road Check, app, API, and database versions.

## 17. Source register

### Internal evidence

- `Silvicom360_Defensive_Driving_System_Plan.docx`; verified SHA-256 `33117e5fbb8656fceab3787dd6a01b302c2eab46b010f9a10d4069ac05ee5376`; Module 5 facts and absence of a module-specific storyboard verified 2026-08-17.
- FuelGuard Git branch and commit recorded in the document header; inspected 2026-08-17.
- `packages/shared/src/entitlements.ts`; `training` entitlement verified.
- `packages/shared/src/featureCatalog.ts`; `training` release state verified as false.
- `apps/driver/package.json` and driver navigation; driver platform/player/navigation baseline verified.
- `supabase/migrations/0003_core_tables.sql`, migrations `0098_drivers_master.sql`, `0102_invites_driver_link.sql`, `0116_driver_app_credentials.sql`, and `apps/api/src/routes/me.ts`; identity and nullable driver-user linkage verified.
- `supabase/migrations/0054_driver_scores.sql` plus related parser/sync services; current safety-aggregate fields verified.
- notification contract and migrations `0089`, `0093`, `0154`; `training_due` category and missing producer verified.
- latest migration filename found: `0201_unit_mileage_write_bucket.sql`.
- repository-wide targeted searches for general training domains, maneuver/lane-change/merge/turn events, driver-assistance events, dashcam media, player dependencies, and event-level safety data; performed 2026-08-17.
- Modules 1–4 planning documents under `docs/plans/silvicom360/`; dependency assumptions reviewed 2026-08-17.

### External authoritative sources checked 2026-08-17

- [49 CFR 383.111 — Required knowledge](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-383/subpart-G/section-383.111): federal CDL knowledge topics include controls, mirrors, basic turns/offtracking, visual search, communication, and space/gap management.
- [49 CFR 383.113 — Required skills](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-383/subpart-G/section-383.113): on-road skills include visual search, signaling, gap choice, turn positioning, and observation before changing speed/direction; simulation cannot replace required on-street testing.
- [49 CFR 392.2 — Applicable operating rules](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-392/subpart-A/section-392.2): CMVs must follow applicable jurisdiction laws and any higher FMCSA standard.
- [49 CFR 392.7 — Equipment, inspection and use](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-392/subpart-A/section-392.7): drivers must be satisfied that specified equipment, including lighting, horn, and rear-vision mirrors, is in working order and use it as needed.
- [49 CFR 393.9 — Lamps operable](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-393/subpart-B/section-393.9): required lamps must be operable and required lighting/reflective devices must not be obscured.
- [49 CFR 393.11 — Lamps and reflective devices](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-393/subpart-B/section-393.11): applicable federal lamp/reflector equipment requirements by vehicle type and manufacture date.
- [FMCSA — Tips for Truck and Bus Drivers](https://www.fmcsa.dot.gov/ourroads/tips-truck-and-bus-drivers): current general outreach on blind areas, wide turns, signaling, speed, vehicle condition, and route planning; not a complete company procedure.
- [FMCSA — Tips for Bicyclists and Pedestrians](https://www.fmcsa.dot.gov/ourroads/tips-bicyclists-and-pedestrians): current context on vulnerable users, blind areas, and wide turns.
- [FMCSA — CMV Driving Tips: Inadequate Surveillance](https://www.fmcsa.dot.gov/safety/driver-safety/cmv-driving-tips-inadequate-surveillance): older maneuver-observation scenarios and guidance; dated statistics and cadence are not approved for learner use by this plan.
- [FMCSA — CMV Driving Tips: Unfamiliar Roadway](https://www.fmcsa.dot.gov/safety/driver-safety/cmv-driving-tips-unfamiliar-roadway): older guidance to plan routes, avoid sudden corrections, signal intent, and scan before a lane change.
- [FMCSA-hosted Commercial Driver’s License Manual — July 2014](https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/2005%20CDL%20Driver%20Manual%20-July%202014%20-%20FINAL.pdf): national model-manual reference for special mirror checks, signals, lane changes, merges, turns/offtracking, entering traffic, and on-road test behavior; verify against current launch-state manuals.
- [NHTSA — Driver Assistance Technologies](https://www.nhtsa.gov/vehicle-safety/driver-assistance-technologies): general descriptions of blind-area and lane-change warnings and their role as alerts; not evidence of FuelGuard fleet equipment or performance.
- [W3C Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/): accessibility success criteria for the eventual learner and administrator experience.
- [W3C — Making Audio and Video Media Accessible](https://www.w3.org/WAI/media/av/): planning guidance for captions, transcripts, description, players, and media alternatives.
- [W3C — Understanding Success Criterion 1.2.2: Captions (Prerecorded)](https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded): prerecorded caption requirement and interpretation.
- [Expo Video documentation](https://docs.expo.dev/versions/latest/sdk/video/): current platform option to evaluate during implementation; it is not currently installed in FuelGuard.
- [Supabase Storage Buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals): public/private bucket behavior relevant to protected media design.
- [Supabase Resumable Uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads): upload path to evaluate for large media; not an implementation decision by itself.

## 18. Definition of done for this planning document

This planning document is complete when:

- the source title, principle, outcome, timing, Road Check context, and lack of a Module 5 source storyboard are represented accurately;
- every proposed storyboard scene is labeled as a proposal rather than source-plan content;
- current FuelGuard capabilities and gaps are recorded without claiming a training or maneuver-event platform exists;
- federal requirements, jurisdiction law, agency guidance, model-manual material, equipment limitations, accessibility standards, and platform references are separated clearly;
- every unresolved maneuver, vehicle, jurisdiction, legal, production, assessment, technology, and rollout choice has an owner and release gate;
- implementation phases have testable exit evidence and stop conditions;
- digital completion and Road Check competence remain distinct; and
- no observation sequence, signal rule, gap, right-of-way rule, turn path, camera capability, warning-system behavior, or telematics workflow is silently assumed.

It is **not** production-ready until M5-D01 through M5-D18 are resolved, required approvals are recorded against exact versions, the generic FuelGuard training foundation exists and passes verification, and the controlled pilot meets its approved stop/go criteria.
