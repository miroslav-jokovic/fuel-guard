# Silvicom360 Module 4 — Leave Space: Following Distance & Escape Space

**Document status:** Planning baseline; not approved for production or release
**Version:** 0.1
**Prepared:** 2026-08-17
**Target product:** FuelGuard Safety Training
**Verified code baseline:** branch `main`, commit `91d05f11d6de32e7ea5517bfed081b74bf731f20`
**Source-program plan:** `Silvicom360_Defensive_Driving_System_Plan.docx`, SHA-256 `33117e5fbb8656fceab3787dd6a01b302c2eab46b010f9a10d4069ac05ee5376`
**Document owner:** Unassigned

> This document separates verified facts, evidence-based proposals, and unresolved company decisions. A **Decision required** item is not permission to invent an answer during scripting, filming, assessment, observation, or implementation.

## 1. Outcome and scope

Module 4 turns the third proposed Silvicom360 principle, **Leave Space**, into a practical margin-management habit. It teaches a commercial driver to create usable time and distance ahead, protect lateral space where conditions allow, recognize when traffic or conditions reduce that margin, and rebuild it calmly before the reduced margin becomes urgent.

The proposed learning pattern is:

1. **Create** a suitable margin before it is needed.
2. **Protect** the margin by monitoring changes and avoiding unnecessary compression.
3. **Rebuild** it when a cut-in, slowdown, grade, surface change, visibility loss, or other condition takes it away.

The module must not imply that one time interval, physical distance, lane position, or escape route is safe in every vehicle and condition. It must also distinguish a **potential maneuvering option** from a path that has been checked and is legal and safe to use. Module 4 creates options; later modules govern verification and execution.

Digital completion can document knowledge, time-gap measurement, scenario interpretation, and the learner’s ability to choose a margin-restoring response. It cannot prove that the learner maintains appropriate space in live traffic. That behavior remains a separate Silvicom360 Road Check responsibility under an approved observation standard.

### 1.1 Included

- Module 4 learning objectives, content boundaries, timing, storyboard blueprint, and production rules.
- A provisional vocabulary for following interval, physical gap, stopping distance, stopping margin, lateral space, closing rate, cut-in, compression, potential maneuvering option, and margin recovery.
- A repeatable method for measuring a following interval from a fixed roadside reference point.
- The relationship among perception distance, reaction distance, brake-system response, and braking distance at a conceptual level.
- Condition-sensitive spacing decisions involving speed, visibility, traction, traffic, grade, load/equipment profile, and available side space.
- Calm recovery after another road user enters the gap, without retaliation, acceleration, crowding, or abrupt maneuvering.
- Recognition that side space, rear pressure, and traffic gaps affect the driver’s available options.
- Scenario practice requiring the learner to identify which margin changed and choose a proportionate first response.
- Accessibility design for instruction and assessment whose essential information is spatial, visual, sequential, or time-based.
- FuelGuard packaging, publishing, assignment, analytics, pilot, release, and rollback requirements.
- Conditions for any later use of telematics or forward-safety events, without assuming that such data is approved or currently available.

### 1.2 Excluded

- A final company following-interval rule, adverse-condition multiplier, minimum lateral clearance, or state-law interpretation.
- A promise that a memorized interval guarantees sufficient stopping distance.
- A complete air-brake, brake-inspection, load-securement, tire, ABS, or vehicle-dynamics lesson.
- Detailed mirror-scanning instruction; that belongs to Module 3.
- The complete observation, signaling, lane-change, merge, turn, and path-verification sequence; that belongs to Module 5.
- Backing, GOAL, spotter, and stop-and-check procedures; those belong to Module 6.
- A complete speed-selection, curve, downgrade, intersection, or work-zone procedure; those belong to Module 7.
- Fatigue, distraction, emotion, rushing, and other human-factor control procedures; those belong to Module 8.
- A complete rain, snow, ice, fog, smoke, darkness, wind, or low-visibility procedure; those belong to Module 9.
- Treating a shoulder, adjacent lane, gore, sidewalk, opposing lane, or unverified roadside area as a default escape route.
- Training or testing an evasive maneuver through unsafe live driving.
- Deriving following distance, stopping distance, or collision risk from uncalibrated video pixels.
- Automatic assignment, discipline, or competence claims based on a weekly Samsara safety score or harsh-event count.
- A claim that a quiz, watched video, time-gap exercise, or narrated response proves on-road competence or crash reduction.
- ELDT, government certification, third-party certification, or a replacement for state CDL testing.

## 2. Verified baseline

### 2.1 Program-plan facts

The source program plan specifies:

- a ten-module core course;
- Module 4 title: **Leave Space: Following Distance & Escape Space**;
- target video length: **10–12 minutes**;
- primary outcome: **create stopping margin and maintain maneuvering options**;
- the proposed principle definition: maintain usable following distance, lane space, stopping margin, and a practical escape option whenever possible;
- original scripts, footage, graphics, examples, and assessments;
- concise video segments, decision questions, captions, and transcripts; and
- a separate road observation so digital completion is not the only measure of competency.

The source plan also supplies a six-scene example storyboard:

1. dash-cam footage approaching slower traffic, with the message that space creates working time;
2. a graphic showing a truck stopping zone;
3. highway footage in which another vehicle enters the gap and the driver rebuilds space calmly;
4. a multi-lane diagram addressing lateral space and a usable maneuvering option;
5. a decision prompt asking whether speed, lane position, following gap, or communication should change first; and
6. a recap: create margin, protect it, and rebuild it when traffic takes it away.

The source plan does not define:

- the exact following-interval rule, measurement method, speed breakpoint, or adverse-condition adjustment;
- launch vehicle classes, lengths, weights, brake systems, loads, routes, grades, or jurisdictions;
- the approved technical wording for how vehicle weight and loading affect stopping;
- the difference between a following interval and total stopping distance;
- lateral-space targets or prohibited “escape” areas;
- cut-in, tailgating, and rear-pressure responses;
- assessment method, pass rule, or retake rule;
- road-observation scoring behavior;
- footage source, measurement calibration, or camera perspective controls;
- launch languages or accessible alternative; or
- approved company examples, incident priorities, or terminology.

The proposed source statement that heavier vehicles require more stopping distance must receive technical review before it becomes learner-facing. The FMCSA-hosted CDL manual explains a more nuanced relationship: brakes must do more work as weight increases, vehicle/brake design matters, and an empty truck may require greater stopping distance because it has less traction. The final script must describe the launch fleet accurately rather than reduce stopping performance to weight alone.

### 2.2 FuelGuard facts verified in code

| Area                | Current fact                                                                                                                                                                                                                                                                                     | Evidence                                                                                     | Module 4 consequence                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Code baseline       | Current branch is `main` at `91d05f11d6de`; the Silvicom360 plan directory is untracked. The repository moved from `9531ccd464b7` to the merge commit during drafting; the three intervening file changes are confined to the EFS F9 plan and CLI scripts and do not add training functionality. | Git status, history, and commit comparison on 2026-08-17                                     | Re-run the baseline before implementation and preserve work outside this document.                                                              |
| Migration line      | The latest migration filename currently found is `0201_unit_mileage_write_bucket.sql`.                                                                                                                                                                                                           | Sorted migration inspection                                                                  | Do not reserve a migration number in this plan; allocate from the actual head during implementation.                                            |
| Product entitlement | `training` is an allowed module key labeled “Safety Training.”                                                                                                                                                                                                                                   | `packages/shared/src/entitlements.ts`                                                        | Reuse this entitlement; do not introduce a Module 4 entitlement.                                                                                |
| Driver feature      | `training` exists in the feature catalog but is `released: false`.                                                                                                                                                                                                                               | `packages/shared/src/featureCatalog.ts`                                                      | Module 4 cannot make the feature releasable independently of the generic foundation.                                                            |
| Training foundation | No general course, lesson, assignment, attempt, quiz, completion, or training-event implementation was found in the database, API, web, or driver app.                                                                                                                                           | Targeted migration and code search on 2026-08-17                                             | Module 4 depends on the approved Module 1 foundation or a newly approved replacement.                                                           |
| Driver app          | The learner app is React Native 0.86 / Expo 57; `expo-video` is not installed and no training route or More-menu entry exists.                                                                                                                                                                   | `apps/driver/package.json`, `apps/driver/app/_layout.tsx`, `apps/driver/app/(tabs)/more.tsx` | Reuse the generic player after it exists; do not build a Module 4-only player.                                                                  |
| Identity            | Driver access resolves through authenticated membership and `drivers.user_id`; the link can be null.                                                                                                                                                                                             | `apps/api/src/routes/me.ts`, migrations `0098`, `0102`, `0116`                               | In-app assignments are limited to linked users unless another authenticated channel is approved.                                                |
| Authorization       | Authentication, organization scoping, `requireModule()`, role gates, audit helpers, and RLS conventions exist.                                                                                                                                                                                   | `apps/api/src/middleware`, route patterns, module migrations                                 | Apply existing tenant, role, ownership, audit, and replay protections to every training operation.                                              |
| Safety aggregates   | `driver_scores` contains weekly Samsara-derived safety score, distance/time exposure, harsh acceleration/braking/turn counts, crash count, speeding duration, and raw provider response.                                                                                                         | migration `0054_driver_scores.sql`, parser and sync services                                 | Stored values do not describe following interval, time headway, forward-collision warnings, cut-ins, lateral clearance, or maneuvering options. |
| Event media         | No event-level dashcam, following-distance event, near-miss narrative, collision-review clip, or space-management label was found.                                                                                                                                                               | Migration and service search on 2026-08-17                                                   | Do not promise personalized scenes, automated diagnoses, or event-triggered assignments.                                                        |
| Notifications       | `training_due` is a recognized notification category, but no producer creates course-due events.                                                                                                                                                                                                 | notification contract, migrations `0089`, `0093`, `0154`, producer search                    | Add reminders only after assignment and due-state rules exist.                                                                                  |
| Device permissions  | The driver app declares camera use for operational load-stop capture; no training camera use exists.                                                                                                                                                                                             | driver app configuration and capture features                                                | Do not reuse the operational camera permission to measure following distance or record learner behavior.                                        |
| Maps/location       | Location and mapping packages support operational workflows.                                                                                                                                                                                                                                     | `apps/driver/package.json` and navigation features                                           | Module 4 has no justified need for live learner location, speed, or route capture during digital training.                                      |
| Compliance records  | Hazmat training records implement a separate regulation-specific qualification workflow.                                                                                                                                                                                                         | compliance migrations, services, and UI                                                      | Never write Silvicom360 Module 4 completion into hazmat certification or driver-qualification evidence.                                         |

