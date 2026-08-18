# Silvicom360 Module 2 — See Far Ahead: Hazard Recognition

**Document status:** Planning baseline; not approved for production or release
**Version:** 0.1
**Prepared:** 2026-08-17
**Target product:** FuelGuard Safety Training
**Verified code baseline:** branch `claude/efs-phase-10-write-path`, commit `e1a20a427c482c0576e3f6fd396bb21c6886d1f2`
**Source-program plan:** `Silvicom360_Defensive_Driving_System_Plan.docx`, SHA-256 `33117e5fbb8656fceab3787dd6a01b302c2eab46b010f9a10d4069ac05ee5376`
**Document owner:** Unassigned

> This document separates verified facts, evidence-based proposals, and unresolved company decisions. A **Decision required** item is not permission to invent an answer during scripting, production, assessment, or implementation.

## 1. Outcome and scope

Module 2 turns the first Silvicom360 principle, **See Far Ahead**, into an observable decision habit. It teaches a driver to notice early cues, predict a plausible conflict, and select an early response that preserves time and options before an emergency maneuver is needed.

The module is successful only when a driver can:

1. distinguish an observable cue from a developing conflict and from an immediate hazard;
2. identify relevant forward-road cues in realistic commercial-driving scenes;
3. explain what could reasonably happen next without claiming certainty;
4. choose an early, proportionate response that creates time and space; and
5. apply the same reasoning to an unfamiliar scenario that was not used during instruction.

Digital completion documents knowledge and scenario judgment. It does not prove the driver consistently performs the behavior on the road. The separate Silvicom360 Road Check remains the intended observation channel.

### 1.1 Included

- Module 2 learning design, content boundaries, timing, storyboard, and production rules.
- A forward-hazard vocabulary and a repeatable cue-to-action reasoning process.
- Commercial-driving scenes involving traffic flow, intersections, sight obstructions, vulnerable road users, roadway geometry, unfamiliar routes, and changing visibility.
- Scenario-based practice and assessment using original or properly licensed footage and graphics.
- Accessibility design for content whose teaching point is substantially visual.
- Module 2 packaging, publishing, assignment, analytics, pilot, and release requirements in FuelGuard.
- The conditions under which existing FuelGuard driver-performance data may later inform assignment or evaluation.

### 1.2 Excluded

- The final approved narration script, finished video, or assessment bank.
- A complete mirror and scanning routine; that belongs to Module 3.
- Following-distance formulas and escape-space technique; those belong to Module 4.
- Full lane-change, turning, and merging procedure; those belong to Module 5.
- Backing and GOAL procedure; those belong to Module 6.
- Detailed speed, intersection, work-zone, fatigue, distraction, or weather instruction; those belong to Modules 7–9.
- Collision reconstruction, fault determination, preventability classification, or disciplinary policy.
- Automatic assignment based on a Samsara score or event.
- A claim that passing a video-based hazard exercise proves on-road competence or reduces crashes.
- ELDT, government certification, or third-party defensive-driving certification.

## 2. Verified baseline

### 2.1 Program-plan facts

The source program plan specifies:

- a ten-module core course;
- Module 2 title: **See Far Ahead: Hazard Recognition**;
- target video length: **10–12 minutes**;
- primary outcome: **identify developing conflicts before they become emergencies**;
- the proposed principle definition: look beyond the immediate traffic zone to identify developing hazards early and reduce surprise;
- original scripts, footage, graphics, examples, and assessments;
- concise videos, scenario questions, captions, and transcripts; and
- digital learning followed by a separate road observation rather than digital completion as the only measure of competence.

The source plan does not define a required look-ahead interval, company hazard priorities, exact scenario set, pass rule, interaction type, accessibility alternative, footage source, or approved early-response language.

### 2.2 FuelGuard facts verified in code

| Area | Current fact | Evidence | Module 2 consequence |
|---|---|---|---|
| Code baseline | Current branch is `claude/efs-phase-10-write-path` at `e1a20a427c48`; unrelated user changes already exist in the worktree. | Git inspection on 2026-08-17 | Re-verify before implementation and preserve unrelated work. |
| Product entitlement | `training` is a valid module key labeled “Safety Training.” | `packages/shared/src/entitlements.ts` | Reuse this entitlement; do not introduce a Module 2 entitlement. |
| Driver feature | `training` exists in the feature catalog but is `released: false`. | `packages/shared/src/featureCatalog.ts` | Module 2 cannot make the feature releasable by itself. |
| Training foundation | No general training tables, routes, services, admin pages, or driver player exist. | `supabase/migrations/`, `apps/api/src`, `apps/web/src`, `apps/driver` | Module 2 depends on the generic foundation planned in Module 1 or a freshly approved replacement. |
| Driver app | The learner app is React Native/Expo 57; `expo-video` is not installed and no training route appears in More or the root stack. | `apps/driver/package.json`, `apps/driver/app/_layout.tsx`, `apps/driver/app/(tabs)/more.tsx` | Reuse the Module 1 learner architecture after it exists; do not build a separate Module 2 player. |
| Identity | Driver endpoints resolve the signed-in driver through `drivers.user_id`; that link is nullable in the current model. | `apps/api/src/routes/me.ts`, roster/driver migrations | Initial in-app assignments remain limited to linked users unless another authenticated channel is approved. |
| Authorization | Express authentication, org scoping, `requireModule()`, audit helpers, capability checks, and RLS conventions exist. | `apps/api/src/app.ts`, `apps/api/src/middleware/requireModule.ts`, route/service patterns | Every Module 2 mutation and learner read must use the existing boundaries. |
| Safety aggregates | `driver_scores` stores weekly Samsara-derived safety score, harsh acceleration/braking/turn counts, crash count, speeding duration, and raw provider response for linked drivers. | migration `0054_driver_scores.sql`, `parseSafetyScores`, `syncDriverScores` | Data exists, but it is weekly/provider-derived and not a validated Module 2 mastery signal. |
| Event media | No FuelGuard table or service stores event-level dashcam clips, hazard labels, near-miss narratives, or collision-review footage. | Migration and code search on 2026-08-17 | Do not promise personalized clips or company-event scenarios without a new approved source and privacy workflow. |
| Driver score UI | A released driver-score feature already displays performance context. | `featureCatalog.ts`, driver score feature, driver-performance web pages | Training results must remain distinct from performance scores unless an approved integration defines meaning and access. |
| Notifications | `training_due` is an allowed notification category, but no producer currently creates course-due events. | `packages/shared/src/notificationsContract.ts`, migrations `0089`, `0154`, producer search | Add reminders only after assignments and due-state logic exist. |
| Maps/location | The driver app includes mapping/location dependencies for operational features. | `apps/driver/package.json` and navigation code | Module 2 has no justified need for live location; do not collect it for learning or assessment. |
| Compliance records | Hazmat training certifications use regulation-specific records and qualification logic. | migration `0127_hazmat_certifications.sql` and compliance services | Never write Silvicom360 completion into hazmat certification or qualification records. |

