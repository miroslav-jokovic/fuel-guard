# Driver App Design System 2.0 — Phase 1 Operating Model

> Status: **Phase 1 repository work complete; field validation open**
>
> Owner surface: `apps/driver`
>
> Created: 2026-08-07
>
> This is a redesign track, not the numbered engineering phases in `DRIVER-APP-PLAN.md`.

**Owner direction, 2026-08-07:** field interviews and owner usability testing are deferred until
the visual redesign is assembled. The open validation items remain recorded below, but they no
longer block reversible token, component, and screen implementation.

## 1. Outcome

The redesigned app is a **driver mission control**, not a mobile dashboard. It should answer, in
this order:

1. Am I ready to work, and which equipment am I using?
2. What am I doing now?
3. What must I do next?
4. Is anything unsafe, blocked, unsynced, or waiting for me?
5. What supporting information can I inspect without interrupting the job?

Every redesign decision must reduce uncertainty, taps, or reading time for one of those questions.
A larger surface, extra card, illustration, decorative metric, or blank region is not an
improvement unless it does the same.

Phase 1 creates the operating model, provisional information architecture, Today templates,
density rules, research protocol, and validation gates. It deliberately does **not** change
production screens, tokens, fonts, or components; those begin in Design System 2.0 Phase 2 after
the field assumptions below are tested.

## 2. Evidence used

The operating model is based on:

- The current Driver app routes and reusable components.
- The implemented duty, equipment, load, stop-capture, hazmat, score, message, notification,
  offline, and sync behaviors.
- `FIELD-REPORTS.md`, especially the real-device safe-area and capture observations.
- The locked product and security decisions in `DRIVER-APP-PLAN.md` and
  `DRIVER-APP-DECISIONS-2026-08-07.md`.
- Apple guidance for adaptable layouts, safe areas, Dynamic Type, minimum hit regions, and
  accessibility settings.
- Current Uber Freight, Samsara Driver, and J.B. Hunt DRIVE product patterns.

The benchmark products are inputs, not visual templates:

| Product | Pattern to learn from | FuelGuard application |
| --- | --- | --- |
| Uber Freight | Route and load transparency | Dense, predictable load summaries and clear next actions |
| Samsara Driver | Task-first, role-aware work surfaces | State-driven Today templates, compliance tasks, offline honesty |
| J.B. Hunt DRIVE | Driver support and company services | Direct operations contacts, maintenance, documents, and training |

## 3. Product principles

### P1. Current work outranks navigation and reporting

The active load, next stop, or required duty action is the most prominent content. Navigation,
score, history, settings, and company information may never displace current work above the fold.

### P2. Dense does not mean cramped

Density comes from removing redundant containers and repeated labels, not shrinking type or touch
targets. Body text remains readable, routine targets remain at least 44pt, and driving-critical
actions use a 56pt target.

### P3. One surface communicates one level of hierarchy

A grouped list is one surface with internal rows and separators. A row does not become another
card. A current-load module may contain route information, but it does not contain a second generic
card around the next stop.

### P4. State is more important than decoration

Operational state uses a stable combination of text, icon, position, and semantic tone. Pills are
reserved for short categorical values that must survive outside their original context; they are
not default labels.

### P5. Offline is a normal state

Cached work remains usable. The interface states what is current, what is stored locally, what is
waiting to sync, and what needs intervention. Connectivity warnings never erase the driver's
primary task.

### P6. Configuration uses strict templates

Fleet configuration can enable capabilities and choose from approved module arrangements. It does
not become a free-form dashboard builder. This preserves learnability across drivers and fleets.

### P7. Platform fidelity is behavioral

iOS follows Apple navigation, safe-area, Dynamic Type, motion, and accessibility conventions.
Android uses equivalent native conventions. Cross-platform consistency comes from shared task
hierarchy and semantic roles, not forced pixel identity.

## 4. Task hierarchy

This is the provisional ranking to validate with drivers. “Placement” is a design obligation, not
an implementation detail.