### 2.3 Prior-module dependency disposition

Modules 1–3 are planning documents; none proves approval, implementation, or release. Module 4 may reuse only verified, approved versions of:

- immutable course and content versions;
- assignments, attempts, responses, server-side grading, and event history;
- private media delivery, captions, transcripts, and accessible alternatives;
- driver player and administrator workflows;
- Module 2 terms for cues, developing conflicts, hidden areas, and early response; and
- Module 3 terms and behaviors for forward anchoring, purposeful checks, tracking, and unknown areas.

Module 4 must not:

- duplicate the generic platform in Module 4-specific tables or routes;
- treat unresolved prior-module vocabulary or policy as approved;
- imply a lane or side area is available merely because it appeared open during the last Module 3 check;
- release `training` before an end-to-end generic learner and administrator path is verified;
- merge training results into driver performance scores without separate approval; or
- reserve migration numbers from the current `0201` line before implementation begins.

## 3. Facts, proposals, and decisions required

| ID     | Topic                               | Status            | Current evidence                                                                                                                                                                                                                                                     | Release requirement                                                                                                                                                             |
| ------ | ----------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M4-D01 | Foundation readiness                | Decision required | The entitlement and feature seam exist, but the generic training platform does not.                                                                                                                                                                                  | Name the approved Module 1 plan/version and verified software release Module 4 will reuse, or approve a replacement.                                                            |
| M4-D02 | Audience and operating profile      | Decision required | “Company drivers” is the only supplied audience description.                                                                                                                                                                                                         | Name launch terminals, driver roles, jurisdictions, CMV classes and lengths, brake systems, load states, route types, typical speeds/grades, and exclusions.                    |
| M4-D03 | Base following-interval rule        | Decision required | Older FMCSA guidance recommends one second per ten feet below 40 mph plus one additional second above 40 mph. Federal regulations require knowledge and skill appropriate to conditions but do not establish this as one universal numerical rule for all operation. | Safety, operations, fleet engineering, and legal approve the exact rule, units, applicability, exceptions, and source date.                                                     |
| M4-D04 | Condition adjustment                | Decision required | Regulations require adjustment for road, weather, visibility, traffic, vehicle, cargo, and driver conditions; the source plan gives no multiplier or decision method.                                                                                                | Approve condition categories, minimum response, whether a multiplier is taught, and stop/no-go escalation boundary.                                                             |
| M4-D05 | Stopping model and load language    | Decision required | Stopping includes perception, reaction, brake-system response where applicable, and braking. Weight, brake design, traction, grade, speed, and condition interact.                                                                                                   | A qualified fleet/safety reviewer approves all technical language, diagrams, examples, and fleet-specific assumptions.                                                          |
| M4-D06 | Lateral-space standard              | Decision required | Regulations require knowledge of controlling space to the sides, but no universal company clearance or lane-position rule was supplied.                                                                                                                              | Approve scenario-specific priorities, vehicle/equipment profiles, prohibited simplifications, and any measurable Road Check anchor.                                             |
| M4-D07 | Maneuvering-option terminology      | Decision required | “Escape space” is program language; availability changes continuously and a visible area may be illegal, occupied, unstable, or unverified.                                                                                                                          | Approve “potential maneuvering option” or another term, the verification boundary, and explicit exclusions such as treating the shoulder as a routine answer.                   |
| M4-D08 | Cut-in and gap-compression response | Decision required | The source plan says rebuild space calmly but supplies no ordered company response.                                                                                                                                                                                  | Approve observe/ease/rebuild wording, accelerator/brake boundaries, communication limits, and conditions requiring stronger action.                                             |
| M4-D09 | Rear pressure and tailgating        | Decision required | FMCSA-hosted CDL guidance advises increasing space ahead, avoiding quick changes, and not speeding up or using tricks when tailgated.                                                                                                                                | Approve company wording, dispatch/escalation boundary, lane-change boundary, and scenario limitations.                                                                          |
| M4-D10 | Jurisdiction-specific law           | Decision required | Launch states and routes were not supplied; following-distance, lane-use, shoulder, and move-over requirements can vary.                                                                                                                                             | Legal/compliance records the launch-jurisdiction review and any content/profile differences. Federal sources alone are not sufficient.                                          |
| M4-D11 | Footage, data, and calibration      | Decision required | FuelGuard has no approved space-management event media. Camera field of view can distort perceived distance and no calibrated source package was supplied.                                                                                                           | Approve source, rights/privacy, vehicle profile, speed/grade/load metadata, synchronization, measurement method, and perspective-disclosure rules for every quantitative scene. |
| M4-D12 | Digital interaction                 | Decision required | The current app has no training player, timed interval exercise, controlled pause, or scenario engine.                                                                                                                                                               | Select a standard question format, landmark/timestamp exercise, accessible equivalent, and device-timing tolerance.                                                             |
| M4-D13 | Accessibility equivalent            | Decision required | Essential information is visual, spatial, sequential, and sometimes time-based. Captions alone do not convey changing gaps or lane occupancy.                                                                                                                        | Approve description, structured timelines/diagrams, non-color cues, keyboard/screen-reader alternatives, and independent accessibility review.                                  |
| M4-D14 | Assessment and Road Check           | Decision required | No bank size, pass threshold, retake, feedback, observation behavior, or rater rule exists.                                                                                                                                                                          | Approve objective coverage, grading, observable behaviors, route conditions, trainer calibration, recheck rules, and separation of digital completion from competence.          |
| M4-D15 | Telematics and personalization      | Decision required | Current FuelGuard stores weekly aggregates, not validated time-headway or forward-conflict events.                                                                                                                                                                   | Approve no integration by default or a separately validated human-reviewed workflow with data, appeal, and retention controls.                                                  |
| M4-D16 | Languages, pilot, and claims        | Decision required | No launch languages, reviewer pool, pilot cohort, effectiveness threshold, or learner-facing statistics were supplied.                                                                                                                                               | Approve localization, pilot measures, stop criteria, claims register, and permitted interpretation of results.                                                                  |

## 4. Learner design

### 4.1 Audience

Provisional audience: company commercial drivers in the approved Module 4 pilot who:

- have an authenticated FuelGuard driver account linked through `drivers.user_id`;
- completed the approved prerequisite module versions;
- are assigned content matching an approved vehicle, equipment, route, and jurisdiction profile;
- receive the same approved language across narration, captions, transcript, prompts, alternatives, and questions; and
- are parked and not operating a vehicle while taking the digital module.

The plan does not assume that every learner:

- drives a tractor-trailer or a vehicle of the same length, weight, brake type, tire condition, or load state;
- operates at highway speed or on the same grades and surfaces;
- has an adjacent lane, usable shoulder, or any legal lateral option;
- uses Samsara collision-warning, headway, or camera technology;
- reads English as a first language;
- has normal color perception, visual acuity, contrast perception, hearing, motor ability, or cognitive processing speed; or
- can demonstrate live gap control through a phone interaction.

### 4.2 Prerequisites

Before pilot assignment:

1. The approved generic training foundation is implemented and verified.
2. Approved Module 2 and Module 3 terminology and content versions are named.
3. M4-D02 through M4-D14 are resolved for the pilot.
4. A legal review is complete for every launch jurisdiction represented in instruction or assessment.
5. Each launch vehicle/equipment profile has an approved length, brake-system, load-state, and operating-condition description sufficient for its examples.
6. Every quantitative scene has a source, rights/privacy record, metadata record, calibration method, answer key, and accessibility alternative.
7. The player and assessment are tested on representative devices, orientations, text sizes, screen readers, connection states, and playback recovery states.
8. The company provides a route for learners to report inaccessible, misleading, vehicle-inapplicable, or jurisdiction-inapplicable content without being scored as noncompliant.
9. Trainers complete the approved Module 4 observation calibration before recording Road Check results.

### 4.3 Proposed measurable learning objectives

Subject to M4-D03 through M4-D14, a learner will be able to:

1. **Measure:** Use a stable roadside reference and elapsed time to determine a represented following interval without estimating distance from apparent video size.
2. **Differentiate:** Distinguish following interval, physical gap, stopping distance, stopping margin, and lateral space.
3. **Diagnose:** Identify which condition or traffic change reduced available margin and why a previously acceptable gap may no longer be suitable.
4. **Create:** Choose a timely, proportionate first response that creates more working time or space before urgency develops.
5. **Protect:** Recognize actions that unnecessarily compress space or remove potential maneuvering options.
6. **Rebuild:** Select a calm response after a cut-in or traffic compression, without retaliation or an unverified abrupt lane movement.
7. **Transfer:** Apply the approved **Create → Protect → Rebuild** process to at least two unseen scenarios from the learner’s approved operating profile.

No response-speed, accelerator/brake smoothness, steering performance, or gaze threshold is proposed for digital assessment. Those cannot be validly inferred from phone interaction.

### 4.4 Working vocabulary

These definitions are proposed for review and are not company policy until approved:

- **Following interval:** The elapsed time between a lead vehicle and the learner’s represented vehicle reaching the same fixed reference point. It is often called time headway. It is not total stopping time.
- **Physical gap:** The distance between vehicles at a particular instant. A camera image alone does not establish this distance unless the scene is calibrated.
- **Closing rate:** How quickly the separation between two road users is decreasing. Equal-looking gaps can carry different urgency when relative speeds differ.
- **Perception distance:** Distance traveled while the driver detects and recognizes a need to respond.
- **Reaction distance:** Distance traveled while the driver selects and begins a response.
- **Brake-system response:** Additional time and distance between driver input and effective braking, including air-brake lag where applicable.
- **Braking distance:** Distance traveled from effective brake application until the represented vehicle stops.
- **Total stopping distance:** The combined distance associated with perception, reaction, brake-system response where applicable, and braking under stated assumptions.
- **Stopping margin:** The usable space and time beyond the stopping demand reasonably anticipated in the represented conditions. It is not a fixed number and is not guaranteed by one interval rule.
- **Lateral space:** Usable clearance to the sides of the vehicle, including clearance affected by vehicle width, lane position, curves, wind, road users, barriers, and fixed objects.
- **Gap compression:** A reduction in usable separation caused by closing speed, a cut-in, braking traffic, lane narrowing, grade, reduced visibility, or another change.
- **Potential maneuvering option:** A space or path that may preserve choice but is not considered available for use until it is current, legal, physically suitable, and verified under the approved maneuver procedure.
- **Margin recovery:** A controlled response that restores suitable time or space after compression.
- **Cut-in:** Another road user enters the space ahead closely enough to reduce the represented following margin. The term describes the event, not the other road user’s intent.
- **Tailgating pressure:** Close following from behind that can reduce the driver’s flexibility. It does not authorize speeding, retaliation, brake-checking, or an unverified lane movement.

### 4.5 Proposed process model

The following is a planning model, not approved driver instruction:

1. **Read the margin:** Observe the forward path, relative motion, side constraints, and relevant condition changes.
2. **Create working time:** Establish the approved following interval and lane space before a conflict is immediate.
3. **Protect options:** Avoid unnecessary closing, monitor the areas that affect available choices, and anticipate likely compression.
4. **Recognize loss:** Detect a cut-in, slowdown, grade, visibility reduction, traction change, lane narrowing, rear pressure, or other margin loss.
5. **Rebuild calmly:** Use the approved proportionate response—often an early speed adjustment—without retaliating or moving into an unverified path.
6. **Reassess:** Confirm the new interval, traffic flow, side conditions, and whether the situation continues to change.

Safety/operations must decide whether this becomes learner-facing language, is replaced, or remains an internal storyboard tool.

### 4.6 Following-interval measurement model

If M4-D03 approves a time-based rule, teach the measurement without implying false precision:

1. Select a fixed, unambiguous roadside reference visible to both represented vehicles.
2. Start when the rear of the lead vehicle passes that reference.
3. Stop when the front of the represented vehicle reaches the same reference.
4. Compare the elapsed time with the approved rule for that vehicle and stated condition.
5. If the margin is below the approved rule or conditions have worsened, choose the approved recovery response and measure again after the situation stabilizes.

The assessment may show timestamps or a count synchronized to the clip. It must not score the learner on their counting cadence. A screen reader-accessible equivalent can provide an ordered event timeline such as “lead vehicle clears marker at 12.0 seconds; host reaches marker at 15.4 seconds.”

### 4.7 Technical model and wording constraints

The learner-facing explanation should establish that:

- stopping demand is more than brake application alone;
- greater speed increases distance traveled during the time components and generally increases braking distance substantially;
- visibility, traction, road grade, brake/tire condition, vehicle configuration, load, traffic, and driver condition can change what margin is suitable;
- a time interval is a practical observation tool, not a guarantee that the vehicle can stop within the visible gap;
- an empty CMV is not automatically the shortest-stopping case;
- a “clear” adjacent area can become occupied before it can be used; and
- the early response is usually less abrupt because it begins while margin still exists.

Do not publish a numerical stopping-distance graphic until its assumptions, calculation method, units, fleet profile, source, rounding, and intended teaching purpose are approved. Do not blend numbers from different sources or conditions into one diagram.

### 4.8 Content boundaries with other modules

| Topic encountered in Module 4 | Teach here                                                                                    | Defer                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Forward hazard                | Recognize how a developing conflict changes required margin                                   | Full cue-search and hazard-priority method remains Module 2                                |
| Whole-scene awareness         | Use current forward, side, and rear information to understand space                           | Scan cadence, mirror fields, and tracking remain Module 3                                  |
| Lane change or merge          | Preserve a potential option and avoid moving into an unverified area                          | Observation, signaling, gap acceptance, and execution belong to Module 5                   |
| Backing space                 | State that highway following rules do not govern backing                                      | Setup, GOAL, spotter, and stop/check belong to Module 6                                    |
| Speed and grade               | Recognize that speed and grade affect margin and that early speed reduction may rebuild it    | Complete speed selection, curve, downgrade, and intersection procedure belongs to Module 7 |
| Rear pressure and emotion     | Do not retaliate, speed up, brake-check, or let pressure dictate an unsafe choice             | Emotional control, rushing, fatigue, and distraction belong to Module 8                    |
| Weather and visibility        | Increase margin or stop when conditions make continued operation unsafe under approved policy | Complete adverse-condition and stop/no-go procedure belongs to Module 9                    |
| Integrated performance        | Apply spacing decisions in focused scenarios                                                  | Full multi-principle scenarios belong to Module 10 and the Road Check                      |

## 5. Evidence and regulatory boundary

### 5.1 Verified source interpretation

Federal CDL knowledge requirements in 49 CFR 383.111 include speed and stopping distance, space management, controlling space ahead and behind, controlling space to the sides, and safe gaps. Federal on-road skill requirements in 49 CFR 383.113 include adjusting speed for roadway, weather, visibility, traffic, vehicle, cargo, and driver conditions; choosing a safe gap; and maintaining a safe following distance depending on road condition, visibility, and vehicle weight.