### 2.3 Module 1 dependency disposition

`MODULE-01-INTRODUCTION-PROFESSIONAL-MINDSET.md` is the current foundation plan, not proof that the foundation is approved or implemented. Module 2 may reuse its proposed immutable versions, assignments, attempts, server-side grading, private media, event trail, driver player, and admin workflow only after those decisions are approved and the implementation is verified against the then-current branch.

Module 2 must not:

- reserve migration numbers based on the present `0201` migration line before implementation begins;
- duplicate the course, assignment, player, or event model under Module 2-specific tables;
- release `training` before an end-to-end generic training path exists; or
- treat an unresolved Module 1 program rule as approved merely because this document references it.

## 3. Facts, proposals, and decisions required

| ID | Topic | Status | Current evidence | Release requirement |
|---|---|---|---|---|
| M2-D01 | Foundation readiness | Decision required | Module 1 is planned but the general training platform does not exist. | Name the approved Module 1 version and verified software release that Module 2 will reuse, or approve a replacement architecture. |
| M2-D02 | Audience and equipment | Decision required | “Company drivers” is the only supplied audience description. | Identify launch terminals, driver roles, vehicle classes, trailer types, route environments, tenure mix, and exclusions. |
| M2-D03 | Look-ahead standard | Decision required | FMCSA guidance says to look at least 15 seconds ahead; the source plan gives no number. | Safety/operations approve exact learner wording, examples, and whether the time horizon varies by environment. |
| M2-D04 | Company hazard priorities | Decision required | No company incident taxonomy, near-miss dataset, safety policy, or approved examples were supplied. | Provide a de-identified, owner-approved priority list or explicitly approve a generic first release. |
| M2-D05 | Early-response language | Decision required | Public guidance supports early and smooth response, but company authority and escalation wording are unknown. | Approve which actions may be taught in Module 2 and which must defer to later modules/policy. |
| M2-D06 | Footage source | Decision required | FuelGuard has aggregate safety data but no event-clip repository. | Approve original controlled footage, licensed footage, de-identified company footage, simulation/graphics, or a defined mix with rights and privacy evidence. |
| M2-D07 | Scenario interaction | Decision required | The generic plan can support video and quizzes; no hotspot or timed-pause engine exists. | Select standard post-clip questions, controlled freeze-frame prompts, accessible hotspot interaction, or another tested method. |
| M2-D08 | Accessibility equivalent | Decision required | Hazard recognition is visual; W3C requires access to important visual information. | Approve integrated description, descriptive transcript, alternate assessment form, and non-visual equivalence review. |
| M2-D09 | Assessment rule | Reconfirm | Module 1 proposes an eight-item bank, five served, four correct, but its rule remains unapproved. | Approve Module 2 bank size, served set, pass threshold, retakes, feedback, and whether response time is recorded but never graded. |
| M2-D10 | Telematics use | Decision required | Weekly Samsara aggregates exist but are not hazard-recognition diagnoses. | Approve no integration, human-reviewed targeting, or a separately validated rule; automatic assignment is prohibited by default. |
| M2-D11 | Languages | Decision required | No launch languages or reviewer pool were supplied. | Name languages and require translated narration, captions, transcript, on-screen text, questions, and rationales to be reviewed together. |
| M2-D12 | Pilot and transfer gates | Decision required | Hazard-perception research supports scenario practice but evidence does not automatically transfer to experienced CMV drivers or crash reduction. | Approve pilot cohort, unseen-scenario measures, thresholds, observation method, and stop criteria. |
| M2-D13 | Claims and statistics | Decision required | FMCSA sources contain older study statistics and time/distance examples with limitations. | Approve every numerical or regulatory learner-facing claim through a dated source and SME/legal disposition. |

## 4. Learner design

### 4.1 Audience

Provisional audience: company commercial drivers in the approved Module 2 pilot who:

- have an active FuelGuard-authenticated driver account linked through `drivers.user_id`;
- have completed the approved Module 1 version;
- are assigned the same language version used for captions, transcript, prompts, and questions; and
- are not operating a vehicle while taking the module.

The plan does not assume every driver operates a tractor-trailer, uses Samsara, speaks English, has normal vision, or encounters the same traffic environment.

### 4.2 Prerequisites

Before assignment:

1. Module 1 content and program terminology are approved.
2. The generic training foundation is implemented and verified.
3. M2-D02 through M2-D09 are resolved for the pilot.
4. Every scene has an approved source, rights/privacy record, hazard key, and accessibility alternative.
5. The release-candidate video and questions are tested on representative devices and connections.
6. The company identifies how a driver reports inaccessible, ambiguous, or inaccurate material without being scored as noncompliant.

### 4.3 Proposed measurable learning objectives

Subject to approval, a learner will be able to:

1. **Classify:** Given a scene description, correctly classify at least four of five examples as a cue, developing conflict, immediate hazard, or irrelevant detail.
2. **Detect:** In an unfamiliar forward-road clip or still sequence, identify the priority cue or cue cluster before the preferred response is revealed.
3. **Predict:** Select the most plausible next conflict from the visible evidence without overstating certainty or inventing unseen facts.
4. **Respond:** Select the earliest proportionate action that preserves time and space and avoids an abrupt, unverified maneuver.
5. **Transfer:** Apply the same cue → possibility → early-action reasoning to at least two scenarios not shown during instruction.

Response latency may be observed during research, but it must not determine pass/fail because device performance, playback, motor ability, screen-reader use, and other accessibility factors can affect timing.

### 4.4 Working vocabulary

These terms are proposed for content review and are not company policy until approved:

- **Cue:** Something observable now—for example brake lights several vehicles ahead, a blocked sightline, a narrowing lane, a wheel beginning to turn, or a pedestrian approaching a curb.
- **Developing conflict:** A plausible interaction that could require braking, changing position, communicating, or stopping if it continues.
- **Immediate hazard:** A condition requiring prompt action now; this module emphasizes recognizing the development before this stage.
- **Hidden area:** A place where a person, vehicle, or condition could be concealed by traffic, buildings, vegetation, roadway shape, parked equipment, or weather.
- **Priority cue:** The cue that most changes the driver’s available time or options.
- **Early response:** A smooth, verified adjustment that preserves time and space without creating a new conflict.

