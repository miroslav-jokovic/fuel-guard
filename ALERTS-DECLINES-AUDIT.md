# Alerts & Declined-Transactions — Audit (v2, with confirmed EFS data)

**Prepared for:** Miki
**Date:** July 13, 2026
**Case:** EFS "Failed Proximity Validation" on invoice `0851226257`, Pilot N. Las Vegas NV, 07/11/2026 15:37, 644.26 mi. EFS reports **Truck 572**; our app's Rejections page shows **Unit 576**; we scored it **Clear**.

> This version corrects v1. My first pass guessed our system had mis-attributed the decline *to* 572. The real data shows the opposite: **EFS is the source of 572, and our importer keeps only 576 and drops 572.** Details below.

---

## 1. The short version

Three facts, all now confirmed against the actual EFS record and our code:

1. **572 and 576 are two different fields on the same event.** **572** is the truck the **card is assigned to** in EFS — the one EFS runs its proximity check against and prints in the alert. **576** is the **unit keyed at the pump**, which is the only field our importer stores. There's "no trace of 572" in our system because **we never read EFS's Truck field on import — we drop it.**
2. **This is a real "card not with its truck" event.** Card `…7521` (assigned to 572) was swiped at Pilot N. Las Vegas while **truck 572's GPS was 644 miles away**. EFS correctly blocked it. Whether it's a stale card assignment, buddy-fueling, or a cloned card depends on **where truck 576 actually was at 15:33** (Section 6).
3. **We ignored EFS's own fraud verdict and scored it "Clear."** EFS did the detection for us ("Failed Proximity Validation"), and our system let it through — because our decline-reason classifier doesn't recognize "position too far / proximity / invalid truckstop," and our own decline location-check is dead code.

Net: the event is genuinely worth attention, and our alerting **missed it** and **presented it confusingly**. Both are code problems with clear fixes.

---

## 2. What the EFS record and our record actually contain

| Field | EFS (alert + reject report) | Our Rejections page | Source |
|---|---|---|---|
| Truck (card-assigned) | **572** | *(not stored)* | EFS card→truck registration; used for the proximity check |
| Unit (pump-entered) | 576 (in the file's Unit column) | **576** | Whoever keyed the pump; the field our parser reads |
| Alert / reason | Failed Proximity Validation · Merchant Position Too Far | "INVALID TRUCKSTOP … Merchant Position Too Far" | EFS decline reason |
| Proximity | **644.26 mi** | *(not stored)* | EFS telematics geofence |
| Truck location time | 15:33 | *(not stored)* | EFS telematics |
| Card # | `7083050030281917521` | `…7521` | — |
| Driver | — | TEHONE CARTER | EFS |
| Our suspicion score | — | **Clear** | our scorer |

The whole story is in row 1: two truck identifiers that **disagree**, and we keep the wrong one and discard the meaningful one.

---

## 3. What's broken (verified in code)

### Bug A — We read the pump "Unit" and never read EFS's "Truck"
`normalizeRejectRows` does `unit: str(pick(row, "Unit"))` and there is **no** `pick(row, "Truck" / "Tractor" / "Vehicle")` anywhere in the parser. EFS's card-assigned truck (572), the proximity distance (644 mi), and the truck-location-time are all **dropped on import.** So you literally cannot reconcile 572 vs 576 inside our app — half the evidence never gets stored.

### Bug B — We don't recognize EFS's proximity verdict, so it scores "Clear"
The decline-reason classifier `isRestrictedDeclineReason` matches `site | location | geofence | product | restrict | not allowed | unauthorized | outside | limit exceed`. It does **not** match **"position too far," "proximity," "failed proximity," or "invalid truckstop."** EFS's single strongest location-fraud reason therefore contributes **zero** to our suspicion score. Combined with Bug C, the decline scores **Clear** — which is exactly what your screenshot shows.

### Bug C — Our own decline location-check is dead code
From the earlier audit and still true: the decline importer never sets `declined_transactions.vehicle_id`, and the scorer's location reconciliation is gated on `if (d.vehicle_id)`. So even our independent "was the truck there?" check never runs on declines. We had **two** ways to catch this (EFS's reason text, and our own telematics check) and **both** are switched off.