49 CFR 392.14 requires extreme caution and reduced speed when hazardous conditions such as snow, ice, sleet, fog, mist, rain, dust, or smoke affect visibility or traction. If conditions become sufficiently dangerous, operation must stop until the vehicle can be operated safely. Module 4 may introduce that boundary but must not replace the approved company adverse-condition procedure planned for Module 9.

FMCSA’s older following-too-closely guidance provides the familiar one-second-per-ten-feet method below 40 mph, with an additional second above 40 mph, and says the gap should increase for adverse weather, road, visibility, and traffic conditions. This is useful evidence for M4-D03, not automatic company policy. The page was last updated in 2015, it includes older crash statistics and stopping figures, and launch jurisdictions or company equipment may require different or additional wording.

The FMCSA-hosted CDL manual describes perception, reaction, braking, and air-brake lag; explains how to time a following interval at a landmark; and gives advice for being tailgated. It also demonstrates why the source plan’s weight statement needs review: loading, vehicle/brake design, traction, and condition interact. The manual is a national reference, not a substitute for the current state manual and company requirements applicable to each learner.

A 2016 FHWA/Volpe report presenting a 2015 naturalistic-driving study observed real commercial-vehicle following behavior and analyzed shorter time headways, partly to inform truck-platooning research. It can inform the instructional design team’s understanding of real behavior, but its observed averages are not safe company thresholds, its context is not the FuelGuard fleet, and it must not be presented as a recommended following interval or current fleet rate.

### 5.2 Legal and standards interpretation rules

1. Federal regulations establish required knowledge, skill, and condition-sensitive behavior; this plan does not reinterpret them as one universal numerical following law.
2. The company must review every launch state or other jurisdiction for current following-distance, lane-use, shoulder, move-over, speed, and training requirements.
3. A public agency tip is guidance, not automatically a regulation or company rule.
4. A state CDL manual may contain a training rule or example that differs from an older federal-hosted manual; the launch profile must record which source controls company wording.
5. “Escape space” must not be presented as legal authorization to enter a shoulder, opposing lane, gore, closed lane, sidewalk, or private property.
6. Simulation or digital scenarios can support knowledge and judgment practice, but 49 CFR 383.113’s required on-road CDL skills cannot be replaced by this module.
7. Nothing in Module 4 authorizes operation contrary to law, posted control, manufacturer instructions, fleet limits, dispatch restrictions, or the company safety manual.

### 5.3 Claim rules

Every numerical or safety claim must have a claim-register entry containing:

- exact proposed wording;
- source URL, title, publisher, publication/update date, and access date;
- source context and population;
- assumptions, units, vehicle/load/road/speed conditions, and calculation method;
- whether it is regulation, agency guidance, company policy, engineering analysis, study finding, or illustrative example;
- approved learner-facing paraphrase;
- reviewer, approval date, and expiration/recheck date; and
- every scene, caption, transcript, question, answer explanation, and localization in which it appears.

Prohibited without specific approval:

- “this interval guarantees a safe stop”;
- “a heavier truck always takes farther to stop”;
- “an empty truck stops faster”;
- “double the gap” or any adverse-condition multiplier not adopted by company policy;
- a stopping-distance number without conditions and source;
- a generic camera image labeled with an exact distance that was not measured;
- crash percentages or reduction claims used outside their original population and date;
- “the shoulder is your escape route”;
- “always change lanes when tailgated”;
- “never brake after a cut-in”; or
- any claim that Module 4 completion proves safe live-driving performance.

## 6. Content structure and timing

Proposed runtime: **10:45**, within the source plan’s 10–12 minute target. Decision interactions pause playback and do not count toward narrated runtime.

| Segment                         |       Time | Purpose                                                                                   | Required decision/evidence                                |
| ------------------------------- | ---------: | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1. Space is working time        |  0:00–0:45 | Show slower traffic developing and establish why margin matters before urgency            | Original/approved approach footage; no quantitative claim |
| 2. What “space” means           |  0:45–1:35 | Distinguish interval, gap, stopping margin, lateral space, and potential option           | Approved vocabulary                                       |
| 3. Measure a following interval |  1:35–2:35 | Demonstrate fixed-reference timing and its limits                                         | M4-D03, calibrated/timestamped asset                      |
| 4. Stopping is a sequence       |  2:35–3:40 | Explain perception, reaction, system response, and braking without false precision        | M4-D05, technical review                                  |
| 5. Conditions change the margin |  3:40–4:50 | Compare speed, visibility, traction, grade, load/equipment, traffic, and driver condition | M4-D04, Module 9 boundary                                 |
| 6. Create and protect           |  4:50–5:55 | Show early speed choice and avoiding unnecessary compression                              | Approved company response                                 |
| 7. Cut-in: rebuild calmly       |  5:55–7:00 | Show margin loss, non-retaliatory recovery, and reassessment                              | M4-D08                                                    |
| 8. Lateral space and options    |  7:00–8:05 | Explain side clearance and why visible does not equal verified/usable                     | M4-D06–D07                                                |
| 9. Rear pressure                |  8:05–8:50 | Address tailgating without speeding, tricks, or abrupt action                             | M4-D09                                                    |
| 10. Decision scenario           |  8:50–9:55 | Ask which factor should change first and why                                              | M4-D11–D14                                                |
| 11. Transfer and recap          | 9:55–10:45 | Apply **Create → Protect → Rebuild** to a new scene                                       | Approved recap and next-module boundary                   |

If the approved script exceeds 12 minutes, reduce repetition or split optional enrichment from the core. Do not speed narration, remove accessibility content, or delete condition qualifiers to meet runtime.

## 7. Scene-by-scene storyboard blueprint

| Scene | Approx. time | Visual and action                                                                                                    | Narration purpose                                                                          | Interaction/accessibility                                      | Approval dependency             |
| ----- | -----------: | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------- |
| 1     |    0:00–0:25 | Forward view approaches slower-moving traffic with ample initial margin                                              | Establish that early space creates working time                                            | Description identifies traffic slowing and relative separation | Footage rights, safe capture    |
| 2     |    0:25–0:45 | Same event shown as a simple margin timeline                                                                         | Contrast early adjustment with delayed urgency without staging an unsafe near miss         | Structured text alternative                                    | Claims review                   |
| 3     |    0:45–1:10 | Original graphic labels following interval and physical gap separately                                               | Prevent time and distance from being treated as synonyms                                   | Labels read in logical order                                   | Vocabulary approval             |
| 4     |    1:10–1:35 | Top-down diagram labels front, side, rear pressure, and potential option                                             | Define whole-vehicle space without declaring a path usable                                 | Text description names each zone and uncertainty               | M4-D06–D07                      |
| 5     |    1:35–2:05 | Lead vehicle and host pass the same fixed landmark; timestamp overlay is visible                                     | Demonstrate when timing starts and stops                                                   | Timeline alternative provides both event times                 | M4-D03, timing validation       |
| 6     |    2:05–2:35 | Second measurement with a different interval                                                                         | Ask learner to calculate, then reveal method and answer                                    | Numeric input or multiple choice; no speed scoring             | Interaction approval            |
| 7     |    2:35–3:10 | Animated stopping sequence: perceive, react, system response if applicable, brake                                    | Show that braking distance is only one part                                                | Audio description and ordered text steps                       | Technical review                |
| 8     |    3:10–3:40 | Two explicitly labeled operating profiles differ by speed/load/surface or brake system                               | Explain why a diagram must state assumptions                                               | Alternative table contains same facts                          | M4-D05                          |
| 9     |    3:40–4:15 | Condition cards introduce wet surface, limited sight distance, downgrade, congestion, or fatigue without mixing them | Show that the approved base interval is not a universal answer                             | Each condition named, not color-only                           | M4-D04, M8/M9 boundary          |
| 10    |    4:15–4:50 | One controlled comparison changes a single condition while other variables remain stated                             | Practice explaining why margin should change                                               | Accessible before/after text                                   | Claims review                   |
| 11    |    4:50–5:25 | Driver recognizes closing traffic and adjusts early                                                                  | Demonstrate creating margin before hard response is needed                                 | Description covers relative motion and response                | Company procedure approval      |
| 12    |    5:25–5:55 | View shows a tempting action that would unnecessarily compress space                                                 | Identify how margin can be surrendered                                                     | Decision prompt with equivalent text                           | Assessment approval             |
| 13    |    5:55–6:30 | Another vehicle enters the established gap                                                                           | Identify compression without assigning motive                                              | Description says what changed, not intent                      | Footage/privacy review          |
| 14    |    6:30–7:00 | Host vehicle eases/rebuilds under approved procedure and measures again                                              | Model calm recovery and reassessment                                                       | Timeline includes change and restored interval                 | M4-D08, calibration             |
| 15    |    7:00–7:35 | Multi-lane diagram shows barrier, occupied lane, and an apparently open but stale/unverified zone                    | Distinguish visible space from a current, legal, verified option                           | Structured lane-state table                                    | M4-D06–D07                      |
| 16    |    7:35–8:05 | Same scene updates; the apparent option becomes occupied                                                             | Reinforce that options expire and require continued observation                            | Sequential description                                         | Module 3/5 vocabulary alignment |
| 17    |    8:05–8:50 | Rear vehicle follows closely while forward space remains controllable                                                | Teach approved non-retaliatory response and preserve space ahead                           | Text alternative; no brake-check depiction                     | M4-D09                          |
| 18    |    8:50–9:25 | Composite decision scene includes slower traffic, narrowing lane, rear pressure, and one legal potential option      | Ask which factor—speed, lane position, following gap, or communication—should change first | Equivalent structured facts; response is not timed             | M4-D10–D14                      |
| 19    |    9:25–9:55 | Answer reveal explains why rejected options are premature, illegal, or insufficient                                  | Test reasoning, not slogan recall                                                          | Full text rationale                                            | Legal/safety approval           |
| 20    |   9:55–10:25 | Unseen transfer scene in a different approved operating profile                                                      | Apply process without visual repetition                                                    | Accessible equivalent                                          | Profile and item validation     |
| 21    |  10:25–10:45 | Original recap graphic: **Create → Protect → Rebuild**                                                               | Close with practice statement and transition to maneuver verification                      | Narration, captions, transcript match                          | Final editorial approval        |