The script should use the three plain-language questions below as the instructional spine unless reviewers approve a better original formulation:

1. **What changed or is about to change?**
2. **What could that create?**
3. **What can I do early to preserve time and options?**

### 4.5 Content boundaries with later modules

| Topic encountered in Module 2 | Teach here | Defer |
|---|---|---|
| Forward sight horizon | Why a time-based forward horizon reveals change earlier; approved target wording | Full scan pattern and mirror cadence to Module 3 |
| Brake lights and traffic waves | Recognize multi-vehicle change, not only the nearest vehicle | Following-gap calculation to Module 4 |
| Lane ending or missed exit | Recognize early; accept the missed turn rather than make a sudden correction | Lane-change verification sequence to Module 5 |
| Obstructed intersection | Identify hidden approach paths and prepare early | Detailed intersection/speed method to Module 7 |
| Work zone or roadway geometry | Notice signs, channelization, workers, stopped queues, crests, and curves early | Full work-zone and speed instruction to Module 7 |
| Fatigue or distraction | Acknowledge that attention quality affects detection | Self-management procedure to Module 8 |
| Rain, fog, smoke, glare, darkness | Recognize reduced preview and increase caution | Detailed adverse-condition response to Module 9 |

## 5. Evidence and regulatory boundary

Module 2 should teach observable judgment, not a dense legal briefing. Every factual, numerical, company-policy, or regulatory claim in the final script must appear in the source register with exact wording, retrieval date, reviewer, scene, and disposition.

| Topic | Approved source baseline | Permitted Module 2 use | Constraint |
|---|---|---|---|
| CMV operating responsibility | 49 CFR 392.1 and 392.2 | State that CMV operation is governed by applicable rules and that carriers/drivers must be instructed in Part 392. | Do not imply Module 2 is complete regulatory instruction. |
| Hazardous visibility/traction | 49 CFR 392.14 | Briefly connect early recognition to extreme caution and speed reduction when conditions affect visibility or traction. | Detailed adverse-weather instruction remains in Module 9; company/legal review exact phrasing. |
| Recognition relevance | FMCSA LTCCS analysis brief/report | Explain internally why recognition deserves a dedicated module. | The 2001–2003 study is descriptive; “critical reason” is not a full causal or fault finding. Do not present old percentages as current crash rates. |
| Inadequate surveillance | FMCSA CMV Driving Tips | Support looking where a safe maneuver requires, noticing conflicts early, and using scenario questions. | Pages were last updated in 2015; validate learner-facing numbers and terminology before use. |
| Forward horizon | FMCSA Inadequate Surveillance and Inadequate Evasive Action pages | Use “at least 15 seconds” as the public-source baseline for M2-D03. | Safety/operations must approve the exact company standard and examples; do not convert it into fixed universal feet. |
| Unfamiliar roads | FMCSA Unfamiliar Roadway page | Teach route review before driving and accepting a missed turn/exit rather than correcting suddenly. | Navigation/device policy must match company policy; do not teach in-motion device interaction. |
| Scenario training design | NHTSA Risk Awareness and Perception Training evaluation, DOT HS 812 379 | Support instruction plus practice on hazards that may be hidden or developing and testing with different scenarios. | Study population was young drivers, not the approved company CMV cohort; use as design input, not proof of Module 2 effectiveness. |
| Video accessibility | WCAG 2.2 and W3C media guidance | Require captions, integrated description of essential visual information, descriptive transcript, and an equivalent assessment path. | A transcript that reveals the answer before the learner responds is not an equivalent assessment design. |

### 5.1 Claim rules

- Do not say a behavior “causes” a percentage of crashes based on LTCCS critical-reason or associated-factor data.
- Do not imply that every cue predicts one outcome; use probability language such as “could,” “may,” and “be prepared for.”
- Do not claim that a specific look-ahead interval guarantees adequate stopping distance.
- Do not use stopping-distance, reaction-distance, or speed-to-distance calculations unless separately sourced, equipment/condition qualified, and approved.
- Do not use a company incident, dashcam clip, telematics record, or driver story without documented authority, de-identification, rights, and a safety review.
- Do not describe the system as measuring where the driver looked; video answers and watch telemetry do not provide eye tracking.
- Do not represent assessment improvement as proof of fewer crashes or improved on-road behavior.

## 6. Content structure and timing

**Target edited-video duration:** 10:45.
**Allowed release window:** 10:00–12:00.
**Narration budget:** approximately 1,150–1,280 spoken words, allowing at least 75 seconds for observation and decision pauses.
**Assessment time:** 5–7 minutes outside the video unless M2-D07 approves embedded prompts.

| Time | Duration | Content block | Learner action | Exit condition |
|---|---|---|---|---|
| 00:00–00:25 | 0:25 | Cold open: a traffic change becomes urgent | Observe and name the earliest cue | Learner sees that the emergency began as smaller changes. |
| 00:25–00:55 | 0:30 | Module purpose and boundary | Listen/read | Hazard recognition is separated from later maneuver technique. |
| 00:55–01:50 | 0:55 | Cue, developing conflict, immediate hazard | Classify three examples | Vocabulary is understood without treating predictions as certainty. |
| 01:50–02:45 | 0:55 | The three questions | Apply cue → possibility → early action | Learner can repeat the reasoning process. |
| 02:45–03:40 | 0:55 | Looking far enough ahead | Compare narrow vs broader preview | Approved time-horizon wording is demonstrated. |
| 03:40–04:35 | 0:55 | Cue families | Identify traffic, roadway, visibility, and human cues | Learner avoids fixation on one object. |
| 04:35–05:30 | 0:55 | Hidden areas and obstructed sightlines | Predict what could emerge | Learner treats missing view as uncertainty, not proof of clearance. |
| 05:30–06:35 | 1:05 | Scenario A: highway traffic wave/lane reduction | Pause, identify cues, choose first adjustment | Preferred response is explained without following-distance formula. |
| 06:35–07:40 | 1:05 | Scenario B: urban intersection/vulnerable road user | Pause, identify hidden paths and early action | Answer relies on visible evidence, not stereotype or certainty. |
| 07:40–08:45 | 1:05 | Scenario C: unfamiliar route/curve/work zone | Pause and choose between early planning and sudden correction | Learner accepts rerouting rather than creating a new conflict. |
| 08:45–09:45 | 1:00 | Early-response menu | Match response to risk and uncertainty | Actions are smooth, verified, and proportionate. |
| 09:45–10:20 | 0:35 | Common failures | Identify fixation, late recognition, and abrupt correction | Learner can state what information was missed. |
| 10:20–10:45 | 0:25 | Recap and transition | Recall three questions | Learner is ready for the knowledge/scenario check. |