| Priority | Driver task | Frequency | Failure consequence | Required placement |
| --- | --- | --- | --- | --- |
| 0 | See current load and next required action | Repeated throughout shift | Missed stop or delayed load | Today primary region and load detail |
| 0 | Start, change, or end duty equipment | Daily and at swaps | Wrong attribution or unavailable equipment | Today primary/secondary region; reachable in two taps |
| 0 | See safety, compliance, or blocking exception | Event-driven | Unsafe or unlawful operation | Persistent attention region tied to affected work |
| 0 | Understand offline and sync state | Event-driven | Lost trust, duplicate action, missing proof | Compact status strip; detailed recovery when needed |
| 1 | Review assigned and upcoming loads | Daily | Missed assignment or poor planning | Loads tab and Today preview |
| 1 | Complete stop proof or hazmat capture | At required stops | Incomplete delivery/compliance record | Load-linked task and pinned completion action |
| 1 | Contact dispatch or safety support | Event-driven | Delay or unresolved exception | Contextual contact plus durable support destination |
| 1 | Read material load updates | Event-driven | Work performed against stale instructions | Notification deep link to the exact object |
| 2 | Review coaching and score detail | Weekly | Lower engagement, not immediate operational failure | Today summary; optional detail destination |
| 2 | Review history, training, settings, diagnostics | Occasional | Administrative friction | More, grouped by purpose |

### Prohibited priority inversions

- A greeting may not be larger than the current-work title.
- Score may not appear before active work or attention items.
- A promotion, illustration, or company announcement may not push current work below the fold.
- Notification and message badges may not compete with the primary action.
- An offline banner may not consume more vertical space than the task it qualifies.

## 5. Operating states

Screens should be designed from state, not from an idealized data-rich dashboard.

| State | Driver question | Today emphasis | Primary action |
| --- | --- | --- | --- |
| Pre-shift | What am I assigned, and can I start? | Next assignment, equipment readiness, unresolved sync | Start your day |
| On duty, no active load | What should I work next? | Duty/equipment line, next released assignment, attention | Open next load |
| Active load | Where am I in the job? | Route, next stop, time window, required task | Continue load / complete next step |
| Between stops | What changes at this stop? | Stop requirements, documents, contact, exception state | Start or complete stop task |
| Equipment swap | Can I safely claim this unit? | Current holder, truck/trailer, consequences | Confirm change |
| Exception/recovery | What failed and what is safe to do? | Plain-language impact, locally saved work, recovery path | Retry, resolve, or contact support |
| Offline | Can I continue and what will sync later? | Cached timestamp, queued actions, unavailable operations | Continue safely or review queue |
| Shift complete | Is everything submitted? | Pending uploads, completed work, end summary | End shift or resolve pending work |

## 6. Provisional information architecture

### Immediate shell

Use four **visibly labelled** destinations:

1. **Today** — duty, active work, attention, and compact weekly context.
2. **Loads** — Current, Upcoming, and History.
3. **Score** — only when `tab.score.detailTab` is enabled.
4. **More** — support, documents, training, settings, and diagnostics.

`Home` becomes `Today` because it describes the content rather than the application location.
Messages and Notifications remain interrupt-driven destinations reached from the header and deep
links. Hazmat remains tied to the affected load with a reference/history entry under More.

### Tasks-tab decision gate

Do not add a generic Tasks tab yet. Replace Score with **Tasks** only if field validation shows all
of the following:

- Drivers routinely have cross-load work that is not naturally attached to a load or stop.
- That work is opened at least as often as detailed Score.
- At least three of five participants fail to find or remember that work from Today and Loads.
- A task destination can contain real work at launch, not placeholders or “coming soon” rows.

Until then, Today owns the attention queue and Loads owns load-linked tasks. This avoids creating a
generic work-management tab before the product has a genuine cross-load task model.

## 7. Today templates

Today uses a strict state-driven template. Modules re-order automatically by operational state;
drivers do not drag and resize cards.

### Template A — Pre-shift

1. Compact identity/date line.
2. Conditional sync or blocking-attention strip.
3. Start-day action with last-used equipment context.
4. Next released assignment summary.
5. Optional weekly score summary.

### Template B — Active load