The six source-plan scenes are preserved and expanded into production-verifiable units. Scene numbering is editorial, not a direction to create 21 separate video files.

## 8. Script and production standards

### 8.1 Wording

- Use observable language: “the gap is shrinking,” not “the car is being aggressive.”
- State whether an example concerns elapsed following time, measured distance, or a qualitative margin.
- State the relevant vehicle, speed, surface, grade, visibility, brake-system, and load assumptions before using a number.
- Say “potential maneuvering option” until the approved Module 5 checks establish that a path is current, legal, and usable.
- Avoid absolute words such as “always,” “never,” “guarantees,” “plenty,” and “safe” unless the approved rule actually supports them.
- Avoid blame, humiliation, collision spectacle, and fear-based narration.
- Treat cut-ins and tailgating as conditions to manage, not invitations to infer intent or retaliate.
- Use short sentences and define “interval,” “margin,” and “closing rate” before abbreviations or technical terms.
- Align every spoken number with captions, transcript, graphic, answer explanation, and localized version.

### 8.2 Quantitative and visual integrity

For every scene that communicates a time or distance:

1. Record asset identifier and source.
2. Record vehicle/camera configuration and whether lens correction was used.
3. Record frame rate, timestamp basis, speed source, and synchronization method.
4. Identify the common fixed reference and the exact frames/events used.
5. Record uncertainty, rounding, playback-rate assumptions, and device behavior.
6. State whether the figure is measured, calculated, simulated, or illustrative.
7. Have a second reviewer reproduce the answer from source data.
8. Lock the approved answer key to the immutable content version.

Wide-angle and telephoto views can make spacing appear different. The production team must not use lens choice, cropping, playback speed, or perspective to create a false quantitative impression. If a view is illustrative rather than calibrated, label it as illustrative and do not ask for an exact measurement.

### 8.3 Vehicle and stopping-model integrity

- Do not represent one vehicle’s stopping performance as the entire fleet’s.
- Do not depict a generic tractor-trailer silhouette with precise values from an unrelated configuration.
- Separate company policy intervals from calculated stopping examples.
- Treat air-brake lag only in profiles where it applies.
- Identify whether load state, brake/tire condition, ABS assumptions, grade, and surface are material to the example.
- Do not stage or film threshold braking, close following, emergency lane changes, or a collision for training footage.
- If simulation is used, label it and document its physical assumptions; photorealism is not validation.

### 8.4 Filming safety and privacy

- Use controlled, closed-course, passenger-observed, professional stock, de-identified company footage, or graphics according to the approved production plan.
- No driver may operate a vehicle while also recording, directing, adjusting equipment, reading prompts, or responding to the lesson.
- Mount equipment legally and ensure it does not obstruct the driver’s view or interfere with vehicle systems.
- Do not instruct a camera vehicle to create a short gap, cut in closely, tailgate, brake-check, or occupy an unsafe side position.
- Blur or otherwise protect faces, plates, addresses, customer sites, device screens, proprietary cargo, and incident identifiers as required.
- Maintain talent, location, vehicle, music, font, map, footage, and incident-use rights.
- A real incident clip needs legal, privacy, labor, safety, and dignity review plus a documented educational need.

### 8.5 Audio, captions, description, and transcript

- Provide synchronized captions for all narration and meaningful audio.
- Provide a transcript that includes spoken content, important on-screen labels, relevant motion, timing events, and answer rationales.
- Provide audio description or an equivalent structured alternative when changing position, lane occupancy, reference-point timing, or side-space information is essential.
- Do not depend on sound, color, animation, or spatial position alone.
- Keep description from masking important traffic sounds if those sounds are part of the learning objective.
- Keep numeric units explicit in narration and text; do not rely on symbols alone.
- Verify caption timing at normal and supported playback rates.

### 8.6 Accessible spacing exercises

Each visual timing or lane-space exercise must provide an equivalent form that preserves the construct:

- a timestamped event list for following-interval calculation;
- a structured lane-state table for side-space and option questions;
- ordered stills with concise descriptions for gap-compression sequences;
- text labels and patterns in addition to color;
- sufficiently large controls and diagrams for mobile display and zoom;
- keyboard and screen-reader operability for web administration or learner surfaces where applicable;
- replay, pause, and review without grade penalty; and
- no score based solely on rapid tapping, precise dragging, visual tracking, or spoken counting.

The equivalent must not reveal the correct decision earlier than the visual version. Accessibility QA must test the actual assessment, not only the transcript.

## 9. Assessment blueprint

### 9.1 Delivery rule

Use short post-clip or post-diagram questions after the learner has received the facts needed to answer. Controlled pause points may be used if the player and accessible alternative preserve the same evidence. Do not require interaction while a learner is driving or use response latency as a safety score.

### 9.2 Item blueprint

| Objective                    | Item form                        | Minimum bank | Served target | Required evidence                                              |
| ---------------------------- | -------------------------------- | -----------: | ------------: | -------------------------------------------------------------- |
| Measure a following interval | Landmark/timestamp calculation   |            4 |             1 | Start/stop events and arithmetic are reproducible              |
| Differentiate space concepts | Classification or matching       |            4 |             1 | Terms are approved and alternatives do not overlap             |
| Diagnose margin loss         | Before/after scene comparison    |            6 |           1–2 | Changed condition is observable and stated                     |
| Choose a first response      | Scenario decision with rationale |            6 |             2 | Approved procedure and rejected-answer explanations            |
| Rebuild after cut-in         | Ordered decision sequence        |            4 |             1 | No retaliatory or abrupt-unverified option is rewarded         |
| Evaluate lateral option      | Lane-state scenario              |            5 |             1 | Legal/current/physical/verification status is explicit         |
| Transfer                     | Unseen mixed-condition scenario  |            4 |             1 | Profile differs from instruction without adding unstated facts |

Minimum bank counts are planning targets, not authorization to release. Final served count, pass score, attempt limit, feedback timing, remediation, and version-transition policy remain part of M4-D14.

### 9.3 Item-writing rules

- Give every fact needed to answer; do not require assumptions about an unseen mirror, lane, jurisdiction, load, surface, or speed.
- If a numerical rule is tested, identify the approved vehicle and condition profile.
- Ask for the best **first** response when several later actions could be appropriate.
- Do not reward lane movement unless current observation, legal availability, and the Module 5 boundary are explicit.
- Do not use “do nothing” when the approved response is continued monitoring; name the monitoring action.
- Do not make obvious joke distractors or use another road user’s supposed intent as evidence.
- Do not infer exact physical distance from an uncalibrated image.
- Accept mathematically equivalent units and declared rounding tolerance where free numeric entry is used.
- Give corrective feedback that explains the margin and condition, not merely the correct letter.
- Keep quiz success separate from Road Check status and from disciplinary action.
- Validate each localized item independently; translation can change time, distance, legal, and modal meaning.

### 9.4 Road-observation boundary

The Road Check may evaluate only approved, observable behaviors, such as whether the driver:

- establishes the approved following interval under the stated profile;
- detects and responds when the gap compresses;
- avoids unnecessary closing or retaliatory behavior;
- preserves lateral clearance appropriate to an observed situation;
- recognizes when an apparent option is not current or usable;
- rebuilds space smoothly when conditions permit; and
- explains a decision during a parked debrief without being expected to narrate while driving.