### Bug D — The card→truck table (`fuel_cards`) is unused
`fuel_cards` maps `card_ref → vehicle_id`. Nothing populates or reads it. If it held "`…7521` → 572," we could have instantly said *"card assigned to 572 was used to fuel 576"* — the exact alert you needed. It's the missing control.

---

## 4. What "Failed Proximity Validation / Position Too Far" means

It's EFS's **telematics geofence**: at authorization, EFS compares the merchant's location to the **card-assigned truck's** GPS and declines if they're too far apart. A 644-mile gap is not a GPS glitch. It's one of:

- **Stale card assignment** — the card is physically in truck 576 now, but EFS still has it registered to 572. Benign-ish, but it breaks every location control and creates false-looking alerts until the assignment is corrected.
- **Buddy-fueling / unauthorized use** — 572's card used to fuel a different truck (or a personal vehicle).
- **Cloned / stolen card** — the card (or its number) is being used remotely while the truck is elsewhere.

EFS did the right thing by declining. The value we should add is **telling these three apart and surfacing them**, which today we don't.

---

## 5. Most likely reading of *this* case

Card `…7521` is registered to **572**. It was used at Pilot N. Las Vegas and the pump got unit **576**, while **572 was 644 mi away** → EFS proximity decline. So the card was **not with truck 572**. The deciding question is where **576** was at 15:33:

- **576 was at that Pilot** → the card assignment is simply **stale** (should be reassigned from 572 to 576). Low harm, but fix the record and this stops.
- **576 was *not* there either** → the card is being used away from **both** its assigned truck and the truck named at the pump → treat as **likely fraud**: freeze the card, review driver TEHONE CARTER's recent activity.

Our system currently can't make that call because it dropped 572 and the distance, and never checked 576's telematics.

---

## 6. What to do — recommendations (sharpened)

1. **Honor EFS's verdict.** Add "position too far / proximity / failed proximity / invalid truckstop" (and similar) to the decline-reason classifier and treat a proximity failure as an **alert-level** signal on its own. This one change flips this exact case from *Clear* to *Alert*. *(Smallest, highest-value fix.)*
2. **Capture BOTH truck fields + the distance.** Parse and store EFS's **Truck** (card-assigned, 572), the **pump Unit** (576), **proximity miles** (644), and **truck-location-time**. Show them together and flag when Truck ≠ Unit. This ends the "no trace of 572" confusion permanently.
3. **Add a "Card / truck mismatch" alert.** When the pump unit ≠ the card-assigned truck (from EFS's Truck field and/or `fuel_cards`), raise a named alert: *"Card assigned to 572 used on truck 576, 644 mi from 572."*
4. **Attribute declines to a vehicle** (by unit, and by `fuel_cards` card→truck) so our own location scorer runs as a second opinion — and cross-check against 576's telematics to auto-classify stale-assignment vs. fraud.
5. **Populate and use `fuel_cards`** so the card→truck ground truth exists (and stale assignments become their own report).
6. **Re-score history** after the above, so past proximity declines that scored Clear get re-evaluated.

---

## 7. Confirm this case in ~10 minutes (with data you already have)

1. In your telematics, pull **truck 576's GPS around 07/11 15:33** — was it at/near Pilot N. Las Vegas? (Decides stale-assignment vs. fraud.)
2. In EFS, check which truck **card `…7521` is assigned to** — confirm it's 572, and whether it *should* be 576.
3. In our data, the row for invoice `0851226257` will show `unit = 576` and `vehicle_id = null` (proving Bugs A/C); the raw EFS file for that invoice will have a **Truck** column = 572 that we ignored (proving Bug A).

If 576 was at that Pilot → correct the card assignment. If not → freeze the card and review the driver. Either way, Recommendations 1–3 make sure the **next** one is caught and clearly labeled instead of scoring Clear.

I can implement #1 + #2 + #3 as a scoped, tested change (same approach as the idling work) — together they turn this from an invisible "Clear" into a clear, named alert with both truck numbers and the distance on it.

---

**Sources (telematics fuel-card geofencing / fraud controls):**
- [How Fuel Cards With Telematics Integration Prevent Unauthorized Purchases — FleetRabbit](https://fleetrabbit.com/article/fuel-card-telematics-integration-prevent-unauthorized)
- [Fuel Card Fraud: Tips to Detect & Prevent — FreightWaves Checkpoint](https://www.freightwaves.com/checkpoint/fuel-card-fraud/)