## 7. Scene-by-scene storyboard blueprint

| Scene | Time | Visual plan | Narration/teaching intent | Interaction or text | Evidence/review gate |
|---|---|---|---|---|---|
| 1 | 00:00–00:25 | Forward view: distant brake wave, lane-control sign, and queue partly hidden beyond a crest; no collision | The urgent moment began with cues visible earlier | “What was the first useful clue?” | Safety SME confirms scene is realistic and not staged on an active public road. |
| 2 | 00:25–00:55 | Original Module 2 title and SILVIC ring highlighting S | Define See Far Ahead and state scope | “Recognize early. Predict carefully. Act smoothly.” | Brand/program wording approved; no certification claim. |
| 3 | 00:55–01:22 | Three successive frames from the same scene | Separate cue, developing conflict, and immediate hazard | Labels appear only after explanation | Reviewer can point to exact visible evidence for each label. |
| 4 | 01:22–01:50 | Neutral examples with relevant and irrelevant details | Teach priority without tunnel vision | Quick classification prompt | Item has one defensible key; irrelevant details are plausible but not deceptive. |
| 5 | 01:50–02:45 | Three-question original graphic over a widening forward view | Establish repeatable reasoning, not a memorized guess | What changed? What could happen? What preserves options? | Originality and plain-language review pass. |
| 6 | 02:45–03:12 | Same road shown with short and approved forward planning horizons | Demonstrate why time-based preview adapts to speed | Approved M2-D03 wording | No fixed-distance overlay unless sourced and qualified. |
| 7 | 03:12–03:40 | Sightline changes over crest, curve, large vehicle, and rain mist | Looking ahead includes noticing where vision ends | “A blocked view is uncertainty.” | Avoid implying the driver can see through obstructions. |
| 8 | 03:40–04:35 | Original cue-family montage: traffic flow, signals/signs, lane geometry, visibility, people/animals | Expand attention beyond the lead vehicle while retaining forward priority | Five cue-family icons | Module 3 owner confirms this does not teach the full scan pattern. |
| 9 | 04:35–05:02 | Parked van blocks a crosswalk approach; pedestrian remains concealed initially | Predict a possible road user without claiming one is present | “What could enter your path?” | Accessibility alternative provides equivalent evidence without revealing the answer. |
| 10 | 05:02–05:30 | Construction equipment/building/vegetation obscures a side approach | Show multiple hidden paths and an early preparation point | Reveal paths after response | Operations validates scene against target routes. |
| 11 | 05:30–06:35 | Highway traffic wave and lane reduction shown from controlled/original source | Identify several lead-vehicle cues and create time before the queue | Pause, select first action, then rationale | No exact gap formula; Module 4 boundary retained. |
| 12 | 06:35–07:40 | Urban intersection with turning wheels, blocked crosswalk view, signal phase, and pedestrian approach | Combine cues without stereotyping or overprediction | Multi-cue question plus early action | Vulnerable-road-user depiction and caption placement reviewed. |
| 13 | 07:40–08:45 | Unfamiliar route approaching a late lane split, curve, or work-zone channelization | Plan early; if the turn is missed, continue and recover safely | Choose between sudden correction and safe reroute | Company navigation/device policy is approved before narration. |
| 14 | 08:45–09:45 | Response ladder: release accelerator/cover brake where appropriate, increase margin, communicate, stop/replan, verified lane action | Early response should be proportionate and should not create another hazard | Match cue severity to approved response | Safety/operations approve each action and terminology. |
| 15 | 09:45–10:45 | Before/after recap using unseen still sequence; SILVIC S resolves into ring | Fixation and late reaction are contrasted with early recognition; recap three questions | “See the change. Consider what follows. Preserve options.” | Legal, safety, operations, accessibility, and production sign-off. |

## 8. Script and production standards

### 8.1 Wording

- Write to a professional adult driver in short, active sentences.
- Describe visible evidence before interpreting it.
- Use probability language; never narrate an uncertain future event as inevitable.
- Explain why the preferred action preserves time or options.
- Avoid praise-only language, fear appeals, shaming, and “perfect driver” claims.
- Do not use third-party branded defensive-driving terminology, copied diagrams, recognizable scripts, or proprietary course structures.
- Do not use “accident” and “preventable” casually; collision terminology and preventability determinations require company review.
- Do not imply a driver can compensate for fatigue, distraction, poor visibility, or inadequate space merely by “looking harder.”

### 8.2 Scenario construction

Each scenario record must contain:

- stable scenario ID and version;
- road/environment type and approved audience relevance;
- source/owner/license/release record;
- exact visible and audible cues by timestamp;
- hidden-information boundary—what the learner cannot know;
- plausible conflict key;
- earliest approved response point and rationale;
- prohibited interpretations or unsafe responses;
- crop, resolution, frame-rate, color, audio, and caption-safe-zone requirements;
- descriptive transcript and alternate assessment form;
- content, safety, operations, accessibility, privacy, and legal reviewers; and
- checksum for every published rendition.

### 8.3 Visual integrity

- Initial presentation must not highlight, circle, zoom, caption over, or sonically reveal the correct hazard before the learner responds.
- The reveal may use original overlays after the response to show cue sequence and hidden paths.
- Avoid wide-angle distortion or edits that make vehicle speed, distance, signal timing, or conflict timing misleading.
- Preserve enough resolution that the priority cue is visible on the smallest supported device at normal viewing size.
- Do not assess color alone; signals, arrows, motion, text, or shape must provide redundant information.
- Place captions away from brake lights, signals, pedestrians, signs, and other assessed visual regions.
- If a mobile crop removes a material cue, create a separately reviewed mobile composition rather than allowing automatic cropping.

### 8.4 Filming safety and privacy

- Never ask an operating driver to handle production equipment or repeat an unsafe maneuver.
- Capture moving-road footage with fixed, approved equipment and a dedicated production plan; stage decision points in a closed/controlled location, simulator, or graphics where practical.
- Do not create a near miss, sudden lane intrusion, pedestrian exposure, traffic obstruction, or regulatory violation for footage.
- Record location, vehicle/unit, date, camera placement, operator, route authority, talent/property releases, and asset owner.
- Remove or blur customer data, shipping papers, credentials, device notifications, faces, unit identifiers, and license plates unless explicitly approved.
- Treat dashcam and telematics-linked footage as potentially sensitive employee and third-party data; obtain authority and document de-identification.