It must not:

- require a trainer to judge an invisible mental state;
- create a cut-in, tailgating, hard-braking, or evasive event for testing;
- score a driver against a vehicle/jurisdiction profile that does not apply;
- instruct the trainer to measure intervals manually while that trainer is driving;
- use one uneventful route as proof of all-condition competence; or
- convert a digital pass automatically into an on-road pass.

Before use, define route prerequisites, acceptable measurement aids, rating anchors, critical-fail behaviors, trainer qualifications, inter-rater agreement checks, remediation, recheck, appeal, retention, and escalation.

### 9.5 Pilot measurement design

The pilot should measure separately:

- completion and technical failure rate;
- item difficulty and discrimination by objective;
- accessibility defects and alternative-format equivalence;
- learner reports of ambiguity, inapplicable equipment, or jurisdiction mismatch;
- pre/post change on unseen knowledge and judgment items;
- delayed retention on unseen items if approved;
- Road Check rater agreement and observable-behavior distribution; and
- operational signals only as exploratory, de-identified analysis under a preapproved protocol.

Do not interpret an uncontrolled change in weekly safety score, harsh braking, crash count, or speeding duration as Module 4 causation. Any effectiveness evaluation needs a defined population, exposure, comparison method, confounder plan, missing-data rule, statistical analysis, privacy review, and claims boundary.

## 10. Production package and file contract

Proposed package:

```text
silvicom360/
  course-manifest.json
  module-04/
    module-manifest.json
    decisions/
      decision-register.md
      approval-record.md
      jurisdiction-review.md
      fleet-profile-review.md
    evidence/
      source-register.csv
      claim-register.csv
      calculation-register.csv
      footage-register.csv
      rights-register.csv
      privacy-review.md
      accessibility-review.md
    script/
      module-04-script.md
      pronunciation-and-terms.md
    storyboard/
      module-04-storyboard.pdf
      scene-register.csv
    media/
      module-04-master.mp4
      module-04-description.mp4
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

- stable course, module, lesson, asset, interaction, and assessment identifiers;
- semantic content version and build identifier;
- locale and fallback locale;
- source and approval record versions;
- applicable vehicle/equipment, jurisdiction, and operating-condition profile identifiers;
- title, outcome, prerequisites, estimated duration, and release state;
- ordered assets with cryptographic hashes, MIME types, byte sizes, and duration where applicable;
- captions, transcript, description/alternative relationships, and language tags;
- question-bank version, scoring-policy version, and server-known correct responses;
- minimum supported app/API versions;
- effective and retirement timestamps;
- migration/reassignment behavior for learners in progress;
- privacy classification and retention category; and
- rollback target.

Content IDs must remain stable across packaging systems, while a changed script, media file, translation, answer key, interval rule, calculation, or jurisdiction/profile applicability creates a new immutable content version. Replacing bytes under an existing approved version is prohibited.

## 11. FuelGuard integration plan

### 11.1 Content hierarchy

Reuse the generic hierarchy proposed in Module 1:

```text
Course
  └── Course Version
        └── Module 04 Version
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

Module 4 completion and Road Check status must remain separate facts. If an administrator view later displays both, it must label the difference clearly.

### 11.2 Reuse versus Module 4 additions

Reuse after verification:

- course/module/version/asset entities;
- assignment, attempt, response, completion, due-date, notification, and audit entities;
- private media storage and signed delivery;
- server-side scoring and idempotent event ingestion;
- locale/accessibility-variant selection;
- administrator publishing and assignment controls; and
- generic analytics and export controls.

Module 4 may need generic, reusable metadata—not special-purpose tables—for:

- vehicle/equipment applicability profile;
- jurisdiction applicability profile;
- stated operating conditions;
- scene/calculation provenance;
- interaction alternative linkage; and
- Road Check standard version.

Do not create fields such as `module_4_gap_seconds` or `module_4_escape_score`. If a reusable structured need emerges, design it across the full course and document its privacy, versioning, and authorization semantics.

### 11.3 Interaction options

Preferred minimum-release option: standard post-scene single- or multiple-select questions plus timestamp facts displayed in the prompt. This minimizes player complexity and reduces timing variance.

Optional later enhancement: a controlled video pause with server-defined start/stop event markers. It requires:

- consistent time-base behavior across supported devices;
- accessible equivalent facts;
- tolerance and retry rules;
- no dependence on network latency or tap speed; and
- analytics that distinguish playback failure from an incorrect answer.

Free-form drag spacing, augmented reality, camera-based distance estimation, and reaction-time grading are outside the initial plan.

### 11.4 API and security boundary

All implementation remains subject to the Module 1 API and security design. At minimum:

- authenticate the user and resolve current organization membership;
- require the existing `training` entitlement;
- enforce role and ownership checks server-side;
- ensure the assigned user/driver can access only their own active assignment and immutable content version;
- use non-public media delivery with short-lived authorization;
- never send answer keys to the client before grading;
- make event and submission operations idempotent and replay-safe;
- validate ordering, version, locale, applicability profile, timestamps, and payload size;
- audit publication, assignment, override, attempt reset, result change, Road Check entry, and export;
- apply RLS and organization scoping to all tenant data;
- define retention/deletion for raw interaction events separately from durable completion evidence; and
- prevent client-declared location, speed, vehicle profile, time interval, or score from becoming trusted evidence without server validation.

### 11.5 Driver application

The eventual learner path should:

1. appear only when the `training` module is entitled, released, and assigned;
2. require a linked authenticated driver or another explicitly approved identity path;
3. show module version, estimated time, due state, prerequisites, and parked-use warning;
4. support captions, transcript, description/alternative selection, playback controls, text scaling, and recovery from interruption;
5. state the applicable vehicle/jurisdiction profile and provide a mismatch-report path;
6. save durable progress without treating buffering or backgrounding as watched content;
7. present questions only when required content and accessible facts are available;
8. grade through the server and display approved feedback;
9. distinguish digital completion, assignment status, and Road Check status; and
10. collect no live location, speed, camera, microphone, accelerometer, or telematics data merely to complete Module 4.

### 11.6 Telematics and personalization boundary

The current code does not provide validated following-interval, forward-collision-warning, cut-in, or lateral-clearance events. Weekly Samsara aggregates cannot diagnose why a driver followed closely or whether Module 4 is the correct intervention.

Default launch behavior:

- assign through approved role/cohort/workflow rules, not inferred behavior;
- do not display a claimed personal following score;
- do not use raw provider payloads as a training decision API;
- do not expose one driver’s event or score to another driver;
- do not merge training answers into the operational driver score; and
- do not auto-discipline or auto-certify based on module or telematics data.

Any later event-triggered workflow requires a provider-contract review, field-level data validation, event-context review, false-positive analysis, human review, notice, appeal, access controls, retention, labor/privacy review, and effectiveness evaluation. A provider label is not ground truth.

### 11.7 Analytics

Permitted minimum analytics, subject to the generic event schema:

- assignment opened, module started, asset started/completed;
- caption/transcript/alternative selected;
- interaction shown and response submitted;
- assessment started/submitted/passed/not passed;
- module completed;
- playback/accessibility/technical error; and
- mismatch or content issue reported.

Each event should include server-resolved organization, assignment, immutable content version, locale, applicability profile, and actor context. Do not collect exact GPS, speed trace, camera image, microphone input, gaze, steering, braking, or accelerator data for digital-module analytics.

Use analytics to improve delivery and item quality, not to infer emotion, attention, disability, honesty, or live-driving competence.

## 12. Execution plan

### Phase M4.0 — Refresh baseline and resolve prerequisites

**Work**

- Re-run repository status, branch, commit, migration head, entitlement, feature flag, training-domain, media-player, notification, identity, and telematics searches.
- Compare the approved Module 1–3 versions and implementation state with this plan.
- Assign document, safety, operations, fleet engineering, legal, accessibility, product, security, and Road Check owners.
- Resolve M4-D01 and define the authoritative decision-register workflow.

**Exit evidence**

- dated baseline record;
- dependency matrix with implemented/approved/not-ready state; and
- owner/approver list.

### Phase M4.1 — Fleet, jurisdiction, and evidence profiles

**Work**

- Inventory launch vehicle classes, lengths, typical load states, brake systems, tire/brake standards, routes, grades, speeds, and jurisdictions.
- Review current applicable regulations, state manuals, company policy, manufacturer guidance, and fleet engineering data.
- Establish source, calculation, claim, jurisdiction, and fleet-profile registers.
- Resolve the weight/load wording and determine whether any stopping-distance calculation belongs in the module.

