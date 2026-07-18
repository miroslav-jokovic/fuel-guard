# Idling Logic & Report — Audit

**Prepared for:** Miki
**Date:** July 13, 2026
**Scope:** FuelGuard idle tracking — data pipeline, scoring logic, vehicle capability flags, and the on-screen Idling report.

---

## 1. The short version

You already have a real system here, and it is doing more than Samsara does out of the box. The good news is that your central goal — *"measure real idling, not all working time"* — is already met: the pipeline only ever looks at true engine-on/not-moving idle, and it then strips out the parts that aren't waste (work, extreme weather, short stops) before anyone is scored or charged a dollar figure.

Where the gaps are is exactly where you said they'd be:

1. **APU and Optimized Idle are treated as the same thing.** Today the vehicle setup has a single Yes/No switch that lumps "has an APU" together with "has Freightliner Cascadia Optimized Idle." These two need to be marked separately, and they should not be scored the same way — an Optimized-Idle truck's engine running *is* the fuel-saving feature working, so penalizing it as waste is unfair.
2. **The vehicle marking work isn't finished, and the field to finish it doesn't fully exist yet.** The database has a spare "apu_type" column but nothing in the app writes to it or reads it, so there's no place in the UI to record *which* kind of idle-reduction a truck has.
3. **The report reads like Samsara.** The column names are internal jargon — "Discretionary hrs," "Discr. %," "productive/justified" — which don't tell a dispatcher or an owner what they're looking at. This is a rename-and-reformat job, not a data problem.

Everything below explains what exists, then what to change.

---

## 2. What "real idling" means in your system today

This is the part you got right, so it's worth being clear about *why* it's right.

Your numbers do **not** come from total engine-on time. They come from Samsara's Idling Events feed, which only reports periods where the **engine is running, the truck is not moving, for more than 2 minutes**, and it is already PTO-aware (it knows when the truck is doing work like running a lift gate or pump). So driving time, and stop-and-go, never enter the idle numbers at all.

On top of that raw idle, your own logic sorts every idle event into one of four buckets:

| Your internal name | What it actually is | Counts as waste? |
|---|---|---|
| `brief` | Idle shorter than 5 minutes — a normal stop at a light, a quick check | No |
| `productive` | PTO was active — the engine was running to do work | No |
| `justified` | Weather was outside the comfort band (too hot/cold) — cab heating or cooling | No |
| `discretionary` | Engine running, no work, comfortable weather — sleeping, waiting, phone | **Yes** |

Only the **discretionary** bucket drives the driver score and the "wasted money" figure. That is the definition of "real idling that wastes money," and it's implemented correctly.

**Two details worth knowing:**

- **The comfort band is learnable.** The system watches how your fleet idles versus outside temperature and can *suggest* a data-driven hot/cold band (e.g. it notices your drivers barely idle at 60°F but idle heavily below 15°F and above 90°F). This suggestion is shown but never auto-applied — an admin has to adopt it. Default band is 20°F–85°F.
- **The dollar figure is yours, not Samsara's.** Idle cost is calculated as *gallons × your fleet's actual recent EFS price per gallon*, not Samsara's fuel-cost field (which was deemed unreliable). Gallons come from Samsara's measured burn when available, otherwise 0.8 gal/hour (a standard Class-8 main-engine idle rate). This is a genuinely more precise cost than Samsara gives you.

---

## 3. Vehicle capability — APU & Optimized Idle (the main gap)

You have **two independent sources of truth** about whether a truck can avoid idling, and this is a smart design:

1. **Manual flag (`has_apu`)** — what you record by hand on the Vehicles page. This is treated as the authority, because a diesel APU is a separate engine that telematics literally cannot see (it's not on the truck's data bus). This is correct and unavoidable — APU status *has* to be entered by a human.
2. **Learned capability (`idle_capability`)** — the system studies each truck's engine on/off pattern during long parks and infers one of: `apu`, `ecu_optimized`, `continuous_only`, or `unknown`. This runs automatically and is used as a **cross-check** — the report flags trucks where "what you recorded" and "what the telematics shows" disagree, so you know which trucks to go verify.

That cross-check design is genuinely good. **But here is the problem you already sensed:**

### 3.1 The manual flag can't tell APU apart from Optimized Idle