### 8.5 Audio, captions, and description

- Narration should identify essential visual changes in the main audio when doing so does not reveal a pending answer.
- Provide human-reviewed captions for speech and meaningful non-speech audio.
- Provide a descriptive transcript that includes essential visual sequence and on-screen text.
- If integrated narration cannot convey all visual teaching, provide an approved described version or equivalent accessible lesson.
- Background sound must never be the only signal that a hazard is developing.
- Music, if approved, remains below speech and pauses during observation prompts when it could influence urgency.

### 8.6 Accessibility of hazard exercises

A visual recognition exercise creates a special design problem: describing the priority cue before the response may disclose the answer, while withholding the information may exclude a blind learner. M2-D08 must resolve this before production.

The preferred design to test is:

1. standard clip/still sequence for learners who use the visual form;
2. an alternate structured scene description that presents all relevant observations neutrally and in the same order;
3. the same prediction and early-action decision without a timed penalty;
4. equivalent scoring objective and difficulty reviewed by an accessibility specialist and safety SME; and
5. analytics that identify form version without treating one form as inferior.

## 9. Assessment blueprint

### 9.1 Delivery rule

The final rule inherits the approved program-level pass and retake policy. The Module 2 content proposal is:

- maintain at least ten approved scenario items across at least six scenario families;
- serve six items only if the program rule is changed accordingly; otherwise conform to the approved five-item set;
- include at least two unseen transfer scenarios;
- include cue classification, conflict prediction, and early-action selection in every served set;
- randomize item and option order without changing temporal sequence inside a scenario;
- grade on the server against the immutable content version;
- show rationales only after submission; and
- never use response time as a pass criterion.

### 9.2 Item blueprint

| Objective | Proposed bank count | Minimum served | Item form | Evidence of mastery |
|---|---|---|---|---|
| Cue/conflict classification | 2 | 1 | Text or still-sequence single select | Correctly separates present evidence from possible outcome. |
| Priority cue detection | 3 | 1 | Post-clip single or multi-select | Selects the cue or cue cluster that changes available time/options. |
| Hidden-area prediction | 2 | 1 | Scenario single select | Identifies a plausible conflict without assuming it exists. |
| Early response | 3 | 2 | Scenario single select | Chooses the earliest proportionate, verified action. |
| Transfer | Tagged subset of the above | 2 unseen items | Alternate scenario | Applies reasoning to content not shown in instruction. |

### 9.3 Item-writing rules

- The keyed answer must be defensible from evidence actually visible or provided in the accessible form.
- Distractors should be plausible late, abrupt, assumption-based, or incomplete choices—not reckless caricatures.
- Do not ask the learner to estimate exact speed, distance, or time from uncalibrated video.
- Do not infer intent, identity, impairment, or legal fault from appearance.
- Avoid “all/none of the above,” double negatives, trivia, verbatim narration recall, and vague “best” answers without an approved rationale.
- For multi-select, state the exact number of selections or use exact-set grading with clear instructions.
- Every item must record scenario/rendition checksum, pause frame/time, objective, correct rationale, distractor rationales, source, reviewer, accessibility form, and pilot statistics.
- A question missed by a large or demographically concentrated share of the pilot is reviewed for visibility, accessibility, language, and ambiguity before it is treated as learner failure.

### 9.4 Pilot measurement design

Use two equivalent forms:

- **Instruction/form A:** scenarios used for teaching and supported practice.
- **Transfer/form B:** different road scenes with the same cue/conflict structure.

The pilot report should separate:

- cue identification accuracy;
- conflict-prediction accuracy;
- early-response selection;
- transfer to unseen scenarios;
- item ambiguity and reviewer agreement;
- completion/accessibility/support issues; and
- any later road-check observation, clearly separated from digital results.

Do not interpret a pre/post gain on the same clips as transfer.

## 10. Production package and file contract

All published files belong to a versioned, immutable release. Proposed convention:

`silvicom360/core/v1.0.0/module-02/`

| Artifact | Required filename pattern | Acceptance check |
|---|---|---|
| Approved content brief | `m02-content-brief-v1.0.0.pdf` | Decisions, boundaries, claims, and scene families approved. |
| Script | `m02-script-v1.0.0.docx` | Line-by-line content, safety, legal, operations, and accessibility disposition. |
| Storyboard | `m02-storyboard-v1.0.0.pdf` | Every scene maps to cue key, source, accessibility form, and objective. |
| Shot/asset list | `m02-shot-list-v1.0.0.xlsx` | Source, location, release/license, privacy treatment, status, and owner present. |
| Scenario manifest | `m02-scenarios-v1.0.0.json` | Schema validation; IDs, timestamps, cue/conflict/action keys, and checksums complete. |
| Master video | `m02-master-1080p-v1.0.0.mp4` | Full-frame, timing, color, audio, and safety review pass. |
| Mobile rendition | `m02-mobile-v1.0.0.mp4` | Every assessed cue remains visible on device matrix. |
| Described/alternate media | `m02-described-v1.0.0.mp4` or approved equivalent | Essential visual information available without disclosing answers early. |
| Captions | `m02-en-US-v1.0.0.vtt` | Human-reviewed timing, wording, speakers, sounds, and safe placement. |
| Descriptive transcript | `m02-en-US-descriptive-transcript-v1.0.0.txt` | Speech, essential visuals, sounds, and on-screen text in sequence. |
| Question bank | `m02-question-bank-v1.0.0.json` or controlled export | Schema, exact-set grading, scenario checksum, rationales, and independent review pass. |
| Source/claim register | `m02-source-register-v1.0.0.xlsx` | Every factual, numerical, policy, and regulatory claim disposition recorded. |
| Media/privacy register | `m02-media-register-v1.0.0.xlsx` | Ownership, licenses, releases, de-identification, and retention complete. |
| Approval record | `m02-approval-v1.0.0.pdf` | Named approvers, date, version, checksum, and disposition. |

The application stores release metadata and checksums. Filenames alone are not proof of version.

## 11. FuelGuard integration plan

### 11.1 Content hierarchy

Module 2 should reuse one generic hierarchy:

- **Product entitlement:** `training`
- **Course:** Silvicom360 Defensive Driving — Core Course
- **Published course version:** immutable snapshot such as version 1
- **Training segment displayed as Module:** `module_02`
- **Asset set:** standard, mobile, described/alternate media, captions, transcript, thumbnail
- **Scenario set:** version-pinned scenario manifest and question bank
- **Assignment:** course/segment scope for a named cohort or approved remedial use
- **Attempt:** one learner’s version-pinned work and result
- **Event trail:** append-only record of material state changes

### 11.2 Reuse versus Module 2 additions

Reuse the approved Module 1 foundation for identity, org/module/feature gates, courses, versions, assignments, attempts, grading, media authorization, events, driver navigation, and admin reporting.

Module 2 requires no new table if the approved generic version model can immutably store:

- scenario manifest and rendition checksums;
- question-to-scenario relationship;
- pause frame/time metadata where used;
- accessibility form/version;
- objective and cue-family tags; and
- response plus rationale/result evidence.

Create a schema migration only if the implemented generic model cannot preserve those facts with constraints and server-side validation. Do not put authoritative answer keys or mutable scenario definitions in unvalidated client-only JSON.

### 11.3 Interaction choice and technical scope

The minimum-risk first release is a normal video followed by server-graded scenario questions using stills or short clips, with the preferred cue reveal after submission. This can reuse the generic video and quiz path.

An embedded pause/freeze interaction adds requirements for:

- stable timestamp behavior across renditions and platforms;
- exact clip/frame versioning;
- backgrounding, seek, retry, expiry, and resume rules;
- a non-timed accessible alternative;
- event semantics that do not overstate attention; and
- device tests proving the prompt appears after the same evidence.

An image-hotspot interaction adds a new answer type, region geometry across crops, touch/keyboard/screen-reader behavior, and equivalent non-visual assessment. Do not implement it merely because it appears engaging.

### 11.4 API and security boundary

All Module 2 routes use the generic training API:

- admin mutations require authentication, org scope, `requireModule("training")`, and the approved Safety capability;
- learner routes derive the driver from the verified JWT and ownership-check assignment and attempt IDs;
- the server projects learner-safe question data and grades against protected answer keys;
- media URLs are short-lived and minted only after entitlement, feature, assignment, version, and asset checks;
- progress, submission, and completion transitions are idempotent and replay-safe; and
- content, assignment, scoring, reset, and correction actions write audit/training events.

### 11.5 Driver application

Module 2 adds no new top-level feature key. It appears within the feature-gated Safety Training experience after Module 1.

Required states beyond the generic player:

- scenario loading and minimum-resolution check;
- observation phase without answer reveal;
- question phase;
- post-response reveal/rationale;
- alternate accessible form;
- clip unavailable or cue not legible;
- resume without skipping required evidence; and
- correction when the published scenario is withdrawn.

The app must not request live location, camera, microphone, or motion permissions for Module 2.

### 11.6 Telematics and personalization boundary

Current FuelGuard driver-performance data may be useful for human review, but it does not identify why a crash, harsh brake, or speeding duration occurred and does not show whether the driver saw a hazard early.

Default release behavior:

- no automatic Module 2 assignment from `safety_score`, `crash_count`, `harsh_brake_count`, or `speeding_ms`;
- no claim that Module 2 completion improves those fields;
- no display of score data inside the learning experience; and
- no joining of individual question answers to performance dashboards.

A future integration requires a separate decision record defining trigger validity, exposure normalization, provider coverage, human review, fairness, privacy, appeal/correction, retention, and evaluation.

### 11.7 Analytics

Collect only what supports learning integrity and approved pilot evaluation:

- assignment/version/form IDs;
- start, resume, submission, terminal status, and server timestamps;
- scenario and question version;
- selected response and correctness where access policy permits;
- technical playback/error events;
- standard versus alternate accessible form; and
- support/ambiguity flags.

Do not collect gaze, inferred attention, live location, or continuous driving behavior. Do not use response time for grading.

## 12. Execution plan

### Phase M2.0 — Resolve prerequisites and refresh evidence

**Work**

1. Refresh branch, commit, migration head, worktree, entitlement, feature, training foundation, driver identity, and device-support evidence.
2. Verify the approved Module 1 content version and shipped platform behavior.
3. Assign owners and resolve M2-D01 through M2-D13 or explicitly remove affected scope.
4. Obtain company policy, approved early-response wording, audience/equipment profile, route environments, and de-identified hazard priorities.
5. Approve the footage and accessibility strategy before script drafting.

**Exit gate:** No missing input can silently change audience, safety instruction, interaction, accessibility, personalization, or technical architecture.

### Phase M2.1 — Hazard taxonomy and source map

**Work**

1. Define cue, developing conflict, immediate hazard, hidden area, priority cue, and early response.
2. Build a hazard taxonomy limited to the approved Module 2 boundary.
3. Map each claim and scenario to authoritative, company-policy, or SME evidence.
4. Conduct structured reviews with safety, operations, trainers, representative drivers, accessibility, legal/privacy, and engineering.
5. Record where public guidance is old, descriptive, non-CMV, or otherwise limited.

**Exit gate:** Reviewers agree on vocabulary, scope, sources, and prohibited claims.

### Phase M2.2 — Scenario and assessment design

**Work**

1. Draft more scenarios than will appear in the module so weak or ambiguous scenes can be removed.
2. Produce cue/conflict/action keys and hidden-information boundaries before narration.
3. Design standard and equivalent accessible forms together.
4. Draft instruction/form A and unseen transfer/form B.
5. Run independent SME keying: reviewers identify cues and preferred actions without seeing the proposed answer.

**Exit gate:** Only scenarios with defensible keys, audience relevance, rights, privacy, visual legibility, and accessibility equivalence remain.

### Phase M2.3 — Script, storyboard, and package proof

**Work**

1. Draft narration within the word/time budget.
2. Complete storyboard, shot list, scenario manifest, graphics, captions, description, and transcript plan.
3. Table-read and time the narration plus observation pauses.
4. Create low-fidelity clips/stills and test cue visibility on representative phone sizes.
5. Review every line and frame for accuracy, originality, safety, policy, legal, privacy, and accessibility.

**Exit gate:** Approved production package with no unresolved factual, policy, rights, safety, or accessibility placeholder.

### Phase M2.4 — FuelGuard implementation and integration

**Work**

1. Reuse the verified generic training foundation and reserve migrations from the actual branch head only if a constrained schema change is necessary.
2. Extend shared contracts and validation for scenario metadata only where the approved design requires it.
3. Add server projection/grading and ownership tests for any new item type.
4. Add driver standard/alternate form and post-response reveal states.
5. Add admin validation for scenario/rendition/checksum/accessibility completeness.
6. Add event, RLS, role, IDOR, replay, rate-limit, and module-off/on tests.