**Exit evidence**

- approved audience/applicability profiles;
- signed jurisdiction review;
- signed technical review; and
- traceable source/claim/calculation records.

### Phase M4.2 — Space-management standard

**Work**

- Resolve M4-D03 through M4-D10.
- Define the approved base following rule and measurement method.
- Define how conditions modify the base decision and when operation must stop.
- Define lateral-space, potential-option, cut-in, and tailgating language.
- Reconcile boundaries with Modules 2, 3, 5, 7, 8, and 9.

**Exit evidence**

- signed company Module 4 instructional standard;
- vocabulary and boundary matrix; and
- approved observable behavior list.

### Phase M4.3 — Scenario and assessment design

**Work**

- Create a scenario matrix across approved vehicles, conditions, margin losses, and decisions.
- Specify every quantitative scene’s facts before production.
- Build the assessment blueprint, accessible equivalents, rationales, and validation plan.
- Define the Road Check standard, safe route conditions, and trainer calibration cases.

**Exit evidence**

- approved scenario matrix;
- item specifications and accessible alternatives;
- reproducible calculation keys; and
- Road Check draft ready for calibration.

### Phase M4.4 — Script, storyboard, and production proof

**Work**

- Draft script and storyboard using only approved claims and profiles.
- Conduct instructional, technical, fleet, legal, editorial, accessibility, privacy, and field-review passes.
- Produce a calibration sample for the following-interval scene and one lateral-option scene.
- Test the sample on representative mobile devices before full production.

**Exit evidence**

- locked script/storyboard version;
- signed review log;
- quantitative-scene reproduction report; and
- approved production sample.

### Phase M4.5 — FuelGuard implementation and integration

**Work**

- Implement or reuse the approved generic foundation; do not invent Module 4-only architecture.
- Add required generic applicability, provenance, and accessibility links if approved.
- Package private media, captions, transcripts, alternatives, interactions, and assessment bank.
- Implement driver and administrator paths behind the existing unreleased `training` feature.
- Verify tenant isolation, authorization, answer-key protection, idempotency, audit, retention, and analytics.

**Exit evidence**

- reviewed migrations allocated from then-current head;
- passing automated and manual tests;
- security/accessibility QA; and
- staging evidence for the entire learner/admin flow.

### Phase M4.6 — Production, controlled pilot, and Road Check calibration

**Work**

- Produce final media under approved filming and quantitative-integrity controls.
- Run content, caption, transcript, description, localization, device, and offline/recovery QA.
- Train and calibrate Road Check observers without manufacturing hazardous events.
- Pilot with the approved cohort and collect predefined measures.
- Review adverse events, ambiguity, profile mismatch, accessibility defects, item statistics, and rater agreement.

**Stop conditions**

- a learner could reasonably infer that one number guarantees safety;
- a numerical answer cannot be independently reproduced;
- a scene rewards an illegal, unverified, retaliatory, or abrupt maneuver;
- a vehicle/jurisdiction profile is wrong or missing;
- an accessible alternative changes the construct or reveals the answer;
- critical authorization, tenant, answer-key, or privacy failure;
- Road Check raters cannot reach the approved agreement threshold; or
- a filming/production event creates an unsafe condition.

**Exit evidence**

- signed pilot report;
- resolved critical findings;
- calibrated observers; and
- release/hold decision.

### Phase M4.7 — Release and observation

**Work**

- Release by approved organization/cohort/profile behind the `training` feature.
- Monitor technical, accessibility, content, assignment, and support signals.
- Keep Road Check status separate and monitor rater drift.
- Review source currency and jurisdiction/fleet changes on the approved cadence.
- Roll back the affected immutable version or profile when a stop condition is met.

**Exit evidence**

- release log and version/profile mapping;
- monitoring dashboard/runbook;
- rollback rehearsal or verified mechanism; and
- scheduled content/source review owner and date.

## 13. Verification matrix

| Area                | Required verification                                                  | Minimum evidence                                        |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Source fidelity     | Title, principle, outcome, timing, and six source scenes are preserved | Source comparison checklist and hash                    |
| Claim accuracy      | Every number and stopping/space claim is traceable and in context      | Approved claim/source registers                         |
| Fleet applicability | Examples match represented vehicle, brake, load, and route profile     | Fleet engineering sign-off                              |
| Jurisdiction        | Content is reviewed for all launch jurisdictions                       | Legal/compliance matrix with dates                      |
| Quantitative scenes | Timing/distance answers can be independently reproduced                | Calculation register and second-review result           |
| Visual integrity    | Lens, crop, speed, synchronization, and overlays do not mislead        | Asset QA and metadata record                            |
| Instruction         | Objectives, practice, feedback, and assessment align                   | Design traceability matrix                              |
| Accessibility       | Equivalent access to spatial, temporal, and visual information         | WCAG review and assistive-technology tests              |
| Assessment          | Items are unambiguous, profile-correct, and server-graded              | Item review, pilot statistics, answer-key security test |
| Road Check          | Behaviors are observable and raters calibrated                         | Calibration cases and agreement report                  |
| Identity            | Only valid linked users or approved alternative identities participate | Positive/negative identity tests                        |
| Authorization       | Tenant, role, ownership, assignment, and entitlement rules hold        | API/RLS test evidence                                   |
| Media               | Private delivery, expiry, rights, and recovery work                    | Signed-URL and device/network tests                     |
| Versioning          | Changed content/answers/policy create a new immutable version          | Publish/migration/rollback tests                        |
| Privacy             | No unjustified sensor/location/event data is collected                 | Data-flow and retention review                          |
| Analytics           | Events are idempotent, scoped, minimal, and interpretable              | Contract tests and sample export review                 |
| Telematics boundary | Weekly aggregates cannot trigger unsupported diagnosis                 | Assignment-rule and UI review                           |
| Operations          | Support, correction, stop, rollback, and source-review paths work      | Runbook exercise                                        |

## 14. Rollout, monitoring, and rollback

### 14.1 Rollout

1. Internal content and technical review using no learner records.
2. Accessibility and device QA on the release candidate.
3. Small controlled pilot limited to approved profiles and jurisdictions.
4. Review against predefined stop/go criteria.
5. Limited production cohort with enhanced support and monitoring.
6. Broader rollout only after open critical issues are resolved and approvers sign the release record.

Do not expose the feature globally merely because `training` is an entitlement key. Entitlement, feature release, content approval, assignment, identity, profile applicability, and locale availability are separate gates.

### 14.2 Monitoring

Monitor:

- assignment delivery and linked-driver failures;
- video start, buffering, completion, resume, caption, transcript, and alternative-use failures;
- item nonresponse, unexpected distractor selection, excessive retries, and answer disputes;
- profile or jurisdiction mismatch reports;
- numerical reproduction disputes and source-expiration dates;
- accessibility defects by platform and assistive technology;
- support requests alleging unsafe, illegal, misleading, or retaliatory advice;
- Road Check rater disagreement and drift;
- content/version mismatch across narration, graphics, captions, transcript, assessment, and localization; and
- authorization, cross-tenant, signed-media, answer-key, audit, and privacy alerts.

Module completion and quiz pass rates are delivery/learning-process measures, not safety outcomes by themselves.

### 14.3 Rollback

Rollback triggers include:

- incorrect or expired legal/company interval guidance;
- a materially wrong calculation, unit, vehicle assumption, or stopping graphic;
- misleading camera perspective or timing;
- advice that could promote an illegal, abrupt, retaliatory, or unverified maneuver;
- profile/jurisdiction assignment error;
- critical accessibility failure;
- cross-tenant data exposure or answer-key leakage;
- corrupted content/version mapping; or
- evidence that the assessment rewards a materially unsafe response.

Rollback should disable new assignments and access to the affected version/profile, preserve auditable historical records, display an approved learner/admin status, identify impacted assignments and completions, and support reassignment to a corrected immutable version. Never rewrite prior answers or results silently.

## 15. Risks and controls