The learned side already distinguishes three real states — true APU, ECU optimized cycling, and continuous-only. **The manual side is only a single Yes/No.** In the vehicle form the option literally reads *"Has APU / optimized idle"* — one choice for two very different pieces of equipment:

- A **true APU / battery-HVAC / shore power** truck: the main engine should be **off** during rest. Main-engine idle here is real waste.
- A **Freightliner Cascadia with Optimized Idle**: the main engine is *supposed* to start and stop on its own to hold cab temperature and battery charge. That engine running **is the feature working**, not the driver wasting fuel.

Because both are recorded as `has_apu = true`, the scoring treats them identically:

- Both get their extreme-weather idle counted as **discretionary/avoidable** (see `classifyIdleEvent`), and
- Both get flagged **"Avoidable · APU"** in the Longest Avoidable Idles list (see `topAvoidableIdles`).

For a true APU truck that's correct. **For an Optimized-Idle Cascadia it is wrong** — you'll be telling a driver they wasted fuel when the truck's own OEM system was doing exactly what it's designed to do. That undermines trust in the whole scorecard.

### 3.2 The database is half-ready for this

Migration `0046_vehicle_apu.sql` already added an **`apu_type`** column meant to hold `diesel_apu | battery_hvac | fuel_heater | shore_power | none`. **Nothing uses it.** It is not in the vehicle form, not in the save/validation schema (`fleet.ts`), and not in the columns the app reads back (`useVehicles.ts`). So the richer classification you'll need already has a home in the database — it just was never wired up.

### 3.3 What needs to change

To do the vehicle marking properly and score fairly, the recommendation is:

1. **Split the single flag into two clear questions on the Vehicles page:**
   - *"Idle-reduction equipment"* → None / **APU (diesel)** / **Battery HVAC** / **Shore power** / **Fuel-fired heater** (this fills the existing `apu_type`).
   - *"OEM Optimized Idle"* → Yes / No (a new small flag, e.g. `has_optimized_idle`, for Cascadia and similar).
2. **Score them differently:**
   - **APU / battery / shore power** → main-engine idle during rest is **avoidable** (current behavior — keep it).
   - **Optimized Idle** → engine cycling in extreme weather should be treated as **justified**, not discretionary; only clearly excessive continuous idle beyond what the OEM system would do should count.
   - **Nothing** → extreme-weather idle stays **justified** (the engine is the only climate source) — this is already how "no APU" behaves.
3. **Finish the marking pass.** You mentioned you still have to go through and mark every vehicle. Once the two-field version above exists, that becomes a clean data-entry task, and the built-in cross-check will immediately show you which trucks you marked in a way the telematics disagrees with — a free QA pass.

---

## 4. Driver rating — does it prevent wasted money?

Yes, and it's fair by design. Each driver gets:

- A **score 0–100** (100 = no avoidable idle; it drops as the *share* of a driver's idle that is avoidable rises). Because it's a share, a driver who runs long legitimate PTO idle isn't punished for it.
- **Dollars wasted**, gallons wasted, avoidable hours, total idle hours, count of long idles (>1 hr), and a **week-over-week trend arrow** (improving / worsening).
- Idle that **couldn't be tied to a driver** (Samsara had no operator assigned) is shown as a separate **"Unattributed"** line — correctly *not* blamed on a person, and the report tells you what % of wasted dollars it could actually attribute, so you know how trustworthy the leaderboard is.

The one thing that limits driver rating quality is **attribution coverage**: idle events only get a driver when Samsara had a driver assigned to that vehicle at that time. If Samsara driver assignments are thin, a lot of waste lands in "Unattributed." Worth watching that attributed-% number; if it's low, the fix is in Samsara driver-vehicle assignments, not in this logic.

**One fairness note tied to Section 3:** driver rating is only as fair as the vehicle flags. Until Optimized-Idle trucks are marked separately, drivers on Cascadias will look worse than they are. Fixing the vehicle marking directly improves the fairness of the driver scores.

---

## 5. The report page — renaming & reformatting for plain language

This is the most visible fix. The current Idling page has three tabs (Drivers, Avoidable idles, Truck capability) and the bones are good — the problem is purely the **words**. Here's a column-by-column plain-language rewrite you can hand straight to whoever updates the UI.

### 5.1 Fleet summary tiles (top of page)

| Current label | Suggested label | Why |
|---|---|---|
| Wasted on idle (30 d) | **Money wasted idling (last 30 days)** | "on idle" is ambiguous |
| Discretionary idle hours | **Avoidable idle hours** | "discretionary" is jargon |
| Projected annual waste | **Projected yearly waste** | fine, minor |

### 5.2 Drivers tab

| Current column | Suggested column | Why |
|---|---|---|
| Score | **Idle score (0–100)** | tell them the scale |
| $ wasted | **Money wasted** | plain |
| Discretionary hrs | **Avoidable idle (hrs)** | the key rename |
| Total idle hrs | **Total idle (hrs)** | fine |
| Discr. % | **% of idle that was avoidable** | "Discr. %" is unreadable |
| Long idles | **Long idles (1 hr +)** | say what "long" means |
| 7-day trend | **Trend vs last week** | plain |

### 5.3 Avoidable idles tab

| Current column | Suggested column | Why |
|---|---|---|
| "Longest avoidable idles" (title) | **Biggest idle events to coach** | outcome-focused |
| Est. cost | **Estimated cost** | spell it out |
| Equipment → "Avoidable · APU" | **"Engine off was possible (APU)"** | says the action |
| Equipment → "No APU" | **"No idle-reduction equipment"** | clearer |
| Equipment → "APU unknown" | **"Equipment not recorded — set it"** | tells them what to do |

### 5.4 Truck capability tab

| Current column | Suggested column | Why |
|---|---|---|
| APU (recorded) | **Idle-reduction equipment (recorded)** | matches the new two-field setup |
| Telematics (learned) | **What the data suggests** | plainer than "telematics/learned" |
| Optimized idle % | **% of parked time engine was off/optimized** | the label is meaningless as-is |
| Cross-check → "✓ agrees" / "⚠ review" | **"Matches" / "Doesn't match — check"** | plain |
| Badge "No optimization" | **"Continuous idle only"** | describes the truck honestly |

### 5.5 "How idle is scored" panel

The explanation panel still leans on "discretionary / justified / productive." Rewrite it in one plain paragraph, e.g.:

> *"We only count idling that could have been avoided — engine running while parked, in comfortable weather, with no work being done. We don't count short stops, idling to run equipment (PTO), or idling to heat/cool the cab in extreme weather. Only avoidable idle affects a driver's score and the wasted-money total."*

> **Naming principle:** everywhere the code says **discretionary**, the screen should say **avoidable**; where it says **justified**, say **weather-excused**; where it says **productive**, say **working (PTO)**. Keep the internal code names as-is (changing them is risky) — this is a display-label change only.

---

## 6. One bigger question to decide

Right now "real idling" is **Samsara's idle event list, re-classified and re-priced by you.** Your own raw engine-state analysis (the park-session logic) is used *only* to learn each truck's capability — it does **not** independently recompute idle durations.

That's a reasonable design and I'd keep it. But it's worth being explicit about, because your note said *"create our own precise logic that will follow real idling."* If your intent is to eventually stop depending on Samsara's idle-event feed entirely and compute every idle minute yourself from raw engine states, that's a larger project and not what's built today. My recommendation: **don't** — Samsara's idle detection is solid and PTO-aware, and rebuilding it yourself adds risk for little gain. Your precision layer (classification + your own cost model + capability fairness) is where the real value is, and that's already yours.

---

## 7. Priority list — what to update

1. **Split APU vs Optimized Idle on vehicles** (wire up `apu_type`, add an Optimized-Idle flag). *Highest impact — it fixes scoring fairness and unblocks your marking pass.*
2. **Make scoring capability-aware for Optimized Idle** (stop flagging Cascadia engine-cycling as avoidable waste).
3. **Finish marking every vehicle** once the two-field setup exists; use the built-in cross-check as your QA.
4. **Rename the report columns and the scoring blurb** to the plain-language set in Section 5.
5. **Watch the attribution %** — if a lot of waste is "Unattributed," fix Samsara driver assignments so driver ratings are complete.

Nothing here requires throwing anything away. The engine is sound; this is finishing the vehicle-marking model, making the scoring fair to Optimized-Idle trucks, and translating the screen into language your whole team can read.