**Exit gate:** Existing repository gates plus Module 2 authorization, grading, rendering, accessibility, and recovery tests pass with exact command evidence.

### Phase M2.5 — Production and controlled pilot

**Work**

1. Acquire or film approved assets without creating road risk.
2. Produce standard, mobile, and approved accessible versions; human-review captions and transcript.
3. Test every assessed cue on the device/network matrix.
4. Pilot with the named cohort using unseen transfer scenarios and accessible forms.
5. Log ambiguity, intervention, support, playback, and reviewer disagreement rather than silently coaching.

**Proposed operational gates, subject to M2-D12:**

- 100% of pilot assignments start, resume, submit, and preserve a terminal result without data repair;
- no cross-tenant, cross-driver, answer-key, rights, privacy, or unsafe-production finding;
- no severity-1/2 accessibility, security, data-loss, or cue-legibility defect;
- at least 90% complete without facilitator intervention;
- at least 80% correctly answer each approved core-objective item after ambiguous items are removed;
- unseen transfer performance is reported separately and meets the threshold approved in M2-D12;
- standard and accessible forms show no unexplained objective-level scoring gap requiring redesign;
- every failed or abandoned attempt has an explainable event trail; and
- final video remains within 10–12 minutes.

**Exit gate:** Pilot report disposes every issue as fixed, accepted with owner/date, or release-blocking.

### Phase M2.6 — Release and observation

**Work**

1. Publish immutable Module 2 assets and question/scenario versions.
2. Assign only the approved cohort after Module 1 prerequisites are verified.
3. Expand in waves after technical, accessibility, comprehension, and transfer signals are reviewed.
4. Keep telematics-triggered assignment off unless M2-D10 is separately approved and tested.
5. Freeze evidence and publish a new version for any cue, crop, timing, answer, or rationale change.
6. Feed approved lessons into Module 3 without silently changing Module 2.

**Exit gate:** Named owner accepts the post-release report and authorizes the next module to reuse the package.

## 13. Verification matrix

| Area | Required verification | Pass evidence |
|---|---|---|
| Source and claims | Every factual, numerical, policy, and regulatory statement reviewed in context | Signed source-register disposition by claim and scene. |
| Scenario validity | Independent reviewers identify material cues, plausible conflict, and preferred early action | Agreement record; ambiguous scenes removed or corrected. |
| Boundary control | Module 2 does not teach incomplete procedures reserved for later modules | Cross-module curriculum-owner review. |
| Visual legibility | Priority cues visible before reveal on every supported rendition/device | Signed device/frame matrix with screenshots and checksums. |
| Temporal integrity | Pause/reveal occurs after the same evidence across device, seek, resume, and retry paths | Automated/manual timing record by rendition. |
| Accessibility | Captions, description/transcript, focus, screen reader, Dynamic Type, contrast, non-color cues, equivalent assessment | Accessibility review plus VoiceOver/TalkBack and form-equivalence record. |
| Rights/privacy | Every clip, person, property, identifier, and data source authorized and treated as approved | Media/privacy register and reviewer sign-off. |
| Learning alignment | Every objective maps to instruction, supported practice, and assessment/transfer | Alignment matrix with no orphan objective or item. |
| Grading | Protected answer key, exact-set logic, one terminal result, replay/concurrency safety | Unit/API tests including duplicate and concurrent submit. |
| Tenant/driver isolation | Module, org, role, assignment, attempt, media, and cross-ID checks | Discovered RLS/API/IDOR matrix. |
| Resume/recovery | App kill, network loss, URL expiry, backgrounding, and withdrawn scenario | Device/server event trail shows no false completion or lost response. |
| Telematics separation | No unapproved score trigger, join, claim, or dashboard linkage | Code/config inspection and integration tests. |
| Transfer | Unseen scenarios scored separately from trained examples | Approved pilot report with predeclared analysis. |
| Records | Version, form, scenario/question checksum, response, timestamps, correction event, retention | Sample audit export reviewed by records owner. |
| Release control | Feature and content unavailable before approval; safe revoke/rollback | Staging proof and rollback rehearsal. |

Repository verification must use the commands relevant to the actual touched work at implementation time: shared/API/web/driver typechecks and tests, lint, file/function-size checks, boundary checks, route-auth fitness, migration checks, and every discovered RLS matrix. Record exact commands, counts, and logs.

## 14. Rollout, monitoring, and rollback

### 14.1 Rollout

- Require the approved Module 1 prerequisite version.
- Start with the M2-D12 pilot cohort and expand only by named wave.
- Do not assign unlinked drivers through the app.
- Do not use Module 2 completion as a dispatch block until due dates, exceptions, support, and accessibility paths are approved.
- Do not auto-assign from driver score or Samsara aggregates in version 1.

### 14.2 Monitoring

Monitor:

- assignment/start/resume/submission/terminal counts;
- video start, buffering, crop/resolution, URL expiry, and media failures;
- standard versus accessible form use and completion;
- per-objective and unseen-transfer performance;
- item ambiguity, challenge, and support flags;
- unexpected differences by platform, language, form, terminal, or approved cohort attributes;
- correction/withdrawal events and version consistency; and
- later road-check observations only under an approved, separate evaluation design.

Do not interpret completion rate, watch duration, or weekly Samsara aggregates as proof the driver recognized hazards on the road.

### 14.3 Rollback

1. Pause new Module 2 assignments.
2. Withdraw the affected published version or disable the training feature/module if broader access must stop.
3. Revoke affected media sessions according to the approved URL/cache design.
4. Preserve attempts, responses, and events for investigation.
5. Mark invalid items/scenarios through a correction event and re-evaluate affected results under an approved rule.
6. Publish a corrected immutable version; never replace the video, crop, answer key, or cue timing in place.
7. Notify assigned learners and administrators of the disposition.

## 15. Risks and controls