| Risk                                     | Why it matters                                                                                                  | Required control                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| One-number safety promise                | A base interval cannot account for every speed, surface, visibility, grade, load, vehicle, and driver condition | Policy approval, condition qualifiers, scenario practice, claim review        |
| Weight oversimplification                | “Heavier always takes farther” can be technically misleading; empty CMVs can have reduced traction              | Fleet engineering review and profile-specific wording                         |
| Time gap confused with stopping distance | Learners may think the timed interval guarantees a stop                                                         | Separate definitions, stopping sequence, feedback checks                      |
| Camera-perspective distortion            | Lens/crop can make unsafe gaps appear large or safe gaps appear short                                           | Calibration record, labeling, no exact inference from illustrative footage    |
| Unsafe production                        | Authentic-looking cut-ins or tailgating could endanger participants                                             | Closed-course/graphics/approved stock and no staged hazardous maneuvers       |
| “Escape route” misuse                    | A visible shoulder or lane may be illegal, occupied, unstable, or unverified                                    | Potential-option terminology and Module 5 verification boundary               |
| Retaliatory interpretation               | Cut-in/tailgating scenes can normalize blame, speeding, brake-checking, or confrontation                        | Neutral language and approved calm-recovery behavior                          |
| Jurisdiction mismatch                    | State rules can differ                                                                                          | Launch-state review and applicability profiles                                |
| Fleet mismatch                           | Vehicle length, brakes, load, and routes can change the example                                                 | Profile-based assignment and mismatch reporting                               |
| Visual-only assessment                   | Blind/low-vision or other learners may lack equivalent access                                                   | Timestamp timelines, structured lane tables, description, AT testing          |
| False digital competence                 | Quiz success does not prove live margin management                                                              | Separate Road Check and explicit status labeling                              |
| Invalid telematics inference             | Weekly aggregates do not establish following behavior or training need                                          | No automated diagnosis/assignment; validation and human review if added later |
| Platform duplication                     | Module-specific infrastructure fragments training                                                               | Reuse approved generic foundation                                             |
| Stale content                            | Regulations, company policy, fleet, or state manuals can change                                                 | Named owner, dated source register, scheduled revalidation, rollback          |
| Cross-tenant or answer leakage           | Training and assessment data are sensitive and tenant-scoped                                                    | Auth, RLS, role/ownership tests, private media, server scoring, audit         |

## 16. Required approval record

No production or release approval may be inferred from silence. Record name, role, version, date, decision, conditions, and expiration/review date for:

| Approval                                                  | Required owner                                          |
| --------------------------------------------------------- | ------------------------------------------------------- |
| Module purpose, audience, and prerequisite profile        | Program owner + operations                              |
| Base following rule and condition adjustment              | Safety + operations + legal/compliance                  |
| Stopping model, weight/load wording, and calculations     | Fleet engineering/qualified technical reviewer + safety |
| Lateral-space and potential-option standard               | Safety + operations + legal/compliance                  |
| Cut-in, rear-pressure, and recovery procedures            | Safety + operations                                     |
| Launch-jurisdiction interpretation                        | Legal/compliance                                        |
| Learning objectives, storyboard, practice, and assessment | Instructional design + safety                           |
| Road Check behavior, route, and scoring                   | Safety + operations + trainer lead                      |
| Footage, rights, privacy, and production safety           | Legal/privacy + safety + production owner               |
| Accessibility design and evidence                         | Accessibility owner                                     |
| Localization                                              | Qualified language reviewer + safety reviewer           |
| FuelGuard architecture, security, and privacy             | Product + engineering + security/privacy                |
| Pilot design and claims                                   | Program owner + analytics/legal as applicable           |
| Final release                                             | Named business, safety, product, and legal approvers    |

The release record must point to exact immutable content, assessment, applicability-profile, Road Check, app, API, and database versions.

## 17. Source register

### Internal evidence

- `Silvicom360_Defensive_Driving_System_Plan.docx`; verified SHA-256 `33117e5fbb8656fceab3787dd6a01b302c2eab46b010f9a10d4069ac05ee5376`; Module 4 facts and six-scene example storyboard extracted 2026-08-17.
- FuelGuard Git branch and commit recorded in the document header; inspected 2026-08-17.
- `packages/shared/src/entitlements.ts`; `training` entitlement verified.
- `packages/shared/src/featureCatalog.ts`; `training` release state verified as false.
- `apps/driver/package.json`, `apps/driver/app/_layout.tsx`, and `apps/driver/app/(tabs)/more.tsx`; driver platform/player/navigation baseline verified.
- `apps/api/src/routes/me.ts`, authentication/authorization middleware, and migrations `0098`, `0102`, `0116`; identity and nullable driver-user linkage verified.
- migration `0054_driver_scores.sql` plus related parser/sync services; current safety-aggregate fields verified.
- notification contract and migrations `0089`, `0093`, `0154`; `training_due` category and missing producer verified.
- latest migration filename found: `0201_unit_mileage_write_bucket.sql`.
- repository-wide targeted searches for training domains, following/headway/space events, forward-collision media, player dependencies, and event-level safety data; performed 2026-08-17.
- Modules 1–3 planning documents under `docs/plans/silvicom360/`; dependency assumptions reviewed 2026-08-17.

### External authoritative sources checked 2026-08-17

- [49 CFR 383.111 — Required knowledge](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-383/subpart-G/section-383.111): federal CDL knowledge topics include speed/stopping distance and space management ahead, behind, to the sides, and across traffic gaps.
- [49 CFR 383.113 — Required skills](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-383/subpart-G/section-383.113): safe speed/gap/following skill must account for roadway, visibility, weather, traffic, vehicle, cargo, and driver conditions; on-road skills are not replaced by digital training.
- [49 CFR 392.14 — Hazardous conditions; extreme caution](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-392/subpart-B/section-392.14): reduced-speed and discontinue-operation boundary when visibility or traction hazards become sufficiently dangerous.
- [FMCSA — Following Too Closely](https://www.fmcsa.dot.gov/safety/driver-safety/cmv-driving-tips-following-too-closely): older agency guidance for a time-based following method and adverse-condition adjustment; page age and context must remain visible during policy review.
- [FMCSA — Too Fast for Conditions](https://www.fmcsa.dot.gov/safety/driver-safety/cmv-driving-tips-too-fast-conditions): agency explanation connecting speed, conditions, and stopping demand; older statistics are not approved for learner use by this plan.
- [FMCSA — Safe Speed](https://www.fmcsa.dot.gov/safespeed): current public campaign context on CMV stopping time/distance and speed; exact public examples still require claim review before learner use.
- [FMCSA — Safe Driving Around Commercial Motor Vehicles](https://www.fmcsa.dot.gov/ourroads/safe-driving-around-cmvs): current road-sharing context, including the effect of cutting into space ahead of a large vehicle.
- [FMCSA — CMV Safe Speed Outreach Resources](https://www.fmcsa.dot.gov/ourroads/cmv-safe-speed-outreach-resources): current outreach assets available for contextual review; reuse still requires rights and content approval.
- [FMCSA-hosted Commercial Driver’s License Manual](https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/2005%20CDL%20DRIVER%20MANUAL%20FINAL%20July%202010.pdf): landmark interval method, stopping components, space management, tailgating response, and important load/traction nuance; verify against current launch-state manuals.
- [FHWA/Volpe — Naturalistic Study of Truck Following Behavior](https://rosap.ntl.bts.gov/view/dot/12251): 2016 report presenting a 2015 naturalistic following study, used only as design context—not as a policy threshold or FuelGuard fleet statistic.
- [W3C Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/): accessibility success criteria for the eventual learner and administrator experience.
- [W3C — Making Audio and Video Media Accessible](https://www.w3.org/WAI/media/av/): planning guidance for captions, transcripts, description, players, and media alternatives.
- [W3C — Understanding Success Criterion 1.2.2: Captions (Prerecorded)](https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded): prerecorded caption requirement and interpretation.
- [Expo Video documentation](https://docs.expo.dev/versions/latest/sdk/video/): current platform option to evaluate during implementation; it is not currently installed in FuelGuard.
- [Supabase Storage Buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals): public/private bucket behavior relevant to protected media design.
- [Supabase Resumable Uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads): upload path to evaluate for large training media; not an implementation decision by itself.

## 18. Definition of done for this planning document

This planning document is complete when:

- the source title, principle, outcome, timing, and six example scenes are traceable to the hashed program plan;
- current FuelGuard capabilities and gaps are recorded without claiming the training platform exists;
- federal requirements, agency guidance, technical nuance, state-law boundary, accessibility standards, and platform references are separated clearly;
- the source statement about heavier vehicles is flagged for qualified review rather than repeated as a universal fact;
- every unresolved policy, fleet, legal, content, assessment, technology, and rollout choice has an owner and release gate;
- implementation phases have testable exit evidence and stop conditions;
- digital completion and Road Check competence remain distinct; and
- no numerical interval, stopping distance, lateral clearance, maneuvering path, production method, or telematics workflow is silently assumed.

It is **not** production-ready until M4-D01 through M4-D16 are resolved, required approvals are recorded against exact versions, the generic FuelGuard training foundation exists and passes verification, and the controlled pilot meets its approved stop/go criteria.