1. Compact duty/equipment line.
2. Conditional sync or blocking-attention strip.
3. Active route and next-stop module with the one primary action.
4. Compact attention queue for documents, hazmat, changes, or failed uploads.
5. Next assignment preview, if one exists.
6. Optional weekly score summary.

### Template C — On duty, between loads

1. Duty/equipment line with Change action.
2. Conditional attention strip.
3. Next assignment or honest no-assignment state.
4. Pending local work, when present.
5. Optional score summary.

### Template D — Recovery

1. Current work remains visible from cache.
2. Recovery summary states what is saved locally and what is blocked.
3. Primary safe action: continue, retry, review queue, or contact operations.
4. Nonessential modules collapse until the recovery state is cleared.

### Fleet configuration boundary

The fleet may enable Loads, Score, Messages, Notifications, Hazmat, and Training through the
existing feature model. In Design System 2.0, configuration may also choose whether a noncritical
module such as Score appears expanded or compact. The fleet may not remove Duty, sync state,
current work, or safety-critical attention.

## 8. Compact-density contract

These rules apply immediately to new Driver UI and become testable component constraints in Phase 2.

### Viewport baseline

At the default text size on a 390×844pt portrait viewport, a normal Today state should show:

- Driver/duty context.
- Current or next work.
- The primary action.
- The beginning of the next useful information group.

The rule does not override safe areas, Dynamic Type, blocking errors, or translated copy. It prevents
decorative headers and oversized modules from consuming the initial viewport.

### Spacing rules

- Use 8pt for control/icon relationships, 12pt inside compact content groups, 16pt between related
  components, and 24pt between major workflow regions.
- Use 32pt or more only when a genuine workflow boundary or empty-state explanation needs it.
- Do not add vertical space solely to make a screen feel “premium,” “airy,” or symmetrical.
- A primary operational module has no fixed height target. Its current state and primary action must
  remain visible without decorative filler, and it grows for Dynamic Type or required safety copy.
- Screen titles, greetings, illustrations, and empty states do not receive fixed minimum heights.
- An inline empty state uses only the space its message and action require.
- Multiple alerts collapse into one attention summary with a count and expandable detail.

### Container rules

- No card-per-row lists.
- No card inside a card unless the inner surface is an interactive object with an independent
  lifecycle, such as a captured document preview.
- Do not wrap a single heading and paragraph in a card only to create visual interest.
- Group related rows into one surface with separators.
- Use shadow only for a raised navigation/action layer, sheet, or overlay.
- Use pills only for compact categorical state that must remain recognizable out of context.

### Content-density test

For every proposed screen, annotate each vertical region with its driver purpose. If a region does
not answer a driver question, communicate state, or enable an action, remove it. If two adjacent
regions answer the same question, combine them.

## 9. Field-context constraints

| Context | Design response | Validation method |
| --- | --- | --- |
| Bright sunlight | High contrast, minimal low-contrast borders, no essential tertiary text | Outdoor device check at 50% and 100% brightness |
| Night cab | Dark theme without pure-white glare; semantic tones remain distinct | In-cab or dim-room device check |
| Gloves/one hand | 44pt minimum, 48pt routine, 56pt critical action; bottom reach where safe | Complete priority tasks one-handed with work gloves |
| Intermittent connectivity | Cached timestamp, local-save acknowledgement, explicit sync queue | Airplane-mode task and reconnect test |
| Time pressure | Stable placement, one dominant action, no repeated confirmations | Timed stop-completion scenario |
| Large text | Rows grow, actions stack, essential values do not truncate | iOS/Android accessibility-size sweep |
| Motion sensitivity | No delayed information; reduced motion removes springs and long reveals | System Reduce Motion enabled |
| Device variation | Safe-area and keyboard-aware structure; no fixed-height information regions | Small iPhone, large iPhone, min-spec Android, tablet |

## 10. Research protocol

### Participants

Minimum before closing Phase 1:

- Five drivers: at least three company drivers and two owner-operators when available.
- Include one frequent equipment-swap driver and one driver who regularly operates with weak signal.
- Two operational stakeholders: one dispatcher and one safety/compliance or fleet manager.