| Risk | Impact | Control | Owner |
|---|---|---|---|
| Generic plan is treated as company policy | Inaccurate or unsafe instruction | M2-D02–D05 and line-by-line owner approval. | Safety/operations TBD |
| A visual cue is invisible on a phone | Invalid assessment and learner frustration | Device/rendition cue-legibility matrix before release. | Production/QA TBD |
| Narration or caption reveals the answer | Assessment invalidity | Timestamped cue/reveal review and alternate-form design. | Learning/accessibility TBD |
| Accessible form is easier, harder, or incomplete | Unequal access or invalid scores | Design forms together; SME/accessibility equivalence and pilot analysis. | Accessibility owner TBD |
| Old statistics are presented as current causal facts | Misleading training/legal exposure | M2-D13, claim register, LTCCS limitations, remove unnecessary numbers. | Compliance/legal TBD |
| Unlicensed or identifiable event footage is used | IP, privacy, or employment harm | Rights/privacy register, de-identification, approvals, retention rule. | Legal/privacy TBD |
| Unsafe event is created for filming | Injury or operational event | Controlled capture, fixed equipment, simulation/graphics, safety plan. | Production/safety TBD |
| Hotspot/timed interaction is overbuilt | Delay and inaccessible behavior | Default to standard questions; require M2-D07 evidence for custom type. | Product/engineering TBD |
| Telematics count is treated as diagnosis or fault | Unfair targeting and false causality | Default no automatic integration; separate reviewed decision. | Safety/privacy TBD |
| Same clips are used for teaching and “transfer” | Inflated learning result | Separate unseen form B and predeclared analysis. | Learning owner TBD |
| Module overlaps or contradicts later instruction | Curriculum inconsistency | Cross-module boundary matrix and owner review. | Program owner TBD |
| Training feature is released before foundation | Broken or insecure learner path | M2-D01 and end-to-end release gate. | Engineering/release TBD |

## 16. Required approval record

Before production, capture:

- approved Module 1 prerequisite and generic platform version;
- audience, equipment, route environments, and exclusions;
- vocabulary, exact look-ahead standard, early-response wording, and module boundaries;
- hazard priorities and approved company-policy sources;
- footage/source mix, licenses/releases, privacy treatment, and filming safety plan;
- standard and accessible scenario/assessment forms;
- objectives, script, storyboard, scenario manifest, question bank, and timing;
- languages, reviewers, and localization QA;
- pass, retake, feedback, correction, retention, and access rules;
- telematics no-use or approved-use disposition;
- technical architecture, device/network matrix, cost, and support model;
- pilot cohort, predeclared gates, results, and issue dispositions; and
- final release version, checksums, approvers, dates, and rollback owner.

No blank approval field may be interpreted as approval.

## 17. Source register

### Internal evidence

1. `SILVICOM360 Defensive Driving/Silvicom360_Defensive_Driving_System_Plan.docx` — source program plan, reviewed 2026-08-17.
2. `docs/plans/silvicom360/MODULE-01-INTRODUCTION-PROFESSIONAL-MINDSET.md` — current generic training foundation plan and unresolved program-level gates.
3. `packages/shared/src/entitlements.ts` and `packages/shared/src/featureCatalog.ts` — training entitlement and unreleased driver feature.
4. `supabase/migrations/0088_module_entitlements.sql`, `0134_driver_app_features.sql`, `0139_backfill_modules_existing_orgs.sql` — entitlement and feature-control model.
5. `apps/api/src/routes/me.ts`, `apps/api/src/middleware/requireModule.ts`, `apps/api/src/app.ts` — driver identity, module authorization, and API composition.
6. `apps/driver/package.json`, `apps/driver/app/_layout.tsx`, `apps/driver/app/(tabs)/more.tsx`, `apps/driver/DESIGN.md` — current learner-app platform and design contract.
7. `supabase/migrations/0054_driver_scores.sql`, `packages/shared/src/driverPerformance/parse.ts`, `apps/api/src/services/driverScoreSync.ts`, `apps/api/src/lib/samsaraDriverPerformance.ts` — weekly Samsara-derived safety aggregates and provider mapping.
8. `packages/shared/src/notificationsContract.ts`, migrations `0089_notifications.sql` and `0154_efs_alert_pipeline.sql` — notification vocabulary and current `training_due` seam.
9. Migration/code search on 2026-08-17 — no general training schema and no event-level dashcam, near-miss, collision-review, or hazard-label repository found.

### External authoritative sources checked 2026-08-17

1. Current eCFR, 49 CFR Part 392: https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-392
2. FMCSA CMV Driving Tips overview: https://www.fmcsa.dot.gov/safety/driver-safety/cmv-driving-tips-overview
3. FMCSA CMV Driving Tips — Inadequate Surveillance: https://www.fmcsa.dot.gov/safety/driver-safety/cmv-driving-tips-inadequate-surveillance
4. FMCSA CMV Driving Tips — Inadequate Evasive Action: https://www.fmcsa.dot.gov/safety/driver-safety/cmv-driving-tips-inadequate-evasive-action
5. FMCSA CMV Driving Tips — Unfamiliar Roadway: https://www.fmcsa.dot.gov/safety/driver-safety/cmv-driving-tips-unfamiliar-roadway
6. FMCSA Large Truck Crash Causation Study analysis brief: https://www.fmcsa.dot.gov/safety/research-and-analysis/large-truck-crash-causation-study-analysis-brief
7. FMCSA Report to Congress on the LTCCS: https://www.fmcsa.dot.gov/safety/research-and-analysis/report-congress-large-truck-crash-causation-study-0
8. FMCSA LTCCS report PDF: https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/ltccs-2006.pdf
9. NHTSA evaluation of updated Risk Awareness and Perception Training, DOT HS 812 379: https://rosap.ntl.bts.gov/view/dot/2086
10. NHTSA Driver Simulation research overview: https://www.nhtsa.gov/research-data/driver-simulation
11. W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
12. W3C Description of Visual Information: https://www.w3.org/WAI/media/av/description/
13. W3C Audio and Video Content guidance: https://www.w3.org/WAI/media/av/av-content/
14. W3C Understanding Captions (Prerecorded): https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded
15. Expo Video documentation: https://docs.expo.dev/versions/latest/sdk/video/
16. Supabase private storage buckets: https://supabase.com/docs/guides/storage/buckets/fundamentals
17. Supabase resumable uploads: https://supabase.com/docs/guides/storage/uploads/resumable-uploads

## 18. Definition of done for this planning document

This plan becomes **Approved for execution** only when:

1. the source plan and current code baseline are refreshed if work starts from another document version, branch, commit, or migration head;
2. the approved Module 1 prerequisite and generic training implementation are named and verified;
3. M2-D01 through M2-D13 each has a named disposition, owner, and date;
4. content, policy, safety, operations, legal/privacy, accessibility, learning, engineering, production, and pilot owners approve their sections;
5. every scenario has a rights/privacy record, evidence key, accessible equivalent, immutable version, and device-legibility proof;
6. any approved deviation is recorded in a new document version; and
7. implementation and production are tracked against phase exit gates rather than prose alone.