Do not substitute internal product-team opinions for the five driver sessions.

### Thirty-minute driver session

1. **Context, 5 minutes** — shift type, equipment changes, phone mounting, gloves, connectivity,
   and the moments they open a driver app.
2. **Current-app walkthrough, 10 minutes** — ask the driver to show where they would start a shift,
   find the next load, identify the next action, change equipment, find a failed upload, contact
   dispatch, and explain their score.
3. **Priority sort, 5 minutes** — sort the task hierarchy in §4 into “must see now,” “today,” and
   “occasionally.”
4. **Today-template test, 7 minutes** — present Pre-shift, Active load, and Recovery low-fidelity
   layouts in Phase 2 and ask what is missing, duplicated, or too prominent.
5. **Close, 3 minutes** — ask what would make the app untrustworthy and which information they
   currently confirm by phone or text.

### Neutral prompts

- “What do you think the app wants you to do next?”
- “Where would you look for a changed instruction?”
- “What would you do if this said it was saved locally?”
- “Which item could disappear without affecting your shift?”
- “What information would you need before tapping this action?”

Avoid “Do you like this?”, naming the intended control, or explaining the screen before the driver
has interpreted it.

### Usability tasks and targets

| Task | Success target |
| --- | --- |
| Identify duty state and equipment | Correct without interaction in 5 seconds |
| Identify current load and next action | Correct without interaction in 5 seconds |
| Open next-stop requirements | No more than 1 navigation action from Today |
| Change truck or trailer | No more than 2 navigation actions from Today |
| Explain offline/sync state | Correctly distinguish local, pending, failed, and synced |
| Find dispatch/safety contact | No more than 2 navigation actions |
| Find and explain Score | At least 4/5 can locate it; detail-tab value tested separately |
| Recover a failed upload | At least 4/5 complete without assistance |

Record completion, time, wrong destinations, assistance, confidence from 1–5, and the participant's
first interpretation. Do not collect real load identifiers, BOL images, credentials, CDL data, or
other production PII in research notes.

## 11. Session record template

```text
Participant code:
Driver type: company / owner-operator
Shift pattern:
Equipment swap frequency:
Typical connectivity:
Device / mount / glove context:

Task                         Complete  Time  Wrong taps  Assist  Confidence
Duty + equipment
Current load + next action
Next-stop requirements
Equipment change
Offline state
Support contact
Score
Failed-upload recovery

Must see now:
Needed today:
Occasional:
Duplicated or unnecessary:
Trust concern:
Verbatim observation (no PII):
```

## 12. Decision gates

After five driver sessions and two stakeholder sessions:

1. **Today label:** adopt unless drivers consistently use and search for “Home.”
2. **Score depth:** retain the detail tab only if at least three of five drivers use or intentionally
   inspect detail weekly; otherwise keep the compact Today summary and move detail under More.
3. **Tasks destination:** apply the four-part gate in §6; do not create it from preference alone.
4. **Today ordering:** current work remains first unless safety/compliance research demonstrates a
   higher-risk state that must precede it.
5. **Typography direction:** compare platform UI text with scalable Hanken in sunlight, night, and
   accessibility sizes; retain Hanken for body text only if it performs equally.
6. **Template configuration:** allow fleet-selected variants only when stakeholders need materially
   different task order; otherwise keep automatic state-driven templates.

## 13. Phase 1 exit checklist

- [x] Current screens, tokens, components, and operational states audited.
- [x] Priority task hierarchy authored.
- [x] Compact-density and anti-generic composition rules authored.
- [x] Provisional shell and Tasks/Score decision gate authored.
- [x] State-driven Today templates authored.
- [x] Field-context matrix authored.
- [x] Driver interview and usability protocol authored.
- [x] Measurable task-success targets authored.
- [ ] Five driver sessions completed and summarized without PII.
- [ ] Two operations stakeholder sessions completed and summarized.
- [ ] Navigation, typography, and Today-template decisions closed from evidence.

Phase 2 may proceed with reversible foundation work. Navigation and template choices remain
provisional until the assembled redesign receives owner testing at the end of the visual pass.
